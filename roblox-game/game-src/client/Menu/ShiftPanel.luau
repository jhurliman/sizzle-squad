--!strict
-- The between-rounds home screen: a big Start Shift button, the four menu
-- buttons, and your career line -- centred, because this IS the screen when a
-- shift is not running.
--
-- Replaces both the old ready button and the top-left tab cluster. The cluster
-- sat under the patience bar and collided with Roblox's own top-bar controls;
-- more importantly, scattering the menu into a corner made it feel like a
-- side-panel when between-rounds is actually the game's front page.
--
-- A ROUND NEVER STARTS ON A TIMER (see RoundDirector:heartbeat), so this
-- button is the only way into a shift and there is no countdown to show.
--
-- The caption is derived purely from the server's readyIds. The old button set
-- its own text to "WAITING…" on click and nothing ever restored it, so it read
-- "WAITING…" for every later intermission.

local Players = game:GetService("Players")

local Theme = require(script.Parent.Theme) :: any

local ShiftPanel = {}
ShiftPanel.__index = ShiftPanel

local mk = Theme.mk

local TABS = {
	{ id = "wardrobe", label = "👕 WARDROBE" },
	{ id = "shop", label = "🛒 SHOP" },
	{ id = "career", label = "⭐ CAREER" },
	{ id = "ranks", label = "🏆 RANKS" },
}

function ShiftPanel.new(gui: Instance, deps: any)
	local self = setmetatable({}, ShiftPanel)
	self.deps = deps
	self.hidden = false
	self.ready = false
	self.spectating = false
	self.phase = { phase = "countdown" }

	self.root = mk("Frame", {
		Name = "ShiftPanel",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.58),
		Size = UDim2.fromOffset(600, 190),
		BackgroundTransparency = 1,
		Visible = false,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 12),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.root)

	self.startButton = Theme.button({
		Size = UDim2.fromOffset(320, 72),
		TextSize = 30,
		LayoutOrder = 1,
		Text = "START SHIFT",
	}, self.root)
	Theme.stroke(self.startButton, Theme.CREAM, 2)
	self.startButton.Activated:Connect(function()
		-- Toggle, so a player who changes their mind can stand down.
		self.ready = not self.ready
		self:paint()
		self.deps.onReady(self.ready)
	end)

	-- SIX BUTTONS, WRAPPING INTO TWO LINES WHEN ONE WILL NOT FIT.
	--
	-- This was a single centred row whose width was computed from #TABS -- four
	-- -- while the row actually held six children, because BOTS and NEW SERVER
	-- were added later and never counted. A centred UIListLayout overflows
	-- symmetrically, so the ends fell off BOTH screen edges: WARDROBE clipped on
	-- the left, NEW SERVER clipped to "NE" on the right, on any phone.
	self.tabRow = mk("Frame", {
		Size = UDim2.fromOffset(600, Theme.MIN_TAP),
		BackgroundTransparency = 1,
		LayoutOrder = 2,
	}, self.root)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.tabRow)

	self.rows = {}
	for i = 1, 2 do
		local row = mk("Frame", {
			Size = UDim2.fromOffset(600, Theme.MIN_TAP),
			BackgroundTransparency = 1,
			LayoutOrder = i,
		}, self.tabRow)
		mk("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 8),
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			VerticalAlignment = Enum.VerticalAlignment.Center,
			SortOrder = Enum.SortOrder.LayoutOrder,
		}, row)
		self.rows[i] = row
	end

	self.tabButtons = {}
	-- Every button in the row, tabs and actions alike, so `relayout` can size
	-- them as one set. Keeping BOTS and NEW SERVER out of this list is what let
	-- them keep a hardcoded 196px while the tabs shrank.
	self.rowButtons = {}
	for i, t in TABS do
		local btn = Theme.button({
			Size = UDim2.fromOffset(140, Theme.MIN_TAP),
			Fill = Theme.BROWN_MID,
			BackgroundTransparency = 0.1,
			TextSize = 14,
			LayoutOrder = i,
			Text = t.label,
		}, self.rows[1])
		btn.Activated:Connect(function()
			self.deps.onOpenTab(t.id)
		end)
		self.tabButtons[t.id] = btn
		table.insert(self.rowButtons, btn)
	end

	-- BOTS ARE OPTIONAL, AND THE LOBBY IS WHERE YOU SAY SO.
	--
	-- Sits with the tab row rather than in a settings screen because it is a
	-- per-server choice made in the ten seconds before a shift, not a
	-- preference. The caption states what will happen at the NEXT start, since
	-- that is when it lands — flipping bots mid-shift would freeze them where
	-- they stand, mid-carry.
	self.botButton = Theme.button({
		Size = UDim2.fromOffset(196, Theme.MIN_TAP),
		Fill = Theme.BROWN_MID,
		BackgroundTransparency = 0.1,
		TextSize = 14,
		LayoutOrder = #TABS + 1,
		Text = "BOTS: ON",
	}, self.rows[1])
	self.botButton.Activated:Connect(function()
		self.deps.onToggleBots(not self.botFill)
	end)
	table.insert(self.rowButtons, self.botButton)

	-- LEAVING IS AN AFFORDANCE, NOT AN ADMISSION.
	--
	-- A player who dislikes a lobby and has no way out closes the app; every
	-- established Roblox co-op game offers a rematch. Roblox has no
	-- "anywhere but here" API — Teleport re-runs matchmaking, which prefers
	-- servers with room, so it usually moves you but is not guaranteed to.
	self.newServerButton = Theme.button({
		Size = UDim2.fromOffset(196, Theme.MIN_TAP),
		Fill = Theme.BROWN_MID,
		BackgroundTransparency = 0.1,
		TextSize = 14,
		LayoutOrder = #TABS + 2,
		Text = "NEW SERVER",
	}, self.rows[1])
	self.newServerButton.Activated:Connect(function()
		self.deps.onNewServer()
	end)
	table.insert(self.rowButtons, self.newServerButton)

	self.progressChip = Theme.chip({
		Size = UDim2.fromOffset(320, 34),
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		LayoutOrder = 3,
		Text = "Lv 1  ·  0 coins",
	}, self.root)

	return self
