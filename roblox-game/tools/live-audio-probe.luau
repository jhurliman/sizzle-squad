-- CAN THE LIVE EXPERIENCE ACTUALLY PLAY ITS AUDIO?
--
-- Audio owned by the wrong account fails SILENTLY: the Sound loads, plays,
-- and produces nothing. So "no music in the live game" cannot be diagnosed
-- from the client. This runs inside a real server of the published place and
-- asks ContentProvider to fetch every id Music.luau references, which
-- returns a per-asset status -- the same fetch a player's client would do.
--
--   ROBLOX_PLACE_ID=<id> node tools/opencloud.mjs luau tools/live-audio-probe.luau

local ContentProvider = game:GetService("ContentProvider")
local MarketplaceService = game:GetService("MarketplaceService")
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

-- 1. What ids does the PUBLISHED Music module reference?
local scripts = SP:FindFirstChild("StarterPlayerScripts")
local root = scripts and scripts:FindFirstChild("SizzleSquad")
local music = root and root:FindFirstChild("Music")
check(music ~= nil, "Music module is in the published place")
local ids: { [string]: number } = {}
if music then
	local src = (music :: any).Source
	for _, k in { "base", "groove", "melody", "tension" } do
		local id = src:match(`\n%s*{k} = (%d+),`)
		ids[k] = tonumber(id) or 0
		print(`       {k} = {ids[k]}`)
	end
	check(ids.base ~= 0 and ids.groove ~= 0 and ids.melody ~= 0 and ids.tension ~= 0, "all four STEM_IDS are set")
	print(`       MASTER = {src:match("local MASTER = ([%d%.]+)")}  LOOP_SECONDS = {src:match("local LOOP_SECONDS = ([%d%.]+)")}`)
end

-- 2. Can THIS experience fetch them? Same call a client makes.
local sounds = {}
for k, id in ids do
	local s = Instance.new("Sound")
	s.Name = `probe_{k}`
	s.SoundId = `rbxassetid://{id}`
	s.Parent = workspace
	table.insert(sounds, s)
end
local results: { [string]: string } = {}
local ok, err = pcall(function()
	ContentProvider:PreloadAsync(sounds, function(contentId, status)
		results[contentId] = tostring(status)
	end)
end)
check(ok, `PreloadAsync ran ({err or "no error"})`)
for _, s in sounds do
	local st = results[s.SoundId] or "no callback"
	check(st == "Enum.AssetFetchStatus.Success", `{s.Name} {s.SoundId} -> {st}`)
	print(`       IsLoaded={s.IsLoaded} TimeLength={s.TimeLength}`)
end

-- 3. What does the marketplace say about each asset?
for k, id in ids do
	local okI, info = pcall(function()
		return MarketplaceService:GetProductInfo(id)
	end)
	if okI and info then
		print(`       {k}: "{info.Name}" type={info.AssetTypeId} creator={info.Creator and info.Creator.Id} ({info.Creator and info.Creator.Name})`)
	else
		print(`       {k}: GetProductInfo failed: {info}`)
	end
end

print("")
if failures == 0 then
	print("LIVE AUDIO OK — the published place can fetch every stem")
else
	print(`LIVE AUDIO FAILED — {failures} check(s)`)
	error(`{failures} checks failed`)
end
