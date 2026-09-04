-- DOES "finished" EVER REACH THE DATASTORE?
--
-- Every completer's profile reads reach = "worked" with rounds >= 1. This runs
-- the PUBLISHED Progression module against the real DataStore with a fake
-- player, in the exact order main.server's round end uses -- awardRound (which
-- autosaves and yields on leaderboards), then noteReach("finished"), then the
-- leave-save -- and reads the entry back after each step.
--
--   ROBLOX_PLACE_ID=<id> node tools/opencloud.mjs luau tools/live-reach-probe.luau

local SSS = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")

local server = SSS:FindFirstChild("SizzleSquad")
local gameShared = ReplicatedStorage:WaitForChild("Game")
local Progression = require(server.Progression) :: any
local Config = require(gameShared.Config) :: any
local Catalog = require(gameShared.Catalog) :: any

-- A NEGATIVE UserId: Roblox never issues one, so `p-1` cannot be a real
-- player's profile. A small positive number is somebody's account, and the
-- RemoveAsync below would have been their whole progression.
local USER_ID = -1
local KEY = `p{USER_ID}`
local store = DataStoreService:GetDataStore("SizzleProfiles_v1")

-- awardRound also writes the ordered leaderboard stores (u<id>), and a probe
-- row that reaches the top 25 is a user-visible "u-1" on the Ranks tab. Every
-- store the probe can touch is cleared before and after. Same names as
-- Progression's; the weekly board is keyed by ISO week like there.
local weekKey = os.date("!%Y-W%W") :: string
local boards = {
	DataStoreService:GetOrderedDataStore("SizzleBestRound_v1"),
	DataStoreService:GetOrderedDataStore(`SizzleWeekly_{weekKey}`),
	DataStoreService:GetOrderedDataStore("SizzleCareerDishes_v1"),
}
--- Remove the probe's rows from every store, retrying, and say whether it all
--- went. A throttled RemoveAsync that was silently swallowed would leave a
--- "u-1" on a live leaderboard behind a green result.
local function cleanup(id: number): boolean
	local all = true
	local function remove(st: any, key: string)
		for attempt = 1, 4 do
			if pcall(function() st:RemoveAsync(key) end) then
				return
			end
			task.wait(0.5 * attempt)
		end
		print(`  FAIL could not remove {key}`)
		all = false
	end
	remove(store, `p{id}`)
	for _, b in boards do
		remove(b, `u{id}`)
	end
	return all
end
-- (Earlier revisions of this probe ran as p7/u7, a real account's keys. Those
-- rows were removed once and verified gone; a reusable diagnostic must not
-- keep deleting a positive UserId's data on every run.)

local function readBack(label: string)
	local ok, v = pcall(function()
		return store:GetAsync(KEY)
	end)
	print(`       [{label}] stored: reach={ok and v and v.reach or "?"} rounds={ok and v and v.rounds or "?"} lock={ok and v and v.__lock and v.__lock.server or "nil"}`)
	return ok and v or nil
end

local remotes = setmetatable({}, { __index = function() return { FireClient = function() end, FireAllClients = function() end } end })
local prog = Progression.new(Config, remotes, Catalog)
local player = { UserId = USER_ID, Name = "ReachProbe", DisplayName = "ReachProbe" }

if not cleanup(USER_ID) then
	error("could not clear the probe's keys before starting")
end
prog:playerAdded(player)
prog:noteReach(player, "joined")
prog:noteReach(player, "worked")
print(`       in memory after join: reach={prog.profiles[player].reach}`)
readBack("after join")

-- Force the autosave inside awardRound to fire, as it does after a 180s round.
prog.lastSave = os.clock() - 999
local crew = { seats = { [player] = { chefId = 0 } }, humanCount = function() return 1 end }
local results = { coins = 120, stars = 3, served = 4, missed = 0, bestCombo = 3, stats = { [0] = { serves = 4, chops = 2, cooks = 1, washes = 0 } }, tutorial = false }
prog:awardRound(crew, results, false)
-- awardRound itself is what has to say "finished" now -- nothing here
-- nudges it, so a regression there fails this probe rather than being
-- papered over by a second call.
local inMemory = prog.profiles[player].reach
print(`       in memory after awardRound: reach={inMemory} rounds={prog.profiles[player].rounds}`)
-- The autosave is task.spawn'd and DataStore latency is what it is: poll for
-- the write rather than sleep a guess, bounded so a broken path still fails.
local function waitFor(label: string, pred: (any) -> boolean): any
	local last = nil
	for _ = 1, 20 do
		task.wait(0.5)
		last = readBack(label)
		if pred(last) then
			break
		end
	end
	return last
end
local autosaved = waitFor("after awardRound autosave", function(v)
	return v ~= nil and v.rounds == 1
end)

prog:playerRemoving(player)
local final = waitFor("after leave", function(v)
	return v ~= nil and v.__lock == nil
end)

local cleaned = cleanup(USER_ID)
local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end
check(inMemory == "finished", `awardRound notes finished in memory ({inMemory})`)
check(autosaved ~= nil and autosaved.reach == "finished", `and its own autosave persists it ({autosaved and autosaved.reach or "nil"})`)
check(final ~= nil and final.reach == "finished" and final.__lock == nil, `and the leave-save keeps it and releases the lock ({final and final.reach or "nil"})`)
check(cleaned, "and every probe row was removed from every store afterwards")
if failures == 0 then
	print("REACH OK — finished persists through the round-end sequence")
else
	error(`REACH LOST — {failures} check(s) failed`)
end
