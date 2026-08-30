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

-- Starting width of a roster chair. relayout shares the row's real width out
-- between the four, so this is only what they are built at.
local SLOT_W = 150

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

	-- FOUR CHAIRS, AND YOU CAN SEE WHO IS IN THEM.
	--
	-- The invite button used to sit here on its own. It still does its job, but
	-- as the state of an EMPTY SEAT rather than a standalone control -- which
	-- is the honest shape, because inviting somebody is exactly the act of
	-- filling one of these four.
	--
	-- The kitchen has exactly four chef slots, so the roster is always four
	-- wide and each slot is in one of three states:
	--   * a person   -- their name, and a tick once they are ready
	--   * a bot      -- because the crew setting is ON, shown as its effect
	--   * empty      -- so invite, or join a friend who is already cooking
	--
	-- That is what retires the "BOTS: ON (next shift)" caption. It was
	-- unreachable anyway (the suffix only rendered during `round`, when this
	-- whole panel is hidden), and a chair with a bot in it says the same thing
	-- without a label, in the one place you are already looking.
	self.slots = {}
	for i = 1, 4 do
		local slot = mk("Frame", {
			Size = UDim2.fromOffset(SLOT_W, Theme.MIN_TAP + Theme.SHADOW_DY),
			BackgroundTransparency = 1,
			LayoutOrder = i,
		}, self.friendRow)

		-- The filled face: a plaque with a name and a tick.
		local face = mk("Frame", {
			Size = UDim2.fromOffset(SLOT_W, Theme.MIN_TAP),
			BackgroundColor3 = Theme.BROWN_MID,
			BorderSizePixel = 0,
		}, slot)
		Theme.corner(face, 10)
		local name = mk("TextLabel", {
			Size = UDim2.new(1, -10, 0, 20),
			Position = UDim2.fromOffset(5, 6),
			BackgroundTransparency = 1,
			Font = Theme.BOLD_FONT,
			TextSize = 15,
			TextColor3 = Theme.CREAM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			Text = "",
		}, face)
		local state = mk("TextLabel", {
			Size = UDim2.new(1, -10, 0, 16),
			Position = UDim2.fromOffset(5, 26),
			BackgroundTransparency = 1,
			Font = Theme.BODY_FONT,
			TextSize = 13,
			TextColor3 = Theme.DIM,
			-- A fixed-width chip with a translated word in it. KNOWN-GAPS has
			-- German and Japanese overrunning controls sized for English, and
			-- unlike the CTA labels these do not auto-scale, so clip rather
			-- than spill into the neighbour.
			TextTruncate = Enum.TextTruncate.AtEnd,
			Text = "",
		}, face)

		-- The empty face: a button, because an empty chair is an invitation.
		local cta = Theme.cta({
			Size = UDim2.fromOffset(SLOT_W, Theme.MIN_TAP),
			Fill = Theme.BLUE,
			TextSize = 14,
			Text = "＋ INVITE",
		}, slot)
		cta.root.Visible = false
		cta.button.Activated:Connect(function()
			local f = self.friend
			if f ~= nil then
				self.deps.onJoinFriend(f.jobId, f.name)
				return
			end
			-- pcall: PromptGameInvite throws outright where the platform cannot
			-- show the invite sheet, and a dead button beats a broken panel.
			pcall(function()
				local SocialService = game:GetService("SocialService")
				SocialService:PromptGameInvite(Players.LocalPlayer)
			end)
		end)

		self.slots[i] = { root = slot, face = face, name = name, state = state, cta = cta }
	end
	-- Kept for relayout, which sizes the row from the widest thing in it.
	self.inviteRoot = self.slots[1].root

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
	self.friend = friends ~= nil and friends[1] or nil
	self:renderRoster()
	self:relayoutLast()
end

--- Paint the four chairs from the last seat roster the server sent.
---
--- An empty chair offers JOIN when a friend is actually reachable and INVITE
--- otherwise. Never both, and never a JOIN with nobody behind it -- an
--- always-on "join a friend" that leads nowhere advertises an empty game.
function ShiftPanel:renderRoster()
	local seats = self.seats or {}
	local bots = self.botFill == true
	local friend = self.friend
	for i, slot in self.slots do
		local seat = seats[i]
		if seat ~= nil then
			slot.face.Visible = true
			slot.cta.root.Visible = false
			slot.name.Text = seat.name or "Chef"
			slot.state.Text = if seat.ready then "✅ ready" else "…"
			slot.state.TextColor3 = if seat.ready then Theme.GREEN else Theme.DIM
		elseif bots then
			-- A bot in the chair IS the crew setting, stated as its effect.
			slot.face.Visible = true
			slot.cta.root.Visible = false
			slot.name.Text = "Bot"
			slot.state.Text = "filling in"
			slot.state.TextColor3 = Theme.DIM
		else
			slot.face.Visible = false
			slot.cta.root.Visible = true
			slot.cta.button.Text = if friend ~= nil then Loc.f("fmt.join_name", friend.name) else "＋ INVITE"
			Theme.setCtaFill(slot.cta.button, if friend ~= nil then Theme.GREEN else Theme.BLUE)
		end
	end
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

