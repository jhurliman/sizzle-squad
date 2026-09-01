--!strict
-- Funnel and economy instrumentation, via Roblox's built-in AnalyticsService
-- so the numbers land on the Creator Dashboard with no external service and
-- no key to manage.
--
-- WHY THIS EXISTS: the plan's launch gates are all funnel numbers -- D1 >= 25%,
-- session >= 12 min, rounds/session >= 3, first-round completion >= 90% -- and
-- nothing was recording any of them. A playtest without this produces
-- impressions; with it, it produces a funnel.
--
-- EVERY CALL IS pcall'd AND THE SERVICE IS OPTIONAL. AnalyticsService's exact
-- signatures have moved between engine versions, and an analytics call is
-- never worth taking a round down for: if anything here is unavailable or
-- changes shape, it degrades to a silent no-op rather than erroring inside
-- PlayerAdded or a round-end award.

local Analytics = {}
Analytics.__index = Analytics

-- Onboarding funnel: only meaningful for a brand-new player, and Roblox
-- expects the steps to be stable across releases.
local ONBOARDING = {
	joined = 1,
	seated = 2,
	firstShiftStarted = 3,
	firstShiftFinished = 4,
	secondShiftStarted = 5,
}

--- `service` is injectable so the cohort tagging and bucketing can be tested
--- headlessly; production passes nothing and gets the real service.
function Analytics.new(service: any?)
	local self = setmetatable({}, Analytics)
	self.service = service
	if self.service == nil then
		pcall(function()
			self.service = game:GetService("AnalyticsService")
		end)
	end
	-- session bookkeeping, keyed by player
	self.sessions = {} :: { [any]: { joinedAt: number, rounds: number, firstRoundDone: boolean, isNew: boolean } }
	return self
end

local function try(fn: () -> ())
	local ok, err = pcall(fn)
	if not ok then
		-- Once per unique message would be nicer; a warn is enough to notice.
		warn(`[analytics] {err}`)
	end
end

function Analytics:playerAdded(player: any, profile: any)
	-- "New" means they have never finished a shift -- the same test First
	-- Shift itself uses (Tutorial.needsTutorial). Deriving it from `sessions`
	-- made every teleported player look like a returning one, which silently
	-- emptied the onboarding funnel for 100% of real players.
	local isNew = (profile.rounds or 0) == 0 and profile.tutorialDone ~= true
	self.sessions[player] = {
		joinedAt = os.clock(),
		rounds = 0,
		firstRoundDone = false,
		isNew = isNew,
	}
	if isNew then
		self:onboarding(player, "joined")
	end
end

--- The first event of a session, emitted BEFORE the First Shift gate so the
--- teleport leg is visible at all. Together, `server_kind` and `arrival` say
--- which leg of the round trip this is -- the one thing the old funnel could
--- not tell you, because it started after the teleport had already happened.
--- `source` is Tutorial.joinSource: teleport_in / friend_invite /
--- friend_follow / direct. It is the only acquisition breakdown available to a
--- running server -- the analytics query API has no dimension for it -- so
--- this event is where "how many of our players arrive through a friend"
--- gets answered.
function Analytics:joinStart(player: any, isTutorialServer: boolean, source: string)
	local s = self.sessions[player]
	local kind = if isTutorialServer then "tutorial_server" else "public_server"
	local who = if s ~= nil and s.isNew then "new" else "returning"
	self:custom(player, "join_start", 1, { kind, source, who })
end

function Analytics:onboarding(player: any, step: string)
	local n = ONBOARDING[step]
	if self.service == nil or n == nil then
		return
	end
	local s = self.sessions[player]
	if s == nil or not s.isNew then
		return -- the onboarding funnel is a FIRST-SESSION funnel only
	end
	try(function()
		self.service:LogOnboardingFunnelStepEvent(player, n, step)
	end)
end

--- Per-round funnel. funnelSessionId scopes the steps to one shift, so a
--- player who plays five rounds produces five independent funnels rather than
--- one funnel with five confusing step-3s.
function Analytics:roundStep(player: any, roundIndex: number, stepNumber: number, stepName: string)
	if self.service == nil then
		return
	end
	try(function()
		self.service:LogFunnelStepEvent(player, "Shift", `{player.UserId}-{roundIndex}`, stepNumber, stepName)
	end)
end

function Analytics:roundStarted(player: any, roundIndex: number, crewSize: number)
	local s = self.sessions[player]
	if s ~= nil then
		s.rounds += 1
		if s.isNew then
			if s.rounds == 1 then
				self:onboarding(player, "firstShiftStarted")
			elseif s.rounds == 2 then
				self:onboarding(player, "secondShiftStarted")
			end
		end
	end
	self:roundStep(player, roundIndex, 1, "started")
	self:custom(player, "shift_started", crewSize)
