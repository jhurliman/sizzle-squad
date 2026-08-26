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
	-- stacked at the wash-up.
	self.plateStock = 0
	self.dirtyPlates = 0
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
		self.carrying[chef.id] = chef.carrying
		if self.mirror ~= nil and chef.id == self.myChefId then
			self.mirror.pos.x, self.mirror.pos.y = chef.pos.x, chef.pos.y
			self.mirror.vel.x, self.mirror.vel.y = 0, 0
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
	if score.plateStock ~= nil then
		self.plateStock = score.plateStock
		self.dirtyPlates = score.dirtyPlates or 0
	end
	if score.time ~= nil then
		self.simTime = score.time
	end
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
