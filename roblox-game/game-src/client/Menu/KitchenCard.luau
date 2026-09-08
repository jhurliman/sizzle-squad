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
local Loc = require(script.Parent.Parent.Loc) :: any

local KitchenCard = {}
KitchenCard.__index = KitchenCard

local mk = Theme.mk

local AUTO_DISMISS = 12

-- A NAME IN A TITLE IS SHOWN, NOT SPELLED. Twenty characters is a legal
-- display name, and "Starke erste Schicht, Xx_SuperDuperChef_xX!" does not
-- fit a 354px title at the 16px floor. Past this many characters the name is
-- cut with an ellipsis, by codepoint so a kanji counts as one.
local NAME_MAX = 14

local function compactName(name: string): string
	local ok, n = pcall(utf8.len, name)
	if not ok or n == nil or n <= NAME_MAX then
		return name
	end
	local cut = utf8.offset(name, NAME_MAX)
	return string.sub(name, 1, cut - 1) .. "…"
end

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

	-- The title carries a display name -- up to twenty characters, in the
	-- longest of seven languages -- so it stops short of the close button
	-- and scales down (never below 16px) rather than running under it or
	-- off a phone's edge. relayout scales the whole card, which does not
	-- change how much text fits inside it.
	self.title = Theme.label({
		Size = UDim2.new(1, -16 - 50, 0, 34),
		Position = UDim2.fromOffset(16, 14),
		TextSize = 24,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		TextScaled = true,
		TextWrapped = false,
		ZIndex = 8,
		Text = "Welcome back, chef",
	}, self.card)
	mk("UITextSizeConstraint", { MinTextSize = 16, MaxTextSize = 24 }, self.title)

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

	-- A REASON TO COME BACK TOMORROW, SAID WHERE 45% OF NEW PLAYERS LOOK.
	--
	-- This card is the first thing a First Shift completer sees in a real
	-- kitchen, and the first thing every returning player sees each session
	-- -- the one screen with both the people worth keeping and the moment they
	-- are pleased with themselves. The line makes tomorrow concrete: not "keep
	-- your streak" but the number it pays, projected by the server
	-- (Progression.streakOutlook) off the same arithmetic settleDailies pays.
	--
	-- No "please like the game" line. There is no in-experience like API, so
	-- that would be a nag pointing at a menu the player has to leave to find;
	-- a game earns likes by being worth one.
	-- Two lines of room and scaled text: the French and Portuguese sentences
	-- run ~1.4x the English, and a fixed 22px line clipped them.
	self.streakLine = Theme.label({
		Size = UDim2.new(1, -32, 0, 44),
		Position = UDim2.fromOffset(16, 204),
		TextSize = 15,
		TextColor3 = Theme.GOLD,
		TextXAlignment = Enum.TextXAlignment.Center,
		TextWrapped = true,
		TextScaled = true,
		ZIndex = 8,
		Text = "",
	}, self.card)
	mk("UITextSizeConstraint", { MinTextSize = 12, MaxTextSize = 15 }, self.streakLine)

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
		-- "countdown" is the phase a freshly started server sits in, and it is
		-- the ONLY phase a reserved First Shift server is ever in. PLAY did
		-- nothing there -- on the one screen where it mattered most.
		if self.phase.phase == "intermission" or self.phase.phase == "countdown" then
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
		self.deps.onJoinFriend(f.jobId, f.name, f.userId)
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
	-- A player straight out of First Shift has never been here before, so
	-- "welcome back" is a lie the first time. One round, one session, and
	-- the tutorial done is exactly that player.
	local fresh = (progress.rounds or 0) == 1 and (progress.sessions or 1) <= 1 and progress.tutorialDone == true
	local name = compactName(player.DisplayName)
	self.title.Text = if fresh then Loc.f("fmt.first_shift_done", name) else Loc.f("fmt.welcome_named", name)
	-- Tomorrow's bonus comes projected from the server (Progression
	-- .streakOutlook): only it knows whether today's shift has moved the
	-- streak yet, and the multiplier is its arithmetic, not ours.
	local days = progress.streakDays or math.max(1, progress.streak or 1)
	local tomorrowPct = progress.streakTomorrowPct or math.min(50, 10 * days)
	self.streakLine.Text = Loc.f("fmt.streak_tomorrow", days, tomorrowPct)
	local xp, toNext = progress.xp or 0, progress.xpToNext
	self.subtitle.Text = Loc.f("fmt.level_coins", progress.level or 1, progress.coins or 0, progress.rounds or 0)
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
	-- Keyed on career progress rather than session count, which the First
	-- Shift teleport inflated -- that is how "Welcome back, chef" ended up
	-- covering the Start button on a brand-new player's very first screen.
	if (self.progress.rounds or 0) == 0 and self.progress.tutorialDone ~= true then
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
		self.joinButton.Text = Loc.f("fmt.join_name", f.name)
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

-- Every text element on the card with the size it was designed at: plain
-- labels by TextSize, scaled labels and buttons by their constraint. Walked
-- once, so relayout can raise a floor and hand it back without drift.
local function collectText(inst: any, out: { any })
	for _, c in inst:GetChildren() do
		if c:IsA("UITextSizeConstraint") then
			table.insert(out, { inst = c, min = c.MinTextSize, max = c.MaxTextSize })
		elseif c:IsA("TextLabel") or c:IsA("TextButton") then
			table.insert(out, { inst = c, size = c.TextSize })
		end
		collectText(c, out)
	end
end

function KitchenCard:relayout(_L: any, viewport: Vector2)
	self.card.Size = UDim2.fromOffset(CARD_W, CARD_H)
	if self.cardScale == nil then
		self.cardScale = Theme.mk("UIScale", { Scale = 1 }, self.card)
	end
	local fit = math.min(1, (viewport.X - 32) / CARD_W, (viewport.Y - 32) / CARD_H)
	local scale = math.clamp(fit, 0.62, 1)
	self.cardScale.Scale = scale
	-- UIScale multiplies rendered text too: a 14px goal row is 12.25px on
	-- a 375-tall phone (scale 0.875) and 10px on a 320-tall one. Every text
	-- element's floor is raised by the inverse of the scale, so the size
	-- that reaches the screen is never under 12px, and lowered back to its
	-- designed size when the card grows again. Scaled text (the title, the
	-- streak line, every button) is governed by its constraint, so that is
	-- what moves for it; its ceiling follows so the pair stays ordered.
	if self.textFit == nil then
		self.textFit = {}
		collectText(self.card, self.textFit)
	end
	local floor = math.ceil(12 / scale)
	for _, t in self.textFit do
		if t.min ~= nil then
			t.inst.MinTextSize = math.max(t.min, floor)
			t.inst.MaxTextSize = math.max(t.max, t.inst.MinTextSize)
		elseif t.inst.TextScaled ~= true then
			t.inst.TextSize = math.max(t.size, floor)
		end
	end
end

return KitchenCard
