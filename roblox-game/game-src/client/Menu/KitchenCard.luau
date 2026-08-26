--!strict
-- The join card: a soft front porch, NOT a gate.
--
-- The ask was "a menu before you go straight into the game." A hard PLAY gate
-- would add a churn point to every session, and time-to-play is the single
-- biggest retention lever on this platform. So the player still lands in the
-- kitchen; this card just makes the meta impossible to miss on the way in.
-- Input is deliberately never disabled -- your chef keeps walking while you
-- read it, which is what makes it a porch rather than a wall.
--
-- It never shows on a player's FIRST-EVER session: FirstShift owns that
-- moment, and stacking a shop card on top of a tutorial is how you lose a
-- first-timer.

local Players = game:GetService("Players")

local Theme = require(script.Parent.Theme) :: any

local KitchenCard = {}
KitchenCard.__index = KitchenCard

local mk = Theme.mk

local AUTO_DISMISS = 12

function KitchenCard.new(gui: Instance, deps: any)
	local self = setmetatable({}, KitchenCard)
	self.deps = deps
	self.shown = false
	self.consumed = false -- once per session, ever
	self.age = 0
	self.phase = { phase = "countdown" }

	self.scrim = mk("TextButton", {
		Name = "CardScrim",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Theme.BROWN_DEEP,
		BackgroundTransparency = 0.55,
		Text = "",
		AutoButtonColor = false,
		Visible = false,
		ZIndex = 6,
	}, gui)
	self.scrim.Activated:Connect(function()
		self:hide()
	end)

	self.card = Theme.card({
		Name = "KitchenCard",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(420, 330),
		BackgroundTransparency = 0.02,
		Visible = false,
		ZIndex = 7,
	}, gui)
	Theme.stroke(self.card, Theme.GOLD, 2)

	self.title = Theme.label({
		Size = UDim2.new(1, -24, 0, 34),
		Position = UDim2.fromOffset(16, 14),
		TextSize = 24,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 8,
		Text = "Welcome back, chef",
	}, self.card)

	self.subtitle = Theme.label({
		Size = UDim2.new(1, -24, 0, 22),
		Position = UDim2.fromOffset(16, 48),
		TextSize = 15,
		ZIndex = 8,
		Text = "",
	}, self.card)

	-- XP bar
	local track = mk("Frame", {
		Size = UDim2.new(1, -32, 0, 14),
		Position = UDim2.fromOffset(16, 76),
		BackgroundColor3 = Theme.BROWN_MID,
		BorderSizePixel = 0,
		ZIndex = 8,
	}, self.card)
	Theme.corner(track, 7)
	self.xpFill = mk("Frame", {
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
		ZIndex = 9,
	}, track)
	Theme.corner(self.xpFill, 7)

	self.goalsTitle = Theme.label({
		Size = UDim2.new(1, -24, 0, 22),
		Position = UDim2.fromOffset(16, 100),
		TextSize = 14,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 8,
		Text = "TODAY'S GOALS",
	}, self.card)

	self.goalRows = {}
	for i = 1, 3 do
		self.goalRows[i] = Theme.label({
			Size = UDim2.new(1, -32, 0, 24),
			Position = UDim2.fromOffset(16, 122 + (i - 1) * 24),
			TextSize = 14,
			ZIndex = 8,
			Text = "",
		}, self.card)
	end

	local row = mk("Frame", {
		Size = UDim2.new(1, -32, 0, Theme.MIN_TAP),
		Position = UDim2.new(0, 16, 1, -(Theme.MIN_TAP + 16)),
		BackgroundTransparency = 1,
		ZIndex = 8,
	}, self.card)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, row)

	self.primary = Theme.button({
		Size = UDim2.fromOffset(150, Theme.MIN_TAP),
		TextSize = 20,
		LayoutOrder = 1,
		ZIndex = 9,
		Text = "PLAY",
	}, row)
	self.primary.Activated:Connect(function()
		if self.phase.phase == "intermission" then
			self.deps.onReady()
		end
		self:hide()
	end)

	local wardrobe = Theme.button({
		Size = UDim2.fromOffset(120, Theme.MIN_TAP),
		Fill = Theme.BLUE,
		TextSize = 15,
		LayoutOrder = 2,
		ZIndex = 9,
		Text = "👕 WARDROBE",
	}, row)
	wardrobe.Activated:Connect(function()
		self:hide()
		self.deps.onOpenTab("wardrobe")
	end)

	local shop = Theme.button({
		Size = UDim2.fromOffset(100, Theme.MIN_TAP),
		Fill = Theme.RED,
		TextSize = 15,
		LayoutOrder = 3,
		ZIndex = 9,
		Text = "🛒 SHOP",
	}, row)
	shop.Activated:Connect(function()
		self:hide()
		self.deps.onOpenTab("shop")
	end)

	local close = Theme.button({
		Size = UDim2.fromOffset(34, 34),
		Position = UDim2.new(1, -42, 0, 10),
		Fill = Theme.BROWN_LIGHT,
		TextSize = 18,
		ZIndex = 9,
		Text = "✕",
	}, self.card)
	close.Activated:Connect(function()
		self:hide()
	end)

	return self
