--!strict
-- Fans authoritative sim state out to clients:
--   * transforms: packed buffer, 20 Hz, unreliable (clients interpolate)
--   * sim events: reliable, batched per heartbeat (the presentation contract)
--   * station/order/score deltas: reliable, on change, diffed at 10 Hz
--   * full snapshot for new joiners
-- Pure logic against injected remotes so Lune harnesses can capture output.

local Replicator = {}
Replicator.__index = Replicator

local TRANSFORM_HZ = 20
local DIFF_HZ = 10

function Replicator.new(shared: any, net: any, remotes: { [string]: any }, chefFlags: (any) -> number)
	local self = setmetatable({}, Replicator)
	self.shared = shared
	self.net = net
	self.remotes = remotes
	self.chefFlags = chefFlags
	self.transformAcc = 0
	self.diffAcc = 0
	self.stationCache = {} :: { [number]: string }
	self.orderCache = ""
	self.scoreCache = ""
	return self
end

local function holdingSummary(holding: any): any
	if holding == nil then
		return nil
	end
	if holding.type == "ingredient" then
		local ing = holding.ingredient
		return { type = "ingredient", kind = ing.kind, state = ing.state, chop = ing.chop }
	elseif holding.type == "plate" then
		local contents = {}
		for _, c in holding.plate.contents do
			table.insert(contents, { kind = c.kind, state = c.state })
		end
		return { type = "plate", dirty = holding.plate.dirty, contents = contents }
	elseif holding.type == "pan" then
		local contents = {}
		for _, c in holding.pan.contents do
			table.insert(contents, { kind = c.kind, state = c.state })
		end
		return { type = "pan", contents = contents, fire = holding.pan.fire }
	end
	return { type = holding.type }
end

local function stationKey(st: any): string
	local h = st.holding
	local hk = "-"
	if h ~= nil then
		if h.type == "ingredient" then
			hk = `i:{h.ingredient.kind}:{h.ingredient.state}:{math.floor((h.ingredient.chop or 0) * 20)}`
		elseif h.type == "plate" then
			local parts = {}
			for _, c in h.plate.contents do
				table.insert(parts, `{c.kind}.{c.state}`)
			end
			table.sort(parts)
			hk = `p:{if h.plate.dirty then "d" else "c"}:{table.concat(parts, "+")}`
		elseif h.type == "pan" then
			local parts = {}
			for _, c in h.pan.contents do
				table.insert(parts, `{c.kind}.{c.state}`)
			end
			table.sort(parts)
			hk = `n:{table.concat(parts, "+")}:{math.floor((h.pan.fire or 0) * 20)}`
		end
	end
	return `{hk}|{if st.active then 1 else 0}|{math.floor(st.work * 20)}|{math.floor(st.cook * 20)}|{math.floor(st.burn * 20)}`
end

function Replicator:snapshotFor(sim: any): any
	local stations = {}
	for _, st in sim.kitchen.stations do
		table.insert(stations, {
			id = st.id,
			kind = st.kind,
			cell = { x = st.cell.x, y = st.cell.y },
			holding = holdingSummary(st.holding),
			active = st.active,
			work = st.work,
			cook = st.cook,
			burn = st.burn,
		})
	end
	local orders = {}
	for _, o in sim.orders do
		table.insert(orders, self:orderSummary(o))
	end
	local chefs = {}
	for _, chef in sim.chefs do
		table.insert(chefs, {
			id = chef.id,
			skin = chef.skin,
			isPlayer = chef.isPlayer,
			pos = { x = chef.pos.x, y = chef.pos.y },
			carrying = holdingSummary(chef.carrying),
		})
	end
	return {
		time = sim.time,
		over = sim.over,
		stations = stations,
		orders = orders,
		chefs = chefs,
		score = self:scoreSummary(sim),
	}
end

function Replicator:orderSummary(o: any): any
	local components = {}
	for _, c in o.recipe.components do
		table.insert(components, { kind = c.kind, state = c.state })
	end
	return {
		id = o.id,
		recipe = o.recipe.id,
		name = o.recipe.name,
		components = components,
		remaining = o.remaining,
		total = o.total,
	}
end

function Replicator:scoreSummary(sim: any): any
	local s = sim.score
	return {
		coins = s.coins,
		served = s.served,
		missed = s.missed,
		combo = s.combo,
		bestCombo = s.bestCombo,
		patience = s.patience,
		time = sim.time,
	}
end

--- Per-heartbeat fanout. `events` is SimService's drained batch.
function Replicator:flush(sim: any, events: { any }, dt: number, carryingChanged: boolean?)
	local remotes = self.remotes

	if #events > 0 then
		remotes.SimEvents:FireAllClients(events)
	end

	self.transformAcc += dt
	if self.transformAcc >= 1 / TRANSFORM_HZ then
		self.transformAcc = 0
		local transforms = {}
		for _, chef in sim.chefs do
			table.insert(transforms, {
				id = chef.id,
				px = chef.pos.x,
				py = chef.pos.y,
				vx = chef.vel.x,
				vy = chef.vel.y,
				heading = chef.heading,
				flags = self.chefFlags(chef),
				effort = chef.effort,
				stun = chef.stun,
			})
		end
		remotes.Transforms:FireAllClients(self.net.packTransforms(transforms))
	end

	self.diffAcc += dt
	if self.diffAcc >= 1 / DIFF_HZ then
		self.diffAcc = 0
		-- stations
		local deltas = {}
		for _, st in sim.kitchen.stations do
			local key = stationKey(st)
			if self.stationCache[st.id] ~= key then
				self.stationCache[st.id] = key
				table.insert(deltas, {
					id = st.id,
					holding = holdingSummary(st.holding),
					active = st.active,
					work = st.work,
					cook = st.cook,
					burn = st.burn,
				})
			end
		end
		if #deltas > 0 then
			remotes.StationDeltas:FireAllClients(deltas)
		end
		-- orders
		local orderIds = {}
		for _, o in sim.orders do
			table.insert(orderIds, `{o.id}:{math.floor(o.remaining)}`)
		end
		local ok = table.concat(orderIds, ",")
		if ok ~= self.orderCache then
			self.orderCache = ok
			local orders = {}
			for _, o in sim.orders do
				table.insert(orders, self:orderSummary(o))
			end
			remotes.OrdersDelta:FireAllClients({ orders = orders })
		end
		-- score
		local score = self:scoreSummary(sim)
		local sk = `{score.coins}|{score.served}|{score.missed}|{score.combo}|{math.floor(score.patience * 50)}`
		if sk ~= self.scoreCache then
			self.scoreCache = sk
			remotes.ScoreDelta:FireAllClients(score)
		end
	end
end

function Replicator:resetCaches()
	table.clear(self.stationCache)
	self.orderCache = ""
	self.scoreCache = ""
end

return Replicator
