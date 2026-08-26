-- Exercises the hardened DataStore path against a fake store that throttles.
--
-- These three failures are invisible in Studio and expensive in production:
-- a transient throttle silently discarding a round, two servers writing the
-- same profile, and a shutdown eating everything since the last autosave. The
-- fake store lets all three happen on demand.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then print(`  ok   {m}`) else failures += 1 print(`  FAIL {m}`) end
end

-- a DataStore that fails the first N calls, then succeeds
local store = { data = {}, calls = 0, failFirst = 0 }
function store:UpdateAsync(key, fn)
	self.calls += 1
	if self.calls <= self.failFirst then error("throttled") end
	local new = fn(self.data[key])
	if new ~= nil then self.data[key] = new end
	return self.data[key]
end
function store:GetAsync(key) return self.data[key] end
function store:SetAsync(key, v) self.data[key] = v end
function store:UpdateAsyncOrdered() end
local ordered = { UpdateAsync = function() end, IncrementAsync = function() end }

local fakeDSS = {
	GetDataStore = function() return store end,
	GetOrderedDataStore = function() return ordered end,
}
fakeDSS.GetDataStore = function(_self) return store end
fakeDSS.GetOrderedDataStore = function(_self) return ordered end

local env = {
	game = { JobId = "server-A", GetService = function() return fakeDSS end, BindToClose = function() end },
	os = os, math = math, table = table, string = string,
	-- synchronous spawn keeps the test deterministic; wait is real so the
	-- backoff path actually executes
	task = { wait = function(t) require("@lune/task").wait(t or 0) end, spawn = function(f, ...) f(...) end },
	pairs = pairs, ipairs = ipairs, tostring = tostring, tonumber = tonumber,
	typeof = typeof, warn = function() end, print = print, setmetatable = setmetatable, select = select, type = type,
}
local Config = luau.load(luau.compile(fs.readFile("game-src/shared/Config.luau")), { environment = env })()
local Catalog = luau.load(luau.compile(fs.readFile("game-src/shared/Catalog.luau")), { environment = env })()
local Progression = luau.load(luau.compile(fs.readFile("game-src/server/Progression.luau")), { environment = env })()

local remotes = { Progress = { FireClient = function() end } }
local playerA = { UserId = 7, Name = "Alice" }

-- 1. a transient failure must NOT lose the profile
store.failFirst = 2
local p1 = Progression.new(Config, remotes, Catalog, fakeDSS)
p1:playerAdded(playerA)
check(p1.profiles[playerA] ~= nil, `load survived {store.failFirst} throttled attempts`)
p1.profiles[playerA].coins = 1234
p1:save(playerA)
check(store.data["p7"] ~= nil and store.data["p7"].coins == 1234, "save persisted through retry")

-- 2. the claim is written, and a DIFFERENT server is locked out
check(store.data["p7"].__lock ~= nil and store.data["p7"].__lock.server == "server-A", "server A holds the claim")
env.game.JobId = "server-B"
local ProgressionB = luau.load(luau.compile(fs.readFile("game-src/server/Progression.luau")), { environment = env })()
local p2 = ProgressionB.new(Config, remotes, Catalog, fakeDSS)
store.failFirst = 0
p2:playerAdded(playerA)
check(p2.profiles[playerA].__readOnly == true, "server B is locked out and goes session-only")
p2.profiles[playerA].coins = 999999
p2:save(playerA)
check(store.data["p7"].coins == 1234, "a locked-out server never overwrites the live profile")

-- 3. releasing the claim lets the next server in
p1:save(playerA, true)
check(store.data["p7"].__lock == nil, "leaving releases the claim")
local p3 = ProgressionB.new(Config, remotes, Catalog, fakeDSS)
p3:playerAdded(playerA)
check(p3.profiles[playerA].__readOnly ~= true and p3.profiles[playerA].coins == 1234, "next server loads it cleanly")

-- 4. shutdown flush writes everyone
p3.profiles[playerA].coins = 4321
p3:flushAll()
check(store.data["p7"].coins == 4321, "flushAll persisted on shutdown")

print(if failures > 0 then `{failures} FAILURES` else "PASS: datastore hardening")
if failures > 0 then error(`{failures} checks failed`) end
