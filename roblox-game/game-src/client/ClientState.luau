--!strict
-- Client-side world model: the own-chef mirror (advanced by the REAL shared
-- movePhase at 60Hz for zero-latency feel), interpolated remote chefs, and
-- mirrored station/order/score/phase state fed by the replication remotes.

local ClientState = {}
ClientState.__index = ClientState

-- ---------------------------------------------------------- remote smoothing
--
-- Remote chefs are drawn from a buffer of server samples, INTERPOLATED IN
-- SERVER TIME. Every sample carries the server's step clock (Net header), and
-- the client keeps an estimate of `localClock - serverClock` so it can ask
-- "where was this chef at server time T" for a T just far enough in the past
-- that the samples around it have usually arrived.
--
-- The previous version stamped samples with their ARRIVAL time. Over a real
-- connection arrival is the send time plus a latency that wanders by tens of
-- milliseconds packet to packet, so two samples 50 ms apart on the server
-- were 30 ms or 70 ms apart in the buffer, and a chef covering a fixed
-- distance in a wandering time is a chef whose speed wanders. That was the
-- stutter on other players' chefs in the three-human playtest.

-- How far behind the estimated server-now remotes are drawn. Packets come at
-- 20 Hz (Replicator.TRANSFORM_HZ), so the budget has to cover: one lost
-- packet (the gap to the next one is two intervals, 100 ms) plus the
-- arrival jitter of that next packet, measured from the
-- EARLIEST arrivals because that is where the offset tracker sits. 120 ms
-- leaves ~20 ms for jitter on a single loss; a double loss or a heavier
-- jitter spike runs into extrapolation below, which on a walking chef is
-- close to invisible. Going higher buys robustness at the price of everyone
-- else's chef reacting later; 180 ms (the old value) was a visible lag
-- against one's own chef in bump exchanges.
local INTERP_DELAY = 0.12

-- Past the newest sample the chef is carried along its sampled velocity for
-- this long, then held. Long enough to bridge a 150 ms server hitch or two
-- lost packets; short enough that a chef whose stream really has stopped
-- does not walk through a counter.
local EXTRAP_MAX = 0.15

-- Clock-offset tracker (see noteStamp). An early packet is nearer the truth
-- than a late one, so the estimate moves toward a smaller offset FAST and
-- toward a larger one SLOWLY, each as a rate over the local time since the
-- last packet:
--   * OFFSET_DROP  0.3 s/s: 15 ms per 50 ms packet, which swallows arrival
--     jitter in a packet or two. It is a rate rather than a snap because of
--     the one way a packet can look early without being early -- a script
--     stall inside the render frame, after the clock was advanced and before
--     the queued packets were dispatched. Those all land with the SAME local
--     clock, so their elapsed time is zero and they move nothing.
--   * OFFSET_DRIFT 0.02 s/s: a single late packet moves it by a millisecond;
--     a genuine +50 ms route change is absorbed in 2.5 s.
--   * For the first OFFSET_WARMUP packets after a (re)start the upward rate
--     is OFFSET_DROP as well. The first estimate is one packet's word, and
--     the first second of a session is when the client is busiest (station
--     models, rigs), so that packet may well have been dispatched in a slow
--     frame and looked early. Symmetric tracking follows the samples to
--     wherever they really sit; the asymmetry takes over once there is a
--     population to take the minimum of.
-- THE TRACKER ONLY EVER MOVES ON A SAMPLE. It never infers anything from a
-- gap in the stream: a stall is a stall, the estimate through it is still
-- right, and the packets that follow are interpolated through at that
-- estimate. (A first version corrected the offset when the render target
-- had run past the data; a 500 ms outage then left it 230 ms too large and
-- the chef ran at 1.3x for most of a second catching up.)
--
-- AND THERE IS ONE CLOCK DOMAIN FOR THE LIFE OF THIS OBJECT. SimService.clock
-- is set once when the server instance starts and never reset -- not by a
-- round, not by SimService:reset -- and a client never outlives its server
-- instance: it is kicked or teleported, and the whole client script starts
-- over with a fresh ClientState. So a sample far from the estimate is never
-- a new clock; it is a packet that arrived very late (a straggler, or the
-- head of the burst after a long stall), and the right response is the
-- ordinary one: a stamp newer than anything buffered is folded in however
-- late it came (sample > estimate, so it moves the estimate by the slow
-- drift only, which is correct -- the offset was never wrong), and a stamp
-- older than the history window is dropped. Earlier revisions tried to
-- detect a restart, first from one far packet and then from a confirmed
-- run of them; the first took a 1.5 s straggler for a restart and rewound
-- the chef, the second took the in-order burst after a >1 s stall for one
-- and cleared every buffer twice.
local OFFSET_DROP = 0.3
local OFFSET_DRIFT = 0.02
local OFFSET_WARMUP = 20

