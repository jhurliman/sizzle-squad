--!strict
-- Badge awards (plan §2.7). Badge ids are 0 until badges are created on the
-- universe (user-gated: Creator Dashboard) — a 0 id silently no-ops, so this
-- ships wired and lights up when the ids are filled in.

local Badges = {}
Badges.__index = Badges

Badges.IDS = {
	firstDish = 0,
	firstThreeStar = 0,
	fullHumanCrewThreeStar = 0,
	hundredDishes = 0,
	thousandDishes = 0,
	levelTen = 0,
	perfectRound = 0, -- zero expired tickets
	foundingChef = 0, -- launch-window only
}

function Badges.new()
	local self = setmetatable({}, Badges)
	self.service = nil
	pcall(function()
		self.service = game:GetService("BadgeService")
	end)
	return self
end

function Badges:award(player: any, key: string)
	local id = Badges.IDS[key]
	if id == nil or id == 0 or self.service == nil then
		return
	end
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
		self:award(player, "foundingChef")
	end
end

return Badges
