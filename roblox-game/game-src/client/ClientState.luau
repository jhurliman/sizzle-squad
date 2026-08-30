--!strict
-- Client-side world model: the own-chef mirror (advanced by the REAL shared
-- movePhase at 60Hz for zero-latency feel), interpolated remote chefs, and
-- mirrored station/order/score/phase state fed by the replication remotes.

local ClientState = {}
ClientState.__index = ClientState

local INTERP_DELAY = 0.18 -- render remotes this far in the past (>2 packet intervals)

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
	-- Remote chef interpolation buffers: id -> { {t, x, y, vx, vy, heading, flags, effort, stun} }
	self.buffers = {} :: { [number]: { any } }
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
	-- Mirrored plate economy: clean plates left on the racks, dirty ones
	-- stacked at the wash-up. Seeded FROM the mirror sim rather than to zero,
	-- so the display and the sim the prompts are planned against do not start
	-- the round already disagreeing (the sim opens with TUNING.plateStock).
	self.plateStock = self.mirrorSim.plateStock or 0
	self.dirtyPlates = self.mirrorSim.dirtyPlates or 0
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
	self:setPlates(snap.score and snap.score.plateStock, snap.score and snap.score.dirtyPlates)
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

function ClientState:applyTransforms(b: buffer)
	local list = self.net.unpackTransforms(b)
	for _, t in list do
		self.flags[t.id] = t.flags
		self.effort[t.id] = t.effort
		self.lastSeen[t.id] = self.clock
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
			local buf = self.buffers[t.id]
			if buf == nil then
				buf = {}
				self.buffers[t.id] = buf
			end
			table.insert(buf, {
				t = self.clock,
				x = t.px,
				y = t.py,
				vx = t.vx,
				vy = t.vy,
				heading = t.heading,
				effort = t.effort,
				stun = t.stun,
			})
			-- keep ~1s of history
			while #buf > 30 do
				table.remove(buf, 1)
			end
		end
	end
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

--- Interpolated pose for a remote chef at render time.
function ClientState:remotePose(id: number): any?
	local buf = self.buffers[id]
	if buf == nil or #buf == 0 then
		return nil
	end
	local target = self.clock - INTERP_DELAY
	-- find the straddling pair
	for i = #buf - 1, 1, -1 do
		local a, b = buf[i], buf[i + 1]
		if a.t <= target then
			local span = math.max(1e-4, b.t - a.t)
			local f = math.clamp((target - a.t) / span, 0, 1)
			local ha, hb = a.heading, b.heading
			local dh = math.atan2(math.sin(hb - ha), math.cos(hb - ha))
			return {
				x = a.x + (b.x - a.x) * f,
				y = a.y + (b.y - a.y) * f,
				heading = ha + dh * f,
				effort = a.effort + (b.effort - a.effort) * f,
				stun = b.stun,
			}
		end
	end
	local last = buf[#buf]
	return { x = last.x, y = last.y, heading = last.heading, effort = last.effort, stun = last.stun }
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

--- THE PROMPT IS PLANNED AGAINST THE MIRROR, SO THE MIRROR NEEDS THE COUNTS.
---
--- These used to land on the display fields only. But `focusPrompt` runs the
--- real `planGrab` over `mirrorSim`, and the plate rack's branch there asks
--- `s.plateStock > 0 or s.dirtyPlates > 0` -- of the SIM, which kept the
--- constructor's opening stock forever. So once the racks ran dry the local
--- rack went on glowing and advertising "dispense" while the authoritative
--- server answered "none": a highlighted prompt that did nothing when pressed.
---
--- Both copies are written here and nowhere else.
function ClientState:setPlates(stock: number?, dirty: number?)
	if stock == nil then
		return
	end
	self.plateStock = stock
	self.dirtyPlates = dirty or 0
	self.mirrorSim.plateStock = self.plateStock
	self.mirrorSim.dirtyPlates = self.dirtyPlates
end

function ClientState:applyScore(score: any)
	self.score = score
	self:setPlates(score.plateStock, score.dirtyPlates)
	if score.time ~= nil then
		self.simTime = score.time
	end
end

--- Two seconds of silence before a chef's body is culled.
---
--- Guessing "gone" sooner makes bodies blink on a bad connection, which is
--- worse than a body that lingers.
local STALE = 2

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