-- A chef whose stream stops and starts again much later has not been
-- walking in the dark: parked chefs stop streaming, and the chair is filled
-- -- or the slot dealt to a joiner -- somewhere else entirely. Interpolating
-- from the last sample before the silence to the first after it, or worse
-- parking the jump in the visual offset and walking it off at CATCHUP_FRAC,
-- had the chef reappear where it used to stand and slide across the kitchen
-- for many seconds. So a chef that has been MISSING FROM MORE THAN CHEF_GAP
-- OF PACKETS THAT DID ARRIVE -- its newest sample more than that behind the
-- newest sample of anyone's -- or that has been silent for STALE, the same
-- threshold the cull uses, is a discontinuity: its history and visual
-- offset go, and it starts over at the new sample, i.e. it snaps, which
-- for a chef that genuinely teleported is the truth. One second is well
-- past anything the smoother bridges (EXTRAP_MAX plus a few lost packets)
-- and well short of the cull, so the body is moved before it could have
-- blinked.
--
-- Measured against everyone's newest stamp and not the wall, deliberately:
-- a server hitch pauses the whole cast at once and stamps the packet after
-- it a second on (SimService.wireClock keeps pace with the wall through a
-- hitch), and that chef did not go anywhere -- it is drawn moving slowly
-- through the second the server lost, which is what happened. Only a chef
-- that missed packets the others were in has been away.
local CHEF_GAP = 1.0

--- Two seconds of silence before a chef's body is culled (shouldShowChef).
---
--- Guessing "gone" sooner makes bodies blink on a bad connection, which is
--- worse than a body that lingers.
local STALE = 2

-- Per-chef visual offset. When a sample or a clock adjustment moves where
-- the chef should be drawn, the difference is parked here and released --
-- exactly as visOffset does for the own chef's corrections -- but the
-- release is RATE-LIMITED. The own chef's plain exponential decay (VIS_DECAY
-- per second) is right for the few-millimetre corrections jitter produces;
-- for the 0.8 cells a 500 ms outage leaves behind it means the chef zips
-- to catch up at three times walking speed, which is a hitch of its own.
-- So the release is the exponential decay or CATCHUP_FRAC of the rendered
-- speed, whichever is SLOWER -- a chef walking at 3 cells/s catches up at
-- 0.3 cells/s, an eye-level 10% -- with CATCHUP_FLOOR so a chef standing
-- still still glides home. Past VIS_SNAP the offset is not parked at all:
-- a chef a whole floor tile from where it should be is not "slightly off",
-- and gliding it there at a tenth of walking pace would take the best part
-- of ten seconds. A 500 ms outage leaves 0.84 cells at walking speed and
-- glides; the backlog after a 1.5 s stall leaves four and snaps.
local VIS_DECAY = 8
local CATCHUP_FRAC = 0.1
local CATCHUP_FLOOR = 0.3
local VIS_SNAP = 1.0

-- Samples kept per chef: ~1.5 s at 20 Hz, far more than INTERP_DELAY needs
-- and enough to ride out a burst of late arrivals. HISTORY_SPAN is the same
-- window in seconds, for deciding whether a straggler is worth keeping.
local HISTORY = 30
local HISTORY_SPAN = 1.5

