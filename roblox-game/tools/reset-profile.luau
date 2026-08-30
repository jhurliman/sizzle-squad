-- INSPECT (and optionally WIPE) ONE PLAYER'S SAVED PROFILE.
--
-- Not run by Lune -- paste this into the Roblox Studio COMMAND BAR with the
-- place open and "Enable Studio Access to API Services" on (Game Settings ->
-- Security). It talks to the live DataStore, so it sees and changes the real
-- profile.
--
-- Why this exists: a playtest profile read 22542 shifts worked against 11172
-- dishes served. Rounds are 180 seconds even when nobody touches them, so that
-- is about 1100 hours -- the counter was inflated by some build paying a round
-- out more than once. The current round path is 1:1 (tools/career-probe.luau
-- measures it) and RoundDirector now latches the award to the round index, but
-- neither repairs a record that is already wrong.
--
-- READ FIRST. This profile is the only surviving evidence of that bug, so the
-- default is inspect-only: run it once with WIPE = false, keep the output, and
-- only then set WIPE = true. Wiping first throws away the one artifact that
-- could still identify the cause.
local USER_ID = 4262376699
local WIPE = false

local DataStoreService = game:GetService("DataStoreService")
assert(USER_ID ~= 0, "set USER_ID first")

local function weekKey(): string
	local t = os.date("!*t")
	return string.format("%d-%02d", t.year, math.floor(t.yday / 7) + 1)
end

local profiles = DataStoreService:GetDataStore("SizzleProfiles_v1")
local key = `p{USER_ID}`

local ok, profile = pcall(function()
	return profiles:GetAsync(key)
end)
if not ok then
	warn(`read FAILED: {profile}`)
	return
end
if profile == nil then
	print(`{key}: no stored profile`)
	return
end

-- The counters worth looking at, plus the ratio that gave the bug away: a real
-- shift serves tens of dishes, so dishes-per-shift far below 1 means most of
-- those "shifts" were never played.
print(`--- {key} ---`)
for _, f in { "rounds", "totalDishes", "bestRound", "coins", "xp", "level", "sessions" } do
	print(`  {f}: {tostring(profile[f])}`)
end
local rounds = tonumber(profile.rounds) or 0
local dishes = tonumber(profile.totalDishes) or 0
if rounds > 0 then
	print(`  dishes per shift: {string.format("%.3f", dishes / rounds)}`)
	print(`  implied play time at 180s a shift: {string.format("%.0f", rounds * 180 / 3600)} hours`)
end
if profile.__lock ~= nil then
	print(`  __lock: server {tostring(profile.__lock.server)} at {tostring(profile.__lock.at)}`)
end

if not WIPE then
	print("inspect-only (set WIPE = true to clear it)")
	return
end

-- Boards go too, or a wiped profile keeps competing against a score it never
-- earned.
local ok2, err2 = pcall(function()
	profiles:RemoveAsync(key)
end)
print(if ok2 then `profile {key} wiped` else `wipe FAILED: {err2}`)
for _, store in {
	DataStoreService:GetOrderedDataStore("SizzleBestRound_v1"),
	DataStoreService:GetOrderedDataStore("SizzleCareerDishes_v1"),
	DataStoreService:GetOrderedDataStore("SizzleWeekly_" .. weekKey()),
} do
	local ok3, err3 = pcall(function()
		store:RemoveAsync(tostring(USER_ID))
	end)
	if not ok3 then
		warn(`board wipe failed: {err3}`)
	end
end
print("done -- rejoin for a fresh profile")
