-- DOES THE PUBLISHED PLACE ACTUALLY WORK?
--
-- Run inside a real server of the live place via Open Cloud:
--   ROBLOX_PLACE_ID=<id> node tools/opencloud.mjs luau tools/place-smoke.luau
--
-- Every other check in this repo runs against the SOURCE. This one runs against
-- what Roblox is actually serving, which is the only thing players experience.
-- It exists because the live game once served an empty blue sky while every
-- local check was green — the upload had silently never landed — and because a
-- client module that fails to load takes the whole client with it while the
-- server carries on looking healthy.
--
-- NOTE what this canNOT see: place scripts do not run in this sandbox, so the
-- absence of the runtime remotes folder here proves nothing. It checks that
-- everything the scripts NEED is present and loadable.

local RS = game:GetService("ReplicatedStorage")
local SSS = game:GetService("ServerScriptService")
local SP = game:GetService("StarterPlayer")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

local function tryRequire(parent: Instance, name: string): boolean
	local child = parent:FindFirstChild(name)
	if child == nil then
		check(false, `{parent.Name}.{name} is MISSING`)
		return false
	end
	local ok, err = pcall(function()
		return require(child :: any)
	end)
	check(ok, `require {parent.Name}.{name}` .. (if ok then "" else ` — {tostring(err):sub(1, 160)}`))
	return ok
end

print("=== world ===")
local kitchen = game.Workspace:FindFirstChild("Kitchen")
check(kitchen ~= nil, "Workspace.Kitchen exists")
if kitchen then
	local stations = kitchen:FindFirstChild("Stations")
	local n = if stations then #stations:GetChildren() else 0
	check(n >= 20, `Kitchen.Stations has {n} models (>= 20)`)
	check(kitchen:FindFirstChild("Benches") ~= nil, "Kitchen.Benches exists (cell pads need it)")
end

print("=== replicated ===")
for _, n in { "Game", "Rigs", "Items" } do
	check(RS:FindFirstChild(n) ~= nil, `ReplicatedStorage.{n} exists`)
end
local rigs = RS:FindFirstChild("Rigs")
check(rigs ~= nil and #rigs:GetChildren() > 0, "Rigs is not empty — chefs would be placeholder cylinders")
tryRequire(RS, "Shared")

local gameShared = RS:FindFirstChild("Game")
if gameShared then
	for _, n in { "Net", "Config", "Catalog", "Monetization", "BadgeDefs", "LocFallback" } do
		tryRequire(gameShared, n)
	end
end

print("=== server ===")
local server = SSS:FindFirstChild("SizzleSquad")
check(server ~= nil, "ServerScriptService.SizzleSquad exists")
if server then
	local main = server:FindFirstChild("main")
	check(main ~= nil and main.ClassName == "Script", "main is a Script")
	check(main ~= nil and (main :: any).Enabled == true, "main is Enabled")
	for _, n in {
		"SimService", "Replicator", "CrewManager", "Tutorial", "RoundDirector",
		"Progression", "Leaderboards", "Badges", "Monetization", "Analytics", "Usernames",
	} do
		tryRequire(server, n)
	end
end

print("=== client ===")
-- THE CLIENT IS WHERE THE BLUE SKY CAME FROM. A ModuleScript that throws on
-- require takes the whole client script with it: no camera rig, no input
-- handling, so the default camera follows the server-vaulted character into the
-- void and the player sees sky and Roblox's own controls. The server carries on
-- looking perfectly healthy, which is what makes it hard to find.
local sps = SP:FindFirstChild("StarterPlayerScripts")
local client = sps and sps:FindFirstChild("SizzleSquad")
check(client ~= nil, "StarterPlayerScripts.SizzleSquad exists")
if client then
	local main = client:FindFirstChild("main")
	check(main ~= nil and main.ClassName == "LocalScript", "client main is a LocalScript")
	check(main ~= nil and (main :: any).Enabled == true, "client main is Enabled")
	for _, n in {
		"ClientState", "Input", "ChefVisuals", "CameraRig", "Hud", "FirstShift", "Sfx",
		"StationVisuals", "Vfx", "Music", "Menu", "ItemViz", "Results", "BinDress",
		"Loc", "Social", "Thumbstick", "IconViz", "IconData", "Hats", "HatFits", "SurfaceH",
	} do
		tryRequire(client, n)
	end
	local menu = client:FindFirstChild("Menu")
	if menu then
		for _, n in {
			"Theme", "ChefPreview", "WardrobeTab", "ShopTab", "CareerTab",
			"RanksTab", "ShiftPanel", "KitchenCard", "EmoteBar",
		} do
			tryRequire(menu, n)
		end
	end
end

print("")
print(if failures > 0 then `SMOKE FAILED — {failures} problem(s)` else "SMOKE OK — the published place is loadable")
