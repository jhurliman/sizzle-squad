-- Remote-chef smoothing under Lune: a chef walking at constant speed is
-- streamed through the real transform packets into the real ClientState and
-- sampled at 60 Hz, the way the render loop does, under five connections:
-- perfectly regular packets, +-25 ms arrival jitter, 10% loss, a 150 ms
-- network stall that delivers its packets in one burst, and a 150 ms stall
-- of the client's own render frame. A sixth case drives the real Replicator
-- to check the send cadence itself.
--
-- What each case catches (the first four were live in the three-human
-- playtest that reported the stutter; against the old ClientState this file
-- reports 170% worst speed error under jitter and 840% at the stall):
--   * jitter:  samples stamped on ARRIVAL made 50 ms of server motion span
--              25..75 ms of buffer time -- +-50% rendered speed, every packet.
--   * stall:   the burst all arrived with one arrival stamp; the interpolator
--              covered three packets of motion in one frame, then stood still.
--   * loss:    with no extrapolation a lost packet could freeze the chef at
--              the newest sample and then jump it to the next.
--   * cadence: `acc = 0` on the send accumulator dropped the remainder, so
--              the average rate was well under TRANSFORM_HZ (and wobbled).
--   * client stall: a pure min-tracking clock offset takes a frame's worth of
--              stale-clock packets as truth and collapses the render delay.
-- The assertions are on RENDERED SPEED (what the gait and the eye react to)
-- rather than position: within 15% of the true speed on every frame after
-- warm-up, never a frame backwards, and the lag behind the truth held
-- within a jitter margin of INTERP_DELAY + latency -- on both sides.
local shared = require("../out/shared-bundle")
local Net = require("../game-src/shared/Net")
local ClientState = require("../game-src/client/ClientState")
local Replicator = require("../game-src/server/Replicator")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

local SPEED = 3 -- cells/s along +x
local LATENCY = 0.06 -- one way
local CLOCK_SKEW = 100 -- local clock = server clock + this; must not matter
local FRAME = 1 / 60
local INTERVAL = 1 / 20 -- Replicator.TRANSFORM_HZ
local DURATION = 6
local WARMUP = 1 -- buffer fill + offset tracker settling
local INTERP_DELAY = 0.12 -- mirrors ClientState
local SPEED_BAND = 0.15
local JITTER_MARGIN = 0.05 -- +-25 ms jitter plus the tracker's slow creep

-- A fixed-seed LCG so a failing run reproduces exactly.
local seed = 12345
local function rand(): number
	seed = (seed * 1103515245 + 12345) % 2147483648
	return seed / 2147483648
end

local function truthX(serverT: number): number
	return 2 + SPEED * serverT
end

local function packet(serverT: number): buffer
	return Net.packTransforms({
		{ id = 1, px = truthX(serverT), py = 5, vx = SPEED, vy = 0, heading = 0, flags = 0, effort = 1, stun = 0 },
	}, serverT)
end

type Pkt = { stamp: number, arrive: number, b: buffer }

--- Build the delivery schedule for a connection profile.
local function schedule(opts: { jitter: number?, loss: number?, hitchAt: number?, hitchLen: number? }): { Pkt }
	local pkts: { Pkt } = {}
	local k = 0
	while k * INTERVAL <= DURATION do
		local t = k * INTERVAL
		k += 1
		if opts.loss ~= nil and rand() < opts.loss then
			continue
		end
		local jitter = if opts.jitter ~= nil then (rand() * 2 - 1) * opts.jitter else 0
		local arrive = t + LATENCY + jitter
		if opts.hitchAt ~= nil and t >= opts.hitchAt and t < opts.hitchAt + (opts.hitchLen or 0) then
			-- everything sent during the stall lands together once it clears
			arrive = opts.hitchAt + (opts.hitchLen or 0) + LATENCY
		end
		table.insert(pkts, { stamp = t, arrive = arrive + CLOCK_SKEW, b = packet(t) })
	end
	table.sort(pkts, function(a, b)
		if a.arrive == b.arrive then
			return a.stamp < b.stamp
		end
		return a.arrive < b.arrive
	end)
	return pkts
end