end

function ShiftPanel:setHidden(on: boolean)
	self.hidden = on
	self:paint()
end

function ShiftPanel:setProgress(progress: any)
	self.progress = progress
	local streak = progress.streak or 0
	-- "🔥2" ALONE IS A RIDDLE.
	--
	-- The Career tab spells it out; this chip is the one players actually read
	-- between shifts, and out here -- next to a level and a coin count, both of
	-- which are self-describing -- a bare flame and a digit reads as a third
	-- currency rather than a streak. Say the noun.
	local suffix = if streak > 1 then `  ·  🔥{streak} day streak` else ""
	-- NOT the coin emoji: FredokaOne has no glyph for it and it renders as a
	-- hollow box (the 🔥 in the same string is fine).
	self.progressChip.Text = `Lv {progress.level or 1}  ·  {progress.coins or 0} coins{suffix}`
end

function ShiftPanel:setBots(on: boolean, pending: boolean, phase: string?)
	self.botFill = pending
	self.botButton.Text = if pending then "BOTS: ON" else "BOTS: OFF"
	self.botButton.BackgroundColor3 = if pending then Theme.BROWN_MID else Theme.BROWN_DEEP
	-- "(next shift)" ONLY while a shift is actually running.
	--
	-- The qualifier exists because the toggle lands at the next round start
	-- rather than mid-carry, so during a shift it is telling the truth: what
	-- you just picked is not what is on the floor right now. In a LOBBY the
	-- pending value simply is what Start will give you, so the qualifier is
	-- noise — and it read as nonsense to a player who had not yet worked a
	-- shift at all, which is every player's first thirty seconds.
	if phase == "round" and on ~= pending then
		self.botButton.Text ..= "  (next shift)"
	end
