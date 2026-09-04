-- Remote-chef smoothing under Lune: a chef walking at constant speed is
-- streamed through the real transform packets into the real ClientState and
-- sampled at 60 Hz, the way the render loop does, under a set of
-- connections: perfectly regular packets, +-25 ms arrival jitter, 10% loss,
-- a 150 ms network stall that delivers its packets in one burst, a 150 ms
-- stall of the client's own render frame, a 500 ms outage (lost, and
-- delayed-then-burst), a packet 1.5 s out of order, a 1.5 s stall whose
-- backlog arrives in order, and a chef whose stream stops for 3 s and
-- resumes somewhere else. One more case drives the real Replicator to
-- check the send cadence itself.
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
--   * outage:  a tracker that read "the render ran past the data" as a wrong
--              clock estimate pushed the offset out by the outage and then
--              unwound it at 1.3x; and an uncapped catch-up zips the chef
--              through the deficit at 3x.
--   * straggler: a single far-off packet must not be taken for a server
--              restart -- that wiped the buffers and rewound the chef.
--   * long stall: nor may the in-order backlog after a >1 s stall; the
--              clock never restarts in a session (see (i) below).
--   * resumed stream: a chef back after seconds away is somewhere else;
--              gliding from where it last stood took many seconds.
-- The assertions are on RENDERED SPEED (what the gait and the eye react to)
-- rather than position: within 15% of the true speed on every frame after
-- warm-up, never faster than 1.15x true speed even while recovering, never
-- a frame backwards, and the lag behind the truth held within a jitter
-- margin of INTERP_DELAY + latency -- on both sides.
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
-- Buffer fill plus the tracker's own warm-up: for its first 20 packets it
-- follows the samples symmetrically and only then settles to the minimum.
local WARMUP = 1.5
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

--- A packet for the chef's position at server time `serverT` (from `truth`,
--- the straight walk unless a case says otherwise).
local function packet(serverT: number, truth: ((number) -> number)?): buffer
	return Net.packTransforms({
		{ id = 1, px = (truth or truthX)(serverT), py = 5, vx = SPEED, vy = 0, heading = 0, flags = 0, effort = 1, stun = 0 },
	}, serverT)
end

type Pkt = { stamp: number, arrive: number, b: buffer }

type Profile = {
	jitter: number?,
	loss: number?,
	hitchAt: number?, -- packets sent in [hitchAt, hitchAt+hitchLen) all land together after it
	hitchLen: number?,
	outageAt: number?, -- packets sent in [outageAt, outageAt+outageLen) are lost
	outageLen: number?,
	stragglerAt: number?, -- one extra packet, `stragglerAge` seconds old, arrives at this time
	stragglerAge: number?,
	truth: ((number) -> number)?, -- where the chef really is at a server time (default: the walk)
	duration: number?,
}

--- Build the delivery schedule for a connection profile.
local function schedule(opts: Profile): { Pkt }
	local pkts: { Pkt } = {}
	local duration = opts.duration or DURATION
	local k = 0
	while k * INTERVAL <= duration do
		local t = k * INTERVAL
		k += 1
		if opts.loss ~= nil and rand() < opts.loss then
			continue
		end
		if opts.outageAt ~= nil and t >= opts.outageAt and t < opts.outageAt + (opts.outageLen or 0) then
			continue
		end
		local jitter = if opts.jitter ~= nil then (rand() * 2 - 1) * opts.jitter else 0
		local arrive = t + LATENCY + jitter
		if opts.hitchAt ~= nil and t >= opts.hitchAt and t < opts.hitchAt + (opts.hitchLen or 0) then
			-- everything sent during the stall lands together once it clears
			arrive = opts.hitchAt + (opts.hitchLen or 0) + LATENCY
		end
		table.insert(pkts, { stamp = t, arrive = arrive + CLOCK_SKEW, b = packet(t, opts.truth) })
	end
	if opts.stragglerAt ~= nil then
		local t = opts.stragglerAt - (opts.stragglerAge or 0)
		table.insert(pkts, { stamp = t, arrive = opts.stragglerAt + LATENCY + CLOCK_SKEW, b = packet(t, opts.truth) })
	end
	table.sort(pkts, function(a, b)
		if a.arrive == b.arrive then
			return a.stamp < b.stamp
		end
		return a.arrive < b.arrive
	end)
	return pkts
end

type RunOpts = {
	stallAt: number?, -- one render frame stalls for stallLen (see below)
	stallLen: number?,
	exemptFrom: number?, -- speed band and lag bounds are not asserted in [exemptFrom, exemptTo)
	exemptTo: number?,
	snapExpected: boolean?, -- the case expects ONE snap inside the window: the 1.15x cap is lifted there
	truth: ((number) -> number)?,
	probeAt: number?, -- also return the pose at the first frame at or after this server time
	duration: number?,
}

