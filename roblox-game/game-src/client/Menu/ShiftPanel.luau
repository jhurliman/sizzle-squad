--!strict
-- The between-rounds home screen, split into two strips with a rule between
-- them that a player can learn without being told:
--
--   TOP BAR   -- readouts and small controls, level with Roblox's own topbar
--               and to the right of it. The career line is a flat plate; the
--               three controls are raised buttons.
--   BOTTOM    -- Start Shift and the four chairs. EVERYTHING HERE IS TAPPABLE.
--
-- The middle is deliberately empty: Theme.FACE_BAND is where the lobby camera
-- puts four chefs' heads, and that is the one thing this screen exists to
-- show. Both strips are positioned to stay out of it.
--
-- The affordance rule is why the career chip moved up rather than shrinking in
-- place. It sat directly under four things that WERE buttons, in the same
-- brown, and a playtester had already failed to work out which of that column
-- could be pressed. Now nothing in the bottom half is inert, and the only flat
-- plate on screen is up in the bar with the other readouts.
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

-- Floor and ceiling for one control in the top bar. The floor is a tap target
-- that a thumb can actually hit; the ceiling stops a long label from taking
-- the whole bar and pushing the rest into a second row.
local MIN_BAR_ITEM = 64
local MAX_BAR_ITEM = 176

