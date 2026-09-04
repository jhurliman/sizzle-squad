-- FIRST SHIFT AS ITS OWN SERVER: the mode, headless.
--
-- What this proves without Studio: a reserved tutorial server runs an ENDLESS
-- board (no clock, no patience fail), forces bots off whatever the server's
-- switch says, issues the two scripted tickets in teaching order, ends the
-- moment the dish target is met, and pays out enough to reach level 2.
--
-- The teleports either side of it (Tutorial.send / sendHome) cannot be tested
-- here -- they are Roblox service calls -- so this covers everything BETWEEN
-- them, which is where the design actually lives.

local shared = require("../out/shared-bundle")
local SimService = require("../game-src/server/SimService")
local Replicator = require("../game-src/server/Replicator")
local CrewManager = require("../game-src/server/CrewManager")
local RoundDirector = require("../game-src/server/RoundDirector")
local Progression = require("../game-src/server/Progression")
local Net = require("../game-src/shared/Net")
local Config = require("../game-src/shared/Config")
local Catalog = require("../game-src/shared/Catalog")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

local function stubRemote()
	local remote = { allFired = {}, clientFired = {} }
	remote.OnServerEvent = {
		Connect = function()
			return { Disconnect = function() end }
		end,
	}
	function remote:FireAllClients(...)
		table.insert(self.allFired, { ... })
	end
	function remote:FireClient(player, ...)
		table.insert(self.clientFired, { player = player, args = { ... } })
	end
	return remote
end

local remotes = {}
for name in Net.REMOTES do
	remotes[name] = stubRemote()
end

local clock = { t = 0 }
local player = { UserId = 2002, Name = "Newbie" }

-- Bot fill deliberately ON at the server level: the tutorial must override it.
local simService = SimService.new(shared, { seed = 4242, botFill = true })
local replicator = Replicator.new(shared, Net, remotes, function(chef)
	return simService:chefFlags(chef)
end)
local crew = CrewManager.new(simService, Net, remotes, replicator, function()
	return clock.t
end)
local progression = Progression.new(Config, remotes, Catalog)
local awarded = nil
local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	seedFn = function()
		return 999
	end,
	tutorialFn = function()
		return true
	end,
	onRoundEnd = function(results)
		awarded = results
		progression:awardRound(crew, results, true)
	end,
})

progression:playerAdded(player)
crew:playerAdded(player)
local profile = progression.profiles[player]
check(profile ~= nil, "a fresh profile exists")
check((profile.rounds or 0) == 0 and profile.tutorialDone ~= true, "and it has never finished a shift")

director:startRound()
local sim = simService.sim

-- 1. bots are off despite botFill = true at construction
check(simService.botFill == false, "bot fill is forced off in a tutorial server")

-- 2. the board is endless and single-ticket
check(sim.director.endless == true, "the board is endless (no clock, no patience fail)")
check(sim.director.maxOrdersBonus == Config.TUTORIAL.MAX_ORDERS_BONUS, "one ticket at a time")
check(sim.director.patienceMissMul == 0, "a missed ticket costs no patience")

-- 3. the scripted opening, in teaching order
--
-- ASSERTED ON THE BOARD, NOT ON THE KNOB. The previous version of this checked
-- that maxOrdersBonus held the configured value, which it did — while
-- seedOrders ignored the cap and put TWO tickets up anyway. A knob is not a
-- behaviour; check what the player would see.
local first = sim.orders[1]
check(#sim.orders == 1, `exactly one ticket on the board (got {#sim.orders})`)
check(first ~= nil and first.recipe.id == Config.TUTORIAL.RECIPES[1], `and it is {Config.TUTORIAL.RECIPES[1]} (got {first and first.recipe.id})`)
-- The coach reads orders[1]; with one ticket there is nothing else it could
-- point at, which is the whole reason for capping the board.
check(first ~= nil and first.remaining > 1000, `the ticket will not expire while it is read ({math.floor(first.remaining)}s)`)

-- 4. ONE ticket, ONE dish. The shift used to be two; the campaign-002 funnel
-- showed 47% of players who had reached a station quitting before the second
-- dish, so the second dish is gone. Nothing may pile on while the one ticket
-- is open, and the scripted list is exactly one long.
local before = #sim.orders
for _ = 1, 60 * 30 do
	director:heartbeat(1 / 60)
end
check(#sim.orders == before, "no second ticket piles on while the first is open")
check(#Config.TUTORIAL.RECIPES == 1 and Config.TUTORIAL.DISHES == 1, `First Shift is one dish ({#Config.TUTORIAL.RECIPES} recipe(s), {Config.TUTORIAL.DISHES} to serve)`)

-- 5. run PAST the normal round length with nothing served: it must not end
local guard = 0
while sim.time < shared.TUNING.roundSeconds + 30 and guard < 60000 do
	director:heartbeat(1 / 60)
	clock.t += 1 / 60
	guard += 1
end
check(director.phase == "round", `still running at t={math.floor(sim.time)}s, past the {shared.TUNING.roundSeconds}s round limit`)
check(sim.over == false, "and the sim never declared itself over")

-- 5. patience cannot end it either
sim.score.patience = 0
director:heartbeat(1 / 60)
check(director.phase == "round", "an empty patience meter does not end the tutorial")

-- 6. serving the target ends it
sim.score.served = Config.TUTORIAL.DISHES
director:heartbeat(1 / 60)
check(director.phase == "results", `{Config.TUTORIAL.DISHES} dish ends the shift (phase={director.phase})`)
check(awarded ~= nil, "and the results/payout path ran")

-- FINISHING IS THREE STARS. Two scripted dishes cannot clear an 80-coin
-- threshold, so without this the first thing the game ever tells a new player
-- about their own performance is one star.
check(awarded ~= nil and awarded.stars == 3, `finishing First Shift is three stars (got {awarded and awarded.stars})`)
check(awarded ~= nil and awarded.tutorial == true, "and the results are marked as the tutorial's")
-- ...which is what stops Badges handing out "Three Stars" for it.
check(awarded ~= nil and awarded.coins < Config.STARS[1], `on a score that would otherwise be one star ({awarded and awarded.coins} coins, 3-star threshold {Config.STARS[3]})`)

-- 7. the payout ranks them up and can never be paid twice
check(profile.level >= 2, `the tutorial payout reaches level {profile.level} (>= 2)`)
check(profile.tutorialDone == true, "and marks the tutorial done")
check(profile.coins >= Config.TUTORIAL.BONUS_COINS, `coins credited ({profile.coins})`)

-- 8. a finished profile is no longer eligible
local Tutorial = require("../game-src/server/Tutorial")
check(Tutorial.needsTutorial(profile) == false, "a finished player is not sent back")
check(Tutorial.needsTutorial({ rounds = 0 }) == true, "a brand-new player is")
check(Tutorial.needsTutorial({ rounds = 5 }) == false, "a returning player is not")

print("")
if failures == 0 then
	print("PASS: tutorial")
else
	print(`FAIL: tutorial — {failures}`)
end
