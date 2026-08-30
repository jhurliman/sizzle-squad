-- IS FARMING WITH THREE BOTS BETTER PAID THAN PLAYING WITH THREE HUMANS?
--
-- The worry: bots are visibly competent, so a player could rationally never
-- play with anyone. Two guards already exist — bot-plated dishes pay
-- BOT_SERVE_VALUE_MUL, and every crewmate adds CREW_BONUS_PER_MATE — and this
-- measures whether together they are actually enough.
--
-- Both scenarios are driven by the SAME bot brain on all four chairs, so skill
-- is held equal. That is deliberately the best case for the farming strategy:
-- a real human is worse than a bot, which only makes bot-farming look better,
-- so any margin measured here is an OVERSTATEMENT of how safe we are.
--
-- `botMade` is sticky per plate: a bot adding one ingredient marks the whole
-- dish, however finishes it.
local shared = require("../out/shared-bundle")
local Config = require("../game-src/shared/Config")

local SEEDS = { 11, 222, 3333, 44444, 555555, 6666, 77777, 888, 9999, 121212 }

local function starsFor(coins: number): number
	local n = 0
	for _, t in Config.STARS do
		if coins >= t then n += 1 end
	end
	return n
end

--- humans = how many chairs are REAL people (isPlayer). The rest are bots and
--- their plates take the bot multiplier. All four chairs always play.
--- `skill` is the fraction of ticks a HUMAN chair acts on; bots always act.
--- Dropping inputs is a throughput proxy, not a model of bad play — a weak
--- player makes wrong choices rather than fewer — but throughput is the term
--- the payout actually depends on, so it is the right axis for this question.
local function run(humans: number, skill: number?)
	local coins, served, stars, award = 0, 0, 0, 0
	for _, seed in SEEDS do
		local sim = shared.createSim({ seed = seed, botCount = 0 })
		shared.seedPans(sim)
		local row = Config.PACING[humans]
		sim.director.orderGapMul = row.orderGapMul
		sim.director.maxOrdersBonus = row.maxOrdersBonus
		sim.director.ticketTimeMul = row.ticketTimeMul
		sim.director.patienceMissMul = row.patienceMissMul
		for _, chef in sim.chefs do
			chef.isPlayer = chef.id < humans
		end
		local bots = shared.makeBotDirector()
		bots:setDrivePlayer(true)
		local ticks = 0
		while not sim.over and ticks < 60 * 200 do
			local bi = bots:update(sim, shared.SIM_DT)
			local inputs = {}
			for _, chef in sim.chefs do
				local act = true
				if skill ~= nil and chef.isPlayer and skill < 1 then
					-- Deterministic duty cycle, offset per chef so the crew
					-- does not stall in lockstep.
					act = ((ticks * 977 + chef.id * 331) % 1000) < skill * 1000
				end
				inputs[chef.id + 1] = if act then (bi:get(chef.id) or shared.NO_INPUT) else shared.NO_INPUT
			end
			shared.step(sim, inputs)
			sim.events = {}
			ticks += 1
		end
		local st = starsFor(sim.score.coins)
		coins += sim.score.coins
		served += sim.score.served
		stars += st
		award += sim.score.coins + st * 10 + (humans - 1) * Config.CREW_BONUS_PER_MATE
	end
	local n = #SEEDS
	return { coins = coins / n, served = served / n, stars = stars / n, award = award / n }
end

print(string.format("%-24s %-11s %-8s %-7s %-13s", "scenario", "team coins", "dishes", "stars", "coins/player"))
local out = {}
for humans = 1, 4 do
	local r = run(humans)
	out[humans] = r
	local label = if humans == 1 then "1 human + 3 bots" else `{humans} humans + {4 - humans} bots`
	print(string.format("%-24s %-11.0f %-8.1f %-7.2f %-13.0f", label, r.coins, r.served, r.stars, r.award))
end

local farm, full = out[1].award, out[4].award
print("")
print(string.format("farming solo with 3 bots : %.0f coins/round", farm))
print(string.format("a full human crew        : %.0f coins/round  (%+.0f%%)", full, (full / farm - 1) * 100))
print(string.format("BOT_SERVE_VALUE_MUL=%.2f  CREW_BONUS_PER_MATE=%d", Config.BOT_SERVE_VALUE_MUL, Config.CREW_BONUS_PER_MATE))
print("")
-- MEASURED, not extrapolated: degrade the humans and find where farming wins.
print("a full human crew, as its members get worse than the bots:")
print(string.format("  %-16s %-13s %s", "human pace", "coins/player", "vs farming"))
local crossover = nil
for _, sk in { 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4 } do
	local r = run(4, sk)
	local delta = (r.award / farm - 1) * 100
	if crossover == nil and r.award < farm then
		crossover = sk
	end
	print(string.format("  %-16s %-13.0f %+.0f%%", string.format("%.0f%% of bot", sk * 100), r.award, delta))
end
print("")
if crossover == nil then
	print("a full crew out-earns farming even at 40% of bot pace — the guards hold")
else
	print(string.format("farming wins once humans drop below ~%.0f%% of bot pace", crossover * 100))
end
