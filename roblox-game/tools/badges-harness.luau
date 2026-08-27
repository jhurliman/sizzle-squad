-- Badge award rules. Worth pinning down now that the ids are live: a wrong
-- condition is not a silent bug, it hands out a real badge to the wrong people
-- and cannot be taken back.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then print(`  ok   {m}`) else failures += 1 print(`  FAIL {m}`) end
end

local today = "2026-08-26"
local env = {
	os = { date = function(_fmt) return today end, time = os.time, clock = os.clock },
	math = math, table = table, string = string, pairs = pairs, ipairs = ipairs,
	setmetatable = setmetatable, warn = function() end, print = print,
	task = { spawn = function(f, ...) f(...) end, wait = function() end },
	game = { GetService = function() return nil end },
}
local Config = luau.load(luau.compile(fs.readFile("game-src/shared/Config.luau")), { environment = env })()
local Badges = luau.load(luau.compile(fs.readFile("game-src/server/Badges.luau")), { environment = env })()

-- ---- ids ---------------------------------------------------------------
local seen, n = {}, 0
for key, id in Badges.IDS do
	n += 1
	check(id ~= 0, `{key} has a real id`)
	check(seen[id] == nil, `{key} id is unique`)
	seen[id] = key
end
check(n == 8, `all 8 badges present ({n})`)

-- ---- award rules -------------------------------------------------------
local awarded = {}
local fake = { AwardBadge = function(_self, userId, id) table.insert(awarded, { userId = userId, id = id }) end }
local function has(key: string): boolean
	for _, a in awarded do
		if a.id == Badges.IDS[key] then return true end
	end
	return false
end
local function countOf(key: string): number
	local c = 0
	for _, a in awarded do if a.id == Badges.IDS[key] then c += 1 end end
	return c
end

local playerA = { UserId = 1, Name = "A" }
local function crewOf(count: number)
	return { seats = { [playerA] = { chefId = 0 } }, humanCount = function() return count end }
end
local function progressionWith(profile: any)
	return { profiles = { [playerA] = profile } }
end

-- a modest first shift
awarded = {}
local b = Badges.new(Config, fake)
b:onRoundEnd(crewOf(1), progressionWith({ totalDishes = 3, level = 2 }),
	{ stars = 1, missed = 2, served = 3, stats = { [0] = { serves = 3 } } })
check(has("firstDish"), "serving a dish earns First Dish")
check(not has("perfectRound"), "a shift with misses does not earn Clean Service")
check(not has("firstThreeStar"), "one star does not earn Three Stars")
check(not has("levelTen"), "level 2 does not earn Head Chef")

-- a flawless three-star shift, solo
awarded = {}
b = Badges.new(Config, fake)
b:onRoundEnd(crewOf(1), progressionWith({ totalDishes = 120, level = 11 }),
	{ stars = 3, missed = 0, served = 12, stats = { [0] = { serves = 12 } } })
check(has("perfectRound"), "zero misses earns Clean Service")
check(has("firstThreeStar"), "three stars earns Three Stars")
check(not has("fullHumanCrewThreeStar"), "solo three stars does NOT earn Full House")
check(has("hundredDishes") and not has("thousandDishes"), "120 dishes earns Century only")
check(has("levelTen"), "level 11 earns Head Chef")

-- same, with a full crew
awarded = {}
b = Badges.new(Config, fake)
b:onRoundEnd(crewOf(4), progressionWith({ totalDishes = 1200, level = 11 }),
	{ stars = 3, missed = 0, served = 12, stats = { [0] = { serves = 12 } } })
check(has("fullHumanCrewThreeStar"), "three stars with 4 humans earns Full House")
check(has("thousandDishes"), "1200 dishes earns Thousand Plates")

-- ---- session de-dup ----------------------------------------------------
awarded = {}
b = Badges.new(Config, fake)
for _ = 1, 5 do
	b:onRoundEnd(crewOf(1), progressionWith({ totalDishes = 3, level = 2 }),
		{ stars = 1, missed = 1, served = 3, stats = { [0] = { serves = 3 } } })