function ClientState.new(shared: any, net: any)
	local self = setmetatable({}, ClientState)
	self.shared = shared
	self.net = net
	-- A private sim shell for the mirror: kitchen collision + event sink.
	self.mirrorSim = shared.createSim({ seed = 1, botCount = 3 })
	self.mirrorSim.events = {}
	self.myChefId = nil :: number?
	self.mirror = nil :: any
	self.seq = 0
	-- Remote chef sample buffers, sorted by SERVER time:
	-- id -> { {t, x, y, vx, vy, heading, effort, stun} }
	self.buffers = {} :: { [number]: { any } }
	-- Per-chef decaying visual offset + the clock it was last decayed at.
	self.remoteVis = {} :: { [number]: { x: number, y: number, h: number, at: number } }
	-- Server stamp unwrapping (Net.STAMP_WRAP) and the clock-offset estimate.
	self.stampLast = nil :: number?
	self.stampBase = 0
	self.offset = nil :: number? -- localClock - serverClock, or nil before the first packet
	self.offsetAt = 0 -- local clock of the last tracker update
	self.offsetPackets = 0 -- samples folded in since the last (re)start
	self.newestStamp = nil :: number? -- latest server time in any buffer
	self.flags = {} :: { [number]: number }
	self.effort = {} :: { [number]: number }
	self.skins = {} :: { [number]: string }
	self.carrying = {} :: { [number]: any }
	self.lastSeen = {} :: { [number]: number }
	self.hats = {} :: { [number]: string? }
	self.names = {} :: { [number]: string? }
	self.palettes = {} :: { [number]: string? }
	-- visual offset absorbing correction snaps (decays to zero)
	self.visOffset = { x = 0, y = 0 }
	self.stations = {} :: { [number]: any }
	self.orders = {} :: { any }
	self.score = { coins = 0, served = 0, missed = 0, combo = 0, bestCombo = 0, patience = 1, time = 0 }
	-- Round clock, advanced locally (see advanceClock).
	self.simTime = 0
	self.phase = { phase = "countdown", timer = 0, round = 0, results = nil }
	self.working = false
	self.stunned = false
	self.clock = 0
	return self
end

function ClientState:assign(msg: any)
	self.myChefId = msg.chefId
	self.mirror = self.mirrorSim.chefs[msg.chefId + 1]
	self.mirror.working = nil
	self.mirror.stun = 0
end

function ClientState:applySnapshot(snap: any)
	for _, st in snap.stations do
		self.stations[st.id] = st
	end
	self.orders = snap.orders
	self.score = snap.score
	self.simTime = (snap.score and snap.score.time) or 0
	for _, chef in snap.chefs do
		self.skins[chef.id] = chef.skin
		self:setCarrying(chef.id, chef.carrying)
		if self.mirror ~= nil and chef.id == self.myChefId then
			self.mirror.pos.x, self.mirror.pos.y = chef.pos.x, chef.pos.y
			self.mirror.vel.x, self.mirror.vel.y = 0, 0
		end
	end
	-- The snapshot is the ONLY station news a client gets until something
	-- changes, so the mirror has to take it. Without this the mirror kept the
	-- stations `createSim` invented -- notably no pans, because `seedPans` runs
	-- on the server only -- and every prompt was answered from that fiction.
	self:syncMirrorStations()
end

--- WHAT THE PLAYER IS HOLDING IS AN INPUT TO EVERY PROMPT, SO THE MIRROR NEEDS
--- IT TOO.
---
--- `self.carrying` is the display map, read by ChefVisuals to draw the item in
--- a hand. The mirror chef's own `carrying` was never set from anything, so it
--- was permanently nil, and `planGrab` -- which the client runs locally to pick
--- the focus highlight and the button verb -- always took its empty-handed
--- branch. Measured with tools/focus-harness.luau, the client agreed with the
--- server on 163 of 1568 station/hand combinations before this: an empty board
--- offered nothing while you held a tomato, a pan offered nothing while you
--- held bacon, and a plate rack lit up for a fistful of bacon it would refuse.
function ClientState:setCarrying(chefId: number, summary: any)
	self.carrying[chefId] = summary
	if self.mirror ~= nil and chefId == self.myChefId then
		self.mirror.carrying = self:rebuildCarryable(summary)
	end
