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

function Analytics.new()
	local self = setmetatable({}, Analytics)
	self.service = nil
	self.enum = nil
	pcall(function()
		self.service = game:GetService("AnalyticsService")
	end)
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
	local isNew = (profile.sessions or 1) <= 1
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

function Analytics:custom(player: any, name: string, value: number?)
	if self.service == nil then
		return
	end
	try(function()
		self.service:LogCustomEvent(player, name, value or 1)
	end)
end

--- The session summary is what answers "rounds per session" and "how long did
--- they stay", which are two of the four launch gates.
function Analytics:playerRemoving(player: any)
	local s = self.sessions[player]
	self.sessions[player] = nil
	if s == nil then
		return
	end
	local minutes = (os.clock() - s.joinedAt) / 60
	self:custom(player, "session_minutes", math.floor(minutes * 10) / 10)
	self:custom(player, "session_rounds", s.rounds)
	if s.rounds == 0 then
		-- Joined and left without ever finishing a shift: the single most
		-- important drop-off to watch during friends-and-family.
		self:custom(player, "left_before_first_shift", 1)
	end
end

return Analytics
