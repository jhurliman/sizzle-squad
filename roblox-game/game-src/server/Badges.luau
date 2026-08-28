--!strict
-- Badge awards (plan §2.7). All eight are live on the universe.
--
-- A 0 id silently no-ops, which is how this shipped before the badges existed
-- and remains the escape hatch for any future badge added here.
--
-- Names, descriptions and icons: roblox-game/store/badges.md

local Badges = {}
Badges.__index = Badges

--- Seconds between queued badge awards. Roblox's notification is on screen for
--- roughly five, so anything shorter overlaps the one before it.
local AWARD_GAP = 5

Badges.IDS = {
	firstDish = 4431857963958852,
	firstThreeStar = 4317478992496196,
	fullHumanCrewThreeStar = 814549161360154,
	hundredDishes = 1810766503952474,
	thousandDishes = 2460897867893271,
	levelTen = 2294823863469429,
	perfectRound = 437880355258821, -- zero expired tickets
	foundingChef = 2672137851503382, -- launch-window only
}

--- `service` is injectable so the award rules, the session de-dup and the
--- Founding Chef window can be tested without BadgeService.
function Badges.new(config: any?, service: any?)
	local self = setmetatable({}, Badges)
	self.config = config
	self.service = service
	-- player -> set of badge keys already granted THIS SESSION. Awarding a
	-- badge someone owns is a no-op on Roblox's side, but the conditions here
	-- re-fire every round for every player, so without this a four-player
	-- server burns dozens of pointless BadgeService calls a minute and can
	-- trip the award rate limit for badges that actually matter.
	self.granted = {} :: { [any]: { [string]: boolean } }
	-- Pending AwardBadge calls, drained one every AWARD_GAP seconds. See
	-- Badges:enqueue.
	self.pending = {} :: { { player: any, id: number } }
	self.pumping = false
	if self.service == nil then
		pcall(function()
			self.service = game:GetService("BadgeService")
		end)
	end
	return self
end

function Badges:playerRemoving(player: any)
	self.granted[player] = nil
	-- Pacing must never cost someone a badge they earned. Anything still
	-- queued for a leaving player is awarded at once: the toasts would overlap,
	-- but they are not there to see them, and the grant is what matters.
	local flush = {}
	for i = #self.pending, 1, -1 do
		if self.pending[i].player == player then
			table.insert(flush, table.remove(self.pending, i).id)
		end
	end
	if #flush > 0 and self.service ~= nil then
		local userId = player.UserId
		task.spawn(function()
			for _, id in flush do
				pcall(function()
					self.service:AwardBadge(userId, id)
				end)
			end
		end)
	end
end

--- Backfill what a player already owns.
---
--- Without this, anyone who earned a badge before the game started mirroring
--- them sees an empty case forever -- the award only fires on the transition,
--- and Roblox will never re-fire it. One batched call on join, not per badge.
function Badges:backfill(player: any)
	if self.service == nil then
		return
	end
	local keys, ids = {}, {}
	for key, id in Badges.IDS do
		if id ~= 0 then
			table.insert(keys, key)
			table.insert(ids, id)
		end
	end
	if #ids == 0 then
		return
	end
	task.spawn(function()
		local ok, owned = pcall(function()
			return self.service:CheckUserBadgesAsync(player.UserId, ids)
		end)
		if not ok or owned == nil then
			return
		end
		local has = {}
		for _, id in owned do
			has[id] = true
		end
		local seen = self.granted[player]
		if seen == nil then
			seen = {}
			self.granted[player] = seen
		end
		for i, key in keys do
			if has[ids[i]] then
				seen[key] = true -- already owned: never re-award
				if self.onAward ~= nil then
					self.onAward(player, key)
				end
			end
		end
	end)
end

--- Is the launch-window badge still earnable?
function Badges:foundingOpen(): boolean
	local until_ = self.config ~= nil and self.config.FOUNDING_CHEF_UNTIL or nil
	if until_ == nil or until_ == "" then
		return false
	end
	return (os.date("!%Y-%m-%d") :: string) <= until_
end

function Badges:award(player: any, key: string)
	local id = Badges.IDS[key]
	if id == nil or id == 0 or self.service == nil then
		return
	end
	local seen = self.granted[player]
	if seen == nil then
		seen = {}
		self.granted[player] = seen
	end
	if seen[key] then
		return -- already handed out this session
	end
	seen[key] = true
	-- Mirror it into the profile so the game has a badge case of its own.
	if self.onAward ~= nil then
		self.onAward(player, key)
	end
	self:enqueue(player, id)
end

--- ONE BADGE TOAST AT A TIME.
---
--- Roblox's own "Badge Awarded" notification slides in from the right and sits
--- for about five seconds, and AwardBadge is what triggers it -- there is no
--- way to grant quietly and present it ourselves. onRoundEnd can fire up to
--- seven awards for one player in a single tick, and the first round of an
--- established player is exactly that case (firstDish and hundredDishes and
--- thousandDishes and foundingChef all at once). Fired together they animate
--- on top of each other, half of them clipped off the right edge of the
--- screen, which is what a player reported.
---
--- So awards queue and drain one per AWARD_GAP. The profile mirror in :award
--- still happens immediately, so the game's own badge case is never behind.
function Badges:enqueue(player: any, id: number)
	table.insert(self.pending, { player = player, id = id })
	if self.pumping then
		return
	end
	self.pumping = true
	task.spawn(function()
		while #self.pending > 0 do
			local job = table.remove(self.pending, 1)
			pcall(function()
				self.service:AwardBadge(job.player.UserId, job.id)
			end)
			if #self.pending > 0 then
				task.wait(AWARD_GAP)
			end
		end
		self.pumping = false
	end)
end

--- Round-end sweep: badge conditions from results + profiles.
function Badges:onRoundEnd(crew: any, progression: any, results: any)
	for player, seat in crew.seats do
		local profile = progression.profiles[player]
		if profile == nil then
			continue
		end
		local stats = results.stats[seat.chefId] or {}
		if (stats.serves or 0) > 0 then
			self:award(player, "firstDish")
		end
		-- The tutorial always reports three stars (RoundDirector:buildResults),
		-- so the star badges have to ignore it or every player would own
		-- "Three Stars" before working a real shift.
		if results.stars >= 3 and not results.tutorial then
			self:award(player, "firstThreeStar")
			if crew:humanCount() >= 4 then
				self:award(player, "fullHumanCrewThreeStar")
			end
		end
		if results.missed == 0 and results.served > 0 then
			self:award(player, "perfectRound")
		end
		if profile.totalDishes >= 100 then
			self:award(player, "hundredDishes")
		end
		if profile.totalDishes >= 1000 then
			self:award(player, "thousandDishes")
		end
		if profile.level >= 10 then
			self:award(player, "levelTen")
		end
		-- Launch-window only, or it is just a participation trophy.
		if self:foundingOpen() then
			self:award(player, "foundingChef")
		end
	end
end

return Badges