end

--- Copy replicated station state onto the mirror sim, so the local planGrab
--- answers from what the server actually has.
function ClientState:syncMirrorStations()
	for _, st in self.mirrorSim.kitchen.stations do
		local mine = self.stations[st.id]
		if mine ~= nil then
			st.active = mine.active or false
			st.work = mine.work or 0
			st.cook = mine.cook or 0
			st.burn = mine.burn or 0
			st.holding = self:rebuildCarryable(mine.holding)
		end
	end
end

--- Turn a wire stamp (modulo Net.STAMP_WRAP) back into a monotonic server
--- clock. Unreliable packets can arrive out of order, so a step of more
--- than half the window in either direction is read as a wrap, not a jump;
--- that keeps a straggler from just before the wrap on the right side of it.
function ClientState:unwrapStamp(raw: number): number
	local wrap = self.net.STAMP_WRAP
	local last = self.stampLast
	if last ~= nil then
		local d = raw - last
		if d < -wrap / 2 then
			self.stampBase += wrap
		elseif d > wrap / 2 then
			self.stampBase -= wrap
		end
	end
	self.stampLast = raw
	return self.stampBase + raw
end

--- Fold one packet's (localClock - serverStamp) into the offset estimate.
--- See OFFSET_DROP / OFFSET_DRIFT for why the two directions differ. The
--- first sample IS the estimate; every one after it moves the estimate by
--- a bounded rate, and nothing ever restarts it (one clock domain, above).
function ClientState:noteStamp(serverT: number)
	local sample = self.clock - serverT
	local est = self.offset
	local elapsed = math.max(0, self.clock - self.offsetAt)
	self.offsetAt = self.clock
	if est == nil then
		self.offset = sample
		self.offsetPackets = 1
		return
	end
	self.offsetPackets += 1
	local up = if self.offsetPackets <= OFFSET_WARMUP then OFFSET_DROP else OFFSET_DRIFT
	if sample < est then
		self.offset = math.max(sample, est - OFFSET_DROP * elapsed)
	else
		self.offset = math.min(sample, est + up * elapsed)
	end
end

--- The server time remotes are drawn at right now, or nil before any packet.
function ClientState:renderTarget(): number?
	if self.offset == nil then
		return nil
	end
	return self.clock - self.offset - INTERP_DELAY
end

--- Is a sampled velocity believable against the displacement it claims to
--- have produced? Two tests, and a tangent has to pass both:
---   * SIZE: at most three chord lengths (Fritsch-Carlson). Beyond that a
---     cubic Hermite doubles back on itself, which on screen is a chef
---     taking a step backwards.
---   * DIRECTION: it has to point along the chord, not merely be short
---     enough. A chef that reverses inside one interval -- a bump rewrites
---     both chefs' velocities on the spot -- can have an endpoint velocity
---     pointing straight against the displacement and still pass the size
---     test, and Hermite then runs backwards at that end of the segment.
---     The threshold is a small positive cosine (~84 degrees): a sharp
---     corner still curves, a reversal goes linear.
--- A velocity too small to matter (i8 quantization at rest, ~0.06 cells/s)
--- passes regardless: zero tangents are the accelerate-from-rest curve. A
--- zero-length chord is a chef standing still, and only that tiny velocity
--- is believable against it. The same test guards extrapolation: a
--- velocity that did not move the chef over the last interval -- or moved
--- it the other way -- is not carried into the next one; the chef holds
--- until a sample confirms it.
local function plausible(vx: number, vy: number, dx: number, dy: number, span: number): boolean
	local mag = math.sqrt(vx * vx + vy * vy)
	local reach = mag * span
	if reach <= 0.02 then
		return true
	end
	local chord = math.sqrt(dx * dx + dy * dy)
	if chord < 1e-4 or reach > 3 * chord + 0.02 then
		return false
	end
	return vx * dx + vy * dy > 0.1 * mag * chord
