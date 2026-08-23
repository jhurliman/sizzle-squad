--!strict
-- Owns the authoritative SimState and advances it at 60 Hz.
--
-- Authority split (see port plan §1.2):
--   * bot chefs: server integrates movePhase — the server IS their client
--   * human chefs: position/velocity/heading come from the client's move
--     stream (the client runs the identical movePhase locally for zero-lag
--     feel); the server validates displacement + walkability and can snap
--   * collisions, focus, grabs, stations, orders, scoring: server only
--
-- Pure logic: everything Roblox-specific is injected, so Lune harnesses can
-- drive this module headless (tools/service-harness.luau).

local SimService = {}
SimService.__index = SimService

export type HumanSlot = {
	-- latest client-reported state, applied once per sim tick
	packet: { px: number, py: number, vx: number, vy: number, heading: number, useHeld: boolean, seq: number }?,
	lastSeq: number,
	pendingGrabs: number,
	useHeld: boolean,
	-- set when the server had to overrule the client this tick
	corrected: boolean,
}

local MAX_QUEUED_GRABS = 3

function SimService.new(shared: any, opts: { seed: number, chefCount: number? })
	local self = setmetatable({}, SimService)
	self.shared = shared
	self.chefCount = opts.chefCount or 4
	self.humans = {} :: { [number]: HumanSlot }
	self.tickEvents = {} :: { any }
	self:reset(opts.seed)
	return self
end

function SimService:reset(seed: number)
	local shared = self.shared
	-- createSim makes chef 0 the "player" — on this server every chef starts
	-- as a bot; CrewManager promotes them to humans as players join.
	self.sim = shared.createSim({ seed = seed, botCount = self.chefCount - 1 })
	shared.seedPans(self.sim)
	for _, chef in self.sim.chefs do
		chef.isPlayer = false
	end
	self.bots = shared.makeBotDirector()
	self.acc = 0
	self.humans = {}
	self.tickEvents = {}
end

--- Promote a chef slot to human control. Returns the chef, or nil.
function SimService:setHuman(chefId: number, on: boolean)
	for _, chef in self.sim.chefs do
		if chef.id == chefId then
			chef.isPlayer = on
			if on then
				self.humans[chefId] = {
					packet = nil,
					lastSeq = -1,
					pendingGrabs = 0,
					useHeld = false,
					corrected = false,
				}
			else
				self.humans[chefId] = nil
			end
			return chef
		end
	end
	return nil
end

--- Pick a bot chef to hand to a joining player (lowest id not human).
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
	-- Unreliable channel: drop stale/duplicate packets (u16 wraparound-aware).
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

--- Apply the latest client packet to a human chef, with validation.
function SimService:applyHuman(chef: any, slot: HumanSlot, dt: number)
	local shared = self.shared
	local sim = self.sim
	local p = slot.packet
	slot.corrected = false
	if p == nil then
		return
	end
	-- Movement is server-locked while working or stunned; the client freezes
	-- too, but the server's word is final.
	if chef.working ~= nil or chef.stun > 0 then
		return
	end
	local dx = p.px - chef.pos.x
	local dy = p.py - chef.pos.y
	local dist = math.sqrt(dx * dx + dy * dy)
	-- Generous displacement budget: top speed for the tick plus quantization
	-- slack. Packets arrive at ~30 Hz against a 60 Hz sim, so allow two ticks.
	local budget = shared.TUNING.moveSpeed * dt * 2.5 + 0.06
	if dist > budget then
		slot.corrected = true
		return
	end
	local cellX = math.floor(p.px)
	local cellY = math.floor(p.py)
	if not shared.isWalkable(sim.kitchen, cellX, cellY) then
		slot.corrected = true
		return
	end
	chef.pos.x = p.px
	chef.pos.y = p.py
	chef.vel.x = p.vx
	chef.vel.y = p.vy
	chef.heading = p.heading
	-- Cosmetic effort for the animator: humans derive it from speed.
	local speed = math.sqrt(p.vx * p.vx + p.vy * p.vy)
	chef.effort = math.clamp(speed / shared.TUNING.moveSpeed, 0, 1)
end

--- Advance the sim by wall dt. Returns the drained SimEvent batch and the
--- number of ticks advanced.
function SimService:tick(dt: number): ({ any }, number)
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

		local botInputs = self.bots:update(sim, sdt)
		local inputs = {}
		for _, chef in sim.chefs do
			local slot = self.humans[chef.id]
			if slot then
				self:applyHuman(chef, slot, sdt)
				local grab = slot.pendingGrabs > 0
				if grab then
					slot.pendingGrabs -= 1
				end
				inputs[chef.id + 1] = { move = { x = 0, y = 0 }, grabPressed = grab, useHeld = slot.useHeld }
			else
				inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
			end
		end

		sim.tick += 1
		sim.time += sdt
		for _, chef in sim.chefs do
			if self.humans[chef.id] == nil then
				shared.movePhase(sim, chef, inputs[chef.id + 1], sdt)
			end
		end
		shared.collidePhase(sim, sdt)
		for _, chef in sim.chefs do
			shared.interactPhase(sim, chef, inputs[chef.id + 1], sdt)
		end
		shared.stationPhase(sim, sdt)

		for _, ev in sim.events do
			table.insert(batch, ev)
		end
		sim.events = {}
	end
	return batch, ticks
end

--- Movement-only advance for results/intermission: humans keep walking (and
--- colliding) around the kitchen while stations, orders and bots sleep.
function SimService:tickMovementOnly(dt: number)
	local shared = self.shared
	local sim = self.sim
	self.acc = math.min(self.acc + dt, 0.25)
	while self.acc >= shared.SIM_DT do
		self.acc -= shared.SIM_DT
		for _, chef in sim.chefs do
			local slot = self.humans[chef.id]
			if slot then
				-- working/stun both cleared between rounds; bypass the lock
				chef.working = nil
				chef.stun = 0
				self:applyHuman(chef, slot, shared.SIM_DT)
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
