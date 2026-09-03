--!strict
-- Owns the authoritative SimState and advances it at 60 Hz.
--
-- Authority split (see port plan §1.2):
--   * bot-driven chefs: server integrates movePhase — the server IS their client
--   * human chefs: position/velocity/heading come from the client's move
--     stream (the client runs the identical movePhase locally for zero-lag
--     feel); the server validates against a rolling last-accepted envelope
--     and only overrules on walkability violations or sustained divergence
--   * collisions, focus, grabs, stations, orders, scoring: server only
--
-- Bots are OPT-IN (Config.BOT_FILL): by default unassigned chef slots are
-- parked outside the kitchen and skipped by replication, so a crew is only
-- ever the humans present.
--
-- Pure logic: everything Roblox-specific is injected, so Lune harnesses can
-- drive this module headless (tools/server-harness.luau).

local SimService = {}
SimService.__index = SimService

export type HumanSlot = {
	packet: { px: number, py: number, vx: number, vy: number, heading: number, useHeld: boolean, seq: number }?,
	lastSeq: number,
	pendingGrabs: number,
	useHeld: boolean,
	-- rolling envelope: where we last accepted the client, and when
	accepted: { x: number, y: number, t: number },
	-- consecutive rejected applications; sustained divergence -> correction
	rejectStreak: number,
	-- set once when the server wants to snap this client (consumed by CrewManager)
	corrected: boolean,
	-- movement was server-locked (working/stun) last tick: grant a grace
	-- resync on the first packet after the lock releases
	wasLocked: boolean,
}

local MAX_QUEUED_GRABS = 3
-- Parking row for unassigned chefs: on the floor apron beyond the play field
-- (unwalkable cells: they simply stand there, out of frame and out of play).
local PARK = { { x = 2.5, y = 12.6 }, { x = 5.5, y = 12.6 }, { x = 9.5, y = 12.6 }, { x = 12.5, y = 12.6 } }

function SimService.new(shared: any, opts: { seed: number, chefCount: number?, botFill: boolean? })
	local self = setmetatable({}, SimService)
	self.shared = shared
	self.chefCount = opts.chefCount or 4
	self.botFill = opts.botFill == true
	-- PER-CHAIR BOT DISMISSAL, keyed by species.
	--
	-- Bots used to be one boolean for the whole server, flipped by one button,
	-- which made "I want three bots but not a fourth" unsayable. A chair is a
	-- character, so a dismissal is about a character: no bot as Nori.
	-- Keyed by species rather than chef id because claimSkin swaps species
	-- between chefs, and the thing a player dismissed was the chair they were
	-- looking at, not whichever slot index happened to hold it.
	self.dismissed = {} :: { [string]: boolean }
	-- Injected, never required: this module is deliberately Roblox-free so the
	-- Lune harnesses can drive it. nil simply means nobody lines up.
	self.staging = opts.staging
	self.humans = {} :: { [number]: HumanSlot }
	self.tickEvents = {} :: { any }
	-- MONOTONIC service clock, deliberately NOT sim.time.
	--
	-- Human move validation measures "real seconds since the last accepted
	-- packet" to size a distance budget. It used to read sim.time, which is
	-- frozen between rounds (tickMovementOnly never advances it) -- so elapsed
	-- was always a single tick, the budget collapsed to ~0.24 cells, and
	-- ordinary walking during results/intermission tripped the correction
	-- snap. That was the between-rounds rubber-banding.
	--
	-- This clock advances in BOTH tick paths and never resets, so a packet is
	-- judged against the time that actually passed.
	self.clock = 0
	self:reset(opts.seed)
	return self
end

--- `director` is applied at CONSTRUCTION, not after: createSim seeds the
--- opening two tickets immediately, so a knob set afterwards has already
--- missed them.
function SimService:reset(seed: number, director: any?)
	local shared = self.shared
	self.sim = shared.createSim({ seed = seed, botCount = self.chefCount - 1, director = director })
	shared.seedPans(self.sim)
	for _, chef in self.sim.chefs do
		chef.isPlayer = false
	end
	self.bots = shared.makeBotDirector()
	self.acc = 0
	self.humans = {}
	self.tickEvents = {}
	self:parkUnassigned()
end

--- Chefs that play: humans always; bot-driven slots only when botFill is on.
function SimService:isActive(chef: any): boolean
	return chef.isPlayer or (self.botFill and not self.dismissed[chef.skin])