--- Feed a schedule through ClientState frame by frame and measure the render.
--- `stallAt` (server seconds) makes one render frame stall for `stallLen`
--- AFTER the clock was advanced and BEFORE the packets that arrived during
--- the stall are dispatched -- the order Roblox runs RenderStepped and
--- replication receive in -- so those packets look early. Inside the
--- exempt window the speed band and the lag bounds are not asserted (a
--- chef held through an outage is legitimately slow and late); what IS
--- asserted on every frame, exempt or not, is that the render never runs
--- faster than 1+SPEED_BAND times true speed and never steps backwards --
--- catching up must be walked off, not zipped through. The one exception
--- is a case that says `snapExpected`: a chef a whole tile from where it
--- should be is meant to snap (ClientState's VIS_SNAP / CHEF_GAP), and the
--- window may then contain exactly one fast frame. Returns the state.
local function run(name: string, pkts: { Pkt }, ropts: RunOpts?): (any, any)
	local o: RunOpts = ropts or {}
	local duration = o.duration or DURATION
	local state = ClientState.new(shared, Net)
	state:assign({ chefId = 0, skin = "bramble" })
	state.clock = CLOCK_SKEW
	local pi = 1
	local prev = nil
	local truth = o.truth or truthX
	local probe = nil
	local worstDev, badFrames, fastFrames, snapFrames, backwards, worstLag, minLag, nilFrames = 0, 0, 0, 0, 0, -math.huge, math.huge, 0
	local frames = 0
	local pendingStall = 0
	local elapsed = 0
	while elapsed < duration do
		local dt = FRAME + pendingStall
		pendingStall = 0
		elapsed += dt
		state.clock += dt
		local dispatchUntil = state.clock
		if o.stallAt ~= nil and elapsed >= o.stallAt and elapsed - dt < o.stallAt then
			dispatchUntil += o.stallLen or 0
			pendingStall = o.stallLen or 0
		end
		while pi <= #pkts and pkts[pi].arrive <= dispatchUntil do
			state:applyTransforms(pkts[pi].b)
			pi += 1
		end
		local pose = state:remotePose(1)
		local serverNow = state.clock - CLOCK_SKEW
		if probe == nil and o.probeAt ~= nil and serverNow >= o.probeAt then
			probe = pose
		end
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
		local exempt = o.exemptFrom ~= nil and serverNow >= o.exemptFrom and serverNow < (o.exemptTo or math.huge)
		if prev ~= nil then
			local dx = pose.x - prev.x
			local v = dx / dt
			local dev = math.abs(v - SPEED) / SPEED
			if not exempt then
				worstDev = math.max(worstDev, dev)
				if dev > SPEED_BAND then
					badFrames += 1
				end
			end
			if v > SPEED * (1 + SPEED_BAND) then
				if exempt and o.snapExpected then
					snapFrames += 1
				else
					fastFrames += 1
				end
			end
			if dx < -1e-6 then
				backwards += 1
			end
		end
		if not exempt then
			local lag = (truth(serverNow) - pose.x) / SPEED
			worstLag = math.max(worstLag, lag)
			minLag = math.min(minLag, lag)
		end
		prev = pose
	end
	print(`{name}: {frames} frames, worst speed dev {math.floor(worstDev * 1000) / 10}%, {badFrames} outside +-{SPEED_BAND * 100}%, {fastFrames} over {1 + SPEED_BAND}x, {backwards} backwards, lag {math.floor(minLag * 1000)}..{math.floor(worstLag * 1000)} ms`)
	check(nilFrames == 0, `{name}: a pose every frame`)
	check(badFrames == 0, `{name}: rendered speed within {SPEED_BAND * 100}% of true on every frame`)
	check(fastFrames == 0, `{name}: never faster than {1 + SPEED_BAND}x true speed, outage recovery included`)
	if o.snapExpected then
		check(snapFrames == 1, `{name}: exactly one snap frame ({snapFrames})`)
	end
	check(backwards == 0, `{name}: never a frame backwards`)
	check(worstLag <= INTERP_DELAY + LATENCY + JITTER_MARGIN, `{name}: never more than INTERP_DELAY+latency+margin behind the truth`)
	-- The lower bound matters as much as the upper: a render nearer the truth
	-- than the delay allows is one whose clock estimate has collapsed and is
	-- living on extrapolation, which a straight-line walk cannot expose any
	-- other way.
	check(minLag >= INTERP_DELAY + LATENCY - JITTER_MARGIN, `{name}: never nearer the truth than INTERP_DELAY+latency-margin`)
	return state, probe
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
run("150ms client stall", schedule({}), { stallAt = 3, stallLen = 0.15, exemptFrom = 3, exemptTo = 3.3 })

-- -------------------------------------------------- (g) a 500 ms outage
--
-- Nothing arrives for half a second, then the stream resumes. The clock
-- estimate through the outage is still RIGHT -- packets stopped, the clocks
-- did not -- so the tracker must not touch it: a first version read the
-- render target running past the data as a wrong estimate, added 380 ms to
-- the offset, and then ran the chef at 1.3x for most of a second unwinding
-- it. The chef is held at the extrapolation cap and, when data resumes, is
-- interpolated through the backlog at the existing offset and walks off the
-- deficit at a tenth of its speed: 0.84 cells at 0.3 cells/s is 2.8 s, so
-- the lag band is asserted again from 3 s after the outage cleared. Both
-- kinds: packets lost outright, and packets delayed and delivered in a burst.
run("500ms outage (lost)", schedule({ outageAt = 3, outageLen = 0.5, duration = 8 }), { exemptFrom = 3, exemptTo = 6.5, duration = 8 })
run("500ms outage (burst)", schedule({ hitchAt = 3, hitchLen = 0.5, duration = 8 }), { exemptFrom = 3, exemptTo = 6.5, duration = 8 })

-- ------------------------------------------------- (h) a 1.5 s straggler
--
-- One unreliable packet arrives a second and a half late, in the middle of a
-- healthy stream. It is a second away from the estimate, which is exactly
-- what a server restart looks like -- and a first version took its word for
-- it: cleared every buffer, adopted its delay, rewound the chef to where it
-- was 1.5 s ago and jumped it forward again when the next real packet
-- "restarted" the clock back. A lone straggler is history, not evidence.
do
	local state = run("1.5s straggler", schedule({ stragglerAt = 3, stragglerAge = 1.53 }))
	check(math.abs(state.offset - (CLOCK_SKEW + LATENCY)) < 0.03, `straggler did not move the clock estimate (offset {state.offset})`)
	check(state.offsetPackets > 100, `straggler did not restart the tracker ({state.offsetPackets} packets folded in)`)
end

-- ------------------------------------------------- (i) a 1.5 s stall
--
-- There is NO "server restart" case here, on purpose. SimService.clock is
-- set once per server instance and never reset (not by a round, not by
-- SimService:reset), and a client never outlives its server instance -- it
-- is kicked or teleported and the client script starts over with a fresh
-- ClientState. So there is no in-session clock change to detect, and every
-- attempt to detect one has misfired on something real: a lone 1.5 s
-- straggler (case h), and this -- a stall longer than a second whose
-- backlog then arrives in stamp order, three packets of which "confirmed"
-- a restart and cleared every buffer, twice. The backlog is simply late:
-- the offset was never wrong, so the estimate must move by the slow drift
-- only, and the chef -- four cells behind by now -- snaps rather than
-- gliding for ten seconds (VIS_SNAP).
do
	-- the backlog lands at 4.5 + latency; the frame after it is on the bands
	local state = run("1.5s stall (in-order burst)", schedule({ hitchAt = 3, hitchLen = 1.5, duration = 8 }), { exemptFrom = 3, exemptTo = 4.5 + LATENCY + 2 * FRAME, snapExpected = true, duration = 8 })
	check(math.abs(state.offset - (CLOCK_SKEW + LATENCY)) < 0.05, `stall moved the clock estimate by the drift rate only (offset {state.offset})`)
	check(state.offsetPackets > 100, `stall did not restart the tracker ({state.offsetPackets} packets folded in)`)
end

-- ------------------------------------------ (j) a stream that resumes
--
-- The chef stops streaming for three seconds (parked, dismissed, the slot
-- between players) and comes back ten cells away. Its old history is not a
-- past to interpolate from and the jump is not a correction to glide
-- through -- CHEF_GAP / STALE start the chef over at the new sample, and
-- the first frame after the resume already draws it there. Before this the
-- body reappeared where it used to stand and slid across the kitchen.
do
	local JUMP = 3 -- cells; keeps the walk inside the wire's [-2, 30] range
	local function teleported(t: number): number
		return truthX(t) + (if t >= 6 then JUMP else 0)
	end
	local pkts = schedule({ outageAt = 3, outageLen = 3, truth = teleported, duration = 8 })
	-- The first resumed packet lands at 6 + latency; the frame after it must
	-- already draw the chef at the new spot. The render target then takes
	-- INTERP_DELAY to reach that first sample (the chef holds there), after
	-- which the ordinary bands are back on.
	local resumed = 6 + LATENCY + FRAME
	local state, probe = run("stream resumes elsewhere", pkts, { exemptFrom = 3, exemptTo = 6 + LATENCY + INTERP_DELAY + 2 * FRAME, snapExpected = true, truth = teleported, probeAt = resumed, duration = 8 })
	check(probe ~= nil and math.abs(probe.x - teleported(6)) < 0.05, `first frame after the resume is at the new position (x={probe and probe.x}, new={teleported(6)})`)
	check(state.remoteVis[1] == nil or (math.abs(state.remoteVis[1].x) < 1e-6), "no parked offset left to glide through")
end

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
