--!strict
-- The end-of-shift ceremony.
--
-- This was one TextLabel rewritten in a single frame: the whole result of a
-- three-minute round appeared instantly as a wall of text, which gives the
-- player nothing to feel. A reward you cannot watch arrive does not read as a
-- reward.
--
-- So it is staged on a timeline: the score lands, then stars punch in one at a
-- time, then coins and XP COUNT UP to what you actually earned, then the
-- superlative cards deal out. Nothing here invents numbers -- the coin and XP
-- figures are the per-player deltas the server recorded in awardRound.

local Theme = require(script.Parent.Menu.Theme) :: any
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Game"):WaitForChild("Config")) :: any

local Results = {}
Results.__index = Results

local mk = Theme.mk

-- Beats, in seconds from the start of the results phase. The phase runs 12s
-- (Config.RESULTS), so the last card lands with time to read it.
local T_CARD = 0.0
local T_STATS = 0.35
local T_STARS = 1.1
local STAR_GAP = 0.42
local T_COINS = 2.7
local T_XP = 4.1
local T_SUPER = 5.5
local SUPER_GAP = 0.55

local TICK = 1.9 -- how fast a counter chases its target (higher = snappier)

function Results.new(gui: Instance)
	local self = setmetatable({}, Results)
	self.t = -1 -- <0 means "not showing"
	self.coins = 0
	self.xp = 0
	-- The running bar: where it is NOW as the award pays out, not where it
	-- ended up. See setAward.
	self.animXp = 0
	self.animLevel = 1
	self.shownLevel = 0
	self.shownStars = 0
	self.shownCards = 0

	self.scrim = mk("Frame", {
		Name = "ResultsScrim",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Theme.BROWN_DEEP,
		BackgroundTransparency = 0.3,
		Visible = false,
		ZIndex = 8,
	}, gui)

	self.card = Theme.card({
		Name = "Results",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(460, 400),
		BackgroundTransparency = 0.02,
		ZIndex = 9,
	}, self.scrim)
	Theme.stroke(self.card, Theme.GOLD, 2)
	self.scale = mk("UIScale", { Scale = 1 }, self.card)

	self.title = Theme.label({
		Size = UDim2.new(1, -24, 0, 34),
		Position = UDim2.fromOffset(12, 14),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 26,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 10,
		Text = "SHIFT OVER",
	}, self.card)

	self.stars = {}
	for i = 1, 3 do
		self.stars[i] = Theme.label({
			Size = UDim2.fromOffset(56, 56),
			Position = UDim2.new(0.5, -84 + (i - 1) * 56, 0, 52),
			TextXAlignment = Enum.TextXAlignment.Center,
			TextSize = 46,
			Font = Theme.TITLE_FONT,
			TextColor3 = Theme.GOLD,
			ZIndex = 10,
			Text = "☆",
		}, self.card)
	end

	self.stats = Theme.label({
		Size = UDim2.new(1, -24, 0, 22),
		Position = UDim2.fromOffset(12, 116),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 16,
		ZIndex = 10,
		Text = "",
	}, self.card)

	self.coinLabel = Theme.label({
		Size = UDim2.new(1, -24, 0, 40),
		Position = UDim2.fromOffset(12, 146),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 34,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 10,
		Text = "",
	}, self.card)

	self.xpLabel = Theme.label({
		Size = UDim2.new(1, -24, 0, 20),
		Position = UDim2.fromOffset(12, 190),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 15,
		ZIndex = 10,
		Text = "",
	}, self.card)

	local track = mk("Frame", {
		Size = UDim2.new(1, -60, 0, 12),
		Position = UDim2.fromOffset(30, 214),
		BackgroundColor3 = Theme.BROWN_MID,
		BorderSizePixel = 0,
		ZIndex = 10,
	}, self.card)
	Theme.corner(track, 6)
	self.xpFill = mk("Frame", {
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
		ZIndex = 11,
	}, track)
	Theme.corner(self.xpFill, 6)

	self.levelBurst = Theme.label({
		Size = UDim2.new(1, -24, 0, 26),
		Position = UDim2.fromOffset(12, 232),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 19,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GREEN,
		ZIndex = 10,
		Visible = false,
		Text = "",
	}, self.card)

	self.cards = {}
	for i = 1, 4 do
		self.cards[i] = Theme.label({
			Size = UDim2.new(1, -36, 0, 24),
			Position = UDim2.fromOffset(18, 262 + (i - 1) * 26),
			TextXAlignment = Enum.TextXAlignment.Center,
			TextSize = 15,
			ZIndex = 10,
			Visible = false,
			Text = "",
		}, self.card)
	end
	return self
end

--- The personal half of the ceremony, from the Progress push that follows a
--- round award. Arrives just BEFORE the results phase broadcast.
function Results:setAward(award: any)
	self.award = award
end

