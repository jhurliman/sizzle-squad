--!strict
-- Badge awards (plan §2.7). All eight are live on the universe.
--
-- A 0 id silently no-ops, which is how this shipped before the badges existed
-- and remains the escape hatch for any future badge added here.
--
-- Names, descriptions and icons: roblox-game/store/badges.md

local Badges = {}
Badges.__index = Badges

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
	if self.service == nil then
		pcall(function()
			self.service = game:GetService("BadgeService")
		end)
	end
	return self
end

function Badges:playerRemoving(player: any)
	self.granted[player] = nil
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
	task.spawn(function()
		pcall(function()
			self.service:AwardBadge(player.UserId, id)
		end)
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
		if results.stars >= 3 then
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
