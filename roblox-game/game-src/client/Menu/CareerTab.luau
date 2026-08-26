--!strict
-- Career: level and XP, lifetime stats, today's goals, the milestone reward
-- track, and the invite button.
--
-- Absorbs Hud's dailies panel (and its completion toast) plus the INVITE
-- FRIENDS button that main.client.luau was building by hand.

local Theme = require(script.Parent.Theme) :: any

local CareerTab = {}
CareerTab.__index = CareerTab

local mk = Theme.mk

function CareerTab.new(parent: Instance, deps: any)
	local self = setmetatable({}, CareerTab)
	self.catalog = deps.catalog
	self.deps = deps
	self.claimed = {} :: { [string]: boolean }

	-- ---- header: level + XP ------------------------------------------
	local header = Theme.card({
		Size = UDim2.new(1, 0, 0, 76),
		BackgroundColor3 = Theme.BROWN_LIGHT,
		BackgroundTransparency = 0.25,
		ZIndex = 4,
	}, parent)

	self.levelLabel = Theme.label({
		Size = UDim2.new(0.5, 0, 0, 30),
		Position = UDim2.fromOffset(14, 8),
		TextSize = 22,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 5,
		Text = "Level 1",
	}, header)

	self.statsLabel = Theme.label({
		Size = UDim2.new(0.5, -20, 0, 30),
		Position = UDim2.new(0.5, 0, 0, 8),
		TextXAlignment = Enum.TextXAlignment.Right,
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		ZIndex = 5,
		Text = "",
	}, header)

	local track = mk("Frame", {
		Size = UDim2.new(1, -28, 0, 14),
		Position = UDim2.fromOffset(14, 44),
		BackgroundColor3 = Theme.BROWN,
		BorderSizePixel = 0,
		ZIndex = 5,
	}, header)
	Theme.corner(track, 7)
	self.xpFill = mk("Frame", {
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
		ZIndex = 6,
	}, track)
	Theme.corner(self.xpFill, 7)
	self.xpLabel = Theme.label({
		Size = UDim2.new(1, -28, 0, 16),
		Position = UDim2.fromOffset(14, 58),
		TextSize = 12,
		TextColor3 = Theme.DIM,
		ZIndex = 5,
		Text = "",
	}, header)

	-- ---- body: two columns -------------------------------------------
	self.left = Theme.scrollList({
		Position = UDim2.fromOffset(0, 86),
		Size = UDim2.new(0.5, -6, 1, -140),
		ZIndex = 4,
	}, parent)
	self.right = Theme.scrollList({
		Position = UDim2.new(0.5, 6, 0, 86),
		Size = UDim2.new(0.5, -6, 1, -140),
		ZIndex = 4,
	}, parent)

	self.invite = Theme.button({
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -4),
		Size = UDim2.fromOffset(220, Theme.MIN_TAP),
		Fill = Theme.BLUE,
		TextSize = 17,
		ZIndex = 5,
		Text = "＋ INVITE FRIENDS",
	}, parent)
	self.invite.Activated:Connect(function()
		pcall(function()
			local SocialService = game:GetService("SocialService")
			local Players = game:GetService("Players")
			SocialService:PromptGameInvite(Players.LocalPlayer)
		end)
	end)

	return self
end

local function sectionTitle(parent: Instance, order: number, text: string)
	return Theme.label({
		Size = UDim2.new(1, -10, 0, 24),
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		TextSize = 15,
		LayoutOrder = order,
		ZIndex = 5,
		Text = text,
	}, parent)
end

function CareerTab:setProgress(progress: any)
	self.progress = progress
	local level = progress.level or 1
	local xp, toNext = progress.xp or 0, progress.xpToNext or 1
	self.levelLabel.Text = `Level {level}`
	self.statsLabel.Text = `{progress.coins or 0} 🪙   ·   🔥{progress.streak or 0}`
	self.xpFill.Size = UDim2.fromScale(math.clamp(xp / math.max(1, toNext), 0, 1), 1)
	self.xpLabel.Text = `{xp} / {toNext} XP to level {level + 1}`
	self:renderGoals(progress)
	self:renderMilestones(progress)