end

--- Pose at server time `target` from the sample buffer alone: Hermite between
--- straddling samples, velocity extrapolation past the newest, a hold at
--- either end. `speed` is the rendered speed at that point (the chord speed
--- of the segment, or the extrapolation speed), which remotePose uses to
--- pace the visual offset's release. Pure -- applyTransforms calls it before
--- and after inserting a sample to measure how much the picture moved.
local function poseAt(buf: { any }, target: number): any
	local n = #buf
	local last = buf[n]
	if target >= last.t then
		local ahead = math.min(target - last.t, EXTRAP_MAX)
		local vx, vy = last.vx, last.vy
		if n >= 2 then
			local prev = buf[n - 1]
			if not plausible(vx, vy, last.x - prev.x, last.y - prev.y, last.t - prev.t) then
				vx, vy = 0, 0
			end
		end
		-- Heading holds: a guessed turn is worse than a late one.
		return {
			x = last.x + vx * ahead,
			y = last.y + vy * ahead,
			heading = last.heading,
			effort = last.effort,
			stun = last.stun,
			speed = math.sqrt(vx * vx + vy * vy),
		}
	end
	for i = n - 1, 1, -1 do
		local a, b = buf[i], buf[i + 1]
		if a.t <= target then
			local span = math.max(1e-4, b.t - a.t)
			local f = math.clamp((target - a.t) / span, 0, 1)
			local dx, dy = b.x - a.x, b.y - a.y
			local x, y
			if plausible(a.vx, a.vy, dx, dy, span) and plausible(b.vx, b.vy, dx, dy, span) then
				-- Cubic Hermite with the sampled velocities as tangents: the
				-- rendered speed follows the chef's real accel/decel curve
				-- through the sample instead of stepping at it.
				local f2, f3 = f * f, f * f * f
				local h00 = 2 * f3 - 3 * f2 + 1
				local h10 = f3 - 2 * f2 + f
				local h01 = -2 * f3 + 3 * f2
				local h11 = f3 - f2
				x = h00 * a.x + h10 * span * a.vx + h01 * b.x + h11 * span * b.vx
				y = h00 * a.y + h10 * span * a.vy + h01 * b.y + h11 * span * b.vy
			else
				x = a.x + dx * f
				y = a.y + dy * f
			end
			local ha, hb = a.heading, b.heading
			local dh = math.atan2(math.sin(hb - ha), math.cos(hb - ha))
			return {
				x = x,
				y = y,
				heading = ha + dh * f,
				effort = a.effort + (b.effort - a.effort) * f,
				stun = b.stun,
				speed = math.sqrt(dx * dx + dy * dy) / span,
			}
		end
	end
	local first = buf[1]
	return { x = first.x, y = first.y, heading = first.heading, effort = first.effort, stun = first.stun, speed = 0 }
end