end

function KitchenCard:setProgress(progress: any)
	self.progress = progress
	local player = Players.LocalPlayer
	self.title.Text = `Welcome back, {player.DisplayName}`
	local xp, toNext = progress.xp or 0, progress.xpToNext
	self.subtitle.Text = `Level {progress.level or 1}  ·  {progress.coins or 0} coins  ·  {progress.rounds or 0} shifts worked`
	if toNext ~= nil and toNext > 0 then
		self.xpFill.Size = UDim2.fromScale(math.clamp(xp / toNext, 0, 1), 1)
	end
	local dailies = progress.dailies or {}
	for i = 1, 3 do
		local d = dailies[i]
		if d == nil then
			self.goalRows[i].Text = ""
		elseif d.claimed then
			self.goalRows[i].Text = `✅ {d.name}  (+{d.coins}c)`
			self.goalRows[i].TextColor3 = Theme.GREEN
		else
			self.goalRows[i].Text = `▫️ {d.name}  ({math.min(d.progress, d.goal)}/{d.goal})`
			self.goalRows[i].TextColor3 = Theme.CREAM
		end
	end
	self:maybeShow()
end

function KitchenCard:setPhase(phase: any)
	self.phase = phase
	self.primary.Text = if phase.phase == "intermission" then "READY!" else "PLAY"
	if phase.phase == "round" and self.shown then
		self:hide()
	end
	self:maybeShow()
end

--- Show once, on the first non-round phase after joining, and never on a
--- brand-new player's very first session.
function KitchenCard:maybeShow()
	if self.consumed or self.shown or self.progress == nil then
		return
	end
	if (self.progress.sessions or 1) <= 1 then
		self.consumed = true -- first-ever session: FirstShift owns this moment
		return
	end
	if self.phase.phase == "round" then
		return -- joined mid-shift; wait for the next phase change
	end
	self.shown = true
	self.age = 0
	self.scrim.Visible = true
	self.card.Visible = true
end

function KitchenCard:hide()
	if not self.shown then
		return
	end
	self.shown = false
	self.consumed = true
	self.scrim.Visible = false
	self.card.Visible = false
end

function KitchenCard:step(dt: number)
	if not self.shown then
		return
	end
	self.age += dt
	if self.age >= AUTO_DISMISS then
		self:hide()
	end
end

function KitchenCard:relayout(_L: any, viewport: Vector2)
	local w = math.min(420, viewport.X - 40)
	local h = math.min(330, viewport.Y - 40)
	self.card.Size = UDim2.fromOffset(w, h)
end

return KitchenCard
