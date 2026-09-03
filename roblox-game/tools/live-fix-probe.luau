-- IS THE ONBOARDING FIX ACTUALLY LIVE?
--
-- Runs inside a real server of the published place via Open Cloud:
--   ROBLOX_PLACE_ID=<id> node tools/opencloud.mjs luau tools/live-fix-probe.luau
--
-- `place-smoke.luau` proves the place loads. This proves the place is serving
-- the FIRST-SESSION FIX specifically -- that what Roblox hands a new player is
-- the corrected build and not the one that showed them "Welcome back, chef"
-- over the Start button. Source checks cannot answer that; only the live place
-- can, and the last time this project trusted a green local build the upload
-- had silently never landed.

local SSS = game:GetService("ServerScriptService")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

local server = SSS:FindFirstChild("SizzleSquad")
check(server ~= nil, "server modules are present")
if server == nil then
	error("no server modules in the live place")
end

-- 1. The join-source classifier exists at all.
local okT, Tutorial = pcall(function()
	return require(server:FindFirstChild("Tutorial")) :: any
end)
check(okT and Tutorial ~= nil, "Tutorial module loads in the live place")

if okT and Tutorial ~= nil then
	check(typeof(Tutorial.joinSource) == "function", "Tutorial.joinSource is live")
	check(typeof(Tutorial.isHop) == "function", "Tutorial.isHop is live")
	check(typeof(Tutorial.isFriendJoin) == "function", "Tutorial.isFriendJoin is live")

	-- 2. It classifies correctly, in the real runtime.
	check(Tutorial.isHop("teleport_in") == true, "a tutorial leg is a hop")
	check(Tutorial.isHop("friend_hop") == true, "so is a Social teleport")
	check(Tutorial.isHop("direct") == false, "a direct join is not")
	check(Tutorial.isFriendJoin("friend_invite") == true, "an invite is a friend arrival")
	check(Tutorial.isFriendJoin("friend_follow") == true, "so is a follow")
	check(Tutorial.isFriendJoin("friend_hop") == true, "so is JOIN A FRIEND")
	check(Tutorial.isFriendJoin("teleport_in") == false, "an ordinary hop is not")

	-- 3. The eligibility test still reads career progress, not session count.
	check(Tutorial.needsTutorial({ rounds = 0 }) == true, "a brand-new player still needs First Shift")
	check(Tutorial.needsTutorial({ rounds = 3 }) == false, "a player with rounds behind them does not")
	check(Tutorial.needsTutorial({ rounds = 0, tutorialDone = true }) == false, "nor one who finished it")
end

-- 4. The analytics that make the next campaign legible.
local okA, Analytics = pcall(function()
	return require(server:FindFirstChild("Analytics")) :: any
end)
check(okA and Analytics ~= nil, "Analytics module loads in the live place")
if okA and Analytics ~= nil then
	check(typeof(Analytics.joinStart) == "function", "Analytics.joinStart is live")
	local a = Analytics.new(nil)
	check(a ~= nil, "and it constructs without a service")
end

-- 5. THE BUG ITSELF. A teleport must not count as a new session.
local okP, Progression = pcall(function()
	return require(server:FindFirstChild("Progression")) :: any
end)
check(okP and Progression ~= nil, "Progression module loads in the live place")
if okP and Progression ~= nil then
	local pushed: any = nil
	local remotes = {
		Progress = {
			FireClient = function(_self, _p, payload)
				pushed = payload
			end,
		},
	}
	local Config = require(game:GetService("ReplicatedStorage"):FindFirstChild("Game"):FindFirstChild("Config")) :: any
	local Catalog = require(game:GetService("ReplicatedStorage"):FindFirstChild("Game"):FindFirstChild("Catalog")) :: any

	-- AN IN-MEMORY STORE, NOT THE REAL ONE. `Progression.new` falls back to
	-- game:GetService("DataStoreService") when its fourth argument is nil, so
	-- omitting it would write a live profile -- and leave a lock behind.
	local mem: { [string]: any } = {}
	local store = {}
	function store:UpdateAsync(key: string, fn: (any) -> any)
		local new = fn(mem[key])
		if new ~= nil then
			mem[key] = new
		end
		return mem[key]
	end
	function store:GetAsync(key: string)
		return mem[key]
	end
	function store:SetAsync(key: string, v: any)
		mem[key] = v
	end
	local ordered = { UpdateAsync = function() end, IncrementAsync = function() end }
	local fakeDSS = {}
	function fakeDSS:GetDataStore()
		return store
	end
	function fakeDSS:GetOrderedDataStore()
		return ordered
	end

	local fake = { UserId = -1, Name = "Probe" }

	-- Leg 1: the public server they arrived in.
	local public = Progression.new(Config, remotes, Catalog, fakeDSS)
	public:playerAdded(fake, false)
	local first = public.profiles[fake] and public.profiles[fake].sessions
	check(first == 1, `a fresh arrival is session 1 (got {first})`)
	public:playerRemoving(fake) -- teleported out: saves and releases the claim

	-- Leg 2: the reserved First Shift server, reached by teleport.
	local tutorial = Progression.new(Config, remotes, Catalog, fakeDSS)
	tutorial:playerAdded(fake, true)
	local hop = tutorial.profiles[fake] and tutorial.profiles[fake].sessions
	check(hop == 1, `and the teleport hop is STILL session 1 (got {hop}) -- this is the bug`)

	check(pushed ~= nil and pushed.tutorialDone ~= nil, "the progress push carries tutorialDone for the client gates")
end

print("")
if failures == 0 then
	print("LIVE FIX OK — the published place is serving the first-session fix")
else
	print(`LIVE FIX FAILED — {failures} check(s)`)
	error(`{failures} checks failed`)
end