function ClientState:applyTransforms(b: buffer)
	local list, rawStamp = self.net.unpackTransforms(b)
	if #list == 0 then
		return
	end
	local serverT = self:unwrapStamp(rawStamp)
	-- A packet older than the newest one already here is a straggler that
	-- overtook nothing: it is LATE by definition, so it says nothing about
	-- how early a packet can arrive and does not touch the tracker, and its
	-- flags are older than the flags already shown. It still goes into
	-- history where it fits -- a sample is a sample -- and is dropped when
	-- it is older than the history window.
	local newest = self.newestStamp
	local stale = newest ~= nil and serverT < newest
	if stale and newest - serverT > HISTORY_SPAN then
		return
	end
	-- Where was each chef being drawn before this packet? The render target
	-- can move on its own when the offset estimate moves, so "before" is
	-- measured against the target as it was and "after" against the target
	-- as it is: both the new data and the clock adjustment land in the
	-- visual offset, and neither shows as a hop.
	local oldTarget = self:renderTarget()
	local befores: { [number]: any } = {}
	if oldTarget ~= nil then
		for _, t in list do
			local buf = self.buffers[t.id]
			if t.id ~= self.myChefId and buf ~= nil and #buf > 0 then
				befores[t.id] = poseAt(buf, oldTarget)
			end
		end
	end
	if not stale then
		self:noteStamp(serverT)
		self.newestStamp = serverT
	end
	local target = self:renderTarget()
	for _, t in list do
		local silence = self.clock - (self.lastSeen[t.id] or self.clock)
		self.lastSeen[t.id] = self.clock
		if stale then
			-- A straggler still inside the window goes into history, and it
			-- can land in the very segment being drawn -- on a turn, a stop
			-- or a bump the segment then resolves somewhere else -- so it
			-- gets the same before/after compensation as a fresh sample.
			-- Without it the chef snapped, or stepped back, in one frame.
			if t.id ~= self.myChefId then
				self:parkDifference(t.id, befores[t.id], self:insertSample(t, serverT), target)
			end
			continue
		end
		self.flags[t.id] = t.flags
		self.effort[t.id] = t.effort
		if t.id == self.myChefId then
			-- Server's word on working/stun state; position stays client-side.
			self.working = bit32.band(t.flags, self.net.FLAG_WORKING) ~= 0
			self.stunned = bit32.band(t.flags, self.net.FLAG_STUN) ~= 0
			if self.mirror ~= nil then
				-- The freeze brakes toward the committed station, so the id
				-- must be real: use the chef's current local focus.
				self.mirror.working = if self.working then self.lastFocus else nil
				-- Raise-only: the local bump application already runs the
				-- stun down; a late packet must not revive an expired one.
				if t.stun > (self.mirror.stun or 0) then
					self.mirror.stun = t.stun
				end
			end
		else
			-- A resumed stream starts over (see CHEF_GAP).
			local buf = self.buffers[t.id]
			if buf ~= nil and #buf > 0 and ((newest ~= nil and newest - buf[#buf].t > CHEF_GAP) or silence >= STALE) then
				self.buffers[t.id] = nil
				self.remoteVis[t.id] = nil
				befores[t.id] = nil
			end
			-- If the sample changes where the chef is drawn (it landed behind
			-- an extrapolated guess, or the chef was held waiting for it) the
			-- difference is parked in the visual offset so the body glides
			-- rather than snapping.
			self:parkDifference(t.id, befores[t.id], self:insertSample(t, serverT), target)
		end
	end
end

--- Park whatever a buffer change did to a chef's drawn pose -- position and
--- heading -- in its visual offset, so the frame draws what it would have
--- drawn and the difference is released over the frames that follow.
--- `before` is the pose as it was going to be drawn (nil for a chef with no
--- history yet: nothing to be continuous with).
function ClientState:parkDifference(id: number, before: any?, buf: { any }, target: number?)
	if before == nil or target == nil then
		return
	end
	local after = poseAt(buf, target)
	local vis = self.remoteVis[id]
	if vis == nil then
		vis = { x = 0, y = 0, h = 0, at = self.clock }
		self.remoteVis[id] = vis
	end
	vis.x += before.x - after.x
	vis.y += before.y - after.y
	local dh = before.heading - after.heading
	vis.h += math.atan2(math.sin(dh), math.cos(dh))
end

--- Put one chef's transform into its sample history, in SERVER-time order:
--- unreliable packets can overtake each other, and a straggler appended to
--- the end would read as the chef stepping backwards. One too old to fit
--- the history window is trimmed straight back out. Returns the buffer.
function ClientState:insertSample(t: any, serverT: number): { any }
	local buf = self.buffers[t.id]
	if buf == nil then
		buf = {}
		self.buffers[t.id] = buf
	end
	local at = #buf + 1
	while at > 1 and buf[at - 1].t > serverT do
		at -= 1
	end
	if at > 1 and buf[at - 1].t == serverT then
		return buf -- duplicate
	end
	table.insert(buf, at, {
		t = serverT,
		x = t.px,
		y = t.py,
		vx = t.vx,
		vy = t.vy,
		heading = t.heading,
		effort = t.effort,
		stun = t.stun,
	})
	while #buf > HISTORY do
		table.remove(buf, 1)
	end
	return buf
