-- What a shift actually PAYS, so prices come from data rather than vibes.
-- Bots drive every chair (a competent-player proxy; a learning human earns
-- less, which is what the assist multipliers offset).
--
-- Run after touching Config.PACING, Config.STARS, CREW_BONUS_PER_MATE, or any
-- catalog price.
local shared = require("../out/shared-bundle")
local Config = require("../game-src/shared/Config")
local Catalog = require("../game-src/shared/Catalog")
local Tuning = require("../game-src/shared/Tuning")

-- Measure the game as SHIPPED: the port runs ~8% slower than the raw shared
-- tuning, and that shows up in dishes per round.
Tuning.apply(shared, Config)

local SEEDS = { 11, 222, 3333, 44444, 555555, 6666, 77777, 888, 9999, 121212 }

local function starsFor(coins: number): number
	local n = 0
	for _, threshold in Config.STARS do
		if coins >= threshold then
			n += 1
		end
	end
	return n
end

local function runCrew(crew: number)
	local coins, served, missed, starSum, award, survived = 0, 0, 0, 0, 0, 0
	local starHist = { 0, 0, 0, 0 }
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
		local ticks = 0
		while not sim.over and ticks < 60 * 200 do
			local bi = bots:update(sim, shared.SIM_DT)
			local inputs = {}
			for _, chef in sim.chefs do
				inputs[chef.id + 1] = if chef.id < crew then (bi:get(chef.id) or shared.NO_INPUT) else shared.NO_INPUT
			end
			shared.step(sim, inputs)
			sim.events = {}
			ticks += 1
		end
		local st = starsFor(sim.score.coins)
		starHist[st + 1] += 1
		coins += sim.score.coins
		served += sim.score.served
		missed += sim.score.missed
		starSum += st
		if sim.time >= shared.TUNING.roundSeconds - 0.5 then
			survived += 1
		end
		-- Progression:awardRound -- full team value, no per-head division.
		award += sim.score.coins + st * 10 + (crew - 1) * Config.CREW_BONUS_PER_MATE
	end
	local n = #SEEDS
	return {
		coins = coins / n, served = served / n, missed = missed / n,
		stars = starSum / n, award = award / n, survived = survived, n = n, hist = starHist,
	}
end

print(string.format("%-5s %-11s %-8s %-8s %-9s %-7s %-11s", "crew", "team coins", "dishes", "missed", "survived", "stars", "coins/player"))
local perCrew = {}
for crew = 1, 4 do
	local r = runCrew(crew)
	perCrew[crew] = r
	print(string.format("%-5d %-11.0f %-8.1f %-8.1f %-9s %-7.1f %-11.0f",
		crew, r.coins, r.served, r.missed, `{r.survived}/{r.n}`, r.stars, r.award))
end

local solo = perCrew[1]
print("")
print(string.format("star spread (solo): 0*=%d  1*=%d  2*=%d  3*=%d of %d rounds",
	solo.hist[1], solo.hist[2], solo.hist[3], solo.hist[4], solo.n))
print(string.format("co-op incentive: solo %.0f -> 4-player %.0f coins each (%+.0f%%)",
	solo.award, perCrew[4].award, (perCrew[4].award / solo.award - 1) * 100))

-- ---- the ladder -------------------------------------------------------
local ROUND_MINUTES = 3.5 -- 180s shift plus a short lobby
print("")
print(string.format("%-22s %-6s %-8s %-9s %s", "item", "kind", "cost", "rounds", "hours solo"))
local total = 0
local buyable = {}
for _, item in Catalog.items do
	if item.cost > 0 and item.exclusive == nil then
		table.insert(buyable, item)
	end
end
table.sort(buyable, function(a, b)
	return a.cost < b.cost
end)
for _, item in buyable do
	total += item.cost
	local rounds = item.cost / solo.award
	print(string.format("%-22s %-6s %-8d %-9.1f %.1f", item.name, item.kind, item.cost, rounds, rounds * ROUND_MINUTES / 60))
end
print("")
print(string.format("catalog total: %d coins = %.0f rounds = %.1f hours solo (%d buyable items)",
	total, total / solo.award, total / solo.award * ROUND_MINUTES / 60, #buyable))
print(string.format("first buy (%s, %dc) lands after %.1f rounds",
	buyable[1].name, buyable[1].cost, buyable[1].cost / solo.award))
