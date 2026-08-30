--!strict
-- The between-rounds home screen: a big Start Shift button, the four-chair
-- roster, and your career line -- stacked at the BOTTOM of the screen, just
-- above the emote row.
--
-- Bottom, not centred, because the thing worth looking at here is the four
-- characters standing in the kitchen behind it. Centred, Start Shift landed
-- squarely across two of their faces on anything laptop-sized or bigger.
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
-- For its geometry only, not to build one: this column hangs directly above
-- the emote row, so it needs to know where the top of that row is.
local EmoteBar = require(script.Parent.EmoteBar) :: any

local ShiftPanel = {}
ShiftPanel.__index = ShiftPanel

local mk = Theme.mk

-- Starting width of a roster chair. relayout shares the row's real width out
-- between the four, so this is only what they are built at.
local SLOT_W = 150

-- Vertical padding between the panel's rows.
local COLUMN_GAP = 18

-- Air between the bottom of this column and the top of the emote row. Slightly
-- more than the 8px the emote row itself keeps off the screen edge, so the two
-- read as separate strips rather than one crowded block.
local EMOTE_CLEARANCE = 12

-- ONE DOOR, NOT FOUR.
--
-- Wardrobe, Shop, Career and Ranks each had a button here, and the panel they
-- open already carries a tab strip across all four -- so three of those buttons
-- were a second way to reach somewhere you land anyway. They cost a whole row
-- of a screen whose entire job is showing you four characters, and that row was
-- sitting across their faces.
--
-- Wardrobe is the entry point because it is the one people come for.
local TABS = {
	{ id = "wardrobe", label = "👕 WARDROBE" },
}

