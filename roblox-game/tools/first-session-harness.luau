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
local CLOCK = { t = 1000 }

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
	-- A CONTROLLABLE CLOCK. playSeconds is a difference of os.clock() readings,
	-- so it can only be tested if the harness owns the clock.
	os = {
		clock = function()
			return CLOCK.t
		end,
		time = function()
			return 1788000000 + math.floor(CLOCK.t)
		end,
		date = os.date,
	},
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
-- HOW FAR THEY GOT, AND HOW LONG THEY LASTED.
--
-- `rounds > 0` says only "did they ever finish a shift". For the ~76% who
-- never do, it says nothing at all -- a player who quit on the loading screen
-- and one who chopped for two minutes are the same row. These two fields are
-- what turn that undifferentiated block into a funnel, and they live in the
-- profile because a profile is readable through Open Cloud and an analytics
-- event is not.
--------------------------------------------------------------------------
local funnelStore = { data = {} }
function funnelStore:UpdateAsync(key, fn)
	local nv = fn(self.data[key])
	if nv ~= nil then
		self.data[key] = nv
	end
	return self.data[key]
end
function funnelStore:GetAsync(key)
	return self.data[key]
end
function funnelStore:SetAsync(key, v)
	self.data[key] = v
end
local funnelDSS = {}
funnelDSS.GetDataStore = function(_self)
	return funnelStore
end
funnelDSS.GetOrderedDataStore = function(_self)
	return ordered
end

CLOCK.t = 5000
local fp = Progression.new(Config, remotes, Catalog, funnelDSS)
local walker = { UserId = 77, Name = "Walker" }
fp:playerAdded(walker, false)
local wp = fp.profiles[walker]

check(wp.reach == "", "a fresh profile has reached nothing yet")
check(wp.playSeconds == 0, "and has no time on the clock")
check(wp.firstJoinAt ~= nil, "firstJoinAt is stamped on the first join")
local firstJoin = wp.firstJoinAt

fp:noteReach(walker, "joined")
check(wp.reach == "joined", "joined is recorded")
fp:noteReach(walker, "moved")
check(wp.reach == "moved", "and the funnel advances")
-- MONOTONIC. `seated` fires after `moved` in a late-join, and a funnel that
-- could go backwards would report the wrong drop-off stage for that player.
fp:noteReach(walker, "seated")
check(wp.reach == "moved", "an earlier stage never overwrites a later one")
fp:noteReach(walker, "worked")
check(wp.reach == "worked", "but a later stage does advance it")
fp:noteReach(walker, "nonsense")
check(wp.reach == "worked", "an unknown stage is ignored rather than stored")

-- Time accrues in real seconds and survives the round trip.
CLOCK.t = 5090
fp:accrue(walker)
check(math.abs(wp.playSeconds - 90) < 0.01, `90s of play is recorded (got {wp.playSeconds})`)
CLOCK.t = 5100
fp:accrue(walker)
check(math.abs(wp.playSeconds - 100) < 0.01, `accrual is incremental, not restated (got {wp.playSeconds})`)
check(wp.lastSeenAt ~= nil and wp.lastSeenAt >= firstJoin, "lastSeenAt moves forward")

-- A second session continues the same totals rather than resetting them.
fp:playerRemoving(walker)
CLOCK.t = 9000
local fp2 = Progression.new(Config, remotes, Catalog, funnelDSS)
fp2:playerAdded(walker, false)
local wp2 = fp2.profiles[walker]
check(math.abs(wp2.playSeconds - 100) < 0.01, `play time persists across sessions (got {wp2.playSeconds})`)
check(wp2.reach == "worked", "and so does the furthest stage reached")
check(wp2.firstJoinAt == firstJoin, "firstJoinAt is never overwritten")
CLOCK.t = 9060
fp2:accrue(walker)
check(math.abs(wp2.playSeconds - 160) < 0.01, `a later session adds to it (got {wp2.playSeconds})`)

--------------------------------------------------------------------------
-- Where a player came from. Roblox tells a running server almost nothing --
-- there is no search/discovery/ad signal in here, and no analytics dimension
-- for one either -- but it does tell us the two arrivals that change what we
-- should do next: a hop inside the experience, and somebody who came to play
-- with a specific person.
--------------------------------------------------------------------------
local tenv = {
	game = {
		GetService = function()
			return nil
		end,
		PlaceId = 1,
		JobId = "j",
	},
	os = os,
	math = math,
	table = table,
	string = string,
	type = type,
	typeof = typeof,
	pairs = pairs,
	ipairs = ipairs,
	pcall = pcall,
	warn = function() end,
	print = print,
	setmetatable = setmetatable,
}
local Tutorial = luau.load(luau.compile(fs.readFile("game-src/server/Tutorial.luau")), { environment = tenv })()

local function fakePlayer(joinData, followId: number?)
	return {
		UserId = 99,
		Name = "Arriver",
		FollowUserId = followId or 0,
		GetJoinData = function()
			return joinData or {}
		end,
	}