end

--- Advance the own-chef mirror with local input. Returns the mirror.
function ClientState:stepOwn(input: any, dt: number)
	local mirror = self.mirror
	if mirror == nil then
		return nil
	end
	-- Movement locks are legible: committed work and stuns freeze the mirror
	-- exactly like the sim would (movePhase itself decays stun).
	self.shared.movePhase(self.mirrorSim, mirror, input, dt)
	self.mirrorSim.events = {}
	local decay = math.exp(-dt * 7)
	self.visOffset.x *= decay
	self.visOffset.y *= decay
	return mirror
end

--- Pose for a remote chef at render time: the buffer's answer for the current
--- render target (server time) plus the chef's decaying visual offset. The
--- offset decays against this clock rather than a passed dt so a harness
--- can sample it the way the render loop does.
function ClientState:remotePose(id: number): any?
	local buf = self.buffers[id]
	local target = self:renderTarget()
	if buf == nil or #buf == 0 or target == nil then
		return nil
	end
	local pose = poseAt(buf, target)
	local vis = self.remoteVis[id]
	if vis ~= nil then
		local dt = math.max(0, self.clock - vis.at)
		vis.at = self.clock
		local decay = math.exp(-VIS_DECAY * dt)
		-- Position: the exponential release, capped at a fraction of the
		-- rendered speed (see CATCHUP_FRAC) so a large correction is walked
		-- off rather than zipped through -- unless it is too far to glide at
		-- all (VIS_SNAP), in which case the whole thing is let go here. Here
		-- and not as each packet lands: the backlog after a long stall is
		-- thirty packets in one frame, each parking a small step, and judged
		-- one at a time they crossed the line mid-way, were cleared, and
		-- left the remainder to glide.
		local mag = math.sqrt(vis.x * vis.x + vis.y * vis.y)
		if mag > VIS_SNAP then
			self.remoteVis[id] = nil
			return pose
		end
		if mag > 0 then
			local step = math.min(mag * (1 - decay), math.max(CATCHUP_FLOOR, CATCHUP_FRAC * pose.speed) * dt)
			local keep = (mag - step) / mag
			vis.x *= keep
			vis.y *= keep
		end
		vis.h *= decay
		pose.x += vis.x
		pose.y += vis.y
		pose.heading += vis.h
	end
	return pose
end

function ClientState:applyStationDeltas(deltas: { any })
	for _, d in deltas do
		local st = self.stations[d.id]
		if st == nil then
			self.stations[d.id] = d
		else
			st.holding = d.holding
			st.active = d.active
			st.work = d.work
			st.cook = d.cook
			st.burn = d.burn
		end
	end
	-- keep the mirror sim's stations in step so local planGrab (focus prompt)
	-- answers from fresh state
	self:syncMirrorStations()
end

--- Rebuild a sim-shaped Carryable from a replicated summary (ids are local
--- fabrications — the client only ever *reads* these for prompts/visuals).
function ClientState:rebuildCarryable(summary: any): any
	if summary == nil then
		return nil
	end
	if summary.type == "ingredient" then
		return {
			type = "ingredient",
			ingredient = { id = 0, kind = summary.kind, state = summary.state, progress = 0, overcook = 0, chop = summary.chop },
		}
	elseif summary.type == "plate" then
		local contents = {}
		for _, c in summary.contents do
			table.insert(contents, { id = 0, kind = c.kind, state = c.state, progress = 0, overcook = 0 })
		end
		return { type = "plate", plate = { id = 0, contents = contents, dirty = summary.dirty == true } }
	elseif summary.type == "pan" then
		local contents = {}
		for _, c in summary.contents do
			table.insert(contents, { id = 0, kind = c.kind, state = c.state, progress = 0, overcook = 0 })
		end
		return { type = "pan", pan = { id = 0, contents = contents, onHeat = true, fire = summary.fire or 0 } }
	end
	return nil
