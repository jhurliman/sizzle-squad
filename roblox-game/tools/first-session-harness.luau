-- THE FIRST SESSION, END TO END: what a brand-new player's account looks like
-- across the First Shift teleport, and what analytics sees while it happens.
--
-- This exists because all of it was wrong at once, and silently. `sessions`
-- counted SERVER JOINS rather than player sessions, so the hop into the
-- reserved tutorial server made a first-ever player arrive already reading
-- `sessions == 2`. That one number gates three separate things: the auto-start
-- into First Shift, the Kitchen Card's "never on a first session" rule, and
-- the analytics `isNew` flag. All three inverted together. A brand-new player
-- was greeted with "Welcome back, chef" over the top of the Start button, and
-- the onboarding funnel that would have shown it recorded nothing for anyone.
--
-- Measured on the live game before the fix: of 250 sampled profiles, 91.6% had
-- never played a single round, and of the 182 that reached the tutorial server
-- exactly 2 ever started a shift.
--
-- The teleports themselves are Roblox service calls and cannot run here. What
-- this pins is everything that DEPENDS on them: the session accounting either
-- side of the hop, and the analytics that has to survive it.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

--------------------------------------------------------------------------
-- Progression, against an in-memory store, so the profile really round-trips
-- through save-and-release the way it does across a teleport.
--------------------------------------------------------------------------
local store = { data = {} }
function store:UpdateAsync(key, fn)
	local new = fn(self.data[key])
	if new ~= nil then
		self.data[key] = new
	end
	return self.data[key]
end
function store:GetAsync(key)
	return self.data[key]
end
function store:SetAsync(key, v)
	self.data[key] = v
end
local ordered = { UpdateAsync = function() end, IncrementAsync = function() end }
local fakeDSS = {}
fakeDSS.GetDataStore = function(_self)
	return store
end
fakeDSS.GetOrderedDataStore = function(_self)
	return ordered
end

local penv = {
	game = {
		JobId = "server-A",
		GetService = function()
			return fakeDSS
		end,
		BindToClose = function() end,
	},
	os = os,
	math = math,
	table = table,
	string = string,
	task = {
		wait = function() end,
		spawn = function(f, ...)
			f(...)
		end,
	},
	pairs = pairs,
	ipairs = ipairs,
	tostring = tostring,
	tonumber = tonumber,
	typeof = typeof,
	warn = function() end,
	print = print,
	setmetatable = setmetatable,
	select = select,
	type = type,
}
local Config = luau.load(luau.compile(fs.readFile("game-src/shared/Config.luau")), { environment = penv })()
local Catalog = luau.load(luau.compile(fs.readFile("game-src/shared/Catalog.luau")), { environment = penv })()
local Progression = luau.load(luau.compile(fs.readFile("game-src/server/Progression.luau")), { environment = penv })()

local pushed = nil
local remotes = {
	Progress = {
		FireClient = function(_self, _p, payload)
			pushed = payload
		end,
	},
}
local newbie = { UserId = 42, Name = "Newbie" }

-- 1. the public server they clicked the ad into: a genuine new session
local public = Progression.new(Config, remotes, Catalog, fakeDSS)
public:playerAdded(newbie, false)
check(public.profiles[newbie].sessions == 1, `a first-ever join is session 1 (got {public.profiles[newbie].sessions})`)
check(public.profiles[newbie].rounds == 0, "and they have never finished a shift")
public:playerRemoving(newbie) -- teleported out: the profile saves and releases

-- 2. the reserved First Shift server, arrived at by teleport. SAME session.
local tutorial = Progression.new(Config, remotes, Catalog, fakeDSS)
tutorial:playerAdded(newbie, true)
check(
	tutorial.profiles[newbie].sessions == 1,
	`the First Shift hop is NOT a new session (got {tutorial.profiles[newbie].sessions})`
)

-- 3. the client gates read career progress now, so the push has to carry it
check(pushed ~= nil and pushed.rounds == 0, "the progress push carries `rounds`")
check(pushed ~= nil and pushed.tutorialDone == false, "and `tutorialDone`, which the Kitchen Card gate reads")

-- 4. a genuine return still counts, or the Kitchen Card would never show again
tutorial:playerRemoving(newbie)
local later = Progression.new(Config, remotes, Catalog, fakeDSS)
later:playerAdded(newbie, false)
check(later.profiles[newbie].sessions == 2, `coming back tomorrow IS a new session (got {later.profiles[newbie].sessions})`)

