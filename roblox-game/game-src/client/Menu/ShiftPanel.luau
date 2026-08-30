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
local Loc = require(script.Parent.Parent.Loc) :: any

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
		Size = UDim2.fromOffset(600, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		Visible = false,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 18),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.root)

	local cta = Theme.cta({
		Size = UDim2.fromOffset(320, 72),
		TextSize = 30,
		LayoutOrder = 1,
		Text = "START SHIFT",
	}, self.root)
	-- `startRoot` is what the column lays out; `startButton` is the face.
	self.startRoot = cta.root
	self.startButton = cta.button
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
	-- PLAYING WITH SOMEBODY LIVES ON THE SCREEN YOU ACTUALLY SIT ON.
	--
	-- These were on the Kitchen Card, which shows once per session and
	-- auto-dismisses after twelve seconds. That is a poster, not a control. This
	-- panel is the between-rounds home screen — it is up every time a shift
	-- ends — so the one action that grows a four-player co-op game belongs here,
	-- directly under Start and above the tabs.
	--
	-- Above the tabs and not among them on purpose: the tab row changes what YOU
	-- are looking at, this changes who you are playing WITH.
	self.friendRow = mk("Frame", {
		Size = UDim2.fromOffset(600, Theme.MIN_TAP + Theme.SHADOW_DY),
		BackgroundTransparency = 1,
		LayoutOrder = 2,
	}, self.root)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.friendRow)

	local inviteCta = Theme.cta({
		Size = UDim2.fromOffset(230, Theme.MIN_TAP),
		Fill = Theme.BLUE,
		TextSize = 17,
		LayoutOrder = 1,
		Text = "＋ INVITE A FRIEND",
	}, self.friendRow)
	self.inviteRoot = inviteCta.root
	inviteCta.button.Activated:Connect(function()
		-- pcall: PromptGameInvite throws outright where the platform cannot show
		-- the invite sheet, and a dead button beats a broken panel.
		pcall(function()
			local SocialService = game:GetService("SocialService")
			SocialService:PromptGameInvite(Players.LocalPlayer)
		end)
	end)

	-- Only rendered when somebody is actually reachable. An always-on "join a
	-- friend" that never has anybody behind it advertises an empty game.
	local joinCta = Theme.cta({
		Size = UDim2.fromOffset(230, Theme.MIN_TAP),
		Fill = Theme.GREEN,
		TextSize = 17,
		LayoutOrder = 2,
		Text = "JOIN A FRIEND",
	}, self.friendRow)
	self.joinRoot = joinCta.root
	self.joinButton = joinCta.button
	self.joinRoot.Visible = false
	self.joinButton.Activated:Connect(function()
		local f = self.friend
		if f ~= nil then
			self.deps.onJoinFriend(f.jobId, f.name)
		end
	end)

	self.tabRow = mk("Frame", {
		Size = UDim2.fromOffset(600, Theme.MIN_TAP),
		BackgroundTransparency = 1,
		LayoutOrder = 3,
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
	-- Every control in the row, tabs and actions alike, so `relayout` can size
	-- them as one set. Keeping BOTS and NEW SERVER out of this list is what let
	-- them keep a hardcoded 196px while the tabs shrank.
	--
	-- THEY ARE CTAs, NOT FLAT PLATES. From the first multiplayer playtest: the
	-- second player did not realise WARDROBE / SHOP / CAREER / RANKS could be
	-- tapped at all, because the only thing on screen that looked pressable was
	-- Start Shift and the info chip directly beneath them looked identical to
	-- these. Same gradient, edge and press response as the hero button, just
	-- smaller and in the panel's brown — the shape is what says "button".
	self.rowButtons = {}
	self.rowRoots = {}
	local function rowButton(label: string, order: number, fill: Color3?): any
		local cta = Theme.cta({
			Size = UDim2.fromOffset(140, Theme.MIN_TAP),
			Fill = fill or Theme.BROWN_MID,
			TextSize = 15,
			LayoutOrder = order,
			Text = label,
		}, self.rows[1])
		table.insert(self.rowButtons, cta.button)
		table.insert(self.rowRoots, cta.root)
		return cta
	end
	for i, t in TABS do
		local cta = rowButton(t.label, i)
		cta.button.Activated:Connect(function()
			self.deps.onOpenTab(t.id)
		end)
		self.tabButtons[t.id] = cta.button
	end

	-- BOTS ARE OPTIONAL, AND THE LOBBY IS WHERE YOU SAY SO.
	--
	-- Sits with the tab row rather than in a settings screen because it is a
	-- per-server choice made in the ten seconds before a shift, not a
	-- preference. The caption states what will happen at the NEXT start, since
	-- that is when it lands — flipping bots mid-shift would freeze them where
	-- they stand, mid-carry.
	local botCta = rowButton("BOTS: ON", #TABS + 1)
	self.botButton = botCta.button
	self.botRoot = botCta.root
	self.botButton.Activated:Connect(function()
		self.deps.onToggleBots(not self.botFill)
	end)

	-- LEAVING IS AN AFFORDANCE, NOT AN ADMISSION.
	--
	-- A player who dislikes a lobby and has no way out closes the app; every
	-- established Roblox co-op game offers a rematch. Roblox has no
	-- "anywhere but here" API — Teleport re-runs matchmaking, which prefers
	-- servers with room, so it usually moves you but is not guaranteed to.
	local newCta = rowButton("NEW SERVER", #TABS + 2)
	self.newServerButton = newCta.button
	self.newServerRoot = newCta.root
	self.newServerButton.Activated:Connect(function()
		self.deps.onNewServer()
	end)

	self.progressChip = Theme.chip({
		Size = UDim2.fromOffset(320, 34),
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		LayoutOrder = 4,
		Text = "Lv 1  ·  0 coins",
	}, self.root)

	return self
end

--- Whoever is already in a kitchen, from Social:friendsHere(). First entry
--- wins: this is a button, not a browser.
function ShiftPanel:setFriends(friends: { any })
	local f = friends ~= nil and friends[1] or nil
	self.friend = f
	if self.joinRoot == nil then
		return
	end
	self.joinRoot.Visible = f ~= nil
	if f ~= nil then
		self.joinButton.Text = Loc.f("fmt.join_name", f.name)
	end
	self:relayoutLast()
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
	local suffix = if streak > 1 then "  ·  " .. Loc.f("fmt.streak", streak) else ""
	-- NOT the coin emoji: FredokaOne has no glyph for it and it renders as a
	-- hollow box (the 🔥 in the same string is fine).
	self.progressChip.Text = Loc.f("fmt.lv_coins", progress.level or 1, progress.coins or 0) .. suffix
end

function ShiftPanel:setBots(on: boolean, pending: boolean, phase: string?)
	self.botFill = pending
	self.botButton.Text = if pending then "BOTS: ON" else "BOTS: OFF"
	Theme.setCtaFill(self.botButton, if pending then Theme.BROWN_MID else Theme.BROWN_DEEP)
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
	-- A solo tutorial has nobody to add bots alongside and nowhere better to
	-- go; NEW SERVER in particular would teleport a learner out of the lesson.
	if phase.tutorial ~= nil then
		self.tutorial = phase.tutorial == true
		self.botRoot.Visible = not self.tutorial
		self.newServerRoot.Visible = not self.tutorial
		self:relayoutLast()
	end
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

	self.startRoot.Visible = not self.spectating
	local n, total = self.phase.readyCount, self.phase.readyTotal
	local crew = total ~= nil and total > 1
	if self.ready then
		Theme.setCtaFill(self.startButton, Theme.GREY)
		self.startButton.Text = if crew then Loc.f("fmt.waiting_crew", n, total) else "WAITING…"
	else
		Theme.setCtaFill(self.startButton, Theme.GREEN)
		-- Plain text, no hand-spacing. DISPLAY_FONT carries its own
		-- sidebearings; the old "S T A R T   S H I F T" existed only because
		-- FredokaOne did not, and uniform padding characters are not kerning.
		self.startButton.Text = "START SHIFT"
	end
end

function ShiftPanel:step(_dt: number) end

function ShiftPanel:relayout(_L: any, viewport: Vector2)
	self.lastViewport = viewport
	local compact = viewport.X < 720
	-- Hidden buttons take no space in the row: a tutorial server shows four,
	-- not six with two gaps.
	local visible = {}
	for i, root in self.rowRoots do
		if root.Visible then
			table.insert(visible, { root = root, button = self.rowButtons[i] })
		end
	end
	local n = #visible
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

	for i, v in visible do
		local r = if rows == 1 then 1 else math.min(2, math.ceil(i / perRow))
		v.root.Parent = self.rows[r]
		v.root.LayoutOrder = i
		v.root.Size = UDim2.fromOffset(tabW, Theme.MIN_TAP + Theme.SHADOW_DY)
		local cap = v.button:FindFirstChildWhichIsA("UITextSizeConstraint")
		if cap ~= nil then
			cap.MaxTextSize = if narrow then 12 elseif compact then 13 else 15
		end
	end

	local counts = { 0, 0 }
	for i = 1, n do
		local r = if rows == 1 then 1 else math.min(2, math.ceil(i / perRow))
		counts[r] += 1
	end
	for r = 1, 2 do
		local c = counts[r]
		self.rows[r].Visible = c > 0
		self.rows[r].Size = UDim2.fromOffset(math.max(1, tabW * c + gap * math.max(0, c - 1)), Theme.MIN_TAP + Theme.SHADOW_DY)
	end

	-- The friend row is sized from the space it actually has, not from a
	-- breakpoint table: with both buttons up, a fixed 200 each overflows a
	-- 414-wide phone, and the pair has to fit or the second one falls off the
	-- screen exactly the way the six-button row used to.
	local pair = self.joinRoot.Visible
	local want = if narrow then 200 elseif compact then 215 else 230
	local room = if pair then math.floor((avail - gap) / 2) else avail
	local inviteW = math.max(120, math.min(want, room))
	self.inviteRoot.Size = UDim2.fromOffset(inviteW, Theme.MIN_TAP + Theme.SHADOW_DY)
	self.joinRoot.Size = UDim2.fromOffset(inviteW, Theme.MIN_TAP + Theme.SHADOW_DY)
	local friendW = if pair then inviteW * 2 + gap else inviteW
	self.friendRow.Size = UDim2.fromOffset(friendW, Theme.MIN_TAP + Theme.SHADOW_DY)

	local rowsH = rows * (Theme.MIN_TAP + Theme.SHADOW_DY) + (rows - 1) * gap
	local widest = math.max(self.rows[1].Size.X.Offset, self.rows[2].Size.X.Offset, friendW)
	self.tabRow.Size = UDim2.fromOffset(widest, rowsH)
	-- Height comes from the column's own contents (AutomaticSize.Y), not from a
	-- hand-summed constant: the old `142 + rowsH` had to be re-derived by hand
	-- every time a gap or a control changed height, and was already carrying
	-- 12px of slack nobody could account for.
	self.root.Size = UDim2.fromOffset(math.max(widest, 320), 0)
	self.startRoot.Size = UDim2.fromOffset(if compact then 260 else 340, if compact then 62 else 72)
	-- No per-state TextSize any more: the CTA scales its own label (see
	-- Theme.cta). Only the ceiling moves with the breakpoint.
	-- Sized off the button, not picked by feel: a chunky display face wants
	-- roughly 60% of the button's height or it reads as a small label floating
	-- in a large slab, which is how the first version looked.
	local h = if compact then 62 else 72
	local cap = self.startButton:FindFirstChildWhichIsA("UITextSizeConstraint")
	if cap ~= nil then
		cap.MaxTextSize = math.floor(h * 0.62)
	end
	self:paint()
end

--- Re-run the last layout after something changed which buttons are visible.
function ShiftPanel:relayoutLast()
	if self.lastViewport ~= nil then
		self:relayout(nil, self.lastViewport)
	end
end

return ShiftPanel