--- Feed a schedule through ClientState frame by frame and measure the render.
--- `stallAt` (server seconds) makes one render frame stall for `stallLen`
--- AFTER the clock was advanced and BEFORE the packets that arrived during
--- the stall are dispatched -- the order Roblox runs RenderStepped and
--- replication receive in -- so those packets look early. Frames inside
--- `grace` of it may miss the speed band while the tracker takes its
--- bounded correction; nothing else is relaxed.
local function run(name: string, pkts: { Pkt }, stallAt: number?, stallLen: number?, grace: number?)
	local state = ClientState.new(shared, Net)
	state:assign({ chefId = 0, skin = "bramble" })
	state.clock = CLOCK_SKEW
	local pi = 1
	local prev = nil
	local worstDev, badFrames, backwards, worstLag, minLag, nilFrames = 0, 0, 0, -math.huge, math.huge, 0
	local frames = 0
	local pendingStall = 0
	local elapsed = 0
	while elapsed < DURATION do
		local dt = FRAME + pendingStall
		pendingStall = 0
		elapsed += dt
		state.clock += dt
		local dispatchUntil = state.clock
		if stallAt ~= nil and elapsed >= stallAt and elapsed - dt < stallAt then
			dispatchUntil += stallLen or 0
			pendingStall = stallLen or 0
		end
		while pi <= #pkts and pkts[pi].arrive <= dispatchUntil do
			state:applyTransforms(pkts[pi].b)
			pi += 1
		end
		local pose = state:remotePose(1)
		local serverNow = state.clock - CLOCK_SKEW
		if serverNow < WARMUP then
			prev = pose
			continue
		end
		frames += 1
		if pose == nil then
			nilFrames += 1
			prev = nil
			continue
		end
		if prev ~= nil then
			local dx = pose.x - prev.x
			local dev = math.abs(dx / dt - SPEED) / SPEED
			worstDev = math.max(worstDev, dev)
			local inGrace = stallAt ~= nil and serverNow >= stallAt and serverNow < stallAt + (grace or 0)
			if dev > SPEED_BAND and not inGrace then
				badFrames += 1
			end
			if dx < -1e-6 then
				backwards += 1
			end
		end
		local lag = (truthX(serverNow) - pose.x) / SPEED
		worstLag = math.max(worstLag, lag)
		minLag = math.min(minLag, lag)
		prev = pose
	end
	print(`{name}: {frames} frames, worst speed dev {math.floor(worstDev * 1000) / 10}%, {badFrames} outside +-{SPEED_BAND * 100}%, {backwards} backwards, lag {math.floor(minLag * 1000)}..{math.floor(worstLag * 1000)} ms`)
	check(nilFrames == 0, `{name}: a pose every frame`)
	check(badFrames == 0, `{name}: rendered speed within {SPEED_BAND * 100}% of true on every frame`)
	check(backwards == 0, `{name}: never a frame backwards`)
	check(worstLag <= INTERP_DELAY + LATENCY + JITTER_MARGIN, `{name}: never more than INTERP_DELAY+latency+margin behind the truth`)
	-- The lower bound matters as much as the upper: a render nearer the truth
	-- than the delay allows is one whose clock estimate has collapsed and is
	-- living on extrapolation, which a straight-line walk cannot expose any
	-- other way.
	check(minLag >= INTERP_DELAY + LATENCY - JITTER_MARGIN, `{name}: never nearer the truth than INTERP_DELAY+latency-margin`)
end

-- ---------------------------------------------------------------- (a) regular
run("regular", schedule({}))

-- ---------------------------------------------------------------- (b) jitter
run("jitter +-25ms", schedule({ jitter = 0.025 }))

-- ---------------------------------------------------------------- (c) loss
run("10% loss", schedule({ loss = 0.1 }))

-- ---------------------------------------------------------------- (d) hitch
run("150ms hitch", schedule({ hitchAt = 3, hitchLen = 0.15 }))

-- ------------------------------------------------ (e) a slow client frame
--
-- The render frame itself stalls for 150 ms: the clock has already been
-- advanced, the packets that arrive during the stall are dispatched with
-- that stale clock, and every one of them looks 150 ms early. A tracker
-- that simply took the minimum would pull the estimate down by the whole
-- stall and spend seconds drifting back, extrapolating all the way.
run("150ms client stall", schedule({}), 3, 0.15, 0.3)

