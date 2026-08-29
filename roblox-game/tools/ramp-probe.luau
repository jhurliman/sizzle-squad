-- HOW FAST DOES A PLAYER ACTUALLY CLIMB?
--
-- Reported from play: level 6 and 2,000+ coins after three days and fewer than
-- six rounds, with the results screen showing 150-250 coins a round. Those
-- three numbers cannot all be true unless income is arriving from somewhere
-- the screen never mentions — and it was, from level-up grants and daily
-- goals, neither of which was in the reported figure.
--
-- This runs the REAL award maths off the REAL Config so the ramp can be argued
-- about with numbers instead of impressions. It is deliberately generous about
-- player skill (a 3-star round every time) because that is the case that
-- outruns the content.
local Config = require("../game-src/shared/Config")

local ROUNDS_PER_DAY = 2
local DAYS = 7

-- A good 3-star round, solo with bots: coins just over the 3-star threshold,
-- and the dish count that implies.
local ROUND = { coins = Config.STARS[3] + 8, stars = 3, serves = 15, humans = 1 }

local DAILIES = { { coins = 60, xp = 40 }, { coins = 50, xp = 30 }, { coins = 80, xp = 60 } }

local function curveTotal(toLevel: number): number
	local t = 0
	for l = 1, toLevel - 1 do
		t += Config.LEVEL_CURVE(l)
	end
	return t
end

print(`level curve: L2 needs {Config.LEVEL_CURVE(1)}, L6 needs {curveTotal(6)} total, L15 needs {curveTotal(15)}`)
print(`round pay: {ROUND.coins} + {ROUND.stars * 10} stars = {ROUND.coins + ROUND.stars * 10} coins`)
print("")
print(" day  round  roundPay  levelPay  dailyPay   coins   xp   level")

local coins, xp, level, streak = 0, 0, 1, 0
local totalRound, totalLevel, totalDaily = 0, 0, 0
for day = 1, DAYS do
	streak += 1
	local claimed = 0
	for r = 1, ROUNDS_PER_DAY do
		local roundPay = ROUND.coins + ROUND.stars * 10 + (ROUND.humans - 1) * Config.CREW_BONUS_PER_MATE
		local gainXp = math.min(
			Config.XP_SOFT_CAP,
			Config.XP_BASE + ROUND.serves * Config.XP_PER_DISH + ROUND.stars * Config.XP_PER_STAR
		)
		-- dailies: one goal lands per round until the day's three are done
		local dailyPay, dailyXp = 0, 0
		if claimed < #DAILIES then
			claimed += 1
			local d = DAILIES[claimed]
			local mul = math.min(1.5, 1 + 0.1 * math.max(0, streak - 1))
			dailyPay = math.floor(d.coins * mul)
			dailyXp = d.xp
		end
		xp += gainXp + dailyXp
		local levelPay = 0
		while xp >= Config.LEVEL_CURVE(level) do
			xp -= Config.LEVEL_CURVE(level)
			level += 1
			levelPay += level * 25
		end
		coins += roundPay + levelPay + dailyPay
		totalRound += roundPay
		totalLevel += levelPay
		totalDaily += dailyPay
		print(string.format("  %2d   %2d     %5d     %5d     %5d   %6d  %4d    %2d",
			day, r, roundPay, levelPay, dailyPay, coins, xp, level))
	end
end

print("")
print(`after {DAYS} days / {DAYS * ROUNDS_PER_DAY} rounds: {coins} coins, level {level}`)
local pct = math.floor(totalRound / math.max(1, coins) * 100)
print(`income split — rounds {totalRound} ({pct}%), level-ups {totalLevel}, dailies {totalDaily}`)
print(`the results screen used to show ONLY the {pct}% from rounds`)
print("")
print(`catalog is ~24850 coins of items and tops out at level 15 (milestones 3/5/7/10/15)`)
print(`at this rate the whole LEVEL ladder is done in {math.ceil(curveTotal(15) / (Config.XP_SOFT_CAP + 40))} rounds`)
