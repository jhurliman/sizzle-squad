-- Is any station actually contended? Run before adding benches to the kitchen.
--
-- ANSWER AS OF THIS WRITING: no. With four chefs on the line, boards sit at 3%
-- utilisation and stoves at 3%. The ~10 dish/round ceiling is not equipment.
--
-- "Busy" must mean WORK, not occupancy: a pan lives on a stove permanently, so
-- a holding-based measure reports stoves at 100% in an empty kitchen.
local shared = require("../out/shared-bundle")
local Config = require("../game-src/shared/Config")

local SEEDS = { 11, 222, 3333, 44444, 555555, 6666 }

local function run(crew: number)
	local busy, count, served = {}, {}, 0
	for _, seed in SEEDS do
		local sim = shared.createSim({ seed = seed, botCount = 0 })
		shared.seedPans(sim)
		local row = Config.PACING[crew]
		sim.director.orderGapMul = row.orderGapMul
		sim.director.maxOrdersBonus = row.maxOrdersBonus
		sim.director.ticketTimeMul = row.ticketTimeMul
		sim.director.patienceMissMul = row.patienceMissMul
		local bots = shared.makeBotDirector()
		bots:setDrivePlayer(true)
		local t = 0
		while not sim.over and t < 60 * 200 do
			local bi = bots:update(sim, shared.SIM_DT)
			local inputs = {}
			for _, chef in sim.chefs do
				inputs[chef.id + 1] = if chef.id < crew then (bi:get(chef.id) or shared.NO_INPUT) else shared.NO_INPUT
			end
			shared.step(sim, inputs)
			sim.events = {}
			for _, st in sim.kitchen.stations do
				count[st.kind] = (count[st.kind] or 0) + 1
				local active
				if st.kind == "stove" then
					active = (st.cook or 0) > 0.001
				elseif st.kind == "board" or st.kind == "sink" then
					active = (st.work or 0) > 0.001
				else
					active = st.holding ~= nil
				end
				if active then
					busy[st.kind] = (busy[st.kind] or 0) + 1
				end
			end
			t += 1
		end
		served += sim.score.served
	end
	return busy, count, served / #SEEDS
end

local howMany = {}
do
	local sim = shared.createSim({ seed = 1, botCount = 0 })
	for _, st in sim.kitchen.stations do
		howMany[st.kind] = (howMany[st.kind] or 0) + 1
	end
end

local b1, c1 = run(1)
local b4, c4, served4 = run(4)
print(string.format("%-9s %-5s %-14s %-14s", "station", "n", "util @1 chef", "util @4 chefs"))
for _, k in { "board", "stove", "sink", "plates", "serve", "counter", "crate", "bin" } do
	local n = howMany[k] or 0
	if n == 0 then
		continue
	end
	local u1 = (b1[k] or 0) / math.max(1, c1[k] or 1) * 100
	local u4 = (b4[k] or 0) / math.max(1, c4[k] or 1) * 100
	local flag = if u4 > 55 then "  <-- SATURATED" elseif u4 > 35 then "  <-- busy" else ""
	print(string.format("%-9s %-5d %-14.0f %-14.0f%s", k, n, u1, u4, flag))
end
print("")
print(string.format("4-chef dishes/round: %.1f", served4))