end

function CareerTab:renderGoals(progress: any)
	for _, c in self.left:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	sectionTitle(self.left, 1, "TODAY'S GOALS")
	local dailies = progress.dailies or {}
	for i, d in dailies do
		local done = d.claimed == true
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 44),
			BackgroundColor3 = Theme.BROWN_LIGHT,
			BackgroundTransparency = 0.3,
			BorderSizePixel = 0,
			LayoutOrder = i + 1,
			ZIndex = 4,
		}, self.left)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.new(1, -16, 0, 22),
			Position = UDim2.fromOffset(10, 3),
			TextSize = 14,
			Font = Theme.BOLD_FONT,
			TextColor3 = if done then Theme.GREEN else Theme.CREAM,
			ZIndex = 5,
			Text = if done then `✅ {d.name}` else d.name,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -16, 0, 16),
			Position = UDim2.fromOffset(10, 24),
			TextSize = 12,
			TextColor3 = Theme.DIM,
			ZIndex = 5,
			Text = `{math.min(d.progress, d.goal)}/{d.goal}  ·  +{d.coins}🪙  +{d.xp} XP`,
		}, row)
		-- Toast on the transition, exactly as the old dailies panel did.
		if done and not self.claimed[d.id] then
			self.claimed[d.id] = true
			if self.deps.onToast ~= nil then
				self.deps.onToast(`Daily complete: {d.name}  +{d.coins}c`)
			end
		end
	end

	sectionTitle(self.left, 50, "CAREER")
	local stats = {
		{ "Shifts worked", progress.rounds or 0 },
		{ "Dishes served", progress.totalDishes or 0 },
		{ "Best shift", progress.bestRound or 0 },
	}
	for i, s in stats do
		Theme.label({
			Size = UDim2.new(1, -10, 0, 22),
			TextSize = 14,
			LayoutOrder = 50 + i,
			ZIndex = 5,
			Text = `{s[1]}:  {s[2]}`,
		}, self.left)
	end
end

--- The milestone track: which levels grant which cosmetic, and whether it is
--- already yours. Real data, unlike a badge grid (badge ids are still 0).
function CareerTab:renderMilestones(progress: any)
	for _, c in self.right:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	sectionTitle(self.right, 1, "LEVEL REWARDS")
	local levels = {}
	for lvl in self.catalog.milestones do
		table.insert(levels, lvl)
	end
	table.sort(levels)
	local myLevel = progress.level or 1
	for i, lvl in levels do
		local id = self.catalog.milestones[lvl]
		local item = self.catalog.byId[id]
		local owned = progress.owned ~= nil and progress.owned[id] == true
		local reached = myLevel >= lvl
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 40),
			BackgroundColor3 = if owned then Theme.GREEN else Theme.BROWN_LIGHT,
			BackgroundTransparency = if owned then 0.45 else 0.3,
			BorderSizePixel = 0,
			LayoutOrder = i + 1,
			ZIndex = 4,
		}, self.right)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.fromOffset(52, 40),
			Position = UDim2.fromOffset(10, 0),
			Font = Theme.TITLE_FONT,
			TextColor3 = if reached then Theme.GOLD else Theme.DIM,
			TextSize = 15,
			ZIndex = 5,
			Text = `Lv {lvl}`,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -80, 1, 0),
			Position = UDim2.fromOffset(66, 0),
			TextSize = 14,
			Font = Theme.BOLD_FONT,
			TextColor3 = if reached then Theme.CREAM else Theme.DIM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			Text = if item ~= nil then item.name else id,
		}, row)
	end
end

function CareerTab:relayout(L: any, _viewport: Vector2)
	-- One column when there is not enough width for two readable ones.
	if L.twoColumn then
		self.left.Size = UDim2.new(0.5, -6, 1, -140)
		self.right.Size = UDim2.new(0.5, -6, 1, -140)
		self.right.Position = UDim2.new(0.5, 6, 0, 86)
		self.right.Visible = true
	else
		self.left.Size = UDim2.new(1, 0, 1, -140)
		self.right.Visible = false
	end
end

return CareerTab