-- --------------------------------------------- (f) the real send cadence
--
-- The Replicator is driven by a 60 Hz heartbeat whose dt wanders by a
-- millisecond, as a real one does. The old accumulator zeroed itself on every
-- send, so whether the next send took three frames or four depended on that
-- wander -- 50 ms, 66 ms, 50, 66 -- and the mean rate sagged well under 20
-- Hz. With the stamp in the packet the client no longer cares about the
-- spacing, but it still needs the RATE: half the packets means twice the
-- extrapolation.
local function stubRemote()
	local remote = { allFired = {} }
	function remote:FireAllClients(...)
		table.insert(self.allFired, { ... })
	end
	function remote:FireClient() end
	return remote
end
local remotes = {}
for name in Net.REMOTES do
	remotes[name] = stubRemote()
end
local sim = shared.createSim({ seed = 1, botCount = 3 })
local walker = sim.chefs[2] -- id 1
walker.pos.x, walker.pos.y = truthX(0), 5
walker.vel.x, walker.vel.y = SPEED, 0
local rep = Replicator.new(shared, Net, remotes, function()
	return 0
end)
local stepClock = 0
local sent: { Pkt } = {}
local sentCount = 0
while stepClock < DURATION do
	local dt = FRAME + (rand() * 2 - 1) * 0.001
	stepClock += dt
	walker.pos.x = truthX(stepClock)
	local before = #remotes.Transforms.allFired
	rep:flush(sim, {}, dt, stepClock)
	if #remotes.Transforms.allFired > before then
		sentCount += 1
		table.insert(sent, { stamp = stepClock, arrive = stepClock + LATENCY + CLOCK_SKEW, b = remotes.Transforms.allFired[#remotes.Transforms.allFired][1] })
	end
end
print(`replicator: {sentCount} packets in {DURATION}s ({math.floor(sentCount / DURATION * 10) / 10} Hz)`)
check(sentCount >= DURATION / INTERVAL - 2, `replicator sends at TRANSFORM_HZ on average ({sentCount} in {DURATION}s)`)
run("replicator cadence", sent)

-- ------------------------------------------------- the stamp survives a wrap
--
-- The wire stamp is an f32 modulo Net.STAMP_WRAP so it keeps sub-ms precision
-- for the life of a server. The client must read a stamp that just wrapped as
-- one that advanced, not one that went back by the whole window.
do
	local state = ClientState.new(shared, Net)
	state:assign({ chefId = 0, skin = "bramble" })
	local W = Net.STAMP_WRAP
	local c = 500
	local prevX = nil
	local ok = true
	for k = 0, 40 do
		local t = W - 1 + k * INTERVAL -- crosses the wrap around k = 20
		state.clock = c + t + LATENCY
		state:applyTransforms(packet(t))
		state.clock += 0.01
		local pose = state:remotePose(1)
		if pose ~= nil and prevX ~= nil and pose.x < prevX - 1e-6 then
			ok = false
		end
		if pose ~= nil then
			prevX = pose.x
		end
	end
	check(ok, "a wrapped stamp reads as a later sample, not an earlier one")
end

-- ----------------------------------------- a stopped stream does not wander
--
-- Past EXTRAP_MAX the chef holds. A chef whose stream simply ended (left,
-- parked) must not keep walking into the counters until the cull.
do
	local state = ClientState.new(shared, Net)
	state:assign({ chefId = 0, skin = "bramble" })
	state.clock = 0
	for k = 0, 10 do
		state.clock = k * INTERVAL + LATENCY
		state:applyTransforms(packet(k * INTERVAL))
	end
	local lastX = truthX(10 * INTERVAL)
	state.clock += 2
	local pose = state:remotePose(1)
	-- (velocities ride the wire as i8 over +-8 cells/s, so the extrapolated
	-- speed is 3.02, not 3)
	check(pose ~= nil and pose.x <= lastX + SPEED * 0.15 + 0.02, `held within EXTRAP_MAX of the last sample (x={pose and pose.x}, last={lastX})`)
end

if failures > 0 then
	error(`{failures} checks failed`)
end
print("PASS: remote smoothing")
