-- WHAT DOES A THINKING PAUSE COST?
--
-- The bots plan three times a second and act instantly, which reads as
-- relentless. THINK_RATE / THINK_BEAT make a bot stand still for a beat when
-- it picks up a new task. This measures the throughput that costs, because a
-- pause that visibly nerfs the bots is not worth having: a solo player in an
-- empty server needs a crew that can still three-star a shift.
local shared = require("../out/shared-bundle")
local Config = require("../game-src/shared/Config")

local SEEDS = { 11, 222, 3333, 44444, 555555, 6666, 77777, 888, 9999, 121212, 31337, 4242,
	5150, 60606, 7, 80808, 909, 10101, 11011, 12321, 13331, 14441, 15551, 16661 }

local function starsFor(coins: number): number
	local n = 0
	for _, t in Config.STARS do
		if coins >= t then n += 1 end
	end
	return n
end

--- All four chairs bot-driven, one human seat for the payout maths.
local function run(rate: number, beat: number)
	local coins, served, stars, hesitated = 0, 0, 0, 0
	for _, seed in SEEDS do
		local sim = shared.createSim({ seed = seed, botCount = 0 })
		shared.seedPans(sim)
		local row = Config.PACING[1]
		sim.director.orderGapMul = row.orderGapMul
		sim.director.maxOrdersBonus = row.maxOrdersBonus
		sim.director.ticketTimeMul = row.ticketTimeMul
		sim.director.patienceMissMul = row.patienceMissMul
		local bots = shared.makeBotDirector()
		bots:setDrivePlayer(true)
		bots:setThinkPause(rate, beat)
		local ticks, idle = 0, 0
		while not sim.over and ticks < 60 * 200 do
			local bi = bots:update(sim, shared.SIM_DT)
			local inputs = {}
			for _, chef in sim.chefs do
				local inp = bi:get(chef.id) or shared.NO_INPUT
				if inp.move.x == 0 and inp.move.y == 0 then
					idle += 1
				end
				inputs[chef.id + 1] = inp
			end
			shared.step(sim, inputs)
			sim.events = {}
			ticks += 1
		end
		coins += sim.score.coins
		served += sim.score.served
		stars += starsFor(sim.score.coins)
		hesitated += idle / math.max(1, ticks * 4)
	end
	local n = #SEEDS
	return { coins = coins / n, served = served / n, stars = stars / n, idle = hesitated / n }
end

local base = run(0, 0)
print(string.format("%-22s %-11s %-8s %-7s %-9s %s", "setting", "team coins", "dishes", "stars", "still", "vs none"))
print(string.format("%-22s %-11.1f %-8.2f %-7.2f %-9.1f %s", "no pause (today)", base.coins, base.served, base.stars, base.idle * 100, "—"))
for _, v in {
	{ 0.20, 0.40 }, { 0.25, 0.40 }, { 0.30, 0.45 },
	{ 0.35, 0.45 }, { 0.40, 0.40 }, { 0.30, 0.60 },
} do
	local r = run(v[1], v[2])
	print(string.format(
		"rate %-5.2f beat %-5.2f  %-11.1f %-8.2f %-7.2f %-9.1f %+.1f%% dishes",
		v[1], v[2], r.coins, r.served, r.stars, r.idle * 100, (r.served / base.served - 1) * 100
	))
end
