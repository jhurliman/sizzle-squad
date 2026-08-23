--!strict
-- Product tuning for the Roblox port (port plan §2). The sim's own feel
-- constants live in the shared TUNING; this file is the layer above it:
-- session flow, difficulty scaling, progression. Everything here is safe to
-- hot-tweak between rounds.

local Config = {}

-- Round flow (seconds)
Config.COUNTDOWN = 8
Config.RESULTS = 12
Config.INTERMISSION = 25
Config.LATE_JOIN_CUTOFF = 15 -- <15s left: hold joiner in kitchen-cam until results

-- Difficulty by (non-AFK) human count — the director table from plan §2.3.
-- Baseline (1 human) is exactly the shipped web tuning.
Config.PACING = {
	[0] = { orderGapMul = 1.0, maxOrdersBonus = 0, patienceMissMul = 1.0 }, -- bots-only attract mode
	[1] = { orderGapMul = 1.0, maxOrdersBonus = 0, patienceMissMul = 1.0 },
	[2] = { orderGapMul = 0.9, maxOrdersBonus = 1, patienceMissMul = 1.0 },
	[3] = { orderGapMul = 0.8, maxOrdersBonus = 1, patienceMissMul = 1.05 },
	[4] = { orderGapMul = 0.7, maxOrdersBonus = 2, patienceMissMul = 1.1 },
}

-- Invisible pressure director: hold open/max tickets inside this band by
-- rubber-banding orderGapMul ±20% around the table value.
Config.PRESSURE_LOW = 0.55
Config.PRESSURE_HIGH = 0.8
Config.PRESSURE_BAND_MUL = 0.2
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

-- Star thresholds on team coins (tunable against live data).
Config.STARS = { 150, 320, 500 }

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

return Config