end

--- THE ROUND CLOCK RUNS LOCALLY.
---
--- Score deltas are only sent when the SCORE changes (a serve, a miss, a
--- patience tick) — `time` is not part of the server's change key. So the
--- replicated time is stale between actions, which froze the HUD clock
--- (it only moved when you did something) and stalled the music's heat ramp
--- with it. The clock therefore ticks here every frame and RESYNCS whenever
--- an authoritative score arrives; the server stays the source of truth.
function ClientState:advanceClock(dt: number, playing: boolean)
	if playing then
		self.simTime += dt
	end
end

function ClientState:applyScore(score: any)
	self.score = score
	if score.time ~= nil then
		self.simTime = score.time
	end
end

--- Should this chef be drawn at all?
---
--- EXPLICIT BEATS INFERRED. The silence timeout above is the right guess when
--- a chef stops streaming for reasons nobody knows. It is the wrong one when
--- the server has just said the chair is empty -- dismissing a bot stops its
--- transform stream, so the body used to stand there for the full two seconds
--- before vanishing and the delay read as lag on a button press. It was never
--- lag: the roster arrives in the same breath as the dismissal and says
--- outright that nobody is there.
---
--- Lives here rather than in the render loop so a harness can reach it.
function ClientState:shouldShowChef(chefId: number): boolean
	local seats = self.phase ~= nil and self.phase.seats or nil
	if seats ~= nil then
		for _, seat in seats do
			if seat.chefId == chefId then
				return seat.kind ~= "empty"
			end
		end
	end
	return self.clock - (self.lastSeen[chefId] or -10) < STALE
end

--- Server correction: snap the SIMULATED position (authority) but park the
--- visual difference in a decaying offset so the body glides instead of
--- teleporting.
function ClientState:applyCorrection(msg: any)
	local mirror = self.mirror
	if mirror == nil then
		return
	end
	self.visOffset.x += mirror.pos.x - msg.x
	self.visOffset.y += mirror.pos.y - msg.y
	mirror.pos.x, mirror.pos.y = msg.x, msg.y
	mirror.vel.x, mirror.vel.y = 0, 0
end

--- Apply a server bump verdict to the own-chef mirror so client and server
--- knock back together — without this every bump starts a divergence fight.
function ClientState:applyBump(ev: any)
	local mirror = self.mirror
	if mirror == nil or self.myChefId == nil then
		return
	end
	if ev.a ~= self.myChefId and ev.b ~= self.myChefId then
		return
	end
	local TUNING = self.shared.TUNING
	mirror.stun = TUNING.bumpStun or 0.16
	local dx = mirror.pos.x - (ev.at and ev.at.x or mirror.pos.x)
	local dy = mirror.pos.y - (ev.at and ev.at.y or mirror.pos.y)
	local d = math.sqrt(dx * dx + dy * dy)
	if d < 1e-3 then
		dx, dy, d = 1, 0, 1
	end
	local k = (TUNING.bumpKnockback or 4.2) / d
	mirror.vel.x = dx * k
	mirror.vel.y = dy * k
end

--- Local focus + verb prompt: run the REAL gate + plan over the mirror.
function ClientState:focusPrompt(): (number?, string)
	local mirror = self.mirror
	if mirror == nil then
		return nil, "none"
	end
	local shared = self.shared
	local sim = self.mirrorSim
	local gated = shared.gateFocus and shared.gateFocus(sim, mirror) or nil
	local st = gated
	if st == nil and shared.findFocus ~= nil then
		st = shared.findFocus(sim, mirror)
	end
	local action = "none"
	if shared.planGrab ~= nil then
		action = shared.planGrab(sim, mirror, st)
	end
	self.lastFocus = if st ~= nil then st.id else nil
	return self.lastFocus, action
end

return ClientState
