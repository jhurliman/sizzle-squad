-- The drop-off question this exists to answer is "how long did the people who
-- left before their first shift actually stay?" -- which only works if the
-- duration and the cohort ride on the SAME event. That is what this pins down.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then print(`  ok   {m}`) else failures += 1 print(`  FAIL {m}`) end
end

local logged = {}
local fakeService = {
	LogCustomEvent = function(_self, player, name, value, fields)
		table.insert(logged, { player = player, name = name, value = value, fields = fields })
	end,
	LogOnboardingFunnelStepEvent = function() end,
	LogFunnelStepEvent = function() end,
	LogEconomyEvent = function() end,
	LogProgressionEvent = function() end,
}

-- Enum stand-in: only the custom field keys are touched.
local Enum = { AnalyticsCustomFieldKeys = { CustomField01 = "f1", CustomField02 = "f2", CustomField03 = "f3" } }
local clock = { t = 0 }
local env = {
	Enum = Enum, math = math, table = table, string = string, os = { clock = function() return clock.t end },
	pairs = pairs, ipairs = ipairs, warn = function() end, print = print, setmetatable = setmetatable,
	task = { wait = function() end, spawn = function(f, ...) f(...) end },
	game = { GetService = function() return nil end },
}
local Analytics = luau.load(luau.compile(fs.readFile("game-src/server/Analytics.luau")), { environment = env })()

local function findEvent(name: string)
	for i = #logged, 1, -1 do
		if logged[i].name == name then return logged[i] end
	end
	return nil
end

-- A brand-new player who bounces after 42 seconds without starting a shift.
local a = Analytics.new(fakeService)
local bouncer = { UserId = 1, Name = "Bouncer" }
clock.t = 0
a:playerAdded(bouncer, { sessions = 1 })
clock.t = 42
a:playerRemoving(bouncer, "intermission")

local drop = findEvent("left_before_first_shift")
check(drop ~= nil, "bounce is recorded")
check(drop ~= nil and drop.value == 42, `the DURATION is the event value ({drop and drop.value}s), not a constant 1`)
check(drop ~= nil and drop.fields ~= nil and drop.fields.f1 == "15s_1m", `bucketed for a distribution ({drop and drop.fields and drop.fields.f1})`)
check(drop ~= nil and drop.fields.f2 == "intermission", "records the phase they left during")
check(drop ~= nil and drop.fields.f3 == "new", "records new vs returning")

local sess = findEvent("session_minutes")
check(sess ~= nil and sess.fields ~= nil and sess.fields.f1 == "no_shift",
	"session length is tagged with the cohort, so it can be broken down by it")

-- Someone who actually played must land in the other cohort.
logged = {}
local player = { UserId = 2, Name = "Chef" }
clock.t = 0
a:playerAdded(player, { sessions = 4 })
a:roundStarted(player, 1, 2)
clock.t = 300
a:playerRemoving(player, "intermission")
check(findEvent("left_before_first_shift") == nil, "a player who started a shift is not counted as a bounce")
local sess2 = findEvent("session_minutes")
check(sess2 ~= nil and sess2.fields.f1 == "played", "their session is tagged `played`")
check(sess2 ~= nil and sess2.value == 5, `session minutes are correct ({sess2 and sess2.value})`)

-- Bucket boundaries.
logged = {}
for _, case in { { 5, "under_15s" }, { 30, "15s_1m" }, { 120, "1m_3m" }, { 400, "3m_10m" }, { 900, "over_10m" } } do
	local p = { UserId = 100 + case[1], Name = "x" }
	clock.t = 0
	a:playerAdded(p, { sessions = 1 })
	clock.t = case[1]
	a:playerRemoving(p, "countdown")
	local e = findEvent("left_before_first_shift")
	check(e ~= nil and e.fields.f1 == case[2], `{case[1]}s -> {case[2]}`)
end

print(if failures > 0 then `{failures} FAILURES` else "PASS: analytics drop-off breakdown")
if failures > 0 then error(`{failures} checks failed`) end