end
check(countOf("firstDish") == 1, `five qualifying shifts award First Dish once ({countOf("firstDish")})`)

-- ---- mirroring into the profile ---------------------------------------
-- The in-game badge case is driven by onAward, not by BadgeService, so the
-- callback contract is what actually has to hold.
awarded = {}
local mirrored = {}
b = Badges.new(Config, fake)
b.onAward = function(_player, key)
	table.insert(mirrored, key)
end
b:onRoundEnd(crewOf(4), progressionWith({ totalDishes = 1200, level = 11 }),
	{ stars = 3, missed = 0, served = 12, stats = { [0] = { serves = 12 } } })
local function mirroredHas(key: string): boolean
	return table.find(mirrored, key) ~= nil
end
check(mirroredHas("firstDish") and mirroredHas("fullHumanCrewThreeStar"), "every award is mirrored to the profile")
check(#mirrored == #awarded, `one mirror per award ({#mirrored} vs {#awarded})`)

-- ---- Founding Chef window ---------------------------------------------
awarded = {}
b = Badges.new(Config, fake)
b:onRoundEnd(crewOf(1), progressionWith({ totalDishes = 1, level = 1 }),
	{ stars = 0, missed = 1, served = 1, stats = { [0] = { serves = 1 } } })
check(has("foundingChef"), `Founding Chef is earnable inside the window (until {Config.FOUNDING_CHEF_UNTIL})`)

today = "2099-01-01"
awarded = {}
b = Badges.new(Config, fake)
b:onRoundEnd(crewOf(1), progressionWith({ totalDishes = 1, level = 1 }),
	{ stars = 0, missed = 1, served = 1, stats = { [0] = { serves = 1 } } })
check(not has("foundingChef"), "Founding Chef is unearnable after the window closes")
today = "2026-08-26"

-- ---- pacing must never cost a badge ------------------------------------
--
-- Awards drain one every AWARD_GAP so Roblox's own "Badge Awarded" toasts do
-- not slide in on top of each other. The env above stubs task.wait to nothing,
-- so it proves the queue DROPS nothing but cannot see the pacing at all. This
-- one defers every task.spawn instead of running it, which freezes the pump
-- mid-queue and exposes the case that would silently cost a real player a real
-- badge: leaving before the queue drains.
local deferred = {}
local envPaced = {
	os = { date = function(_fmt) return today end, time = os.time, clock = os.clock },
	math = math, table = table, string = string, pairs = pairs, ipairs = ipairs,
	setmetatable = setmetatable, warn = function() end, print = print,
	task = {
		spawn = function(f, ...)
			local a = table.pack(...)
			table.insert(deferred, function() f(table.unpack(a, 1, a.n)) end)
		end,
		wait = function() end,
	},
	game = { GetService = function() return nil end },
}
local BadgesPaced = luau.load(luau.compile(fs.readFile("game-src/server/Badges.luau")), { environment = envPaced })()
awarded = {}
local bp = BadgesPaced.new(Config, fake)
bp:onRoundEnd(crewOf(4), progressionWith({ totalDishes = 1200, level = 11 }),
	{ stars = 3, missed = 0, served = 12, stats = { [0] = { serves = 12 } } })
local queued = #bp.pending
check(#awarded == 0, `a round-end sweep queues its awards instead of firing them together ({#awarded} fired)`)
check(queued > 1, `the sweep really did stack several awards ({queued} queued)`)
bp:playerRemoving(playerA)
check(#bp.pending == 0, "leaving empties that player's queue")
for _, f in deferred do
	f()
end
check(#awarded == queued, `a player who leaves mid-queue still receives every badge ({#awarded} of {queued})`)

print(if failures > 0 then `{failures} FAILURES` else "PASS: badges")
if failures > 0 then error(`{failures} checks failed`) end