function Results:show(results: any, cards: any?)
	self.results = results
	self.cardList = cards
	self.t = 0
	self.coins = 0
	self.xp = 0
	self.shownStars = 0
	self.shownCards = 0
	self.scrim.Visible = true
	self.scale.Scale = 0.9

	for i = 1, 3 do
		self.stars[i].Text = "☆"
		self.stars[i].TextTransparency = 0.45
	end
	self.stats.Text = ""
	self.coinLabel.Text = ""
	self.xpLabel.Text = ""
	self.xpFill.Size = UDim2.fromScale(0, 1)
	self.levelBurst.Visible = false
	-- Start the bar where the player left it, so the fill they watch is the
	-- one they earned rather than a number that was already there.
	self.animXp = (self.award ~= nil and self.award.xpBefore) or 0
	self.animLevel = (self.award ~= nil and self.award.levelBefore) or 1
	self.shownLevel = self.animLevel
	for _, c in self.cards do
		c.Visible = false
	end
end

function Results:hide()
	self.t = -1
	self.scrim.Visible = false
end

function Results:step(dt: number)
	if self.t < 0 or self.results == nil then
		return
	end
	self.t += dt
	local r = self.results
	local award = self.award

	-- card settles in
	self.scale.Scale += (1 - self.scale.Scale) * math.min(1, dt * 9)

	if self.t >= T_STATS and self.stats.Text == "" then
		-- "best combo x7" was the same category error the in-round chip made:
		-- bestCombo is a COUNT of consecutive clean serves, and a 7 streak pays
		-- x1.90, not x7. As an end-of-round record the count is the interesting
		-- number, so it keeps the count and loses the multiplication sign.
		self.stats.Text = `{r.served} dishes served  ·  best streak {r.bestCombo}  ·  {r.coins} team coins`
	end

	-- stars punch in one at a time
	local want = math.clamp(math.floor((self.t - T_STARS) / STAR_GAP) + 1, 0, r.stars or 0)
	while self.shownStars < want do
		self.shownStars += 1
		local star = self.stars[self.shownStars]
		star.Text = "★"
		star.TextTransparency = 0
		star.TextSize = 64
		if self.onStar ~= nil then
			self.onStar(self.shownStars)
		end
	end
	for i = 1, 3 do
		local target = if i <= self.shownStars then 46 else 46
		self.stars[i].TextSize += (target - self.stars[i].TextSize) * math.min(1, dt * 7)
	end

	-- coins count UP to what this shift actually paid
	if self.t >= T_COINS and award ~= nil then
		local target = award.coins or 0
		self.coins += (target - self.coins) * math.min(1, dt * TICK)
		if target - self.coins < 1 then
			self.coins = target
		end
		self.coinLabel.Text = `+{math.floor(self.coins + 0.5)} coins`
	end

	-- then XP, and the level-up if there was one
	if self.t >= T_XP and award ~= nil then
		local target = award.xp or 0
		self.xp += (target - self.xp) * math.min(1, dt * TICK)
		if target - self.xp < 1 then
			self.xp = target
		end
		self.xpLabel.Text = `+{math.floor(self.xp + 0.5)} XP`

		-- ROLL THE BAR, DO NOT SNAP IT.
		--
		-- This used to read the POST-award progress straight off the profile,
		-- so the bar was already where it would end up before the counter had
		-- finished ticking, and a player who gained two levels saw one burst
		-- naming only the last of them. Now the earned XP is poured into the
		-- bar at the same rate the counter climbs, and each level it crosses
		-- announces itself on the way past.
		local poured = math.floor(self.xp + 0.5)
		local want = (award.xpBefore or 0) + poured
		self.animXp = want
		local guard = 0
		while guard < 20 do
			guard += 1
			local need = Config.LEVEL_CURVE(self.animLevel)
			if need <= 0 or self.animXp < need then
				break
			end
			self.animXp -= need
			self.animLevel += 1
		end
		local need = math.max(1, Config.LEVEL_CURVE(self.animLevel))
		self.xpFill.Size = UDim2.fromScale(math.clamp(self.animXp / need, 0, 1), 1)

		if self.animLevel > self.shownLevel then
			self.shownLevel = self.animLevel
			self.levelBurst.Visible = true
			self.levelBurst.Text = `LEVEL {self.animLevel}!`
			if self.onLevelUp ~= nil then
				self.onLevelUp()
			end
		end
	end

	-- superlatives deal out last
	if self.cardList ~= nil then
		local n = math.floor((self.t - T_SUPER) / SUPER_GAP) + 1
		local list = {}
		for _, card in self.cardList do
			table.insert(list, card)
		end
		while self.shownCards < math.min(n, #list, #self.cards) do
			self.shownCards += 1
			local card = list[self.shownCards]
			local label = self.cards[self.shownCards]
			label.Visible = true
			label.Text = `🏅 {card.title} — {card.line}`
			if self.onCard ~= nil then
				self.onCard()
			end
		end
	end
end

function Results:setProgress(progress: any)
	self.progress = progress
end

function Results:relayout(_L: any, viewport: Vector2)
	self.card.Size = UDim2.fromOffset(math.min(460, viewport.X - 40), math.min(400, viewport.Y - 40))
end

return Results