--------------------------------------------------------------------------
-- Analytics: "new" must mean "has never finished a shift", never "sessions <= 1"
--------------------------------------------------------------------------
local logged = {}
local fakeService = {
	LogCustomEvent = function(_self, player, name, value, fields)
		table.insert(logged, { player = player, name = name, value = value, fields = fields })
	end,
	LogOnboardingFunnelStepEvent = function(_self, player, n, step)
		table.insert(logged, { player = player, name = `onboarding:{step}`, value = n })
	end,
	LogFunnelStepEvent = function() end,
	LogEconomyEvent = function() end,
	LogProgressionEvent = function() end,
}
local clock = { t = 0 }
local aenv = {
	Enum = { AnalyticsCustomFieldKeys = { CustomField01 = "f1", CustomField02 = "f2", CustomField03 = "f3" } },
	math = math,
	table = table,
	string = string,
	os = {
		clock = function()
			return clock.t
		end,
	},
	pairs = pairs,
	ipairs = ipairs,
	warn = function() end,
	print = print,
	setmetatable = setmetatable,
	task = {
		wait = function() end,
		spawn = function(f, ...)
			f(...)
		end,
	},
	game = {
		GetService = function()
			return nil
		end,
	},
}
local Analytics = luau.load(luau.compile(fs.readFile("game-src/server/Analytics.luau")), { environment = aenv })()
local function findEvent(name: string)
	for i = #logged, 1, -1 do
		if logged[i].name == name then
			return logged[i]
		end
	end
	return nil
end

local a = Analytics.new(fakeService)

-- `sessions == 2` is exactly what the old code saw on the far side of the hop.
-- A player who has never finished a shift is NEW regardless.
clock.t = 0
a:playerAdded(newbie, { sessions = 2, rounds = 0 })
check(findEvent("onboarding:joined") ~= nil, "a teleported first-timer still enters the onboarding funnel")

a:joinStart(newbie, true, true)
local js = findEvent("join_start")
check(js ~= nil, "join_start is recorded before the First Shift gate")
check(js ~= nil and js.fields.f1 == "tutorial_server", `and names the server kind ({js and js.fields.f1})`)
check(js ~= nil and js.fields.f2 == "teleport_in", `and how they arrived ({js and js.fields.f2})`)
check(js ~= nil and js.fields.f3 == "new", `and still calls them new ({js and js.fields.f3})`)

clock.t = 9
a:playerRemoving(newbie, "countdown", "teleport_tutorial")
local se = findEvent("session_end")
check(se ~= nil and se.fields.f1 == "teleport_tutorial", `a hop out is not a quit ({se and se.fields.f1})`)
check(se ~= nil and se.value == 9, `and carries the duration ({se and se.value}s), which is the 8.5s number`)

-- Someone who has finished a shift is not new, however few sessions they have.
logged = {}
local vet = { UserId = 43, Name = "Vet" }
clock.t = 0
a:playerAdded(vet, { sessions = 1, rounds = 4 })
check(findEvent("onboarding:joined") == nil, "a player with rounds behind them is not in the onboarding funnel")
a:joinStart(vet, false, false)
local js2 = findEvent("join_start")
check(js2 ~= nil and js2.fields.f2 == "fresh_join", `a direct join is not a hop ({js2 and js2.fields.f2})`)
check(js2 ~= nil and js2.fields.f3 == "returning", `and reads as returning ({js2 and js2.fields.f3})`)

-- A finished tutorial is enough on its own, even at rounds == 0 -- the same
-- pair of fields Tutorial.needsTutorial trusts.
logged = {}
local done = { UserId = 44, Name = "Done" }
a:playerAdded(done, { sessions = 1, rounds = 0, tutorialDone = true })
check(findEvent("onboarding:joined") == nil, "a finished tutorial is not new either")

-- An ordinary quit still records, so the reason field is never empty.
logged = {}
local quitter = { UserId = 45, Name = "Quitter" }
clock.t = 0
a:playerAdded(quitter, { sessions = 1, rounds = 0 })
clock.t = 30
a:playerRemoving(quitter, "countdown")
local se2 = findEvent("session_end")
check(se2 ~= nil and se2.fields.f1 == "quit", `an exit with no known reason is a quit ({se2 and se2.fields.f1})`)

print("")
print(if failures > 0 then `FAIL: first session — {failures}` else "PASS: first session")
if failures > 0 then
	error(`{failures} checks failed`)
end