end

function ShiftPanel:setPhase(phase: any, spectating: boolean)
	self.phase = phase
	self.spectating = spectating
	local ids = phase.readyIds
	if ids ~= nil then
		self.ready = table.find(ids, Players.LocalPlayer.UserId) ~= nil
	end
	self:paint()
end

function ShiftPanel:paint()
	local p = self.phase.phase
	-- Lobby phases only. `results` is a ceremony with its own full-screen
	-- overlay, and showing a Start button (or a stray "Results 7s" chip) on
	-- top of it was pure noise.
	local lobby = p == "countdown" or p == "intermission"
	self.root.Visible = not self.hidden and lobby

	self.startButton.Visible = not self.spectating
	local n, total = self.phase.readyCount, self.phase.readyTotal
	local crew = total ~= nil and total > 1
	if self.ready then
		self.startButton.BackgroundColor3 = Theme.GREY
		self.startButton.Text = if crew then `WAITING FOR CREW  {n}/{total}` else "WAITING…"
		self.startButton.TextSize = if crew then 22 else 30
	else
		self.startButton.BackgroundColor3 = Theme.GREEN
		-- FredokaOne sets very tight at display sizes and Roblox has no
		-- letter-spacing property, so the headline is spaced by hand. Only
		-- this state: letter-spacing "WAITING FOR CREW 2/3" would read as a
		-- glitch rather than a treatment.
		self.startButton.Text = "S T A R T   S H I F T"
		self.startButton.TextSize = self.startSize or 24
	end
end

function ShiftPanel:step(_dt: number) end

function ShiftPanel:relayout(_L: any, viewport: Vector2)
	local compact = viewport.X < 720
	local n = #self.rowButtons
	-- Three tiers, not two: at 108 a 3-wide row needs 340 of the 343 usable
	-- pixels on the narrowest phone, which is a fit only on paper.
	local narrow = viewport.X < 480
	local tabW = if narrow then 96 elseif compact then 108 else 140
	local gap = 8

	-- How many of these fit on one line inside the screen, not inside an
	-- imagined 600px panel. The 32px is the same margin the menu panel keeps,
	-- so the row can never reach further left or right than the panel does.
	local avail = math.max(320, viewport.X - 32)
	local perRow = math.max(1, math.floor((avail + gap) / (tabW + gap)))
	local rows = if perRow >= n then 1 else 2
	if rows == 2 then
		-- Balance them: 3+3 reads as deliberate where 5+1 reads as a bug.
		perRow = math.ceil(n / 2)
	end

	for i, btn in self.rowButtons do
		local r = if rows == 1 then 1 else math.min(2, math.ceil(i / perRow))
		btn.Parent = self.rows[r]
		btn.LayoutOrder = i
		btn.Size = UDim2.fromOffset(tabW, Theme.MIN_TAP)
		btn.TextSize = if narrow then 11 elseif compact then 12 else 14
	end

	local counts = { 0, 0 }
	for i = 1, n do
		local r = if rows == 1 then 1 else math.min(2, math.ceil(i / perRow))
		counts[r] += 1
	end
	for r = 1, 2 do
		local c = counts[r]
		self.rows[r].Visible = c > 0
		self.rows[r].Size = UDim2.fromOffset(math.max(1, tabW * c + gap * math.max(0, c - 1)), Theme.MIN_TAP)
	end

	local rowsH = rows * Theme.MIN_TAP + (rows - 1) * gap
	local widest = math.max(self.rows[1].Size.X.Offset, self.rows[2].Size.X.Offset)
	self.tabRow.Size = UDim2.fromOffset(widest, rowsH)
	self.root.Size = UDim2.fromOffset(math.max(widest, 320), 142 + rowsH)
	self.startButton.Size = UDim2.fromOffset(if compact then 260 else 340, if compact then 62 else 72)
	self.startSize = if compact then 19 else 24
	self:paint()
end

return ShiftPanel
