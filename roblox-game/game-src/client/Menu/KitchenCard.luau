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
		-- Same reason as the menu panel: the backdrop behind this dismisses on
		-- tap, and a Frame does not consume one.
		Active = true,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(420, 392),
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
		-- Two stacked rows now: actions here, "who with" underneath.
		Position = UDim2.new(0, 16, 1, -(Theme.MIN_TAP * 2 + 24)),
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

	-- PLAYING WITH SOMEBODY IS THE POINT, SO IT GETS A BUTTON.
	--
	-- From the first multiplayer playtest: "as a returning user the main thing
	-- I want to do is jump into a server with a friend but there is no direct
	-- call to action to join or invite a friend." The invite lived only in the
	-- Career tab, three taps deep, which is where you put something you do not
	-- want people to find. This is a four-player co-op game; the second seat
	-- is the product.
	--
	-- It sits on its own row under the primary actions rather than beside them,
	-- because it is a different KIND of action -- everything above changes what
	-- happens next for you, this changes who it happens with.
	local socialRow = mk("Frame", {
		Size = UDim2.new(1, -40, 0, Theme.MIN_TAP),
		Position = UDim2.new(0, 20, 1, -(Theme.MIN_TAP + 16)),
		BackgroundTransparency = 1,
		ZIndex = 9,
	}, self.card)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, socialRow)

	local invite = Theme.button({
		Size = UDim2.fromOffset(182, Theme.MIN_TAP),
		Fill = Theme.BLUE,
		TextSize = 16,
		LayoutOrder = 1,
		ZIndex = 9,
		Text = "＋ INVITE A FRIEND",
	}, socialRow)
	invite.Activated:Connect(function()
		-- pcall: PromptGameInvite throws outright if the platform cannot show
		-- the invite sheet, and a dead button is better than a broken card.
		pcall(function()
			local SocialService = game:GetService("SocialService")
			local Players = game:GetService("Players")
			SocialService:PromptGameInvite(Players.LocalPlayer)
		end)
	end)

	-- Only rendered when there is somebody to join; an empty "friends playing"
	-- affordance advertises that nobody is here, which is worse than silence.
	self.joinButton = Theme.button({
		Size = UDim2.fromOffset(182, Theme.MIN_TAP),
		Fill = Theme.GREEN,
		TextSize = 16,
		LayoutOrder = 2,
		ZIndex = 9,
		Visible = false,
		Text = "JOIN A FRIEND",
	}, socialRow)
	self.joinButton.Activated:Connect(function()
		local f = self.friend
		if f == nil then
			return
		end
		self:hide()
		self.deps.onJoinFriend(f.jobId, f.name)
	end)

	local close = Theme.button({
		Size = UDim2.fromOffset(34, 34),
		Position = UDim2.new(1, -42, 0, 10),
		Fill = Theme.BROWN_LIGHT,
		TextSize = 18,
		ZIndex = 9,
		Text = "X", -- NOT U+2715: no glyph in the UI font, renders as an empty box
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
			self.goalRows[i].Text = `• {d.name}  ({math.min(d.progress, d.goal)}/{d.goal})`
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

--- Offer to join whoever is already in a kitchen. `friends` is the list from
--- Social:friendsHere(); the first entry wins, because a card is not a browser.
function KitchenCard:setFriends(friends: { any })
	local f = friends ~= nil and friends[1] or nil
	self.friend = f
	if self.joinButton == nil then
		return
	end
	self.joinButton.Visible = f ~= nil
	if f ~= nil then
		self.joinButton.Text = `JOIN {f.name}`
	end
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

-- The card's contents are laid out against a fixed 420x392 and both action
-- rows are pinned to the bottom, so squashing the FRAME on a short screen
-- would slide them off it. Scale the whole card instead and it stays correct
-- at any height -- 392 does not fit a 375px viewport, and that is the phone
-- most likely to be someone's first session.
local CARD_W, CARD_H = 420, 392

function KitchenCard:relayout(_L: any, viewport: Vector2)
	self.card.Size = UDim2.fromOffset(CARD_W, CARD_H)
	if self.cardScale == nil then
		self.cardScale = Theme.mk("UIScale", { Scale = 1 }, self.card)
	end
	local fit = math.min(1, (viewport.X - 32) / CARD_W, (viewport.Y - 32) / CARD_H)
	self.cardScale.Scale = math.clamp(fit, 0.62, 1)
end

return KitchenCard