end

local src, who = Tutorial.joinSource(fakePlayer({ TeleportData = { tutorial = true } }))
check(src == "teleport_in", "teleport data reads as a hop")
check(who == nil, "and carries nobody to find")

src, who = Tutorial.joinSource(fakePlayer({ ReferredByPlayerId = 5 }))
check(src == "friend_invite", "ReferredByPlayerId reads as an invite")
check(who == 5, `and returns the referrer ({who})`)

src, who = Tutorial.joinSource(fakePlayer(nil, 7))
check(src == "friend_follow", "FollowUserId reads as a follow")
check(who == 7, `and returns who they followed ({who})`)

-- Social:joinFriend stamps this, so tapping JOIN A FRIEND is both a same-
-- session hop AND a friend arrival. Without it the in-game join button sent a
-- first-timer straight back out to a solo tutorial, away from the friend they
-- had just asked to join.
src, who = Tutorial.joinSource(fakePlayer({ TeleportData = { hop = true, joinedFriend = true, friendUserId = 11 } }))
check(src == "friend_hop", "JOIN A FRIEND is a friend arrival, not a plain hop")
check(who == 11, `and knows who they went to see ({who})`)

check(Tutorial.joinSource(fakePlayer({})) == "direct", "everything else is direct")
check(Tutorial.joinSource(fakePlayer({ ReferredByPlayerId = 0 }, 0)) == "direct", "a zeroed id is not a friend join")

check(Tutorial.isFriendJoin("friend_invite"), "an invite is a friend join")
check(Tutorial.isFriendJoin("friend_follow"), "so is a follow")
check(Tutorial.isFriendJoin("friend_hop"), "so is JOIN A FRIEND")
check(not Tutorial.isFriendJoin("direct"), "a direct join is not")
-- The First Shift return teleport carries teleport data, and treating that as
-- "they came to play with someone" would skip the tutorial for a player who is
-- simply on their way back.
check(not Tutorial.isFriendJoin("teleport_in"), "and neither is an ordinary hop")

-- Every in-experience teleport is the same session, however it was triggered.
check(Tutorial.isHop("teleport_in"), "a tutorial leg is a hop")
check(Tutorial.isHop("friend_hop"), "so is a Social teleport")
check(not Tutorial.isHop("friend_invite"), "an invite from outside is not")
check(not Tutorial.isHop("direct"), "and neither is a direct join")

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

a:joinStart(newbie, true, "teleport_in")
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

-- A HOP IS NOT A DROP-OFF. Hoisting playerAdded above the First Shift gate
-- means the outward leg now has a session record, so the drop-off metrics have
-- to exclude it explicitly -- otherwise `left_before_first_shift` fills up with
-- 8-second teleports and average session length reads as a few seconds again,
-- which is the very artifact this whole change exists to remove.
check(findEvent("left_before_first_shift") == nil, "a teleport is not recorded as a bounce")
check(findEvent("session_minutes") == nil, "and does not count as a session's length")
check(findEvent("session_rounds") == nil, "and does not count as a session at all")

-- The onboarding funnel is per player, not per server: the far side of the hop
-- must not re-enter it, or every new player is counted twice at step 1.
logged = {}
local arrived = { UserId = 47, Name = "Arrived" }
a:playerAdded(arrived, { sessions = 1, rounds = 0 }, true)
check(findEvent("onboarding:joined") == nil, "the far side of a hop does not re-enter the funnel")
a:playerRemoving(arrived, "countdown", "quit")
check(findEvent("left_before_first_shift") ~= nil, "but a real quit on that leg still counts as a bounce")

-- Someone who has finished a shift is not new, however few sessions they have.
logged = {}
local vet = { UserId = 43, Name = "Vet" }
clock.t = 0
a:playerAdded(vet, { sessions = 1, rounds = 4 })
check(findEvent("onboarding:joined") == nil, "a player with rounds behind them is not in the onboarding funnel")
a:joinStart(vet, false, "direct")
local js2 = findEvent("join_start")
check(js2 ~= nil and js2.fields.f2 == "direct", `a direct join is not a hop ({js2 and js2.fields.f2})`)
check(js2 ~= nil and js2.fields.f3 == "returning", `and reads as returning ({js2 and js2.fields.f3})`)

-- A friend arrival carries its own source through to the dashboard, which is
-- what makes "how many players arrive through a friend" answerable at all.
logged = {}
local invited = { UserId = 46, Name = "Invited" }
a:playerAdded(invited, { sessions = 1, rounds = 0 })
a:joinStart(invited, false, "friend_invite")
local js3 = findEvent("join_start")
check(js3 ~= nil and js3.fields.f2 == "friend_invite", `an invite is recorded as one ({js3 and js3.fields.f2})`)
check(js3 ~= nil and js3.fields.f3 == "new", "and they are still a first-timer")

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