-- The Start button will shrink to fit a short screen, but not below this --
-- past it the hero button stops reading as the hero and the screen would be
-- better off scrolling.
local CTA_MIN_H = 48

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
	-- Kept as a field: relayout tightens this gap on screens too short to fit
	-- the column between the face band and the emote row.
	self.columnLayout = mk("UIListLayout", {
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
	-- THE TOP BAR.
	--
	-- Anchored to its RIGHT edge and placed level with Roblox's own topbar
	-- controls, which live on the left -- so the two rows read as one strip
	-- across the top rather than as our UI floating underneath theirs.
	--
	-- It was briefly in the TOP LEFT, at a hand-picked y=84, which put it
	-- straight through the top of the face band. relayout sets the real
	-- position from Theme.topbarBand; this is only the pre-layout frame.
	self.topBar = mk("Frame", {
		Name = "TopBar",
		Size = UDim2.fromOffset(600, Theme.TOPBAR_MIN),
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.fromOffset(0, 0),
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 4),
		HorizontalAlignment = Enum.HorizontalAlignment.Right,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.topBar)

	self.rows = {}
	for i = 1, 2 do
		local row = mk("Frame", {
			Size = UDim2.fromOffset(600, Theme.MIN_TAP),
			BackgroundTransparency = 1,
			LayoutOrder = i,
		}, self.topBar)
		mk("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 8),
			-- Right: the bar is pinned by its right edge, so its contents hug
			-- that edge and any spare width opens up on the left, away from
			-- Roblox's controls.
			HorizontalAlignment = Enum.HorizontalAlignment.Right,
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
	-- Each control declares roughly how many glyphs it has to fit, and relayout
	-- shares the bar's width out in that proportion instead of giving a
	-- two-word button and a five-word one the same box. An approximation on
	-- purpose: the labels are translated into seven languages and INVITE
	-- rewrites itself to JOIN <name>, so the exact width is not knowable here.
	-- The clamp and the label's own UITextSizeConstraint absorb the error.
	self.rowWeights = {}
	local function rowButton(label: string, order: number, fill: Color3?, weight: number?): any
		local cta = Theme.cta({
			Size = UDim2.fromOffset(140, Theme.MIN_TAP),
			Fill = fill or Theme.BROWN_MID,
			TextSize = 15,
			LayoutOrder = order,
			Text = label,
		}, self.rows[1])
		table.insert(self.rowButtons, cta.button)
		table.insert(self.rowRoots, cta.root)
		table.insert(self.rowWeights, weight or 12)
		return cta
	end
	for i, t in TABS do
		local cta = rowButton(t.label, i, nil, 11)
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
	local inviteCta = rowButton("＋ INVITE A FRIEND", #TABS + 2, Theme.BLUE, 17)
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
	local newCta = rowButton("🔄 NEW SERVER", #TABS + 3, nil, 13)
	self.newServerButton = newCta.button
	self.newServerRoot = newCta.root
	self.newServerButton.Activated:Connect(function()
		self.deps.onNewServer()
	end)

	-- A READOUT, AND IT LOOKS LIKE ONE.
	--
	-- Theme.chip is flat: no gradient, no drop shadow, no stroke, where
	-- Theme.cta has all three. That difference is now doing real work, because
	-- this is the only non-button left on the screen and it sits in the bar
	-- with the other things you cannot press, not in the column where
	-- everything else can be.
	--
	-- LayoutOrder 0 so it leads the bar, furthest from the right edge: the
	-- controls stay in the corner where a thumb reaches them.
	self.progressChip = Theme.chip({
		Size = UDim2.fromOffset(160, Theme.TOPBAR_MIN),
		TextSize = 15,
		BackgroundTransparency = 0.3,
		Font = Theme.BOLD_FONT,
		LayoutOrder = 0,
		Text = "Lv 1  ·  0 coins",
	}, self.rows[1])
	self.chipWeight = 16

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

--- Share `budget` out between items in proportion to how much label each has
--- to carry, with a floor so a short label still gets a tappable box and a
--- ceiling so a long one cannot eat the bar. Returns the widths and their sum
--- including the gaps between them.
local function allocate(weights: { number }, budget: number, gap: number): ({ number }, number)
	local n = #weights
	if n == 0 then
		return {}, 0
	end
	-- Padding is per item, not per glyph: a button is its text plus two ends.
	local units = 0
	for _, w in weights do
		units += w + 4
	end
	local content = math.max(1, budget - gap * (n - 1))
	local widths = {}
	local total = 0
	for i, w in weights do
		local px = math.clamp(math.floor(content * (w + 4) / units), MIN_BAR_ITEM, MAX_BAR_ITEM)
		widths[i] = px
		total += px
	end
	return widths, total + gap * (n - 1)
end

function ShiftPanel:relayout(_L: any, viewport: Vector2)
	self.lastViewport = viewport
	local compact = viewport.X < 720
	local narrow = viewport.X < 480
	local gap = 8

	-- ---------------------------------------------------------- the top bar
	--
	-- Level with Roblox's own controls and to the right of them, which is what
	-- TopbarInset describes. Height comes from the platform too, so our buttons
	-- are the same height as the system ones rather than a number picked to
	-- look about right -- clamped only so a bogus inset cannot produce a row
	-- too small to hit.
	local barY, barH, barLeft, barRight = Theme.topbarBand(viewport)
	local btnH = math.clamp(barH, 30, 44)
	local barAvail = math.max(MIN_BAR_ITEM * 2, (barRight - Theme.TOPBAR_MARGIN) - barLeft)

	-- Hidden controls take no space: a tutorial server hides INVITE.
	local visible = {}
	for i, root in self.rowRoots do
		if root.Visible then
			table.insert(visible, { root = root, button = self.rowButtons[i], weight = self.rowWeights[i] })
		end
	end
	-- The chip leads, so the buttons keep the right corner.
	table.insert(visible, 1, { root = self.progressChip, weight = self.chipWeight, chip = true })
	local n = #visible

	-- One row if the whole strip fits beside Roblox's controls; two if it does
	-- not, which only happens on a very narrow screen. Two still clears the
	-- face band -- 0.216 of even a 375-tall phone is 81px, and two 36px rows
	-- with a 4px gap is 76 -- so wrapping is a real fallback, not a cliff.
	local allW = {}
	for i, v in visible do
		allW[i] = v.weight
	end
	local _, oneRowW = allocate(allW, barAvail, gap)
	local rows = if oneRowW <= barAvail then 1 else 2
	local perRow = if rows == 1 then n else math.ceil(n / 2)

	local counts = { 0, 0 }
	local rowWeights = { {}, {} }
	local index = { {}, {} }
	for i, v in visible do
		local r = if rows == 1 then 1 else math.min(2, math.ceil(i / perRow))
		counts[r] += 1
		table.insert(rowWeights[r], v.weight)
		table.insert(index[r], i)
	end

	local rowW = { 0, 0 }
	for r = 1, 2 do
		local widths, total = allocate(rowWeights[r], barAvail, gap)
		rowW[r] = total
		for j, i in index[r] do
			local v = visible[i]
			v.root.Parent = self.rows[r]
			if not v.chip then
				v.root.LayoutOrder = i
				-- The CTA reserves SHADOW_DY below its face, so the root is
				-- taller than the button by exactly that overhang.
				v.root.Size = UDim2.fromOffset(widths[j], btnH + Theme.SHADOW_DY)
				local cap = v.button:FindFirstChildWhichIsA("UITextSizeConstraint")
				if cap ~= nil then
					cap.MaxTextSize = if narrow then 12 elseif compact then 13 else 15
				end
			else
				-- Flat, so no overhang to reserve -- but it is nudged down by
				-- the same amount so its top aligns with the buttons' faces.
				v.root.Size = UDim2.fromOffset(widths[j], btnH)
			end
		end
	end
	for r = 1, 2 do
		self.rows[r].Visible = counts[r] > 0
		self.rows[r].Size = UDim2.fromOffset(math.max(1, rowW[r]), btnH + Theme.SHADOW_DY)
	end
	local barW = math.max(rowW[1], rowW[2])
	local barTotalH = rows * (btnH + Theme.SHADOW_DY) + (rows - 1) * 4
	self.topBar.Size = UDim2.fromOffset(barW, barTotalH)
	self.topBar.Position = UDim2.fromOffset(barRight - Theme.TOPBAR_MARGIN, barY)

	-- ------------------------------------------------------- the bottom column
	--
	-- Four chairs always, sized from the space there actually is rather than a
	-- breakpoint table. Four fixed 230s overflow a 414-wide phone, so the slots
	-- share what is available and stop at a legible floor.
	local colAvail = math.max(320, viewport.X - 32)
	local slotW = math.max(96, math.min(190, math.floor((colAvail - gap * 3) / 4)))
	for _, slot in self.slots do
		slot.root.Size = UDim2.fromOffset(slotW, Theme.MIN_TAP + Theme.SHADOW_DY)
		slot.face.Size = UDim2.fromOffset(slotW, Theme.MIN_TAP)
	end
	local friendW = slotW * 4 + gap * 3
	self.friendRow.Size = UDim2.fromOffset(friendW, Theme.MIN_TAP + Theme.SHADOW_DY)

	-- FIT BETWEEN THE FACES AND THE EMOTES.
	--
	-- The column hangs from its bottom edge just above the emote row and grows
	-- upward, so what constrains it is the bottom of the face band. Rather than
	-- position it and hope, work out the height there is room for and shrink to
	-- it: the gap closes first because 18px of air is the cheapest thing here,
	-- and only then does the Start button give up height.
	--
	-- Losing the career chip out of this column bought most of the room back --
	-- it and its gap were 52 of the old 195px -- so on every real device the
	-- roomy version fits and none of this shrinking happens.
	local colBottom = EmoteBar.topOf(viewport.Y) - EMOTE_CLEARANCE
	local budget = colBottom - math.floor(Theme.FACE_BAND_BOTTOM * viewport.Y)
	local friendH = Theme.MIN_TAP + Theme.SHADOW_DY
	local colGap = COLUMN_GAP
	local ctaH = if compact then 62 else 72
	if ctaH + friendH + colGap > budget then
		colGap = 8
	end
	if ctaH + friendH + colGap > budget then
		ctaH = math.max(CTA_MIN_H, budget - friendH - colGap)
	end
	self.columnLayout.Padding = UDim.new(0, colGap)
	self.root.Position = UDim2.new(0.5, 0, 0, colBottom)
	self.root.Size = UDim2.fromOffset(math.max(friendW, 320), 0)
	self.startRoot.Size = UDim2.fromOffset(if compact then 260 else 340, ctaH)
	-- Sized off the button, not picked by feel: a chunky display face wants
	-- roughly 60% of the button's height or it reads as a small label floating
	-- in a large slab.
	local cap = self.startButton:FindFirstChildWhichIsA("UITextSizeConstraint")
	if cap ~= nil then
		cap.MaxTextSize = math.floor(ctaH * 0.62)
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