end

--- Move every non-human chef to its parking spot (no-op when bots fill in).
function SimService:parkUnassigned()
	if self.botFill then
		return
	end
	for i, chef in self.sim.chefs do
		if not chef.isPlayer then
			local spot = PARK[((chef.id) % #PARK) + 1]
			chef.pos.x, chef.pos.y = spot.x, spot.y
			chef.vel.x, chef.vel.y = 0, 0
			chef.working = nil
			chef.stun = 0
		end
	end
end

--- Promote a chef slot to human control (or hand it back).
function SimService:setHuman(chefId: number, on: boolean)
	for _, chef in self.sim.chefs do
		if chef.id == chefId then
			chef.isPlayer = on
			if on then
				-- Entering play from the parking row: spawn somewhere sane.
				if not self.botFill then
					local spawned = self.shared.safeSpawn(self.sim.kitchen, { x = 7.5, y = 6.5 })
					chef.pos.x, chef.pos.y = spawned.x, spawned.y
					chef.vel.x, chef.vel.y = 0, 0
				end
				self.humans[chefId] = {
					packet = nil,
					lastSeq = -1,
					pendingGrabs = 0,
					useHeld = false,
					accepted = { x = chef.pos.x, y = chef.pos.y, t = 0 },
					rejectStreak = 0,
					corrected = false,
					wasLocked = false,
				}
			else
				self.humans[chefId] = nil
				-- Drop whatever they held back onto... they keep carrying; the
				-- bot (if any) resumes with it. Without bots, park the chef.
				if not self.botFill then
					local spot = PARK[((chef.id) % #PARK) + 1]
					chef.pos.x, chef.pos.y = spot.x, spot.y
					chef.vel.x, chef.vel.y = 0, 0
					chef.working = nil
					chef.stun = 0
				end
			end
			return chef
		end
	end
	return nil
end

function SimService:freeChef(): number?
	for _, chef in self.sim.chefs do
		if not chef.isPlayer then
			return chef.id
		end
	end
	return nil
end

function SimService:humanMove(chefId: number, p: any)
	local slot = self.humans[chefId]
	if slot == nil or p == nil then
		return
	end
	local d = (p.seq - slot.lastSeq) % 65536
	if slot.lastSeq >= 0 and (d == 0 or d > 32768) then
		return
	end
	slot.lastSeq = p.seq
	slot.packet = p
	slot.useHeld = p.useHeld
end

function SimService:pressGrab(chefId: number)
	local slot = self.humans[chefId]
	if slot then
		slot.pendingGrabs = math.min(slot.pendingGrabs + 1, MAX_QUEUED_GRABS)
	end
end

--- Apply the latest client packet to a human chef.
---
--- The envelope is rolling: displacement is measured from the last ACCEPTED
--- client position, not the server's own integration, so server-side pushes
--- (bumps, separations) never start a rejection fight. Rejections only turn
--- into a correction after a sustained streak, and the first packet after a
--- working/stun lock is granted a grace resync.
function SimService:applyHuman(chef: any, slot: HumanSlot, dt: number, now: number)
	local shared = self.shared
	local sim = self.sim
	local p = slot.packet
	if p == nil then
		return
	end
	if chef.working ~= nil or chef.stun > 0 then
		slot.wasLocked = true
		return
	end

	local cellX = math.floor(p.px)
	local cellY = math.floor(p.py)
	if not shared.isWalkable(sim.kitchen, cellX, cellY) then
		slot.rejectStreak += 10 -- walkability violations escalate fast
	else
		if slot.wasLocked then
			-- grace: accept wherever the client is after a lock releases
			slot.wasLocked = false
			slot.accepted = { x = p.px, y = p.py, t = now }
			slot.rejectStreak = 0
		end
		local dx = p.px - slot.accepted.x
		local dy = p.py - slot.accepted.y
		local dist = math.sqrt(dx * dx + dy * dy)
		local elapsed = math.max(dt, math.min(0.5, now - slot.accepted.t))
		local budget = shared.TUNING.moveSpeed * 1.35 * elapsed + 0.12
		if dist <= budget then
			chef.pos.x, chef.pos.y = p.px, p.py
			chef.vel.x, chef.vel.y = p.vx, p.vy
			chef.heading = p.heading
			local speed = math.sqrt(p.vx * p.vx + p.vy * p.vy)
			chef.effort = math.clamp(speed / shared.TUNING.moveSpeed, 0, 1)
			slot.accepted = { x = p.px, y = p.py, t = now }
			slot.rejectStreak = 0
			return
		end
		slot.rejectStreak += 1
	end

	-- Sustained divergence (~250ms) or hard walkability breach: snap the
	-- server chef somewhere valid and tell the client once.
	if slot.rejectStreak >= 15 then
		local fixed = shared.safeSpawn(sim.kitchen, { x = chef.pos.x, y = chef.pos.y })
		chef.pos.x, chef.pos.y = fixed.x, fixed.y
		chef.vel.x, chef.vel.y = 0, 0
		slot.accepted = { x = fixed.x, y = fixed.y, t = now }
		slot.rejectStreak = 0
		slot.corrected = true
	end
end

--- Advance the sim by wall dt. Returns the drained SimEvent batch and ticks.
--- `now` is accepted for call-site compatibility but ignored: timestamps come
--- from the monotonic self.clock (see SimService.new).
function SimService:tick(dt: number, _now: number?): ({ any }, number)
	local shared = self.shared
	local sim = self.sim
	self.acc = math.min(self.acc + dt, 0.25)
	local ticks = 0
	local batch = self.tickEvents
	table.clear(batch)
	while self.acc >= shared.SIM_DT and not sim.over do
		self.acc -= shared.SIM_DT
		ticks += 1
		local sdt = shared.SIM_DT
		self.clock += sdt
		local t = self.clock

		local botInputs = if self.botFill then self.bots:update(sim, sdt) else nil
		local inputs = {}
		for _, chef in sim.chefs do
			local slot = self.humans[chef.id]
			if slot then
				self:applyHuman(chef, slot, sdt, t)
				local grab = slot.pendingGrabs > 0
				if grab then
					slot.pendingGrabs -= 1
				end
				inputs[chef.id + 1] = { move = { x = 0, y = 0 }, grabPressed = grab, useHeld = slot.useHeld }
			elseif botInputs ~= nil then
				inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
			else
				inputs[chef.id + 1] = shared.NO_INPUT
			end
		end

		sim.tick += 1
		sim.time += sdt
		for _, chef in sim.chefs do
			if self.humans[chef.id] == nil and self:isActive(chef) then
				shared.movePhase(sim, chef, inputs[chef.id + 1], sdt)
			elseif self.humans[chef.id] ~= nil and chef.stun > 0 then
				-- A HUMAN'S STUN HAS TO BE RUN DOWN HERE, BY HAND.
				--
				-- `chef.stun -= dt` lives inside moveChef, and moveChef is
				-- exactly what a client-authoritative chef never runs on the
				-- server. So a human bumped once stayed stunned FOREVER:
				-- applyHuman early-returns on stun > 0, so the server stopped
				-- accepting client movement; every transform packet carried
				-- the stale stun, and the client's raise-only mirror kept
				-- re-freezing itself from it; and collidePhase went on nudging
				-- the frozen body, which is the vibration.
				--
				-- Nothing could bump a human while BOT_FILL was false, which
				-- is the only reason this survived: turning bots back on is
				-- what gave it something to trigger it.
				chef.stun = math.max(0, chef.stun - sdt)
			end
		end
		shared.collidePhase(sim, sdt)
		-- A separation can wedge a CLIENT-authoritative chef into a bench
		-- cell (bots recover via their own movePhase; humans never run it
		-- server-side). Un-wedge immediately so the trap can't happen.
		for _, chef in sim.chefs do
			local slot = self.humans[chef.id]
			if slot ~= nil then
				local inside = not shared.isWalkable(sim.kitchen, math.floor(chef.pos.x), math.floor(chef.pos.y))
				if inside then
					local fixed = shared.safeSpawn(sim.kitchen, { x = chef.pos.x, y = chef.pos.y })
					chef.pos.x, chef.pos.y = fixed.x, fixed.y
					slot.accepted = { x = fixed.x, y = fixed.y, t = t }
					slot.corrected = true
				end
			end
		end
		for _, chef in sim.chefs do
			if self:isActive(chef) then
				shared.interactPhase(sim, chef, inputs[chef.id + 1], sdt)
			end
		end
		shared.stationPhase(sim, sdt)

		for _, ev in sim.events do
			table.insert(batch, ev)
		end
		sim.events = {}
	end
	return batch, ticks
end

--- Movement-only advance for results/intermission.
--- Leave a chair empty, or let a bot have it again.
function SimService:setDismissed(species: string, on: boolean)
	self.dismissed[species] = if on then true else nil
end

--- Walk a bot to its lobby mark and stand it facing the camera.
---
--- BETWEEN ROUNDS, NOTHING ELSE MOVES A BOT AT ALL. tickMovementOnly never
--- calls movePhase, and botInputs only run inside `tick`, so a bot spent the
--- whole lobby standing exactly where the final whistle left it -- usually
--- somewhere behind a bench, which is no use to a camera pointed at the crew.
---
--- Humans are deliberately NOT steered here. Their position comes from their
--- own move stream and the client walks itself to its mark through ordinary
--- synthetic input (see Staging.moveToward), so a player who touches the stick
--- just wins, and no authority changes hands between rounds. That is the trap
--- in KNOWN-GAPS about between-rounds movement, and it is worth not repeating.
function SimService:walkToMark(chef: any, dt: number)
	local staging = self.staging
	if staging == nil or not self:isActive(chef) then
		return
	end
	-- By character, not by slot index: the marks belong to the four faces and
	-- the bodies move between them.
	local mark = staging.markFor(chef.skin)
	local mx, my, arrived = staging.moveToward(chef.pos, mark)
	if arrived then
		chef.vel.x, chef.vel.y = 0, 0
		chef.heading = staging.FACE_CAMERA
		return
	end
	local speed = self.shared.TUNING.moveSpeed
	chef.vel.x, chef.vel.y = mx * speed, my * speed
	chef.pos.x += chef.vel.x * dt
	chef.pos.y += chef.vel.y * dt
	chef.heading = math.atan2(my, mx)
end

function SimService:tickMovementOnly(dt: number, _now: number?)
	local shared = self.shared
	local sim = self.sim
	self.acc = math.min(self.acc + dt, 0.25)
	while self.acc >= shared.SIM_DT do
		self.acc -= shared.SIM_DT
		self.clock += shared.SIM_DT
		local t = self.clock
		for _, chef in sim.chefs do
			-- BETWEEN ROUNDS, NOBODY IS STUNNED. NOT EVEN A BOT.
			--
			-- This used to clear working/stun only for HUMANS, and the bots'
			-- stun had nothing to run it down: movePhase is what decrements it
			-- and this path never calls movePhase for anyone. So a bump during
			-- the lobby left a bot stunned FOREVER — the flag rode every
			-- transform packet, the client played the wobble and the 0.9 flail
			-- on a loop, and collidePhase went on shoving the frozen body
			-- around as the humans skated past it. Reported as a bot vibrating
			-- while still drifting around the level, which is exactly what
			-- that is.
			--
			-- Same shape as the human freeze fixed in `tick`: a chef whose
			-- stun is set by a path that cannot clear it. Between rounds there
			-- is no gameplay for a stun to mean anything about, so clear it
			-- for every chef rather than decrementing it.
			chef.working = nil
			chef.stun = 0
			-- AND NOBODY IS HOLDING ANYTHING EITHER.
			--
			-- Whatever was in your hands when the whistle went stayed there
			-- through the whole lobby and into the crew photo -- the shot that
			-- prompted this had somebody posing with a fistful of bacon. There
			-- is nothing to carry between rounds: the kitchen is asleep, and
			-- startRound rebuilds the sim from scratch anyway (simService:reset),
			-- so the plate economy is not losing anything that would otherwise
			-- have been counted.
			chef.carrying = nil
			local slot = self.humans[chef.id]
			if slot then
				self:applyHuman(chef, slot, shared.SIM_DT, t)
			else
				self:walkToMark(chef, shared.SIM_DT)
			end
		end
		shared.collidePhase(sim, shared.SIM_DT)
		sim.events = {}
	end
end

--- Flags byte for the transform stream (Net.FLAG_*).
function SimService:chefFlags(chef: any): number
	local flags = 0
	if chef.stun > 0 then
		flags += 1
	end
	if chef.working ~= nil then
		flags += 2
	end
	if chef.carrying ~= nil then
		flags += 4
		local t = chef.carrying.type
		local tier = if t == "plate" or t == "pan" then 2 else 1
		flags += tier * 8
	end
	if chef.isPlayer then
		flags += 32
	end
	return flags
end

return SimService
