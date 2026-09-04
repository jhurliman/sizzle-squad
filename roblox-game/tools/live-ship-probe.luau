-- IS THE BUILD THAT JUST SHIPPED THE ONE WE THINK IT IS?
--
-- Reads the published modules' Source for the markers of the last three
-- PRs, so "published" means "these changes are live" and not just "an upload
-- succeeded". Run inside the live place:
--
--   ROBLOX_PLACE_ID=<id> node tools/opencloud.mjs luau tools/live-ship-probe.luau

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterPlayer = game:GetService("StarterPlayer")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end
local function src(inst: Instance?): string
	return if inst ~= nil then (inst :: any).Source else ""
end

local gameShared = ReplicatedStorage:FindFirstChild("Game")
local net = gameShared and gameShared:FindFirstChild("Net")
check(src(net):find("TRANSFORMS_HEADER") ~= nil, "#19: transforms carry a server stamp (Net.TRANSFORMS_HEADER)")

local client = StarterPlayer:FindFirstChild("StarterPlayerScripts")
local root = client and client:FindFirstChild("SizzleSquad")
local clientState = root and root:FindFirstChild("ClientState")
check(src(clientState):find("EXTRAP_MAX") ~= nil, "#19: client extrapolates (EXTRAP_MAX)")
check(src(clientState):find("OFFSET_DRIFT") ~= nil, "#19: client tracks the clock offset (OFFSET_DRIFT)")

local menu = root and root:FindFirstChild("Menu")
local shiftPanel = menu and menu:FindFirstChild("ShiftPanel")
check(src(shiftPanel):find("DISMISS_TAP") ~= nil, "#18: bot-dismiss has a 44px target (DISMISS_TAP)")
check(src(shiftPanel):find("introHold") ~= nil, "#17: the character-centric lobby (ShiftPanel.introHold)")

local buildInfo = ReplicatedStorage:FindFirstChild("Shared") and ReplicatedStorage.Shared:FindFirstChild("BuildInfo")
print(`       BuildInfo: {src(buildInfo):match('"?%x+%+?%a*"?') or "?"}`)

print("")
if failures == 0 then
	print("LIVE SHIP OK — #17, #18 and #19 are all in the published place")
else
	print(`LIVE SHIP FAILED — {failures} check(s)`)
	error(`{failures} checks failed`)
end