function ShiftPanel:setBots(_on: boolean, pending: boolean, _phase: string?)
	self.botFill = pending
	self.botButton.Text = if pending then "BOTS: ON" else "BOTS: OFF"
	Theme.setCtaFill(self.botButton, if pending then Theme.BROWN_MID else Theme.BROWN_DEEP)
	-- THE ROSTER ANSWERS "AND WHEN?" NOW, SO THE CAPTION DOES NOT HAVE TO.
	--
	-- There used to be a "(next shift)" suffix here, for the case where the
	-- toggle had been flipped but the running shift still had the old value. It
	-- could never be seen: it was gated on `phase == "round"`, and this whole
	-- panel is hidden during a round. Dead the day it was written.
	--
	-- What replaces it is not another caption but the chairs above -- with bots
	-- on you are looking at bots sitting in the spare seats, and with them off
	-- you are looking at empty chairs. The setting shown as its own effect,
	-- which is also the only version of it that cannot go stale.
	self:renderRoster()
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
	if phase.seats ~= nil then
		self.seats = phase.seats
		local me = Players.LocalPlayer.UserId
		self.ready = false
		for _, seat in phase.seats do
			if seat.userId == me then
				self.ready = seat.ready == true
			end
		end
		self:renderRoster()
	end
	self:paint()
end

function ShiftPanel:paint()
	local p = self.phase.phase
	-- Lobby phases only. `results` is a ceremony with its own full-screen
	-- overlay, and showing a Start button (or a stray "Results 7s" chip) on
	-- top of it was pure noise.
	--
	-- A SPECTATOR IS THE EXCEPTION, because otherwise they are locked out
	-- entirely. Menu:setPhase already permits the menu for anyone without a
	-- chef (`phase ~= "round" or spectating`) -- but permission was all they
	-- had. Every surface that can OPEN a tab is this panel or the Kitchen
	-- Card, both hidden during a round, and there is no hotkey anywhere. So
	-- somebody who joined past the late-join cutoff sat and watched for up to
	-- three minutes with the wardrobe theoretically available and genuinely
	-- unreachable. They have no Start button either way (see startRoot below),
	-- so what appears is the tabs and nothing that could take a press it
	-- cannot honour.
	local lobby = p == "countdown" or p == "intermission" or (self.spectating and p == "round")
	self.root.Visible = not self.hidden and lobby

	self.startRoot.Visible = not self.spectating
	local n, total = self.phase.readyCount, self.phase.readyTotal
	local crew = total ~= nil and total > 1
	-- THE BUTTON SAYS WHICH SITUATION YOU ARE IN, BEFORE YOU COMMIT TO IT.
	--
	-- It used to read START SHIFT identically whether you were alone with bots
	-- or sat with three other people, and only became crew-aware AFTER the
	-- press, when it flipped to WAITING FOR CREW 1/3. So the label promised an
	-- action and delivered a wait, and the only way to find out which game you
	-- were in was to commit to it.
	--
	-- Alone, Start really is Start: nobody else has a say and the round begins.
	-- In a crew it is a readiness pledge, which is a different promise and
	-- deserves a different word.
	if self.ready then
		Theme.setCtaFill(self.startButton, Theme.GREY)
		self.startButton.Text = if crew then Loc.f("fmt.waiting_crew", n, total) else "WAITING…"
	else
		Theme.setCtaFill(self.startButton, Theme.GREEN)
		-- Plain text, no hand-spacing. DISPLAY_FONT carries its own
		-- sidebearings; the old "S T A R T   S H I F T" existed only because
		-- FredokaOne did not, and uniform padding characters are not kerning.
		self.startButton.Text = if crew then "READY" else "START SHIFT"
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

	-- Four chairs always, sized from the space there actually is rather than a
	-- breakpoint table. Four fixed 230s overflow a 414-wide phone the same way
	-- the six-button tab row used to drop its ends off both screen edges, so
	-- the slots share what is available and stop at a legible floor.
	local slotW = math.max(96, math.min(190, math.floor((avail - gap * 3) / 4)))
	for _, slot in self.slots do
		slot.root.Size = UDim2.fromOffset(slotW, Theme.MIN_TAP + Theme.SHADOW_DY)
		slot.face.Size = UDim2.fromOffset(slotW, Theme.MIN_TAP)
		slot.cta.root.Size = UDim2.fromOffset(slotW, Theme.MIN_TAP)
	end
	local friendW = slotW * 4 + gap * 3
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