function ShiftPanel.new(gui: Instance, deps: any)
	local self = setmetatable({}, ShiftPanel)
	self.deps = deps
	self.hidden = false
	self.ready = false
	self.spectating = false
	self.phase = { phase = "countdown" }

	-- HUNG FROM THE BOTTOM, NOT CENTRED.
	--
	-- Anchored at its BOTTOM edge, so AutomaticSize.Y grows the column upward
	-- from a fixed line just above the emote row. relayout sets the real Y; this
	-- is only what it looks like for the frame before the first layout pass.
	self.root = mk("Frame", {
		Name = "ShiftPanel",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -(EmoteBar.HEIGHT + EmoteBar.BOTTOM_MARGIN + EMOTE_CLEARANCE)),
		Size = UDim2.fromOffset(600, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		Visible = false,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, COLUMN_GAP),
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

		-- THE WHOLE CHAIR IS THE CONTROL.
		--
		-- A bot chair and an empty chair are both offers -- "play as this
		-- character" -- so the face is a button rather than a plaque with a
		-- button bolted to it. It simply refuses when the chair holds a person.
		local face = mk("TextButton", {
			Size = UDim2.fromOffset(SLOT_W, Theme.MIN_TAP),
			BackgroundColor3 = Theme.BROWN_MID,
			BorderSizePixel = 0,
			AutoButtonColor = false,
			Text = "",
		}, slot)
		Theme.corner(face, 10)
		local name = mk("TextLabel", {
			Size = UDim2.new(1, -28, 0, 18),
			Position = UDim2.fromOffset(5, 6),
			BackgroundTransparency = 1,
			Font = Theme.BOLD_FONT,
			TextSize = 15,
			TextColor3 = Theme.CREAM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			Text = "",
		}, face)
		local state = mk("TextLabel", {
			Size = UDim2.new(1, -10, 0, 15),
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

		-- Not built any more: the character IS the name label now. It was a
		-- tiny gold eyebrow above a big "Bot", which put the constant in the
		-- small type and the variable in the large -- exactly backwards for a
		-- row you are meant to read as four fixed faces.
		local species = name

		-- THE CORNER IS THE SECOND VERB.
		--
		-- Tapping the chair always means "I will play this character". The
		-- other thing you might want to do with it -- send the bot away, or
		-- invite a person into it -- is a different act and gets its own
		-- target rather than a second meaning for the same tap. That was the
		-- reported bug: an empty chair said "＋ INVITE" across the whole face
		-- while tapping it swapped your skin, so the label described one
		-- action and the tap performed another.
		--
		-- "x" and "+" rather than U+2715 or U+2717: KNOWN-GAPS records both
		-- shipping as empty boxes, because they depend on the TEXT font and
		-- FredokaOne has neither.
		local dismiss = mk("TextButton", {
			Size = UDim2.fromOffset(22, 22),
			Position = UDim2.new(1, -24, 0, 3),
			BackgroundColor3 = Theme.BROWN_DEEP,
			BorderSizePixel = 0,
			Font = Theme.BOLD_FONT,
			TextSize = 15,
			TextColor3 = Theme.CREAM,
			Text = "x",
			Visible = false,
		}, face)
		Theme.corner(dismiss, 6)

		local idx = i
		face.Activated:Connect(function()
			local seat = self.seats and self.seats[idx]
			if seat == nil then
				return
			end
			if seat.kind == "player" then
				return -- somebody is sitting there
			end
			self.deps.onSeatAction(seat.chefId, "claim")
		end)
		-- THE CORNER IS ONE QUESTION: is there a bot in this chair?
		--
		-- x sends it away, + brings it back, and that is the whole meaning. It
		-- briefly meant "invite a friend" on an empty chair, which read as
		-- "add a bot" to everybody who saw it -- reasonably, since it sits
		-- opposite an x that removes one -- and then did nothing at all,
		-- because PromptGameInvite throws where there is no platform invite
		-- sheet and the pcall swallowed it. A silent button that means
		-- something other than it looks like is two bugs.
		--
		-- Inviting is not a per-chair act anyway: a friend fills whichever seat
		-- is free, not the one you happened to tap. It lives on the row below.
		dismiss.Activated:Connect(function()
			local seat = self.seats and self.seats[idx]
			if seat == nil then
				return
			end
			self.deps.onSeatAction(seat.chefId, if seat.kind == "bot" then "dismiss" else "fill")
		end)

		self.slots[i] =
			{ root = slot, face = face, name = name, state = state, species = species, dismiss = dismiss }
	end
	-- OUT OF THE COLUMN, INTO THE CORNER.
	--
	-- These used to be the third row of the centred panel, which pushed Start
	-- and the four chairs up over the crew's faces -- the one thing the lobby
	-- shot exists to show. They are navigation, not part of the crew decision,
	-- so they sit where the in-round coin chip does (which is hidden between
	-- rounds, so the corner is free) and the panel is a row shorter.
	self.tabRow = mk("Frame", {
		Size = UDim2.fromOffset(600, Theme.MIN_TAP),
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(0, 0),
		Position = UDim2.fromOffset(12, 84),
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Left,
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
			-- Left, because the row is pinned to the left edge now rather than
			-- centred under the panel.
			HorizontalAlignment = Enum.HorizontalAlignment.Left,
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

	-- INVITING IS A SERVER-WIDE ACT, SO IT IS NOT ON A CHAIR.
	--
	-- It lived on the empty chairs for a while, which put it in four places at
	-- once and implied you were inviting somebody into that particular seat.
	-- You are not: a friend takes whichever seat is free. The chairs answer
	-- "who is in this one"; this answers "is there anybody else coming".
	--
	-- It reads JOIN <name> when somebody is already cooking, because joining a
	-- friend beats summoning one.
	local inviteCta = rowButton("＋ INVITE A FRIEND", #TABS + 2, Theme.BLUE)
	self.inviteButton = inviteCta.button
	self.inviteRoot = inviteCta.root
	self.inviteButton.Activated:Connect(function()
		local f = self.friend
		if f ~= nil then
			self.deps.onJoinFriend(f.jobId, f.name)
			return
		end
		-- PromptGameInvite throws outright where the platform cannot show the
		-- sheet -- Studio, most obviously. Say so rather than being a button
		-- that does nothing, which is exactly how the last one went wrong.
		local ok = pcall(function()
			local SocialService = game:GetService("SocialService")
			SocialService:PromptGameInvite(Players.LocalPlayer)
		end)
		if not ok then
			self.deps.onToast("Invites are not available here")
		end
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
	if self.inviteButton ~= nil then
		self.inviteButton.Text = if self.friend ~= nil
			then Loc.f("fmt.join_name", self.friend.name)
			else "＋ INVITE A FRIEND"
	end
	self:renderRoster()
	self:relayoutLast()
end

--- Paint the four chairs from the last seat roster the server sent.
---
--- An empty chair offers JOIN when a friend is actually reachable and INVITE
--- otherwise. Never both, and never a JOIN with nobody behind it -- an
--- always-on "join a friend" that leads nowhere advertises an empty game.
--- Paint the four chairs from the last roster the server sent.
---
--- A CHAIR IS A CHARACTER; the occupant is what changes. Four states, and the
--- tap does the obvious thing for each:
---   you     -- nothing to do
---   player  -- somebody else's, not tappable
---   bot     -- tap to play as that character, or x to send the bot away
---   empty   -- tap to take it, or invite/join if a friend is reachable
---
--- This replaces a global BOTS: ON button that could not say "three bots but
--- not a fourth", and whose scope (everyone in the server) was invisible.
--- Paint the four chairs from the last roster the server sent.
---
--- FOUR FIXED CHARACTERS; THE PEOPLE MOVE BETWEEN THEM. The chair is Bramble
--- or Pip or Nori or Mochi and it never moves or relabels. What changes is who
--- is standing in it, which is also literally true in the room behind the
--- panel -- the lineup marks belong to the characters too, so claiming one
--- walks you to their spot.
---
--- The name is the CHARACTER. The caption underneath is the occupant:
---   you     -- "you"
---   player  -- their name, and whether they are ready
---   bot     -- "bot", tap the chair to take over, x to send it away
---   empty   -- "empty", tap to take it, + to invite somebody
function ShiftPanel:renderRoster()
	local seats = self.seats or {}
	local me = Players.LocalPlayer.UserId
	for i, slot in self.slots do
		local seat = seats[i]
		if seat == nil then
			slot.root.Visible = false
		else
			slot.root.Visible = true
			slot.name.Text = string.upper(seat.species or "")
			local mine = seat.userId == me
			-- The corner offers the other verb: dismiss a bot, or invite into
			-- an empty chair. A person's chair has neither.
			slot.dismiss.Visible = seat.kind == "bot" or seat.kind == "empty"
			slot.dismiss.Text = if seat.kind == "bot" then "x" else "+"
			if seat.kind == "player" then
				slot.face.BackgroundColor3 = if mine then Theme.BROWN_LIGHT else Theme.BROWN_MID
				if mine then
					slot.state.Text = if seat.ready then "✅ you, ready" else "you"
					slot.state.TextColor3 = if seat.ready then Theme.GREEN else Theme.GOLD
				elseif seat.afk then
					slot.state.Text = `{seat.name or "Chef"} · away`
					slot.state.TextColor3 = Theme.DIM
				elseif seat.ready then
					slot.state.Text = `✅ {seat.name or "Chef"}`
					slot.state.TextColor3 = Theme.GREEN
				else
					slot.state.Text = seat.name or "Chef"
					slot.state.TextColor3 = Theme.CREAM
				end
			elseif seat.kind == "bot" then
				slot.state.Text = "bot · tap to play"
				slot.state.TextColor3 = Theme.DIM
				slot.face.BackgroundColor3 = Theme.BROWN_MID
			else
				slot.state.Text = "empty · tap to play"
				slot.state.TextColor3 = Theme.DIM
				slot.face.BackgroundColor3 = Theme.BROWN_DEEP
			end
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

function ShiftPanel:setPhase(phase: any, spectating: boolean)
	self.phase = phase
	self.spectating = spectating
	-- A solo tutorial has nobody to add bots alongside and nowhere better to
	-- go; NEW SERVER in particular would teleport a learner out of the lesson.
	if phase.tutorial ~= nil then
		self.tutorial = phase.tutorial == true
		self.newServerRoot.Visible = not self.tutorial
		-- A reserved tutorial server is not somewhere to invite anybody into.
		self.inviteRoot.Visible = not self.tutorial
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
	-- SHORT IS NOT THE SAME AS NARROW.
	--
	-- `compact` keys on WIDTH, and every size below it was chosen for a screen
	-- that is short as well. An 812x375 phone in landscape is neither: wide
	-- enough for the full-size Start button, but only 375 tall, and now that
	-- the column grows upward from the emote row the tall button pushed its own
	-- top edge into the WARDROBE chip in the corner -- caught by the harness at
	-- 3px of overlap, which is exactly the kind of margin nobody notices until
	-- it is a screenshot. Vertical space is what is scarce there, so the button
	-- takes the shorter height on height grounds, independently of width.
	local short = viewport.Y < 400
	local tight = compact or short
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
	end
	local friendW = slotW * 4 + gap * 3
	self.friendRow.Size = UDim2.fromOffset(friendW, Theme.MIN_TAP + Theme.SHADOW_DY)

	local rowsH = rows * (Theme.MIN_TAP + Theme.SHADOW_DY) + (rows - 1) * gap
	-- Pinned to the corner, so it sizes to its own buttons rather than to the
	-- panel's width.
	self.tabRow.Position = UDim2.fromOffset(12, 84)
	-- SIT ON THE EMOTE ROW, DON'T FLOAT OVER THE FACES.
	--
	-- This column used to be centred at 0.58 of the height and lift only as far
	-- as it had to in order to clear the emote buttons. On a phone that was the
	-- right rule; on a laptop it left Start Shift squarely across two of the
	-- four faces the lobby shot exists to show. The column is a control strip,
	-- not the subject, so it belongs at the bottom of the screen at every size.
	--
	-- Pinning the BOTTOM edge also removes the arithmetic. The old rule needed
	-- panelH, hand-summed from the rows and their gaps, and that sum had to be
	-- re-derived every time a row was added or removed -- it was wrong at least
	-- twice, and the guard that was supposed to catch it only ever caught the
	-- panel being too LOW. Now the bottom edge is stated outright and
	-- AutomaticSize.Y grows the column upward from it, so there is no height to
	-- get wrong in the first place.
	self.root.Position = UDim2.new(0.5, 0, 0, EmoteBar.topOf(viewport.Y) - EMOTE_CLEARANCE)
	-- The corner row sizes to ITS OWN buttons; the panel sizes to the chairs.
	-- They used to share a width because they shared a column, and keeping that
	-- link would stretch a one-button row across the whole screen.
	local tabsW = math.max(self.rows[1].Size.X.Offset, self.rows[2].Size.X.Offset)
	self.tabRow.Size = UDim2.fromOffset(tabsW, rowsH)
	local widest = friendW
	-- Height comes from the column's own contents (AutomaticSize.Y), not from a
	-- hand-summed constant: the old `142 + rowsH` had to be re-derived by hand
	-- every time a gap or a control changed height, and was already carrying
	-- 12px of slack nobody could account for.
	self.root.Size = UDim2.fromOffset(math.max(widest, 320), 0)
	self.startRoot.Size = UDim2.fromOffset(if compact then 260 else 340, if tight then 62 else 72)
	-- No per-state TextSize any more: the CTA scales its own label (see
	-- Theme.cta). Only the ceiling moves with the breakpoint.
	-- Sized off the button, not picked by feel: a chunky display face wants
	-- roughly 60% of the button's height or it reads as a small label floating
	-- in a large slab, which is how the first version looked.
	local h = if tight then 62 else 72
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