end

function Analytics:roundFinished(player: any, roundIndex: number, results: any, award: any)
	self:roundStep(player, roundIndex, 2, "finished")
	local s = self.sessions[player]
	if s ~= nil and not s.firstRoundDone then
		s.firstRoundDone = true
		if s.isNew then
			self:onboarding(player, "firstShiftFinished")
		end
	end
	-- Stars are the quality signal the pacing work is judged on.
	self:custom(player, "shift_finished", results.stars or 0)
	if award ~= nil and award.coins ~= nil then
		self:economy(player, "source", award.coins, award.balance or 0, "Gameplay", "round_reward")
	end
end

--- flow: "source" (earned) or "sink" (spent).
function Analytics:economy(player: any, flow: string, amount: number, balance: number, transaction: string, sku: string)
	if self.service == nil or amount == nil or amount <= 0 then
		return
	end
	try(function()
		local flowType = if flow == "sink"
			then Enum.AnalyticsEconomyFlowType.Sink
			else Enum.AnalyticsEconomyFlowType.Source
		self.service:LogEconomyEvent(player, flowType, "Coins", amount, balance, transaction, sku)
	end)
end

function Analytics:levelUp(player: any, level: number)
	if self.service == nil then
		return
	end
	try(function()
		self.service:LogProgressionEvent(
			player,
			"Career",
			Enum.AnalyticsProgressionType.Complete,
			{},
			level,
			`level_{level}`
		)
	end)
end

--- `fields` is up to three strings. Roblox slices a custom event's value by
--- its custom fields, so a bare event answers "how many / what average" but
--- only a FIELDED one answers "broken down by what".
---
--- Keep field values low-cardinality (buckets, not raw numbers): the dashboard
--- groups by exact string, so a continuous value produces one bucket per
--- player and no usable breakdown at all.
function Analytics:custom(player: any, name: string, value: number?, fields: { string }?)
	if self.service == nil then
		return
	end
	try(function()
		local custom = nil
		if fields ~= nil and #fields > 0 then
			custom = {}
			local keys = {
				Enum.AnalyticsCustomFieldKeys.CustomField01,
				Enum.AnalyticsCustomFieldKeys.CustomField02,
				Enum.AnalyticsCustomFieldKeys.CustomField03,
			}
			for i = 1, math.min(#fields, 3) do
				custom[keys[i]] = fields[i]
			end
		end
		self.service:LogCustomEvent(player, name, value or 1, custom)
	end)
end

--- Coarse buckets for "how long before they gave up". A distribution is what
--- you actually want here, and the dashboard can only build one from discrete
--- field values.
local function durationBucket(seconds: number): string
	if seconds < 15 then
		return "under_15s"
	elseif seconds < 60 then
		return "15s_1m"
	elseif seconds < 180 then
		return "1m_3m"
	elseif seconds < 600 then
		return "3m_10m"
	end
	return "over_10m"
end

--- The session summary is what answers "rounds per session" and "how long did
--- they stay", which are two of the four launch gates.
--- `phase` is the round phase they left during, which separates "sat in the
--- lobby and never pressed Start" from "bailed mid-shift" -- two very
--- different problems with the same session length.
--- `reason` separates a teleport out of this server from an actual quit. They
--- were indistinguishable before, and the teleport is by far the more common
--- exit -- which is why average session length read as a few seconds.
function Analytics:playerRemoving(player: any, phase: string?, reason: string?)
	local s = self.sessions[player]
	self.sessions[player] = nil
	if s == nil then
		return
	end
	local seconds = os.clock() - s.joinedAt
	local cohort = if s.rounds == 0 then "no_shift" else "played"
	local who = if s.isNew then "new" else "returning"

	-- Tagged, so session length can be broken down BY cohort rather than
	-- averaged across everyone.
	local why = reason or "quit"

	self:custom(player, "session_minutes", math.floor(seconds / 6) / 10, { cohort, who, durationBucket(seconds) })
	self:custom(player, "session_rounds", s.rounds, { cohort, who })
	-- Custom fields cap at three, so the exit reason gets its own event rather
	-- than being silently truncated off the end of session_minutes.
	self:custom(player, "session_end", math.floor(seconds), { why, who, durationBucket(seconds) })

	if s.rounds == 0 then
		-- Joined and left without ever starting a shift: the most expensive
		-- drop-off there is. The VALUE is how long they lasted and the FIELDS
		-- bucket it, so the dashboard gives both an average and a
		-- distribution -- "how long did the people who bounced actually stay".
		self:custom(player, "left_before_first_shift", math.floor(seconds), {
			durationBucket(seconds),
			phase or "unknown",
			who,
		})
	end
end

return Analytics
