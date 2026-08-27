-- WIPE ONE PLAYER'S SAVED PROFILE.
--
-- Not run by Lune -- paste this into the Roblox Studio COMMAND BAR with the
-- place open and "Enable Studio Access to API Services" on (Game Settings ->
-- Security). It talks to the live DataStore, so it affects the real profile.
--
-- Why this exists: a playtest profile turned up reading 22542 shifts worked
-- against 11172 dishes served. Rounds are 180 seconds even when nobody touches
-- them, so 22542 of them is about 1100 hours -- the counter was inflated by
-- some build that paid a round out more than once. The current round path is
-- 1:1 (tools/career-probe.luau measures it) and RoundDirector now latches the
-- award to the round index, but neither of those repairs a record that is
-- already wrong. This does.
--
-- Set USER_ID and run. Leaderboard entries are removed too, or the wiped
-- profile keeps competing against a score it never earned.
local USER_ID = 0 -- <<< put your UserId here

local DataStoreService = game:GetService("DataStoreService")
assert(USER_ID ~= 0, "set USER_ID first")

local function weekKey(): string
	local t = os.date("!*t")
	return string.format("%d-%02d", t.year, math.floor(t.yday / 7) + 1)
end

local profiles = DataStoreService:GetDataStore("SizzleProfiles_v1")
local ok, err = pcall(function()
	profiles:RemoveAsync(`p{USER_ID}`)
end)
print(if ok then `profile p{USER_ID} wiped` else `profile wipe FAILED: {err}`)

for _, store in {
	DataStoreService:GetOrderedDataStore("SizzleBestRound_v1"),
	DataStoreService:GetOrderedDataStore("SizzleCareerDishes_v1"),
	DataStoreService:GetOrderedDataStore("SizzleWeekly_" .. weekKey()),
} do
	local ok2, err2 = pcall(function()
		store:RemoveAsync(tostring(USER_ID))
	end)
	if not ok2 then
		warn(`board wipe failed: {err2}`)
	end
end
print("done -- rejoin for a fresh profile")
