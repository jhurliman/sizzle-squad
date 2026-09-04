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

local USER_ID = 7 -- a test key nobody owns; removed at the end
local KEY = `p{USER_ID}`
local store = DataStoreService:GetDataStore("SizzleProfiles_v1")

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

pcall(function() store:RemoveAsync(KEY) end)
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
print(`       in memory after awardRound: reach={prog.profiles[player].reach} rounds={prog.profiles[player].rounds}`)
task.wait(1.5)
readBack("after awardRound autosave")

prog:noteReach(player, "finished")
print(`       in memory after noteReach: reach={prog.profiles[player].reach} dirty={tostring(prog.dirty[player])}`)

prog:playerRemoving(player)
task.wait(1.5)
local final = readBack("after leave")

pcall(function() store:RemoveAsync(KEY) end)
if final ~= nil and final.reach == "finished" then
	print("REACH OK — finished persists through the round-end sequence")
else
	error(`REACH LOST — stored reach is {final and final.reach or "nil"}`)
end
