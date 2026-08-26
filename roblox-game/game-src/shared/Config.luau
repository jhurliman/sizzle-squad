--!strict
-- Product tuning for the Roblox port (port plan §2). The sim's own feel
-- constants live in the shared TUNING; this file is the layer above it:
-- session flow, difficulty scaling, progression. Everything here is safe to
-- hot-tweak between rounds.

local Config = {}

-- Round flow (seconds)
Config.RESULTS = 12
Config.LATE_JOIN_CUTOFF = 15 -- <15s left: hold joiner in kitchen-cam until results

-- There is no COUNTDOWN or INTERMISSION duration any more: a round only ever
-- starts when every non-AFK chef presses Start. Those phases are open-ended
-- lobbies, so the intermission-pause machinery they needed is gone too.

-- Bots are OPT-IN (playtest verdict: watching bots efficiently play the game
-- for you kills the fun of learning it). The brain stays in the codebase —
-- flip this on for bot-backfilled kitchens, or wire it to a lobby vote later.
Config.BOT_FILL = false

-- Difficulty by (non-AFK) human count.
--
-- MEASURED, not guessed (tools/economy-probe.luau): dishes served plateaus at
-- ~10-11 per round REGARDLESS of crew size or order rate, because throughput
-- is bound by the kitchen's stations -- chefs contend for the same boards and
-- stoves. The old table ramped the order gap to 0.85 at four players, which
-- produced 7.4 missed tickets a round and wiped 2 rounds in 5 without serving
-- a single extra dish.
--
-- So the table is nearly FLAT, sitting on the measured yield peak (gap ~2.0).
-- Bigger crews get a slight tightening for feel, not for throughput.
--
-- The real fix for four players is more stations, not more tickets: see
-- KNOWN-GAPS "the kitchen cannot absorb a full crew".
Config.PACING = {
	[0] = { orderGapMul = 3.0, maxOrdersBonus = -1, ticketTimeMul = 1.5, patienceMissMul = 0.5 }, -- idle kitchen
	[1] = { orderGapMul = 2.2, maxOrdersBonus = -1, ticketTimeMul = 1.5, patienceMissMul = 0.7 },
	[2] = { orderGapMul = 2.1, maxOrdersBonus = -1, ticketTimeMul = 1.45, patienceMissMul = 0.8 },
	[3] = { orderGapMul = 2.0, maxOrdersBonus = 0, ticketTimeMul = 1.4, patienceMissMul = 0.9 },
	[4] = { orderGapMul = 1.9, maxOrdersBonus = 1, ticketTimeMul = 1.35, patienceMissMul = 1.0 },
}
-- Bot-filled kitchens (BOT_FILL = true) use the original table:
Config.PACING_BOTFILL = {
	[0] = { orderGapMul = 1.0, maxOrdersBonus = 0, ticketTimeMul = 1.0, patienceMissMul = 1.0 },
	[1] = { orderGapMul = 1.0, maxOrdersBonus = 0, ticketTimeMul = 1.0, patienceMissMul = 1.0 },
	[2] = { orderGapMul = 0.9, maxOrdersBonus = 1, ticketTimeMul = 1.0, patienceMissMul = 1.0 },
	[3] = { orderGapMul = 0.8, maxOrdersBonus = 1, ticketTimeMul = 1.0, patienceMissMul = 1.05 },
	[4] = { orderGapMul = 0.7, maxOrdersBonus = 2, ticketTimeMul = 1.0, patienceMissMul = 1.1 },
}

-- Invisible pressure director: hold open/max tickets inside this band by
-- rubber-banding orderGapMul around the table value.
--
-- THIS IS THE 4-PLAYER DIAL, not the table above. Station utilisation was
-- measured at 3% for boards and 3% for stoves with four chefs on the line
-- (tools/station-probe.luau) -- NOTHING in the kitchen is contended, so adding
-- a bench would change nothing. And hard-coding a faster order rate for big
-- crews just manufactures misses: at four chefs it bought +0.3 dishes for
-- +5.8 missed tickets and a wipe.
--
-- The ceiling the harness measures (~10 dishes) is a BOT-BRAIN ceiling -- it
-- parks a working plate on the nearest free counter then goes looking for it,
-- and counter occupancy climbs from 19% to 32% as chefs are added. Four humans
-- do not have that failure mode, so their real ceiling is unknown and cannot
-- be measured here.
--
-- So the base table stays conservative (bot-safe) and the band is wide enough
-- for the director to FIND the right level from play: a crew clearing tickets
-- fast gets up to 50% quicker orders, a crew drowning gets up to 50% slower.
-- That adapts to a good 4-player crew without guessing on their behalf.
Config.PRESSURE_BAND_MUL = 0.5
Config.PRESSURE_LOW = 0.55
Config.PRESSURE_HIGH = 0.8
Config.PRESSURE_BAND_MUL = 0.5
Config.PRESSURE_SMOOTH = 20 -- seconds of smoothing

-- Assist mode (auto, per plan §2.3): applies while the crew's average level
-- is below ASSIST_LEVEL or average rounds played < ASSIST_ROUNDS.
Config.ASSIST_LEVEL = 3
Config.ASSIST_ROUNDS = 3
Config.ASSIST = {
	ticketTimeMul = 1.25,
	patienceMissMul = 0.75,
	burnTimeMul = 1.5,
	recipeDepthCap = 3, -- salads + bacon roll; BLT (4) and deluxe (5+) wait
}

-- Leaderboard integrity: bot-plated dishes pay this fraction (plan §2.4).
Config.BOT_SERVE_VALUE_MUL = 0.6

-- Star thresholds on team coins, set from the measured distribution
-- (bot rounds at the shipped MOVE_SPEED_MUL). The old 150/320/500 made 3
-- stars mathematically unreachable -- and with it the 3-star photo moment, the
-- star coin bonus and two badges were dead content. Re-run
-- tools/economy-probe.luau after ANY change to speed or pacing: an 8% speed
-- change alone moved the whole curve by ~6%.
--
-- 1 star: every completed shift (100%).  2 stars: a good shift (~60%).
-- 3 stars: a genuinely strong shift (~15% at bot skill; more for good humans).
Config.STARS = { 110, 150, 190 }

-- Coins per round, per player. Deliberately NOT a share of the team pot: an
-- even split paid 172 solo but only 27 each in a four-player kitchen, which is
-- an anti-social incentive in a co-op game. Everyone now banks the full team
-- value plus a bonus for each crewmate, so playing together always pays more.
Config.CREW_BONUS_PER_MATE = 20

-- Progression (plan §2.5)
Config.XP_BASE = 50
Config.XP_PER_DISH = 6
Config.XP_PER_STAR = 25
Config.XP_SOFT_CAP = 200
Config.LEVEL_CURVE = function(level: number): number
	-- XP required to advance FROM this level.
	return 100 + (level - 1) * 35
end

Config.AFK_SECONDS = 20

-- "Founding Chef" is only meaningful if it STOPS being awardable. Set this to
-- the last day of the launch window (UTC, YYYY-MM-DD); until then it is handed
-- out at the end of any shift, and after it nobody can earn it again. Leave it
-- empty to disable the badge entirely.
Config.FOUNDING_CHEF_UNTIL = "2026-10-31"


return Config
