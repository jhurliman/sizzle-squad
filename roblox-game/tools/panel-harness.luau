-- THE LOBBY PANEL, BUILT AND DRIVEN.
--
-- Three UI bugs in a row reached a human before they reached anything I run:
-- a share button positioned into the corner of the results card, a roster that
-- called a present player a bot, and a stale `slot.cta.root` in relayout that
-- errored the client on its first layout pass and broke the game outright.
--
-- None of them were catchable by what existed. check-luau checks syntax, and a
-- nil index is not a syntax error. No harness loaded this file at all, because
-- UI "needs Studio" -- which is true of how it LOOKS and false of almost
-- everything else: which widgets exist, what they say in each state, what a tap
-- does, and whether a layout pass runs without throwing.
--
-- So: build the real ShiftPanel against a fake Instance tree and drive it.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

-- A fake Instance, as in cta-harness, but this one REMEMBERS its Activated
-- handlers so a test can press things.
local function newInstance(class: string): any
	local inst
	local children = {}
	local handlers = {}
	-- Visible defaults TRUE on a real GuiObject. Returning nil here made
	-- relayout count zero visible tab buttons, so every measurement below was
	-- taken against a one-row panel no matter how many buttons there were --
	-- a harness quietly answering an easier question than the one asked.
	local props: { [string]: any } = { ClassName = class, Name = class, Visible = true }
	local dead = { Connect = function() return { Disconnect = function() end } end }
	local activated = {
		Connect = function(_, fn)
			table.insert(handlers, fn)
			return { Disconnect = function() end }
		end,
	}
	inst = setmetatable({}, {
		__index = function(_, k)
			if k == "GetChildren" then
				return function()
					return children
				end
			elseif k == "IsA" then
				return function(_, want: string)
					return props.ClassName == want
				end
			elseif k == "FindFirstChild" then
				return function(_, name: string)
					for _, c in children do
						if c.Name == name then
							return c
						end
					end
					return nil
				end
			elseif k == "FindFirstChildWhichIsA" then
				return function(_, want: string)
					for _, c in children do
						if c.ClassName == want then
							return c
						end
					end
					return nil
				end
			elseif k == "Activated" then
				return activated
			elseif k == "__press" then
				return function()
					for _, fn in handlers do
						fn()
					end
				end
			elseif k:match("^Mouse") or k:match("^Input") then
				return dead
			end
			return props[k]
		end,
		__newindex = function(_, k, v)
			if k == "Parent" then
				-- DETACH FIRST. A real Instance has exactly one parent, and
				-- reparenting removes it from the old one. This used to only
				-- ever append, so relayout -- which reparents every control on
				-- every pass -- left the same button in the row eighty times
				-- over, and anything counting or summing a row's children was
				-- measuring the harness rather than the panel.
				local was = props.Parent
				if was ~= nil then
					local kids = was.__children
					for i = #kids, 1, -1 do
						if kids[i] == inst then
							table.remove(kids, i)
						end
					end
				end
				if v ~= nil then
					table.insert(v.__children, inst)
				end
			end
			props[k] = v
		end,
	})
	rawset(inst, "__children", children)
	return inst
end

local UDim2, Vector2 = roblox.UDim2, roblox.Vector2

local env = {
	math = math,
	table = table,
	string = string,
	utf8 = utf8,
	pairs = pairs,
	ipairs = ipairs,
	setmetatable = setmetatable,
	rawset = rawset,
	warn = function() end,
	print = function() end,
	tostring = tostring,
	tonumber = tonumber,
	typeof = typeof,
	Instance = { new = newInstance },
	Color3 = roblox.Color3,
	UDim = roblox.UDim,
	UDim2 = roblox.UDim2,
	Vector2 = roblox.Vector2,
	ColorSequence = roblox.ColorSequence,
	Enum = roblox.Enum,
	game = {
		GetService = function(_, name)
			if name == "Players" then
				return { LocalPlayer = { UserId = 1001, DisplayName = "Me", Name = "Me" } }
			end
			-- SocialService: the invite path is pcall'd in shipping code.
			return setmetatable({}, {
				__index = function()
					return function()
						error("no platform here")
					end
				end,
			})
		end,
	},
}

local Theme = luau.load(luau.compile(fs.readFile("game-src/client/Menu/Theme.luau")), { environment = env })()
local Loc = {
	f = function(key: string, ...)
		local a = { ... }
		return `{key}:{tostring(a[1])}`
	end,
}

-- The REAL EmoteBar, not a stub: the panel is positioned from its exported
-- geometry, and a stub with made-up numbers would let the two drift apart
-- while this file kept saying they agreed. It only requires Theme, and nothing
-- here constructs one.
local emoteEnv = table.clone(env)
emoteEnv.script = { Parent = { Theme = "THEME" } }
emoteEnv.require = function(what)
	if what == "THEME" then
		return Theme
	end
	error(`unexpected require from EmoteBar: {tostring(what)}`)
end
local EmoteBar =
	luau.load(luau.compile(fs.readFile("game-src/client/Menu/EmoteBar.luau")), { environment = emoteEnv })()

-- ShiftPanel resolves its three requires off `script`.
local panelEnv = table.clone(env)
panelEnv.script = { Parent = { Theme = "THEME", EmoteBar = "EMOTEBAR", Parent = { Loc = "LOC" } } }
panelEnv.require = function(what)
	if what == "THEME" then
		return Theme
	elseif what == "LOC" then
		return Loc
	elseif what == "EMOTEBAR" then
		return EmoteBar
	end
	error(`unexpected require: {tostring(what)}`)
end

local ShiftPanel =
	luau.load(luau.compile(fs.readFile("game-src/client/Menu/ShiftPanel.luau")), { environment = panelEnv })()

-- ------------------------------------------------------------------ build

local acted = {}
local panel = ShiftPanel.new(newInstance("ScreenGui"), {
	onStart = function() end,
	onReady = function() end,
	onTab = function() end,
	onJoinFriend = function(jobId, name)
		table.insert(acted, { kind = "join", name = name })
	end,
	onSeatAction = function(chefId, action)
		table.insert(acted, { kind = action, chefId = chefId })
	end,
	onNewServer = function() end,
	onToast = function() end,
})
check(panel ~= nil, "the panel builds")
check(#panel.slots == 4, `with four chairs ({#panel.slots})`)

-- ---------------------------------------------------- A. a layout pass runs
--
-- THE BUG THAT BROKE THE GAME: relayout still touched slot.cta.root after the
-- chair stopped having one, so the client threw on its very first layout pass.
-- Nothing else in the repo would ever have executed this line.
print("A. relayout survives every width")
for _, w in { 1920, 1280, 1024, 820, 720, 640, 480, 414, 360, 320 } do
	local ok, err = pcall(function()
		panel:relayout(nil, Vector2.new(w, 800))
	end)
	check(ok, `relayout at {w}px` .. (if ok then "" else ` -- {tostring(err)}`))
end

-- ------------------------------------------ A2. does anything cover the faces?
--
-- REAL COLLISIONS, BOTH REPORTED FROM A PHONE: first the career chip landed on
-- top of the emote row, then the whole column sat across the crew's faces, and
-- then the controls -- moved to the top-left corner to get them out of the
-- column -- landed across the top of the faces instead.
--
-- So the thing to assert is not a clearance between two widgets, it is that
-- the FACE BAND is empty. Theme.FACE_BAND_TOP/BOTTOM is the band the lobby
-- camera fills with four heads; everything this screen draws goes above it or
-- below it, and this checks both edges at once.
--
-- THIS CHECK IS TWO-SIDED, WHICH THE ONE IT REPLACED WAS NOT. The old guard
-- measured how far the column had been LIFTED to clear the emote row, so
-- over-lifting -- including a deliberate 200px over-estimate of the column
-- height -- passed silently. Both bounds here are real: the bar cannot grow
-- down into the band and the column cannot grow up into it.
--
-- Top bar: AnchorPoint (1, 0) at (barRight - margin, barY), so its left edge
-- is Position.X - width and its bottom is Position.Y + height.
-- Column: AnchorPoint (0.5, 1), AutomaticSize.Y, so its height is its two
-- remaining children plus one gap and its top is Position.Y - that.
-- EmoteBar: AnchorPoint (0.5, 1) at (1, -8), 26 tall, so its top is H - 34.
print("A2. nothing is drawn in the face band")
local EMOTE_CLEARANCE = 12
local function measure(w: number, h: number): any
	local vp = Vector2.new(w, h)
	panel:relayout(nil, vp)
	local barY, _barH, barLeft, barRight = Theme.topbarBand(vp)
	-- The column is Start Shift and the chairs. The career chip is NOT summed
	-- here on purpose -- it moved to the bar, and if it ever comes back this
	-- number goes stale rather than silently absorbing it, which is what the
	-- chip-parent check below is for.
	local colH = panel.startRoot.Size.Y.Offset
		+ panel.friendRow.Size.Y.Offset
		+ panel.columnLayout.Padding.Offset
	local colBottom = panel.root.Position.Y.Offset
	return {
		barTop = panel.topBar.Position.Y.Offset,
		barBottom = panel.topBar.Position.Y.Offset + panel.topBar.Size.Y.Offset,
		barLeft = panel.topBar.Position.X.Offset - panel.topBar.Size.X.Offset,
		barRight = panel.topBar.Position.X.Offset,
		pillsEnd = barLeft,
		bandTop = math.floor(Theme.FACE_BAND_TOP * h),
		bandBottom = math.floor(Theme.FACE_BAND_BOTTOM * h),
		colTop = colBottom - colH,
		colBottom = colBottom,
		colH = colH,
		emoteTop = EmoteBar.topOf(h),
		wantBarY = barY,
		wantBarRight = barRight - Theme.TOPBAR_MARGIN,
		rows = if panel.rows[2].Visible then 2 else 1,
	}
end

for _, vp in
	{
		{ w = 1920, h = 1080, name = "desktop" },
		{ w = 1366, h = 768, name = "laptop" },
		{ w = 1024, h = 768, name = "iPad 4:3" },
		{ w = 874, h = 402, name = "iPhone 16 Pro landscape" },
		{ w = 896, h = 414, name = "iPhone 11 landscape" },
		{ w = 844, h = 390, name = "iPhone 12 landscape" },
		{ w = 812, h = 375, name = "iPhone X landscape" },
		{ w = 736, h = 414, name = "iPhone 8+ landscape" },
		{ w = 667, h = 375, name = "iPhone SE landscape" },
	}
do
	local m = measure(vp.w, vp.h)
	-- 1. the bar stops above the faces
	check(
		m.barBottom <= m.bandTop,
		`{vp.name} {vp.w}x{vp.h}: top bar ends at {m.barBottom}, face band starts at {m.bandTop} ({m.rows} row(s))`
	)
	-- 2. the column starts below them
	check(
		m.colTop >= m.bandBottom,
		`       column {m.colH}px starts at {m.colTop}, face band ends at {m.bandBottom}`
	)
	-- 3. and still sits on the emote row rather than drifting off the bottom
	check(
		m.emoteTop - m.colBottom == EMOTE_CLEARANCE,
		`       and sits {m.emoteTop - m.colBottom}px above the emote row`
	)
	-- 4. the bar is where Theme said to put it, clear of Roblox's own controls
	--    on the left and inside the screen on the right
	check(
		m.barTop == m.wantBarY and m.barRight == m.wantBarRight,
		`       bar pinned top-right at ({m.barRight}, {m.barTop})`
	)
	check(
		m.barLeft >= m.pillsEnd,
		`       and clears Roblox's own controls ({m.barLeft} >= {m.pillsEnd})`
	)
end

-- The affordance rule, as an assertion: the only flat plate on the screen is in
-- the bar. A playtester could not tell the career chip from the buttons above
-- it when it was in the column, so "everything in the column is tappable" is a
-- property worth failing a build over rather than a note in a comment.
print("A3. nothing inert is left in the bottom column")
do
	local inColumn = false
	for _, c in panel.root:GetChildren() do
		if c == panel.progressChip then
			inColumn = true
		end
	end
	check(not inColumn, "the career chip is in the top bar, not the column")
	check(panel.progressChip.Parent == panel.rows[1], "and specifically in the bar's first row")
end

-- ------------------------------------ A4. the bar holds text it did not expect
--
-- REPORTED FROM A PHONE: "🔥3 day streak" spilling out of the career plate and
-- over the WARDROBE button. The plate was one box with a hardcoded width
-- weight of 16, and the string it was handed -- level, coins AND the streak
-- glued on the end -- ran to 34 characters. A Roblox TextLabel does not keep
-- its text inside its own rect, so the overflow drew straight over its
-- neighbour.
--
-- Widths are measured from the text now, so the test is to hand the panel text
-- it was not designed around and check the bar still fits: a long streak, a
-- rich save file, and a German translation (the longest of the seven) at once.
print("A4. a long readout does not push the bar out of shape")
-- Deliberately a SECOND implementation, not the panel's. If the check imported
-- the same function it would agree with the layout by construction and prove
-- nothing about whether the width is really enough for the text.
local function textWeight(text: string): number
	local w = 0
	for _, c in utf8.codes(text) do
		w += if c < 128 then 1 else 1.8
	end
	return w
end
local function widestLine(text: string): number
	local w = 0
	for line in string.gmatch(text .. "\n", "([^\n]*)\n") do
		w = math.max(w, textWeight(line))
	end
	return w
end
for _, case in
	{
		{ name = "no streak", progress = { level = 1, coins = 0, streak = 0 } },
		{ name = "3 day streak", progress = { level = 6, coins = 2978, streak = 3 } },
		{ name = "maxed save", progress = { level = 99, coins = 9999999, streak = 365 } },
	}
do
	panel:setProgress(case.progress)
	for _, vp in { { w = 874, h = 402, name = "iPhone 16 Pro" }, { w = 667, h = 375, name = "iPhone SE" }, { w = 1920, h = 1080, name = "desktop" } } do
		local m = measure(vp.w, vp.h)
		check(
			m.barLeft >= m.pillsEnd,
			`{case.name} @ {vp.name}: bar {m.barRight - m.barLeft}px wide, still clear of Roblox's controls ({m.barLeft} >= {m.pillsEnd})`
		)
		check(m.barBottom <= m.bandTop, `       and still above the face band ({m.barBottom} <= {m.bandTop})`)
		-- A readout that is on screen must be wide enough to READ. 5.5px per
		-- weight unit plus padding is what the text costs at the smallest size
		-- it is allowed to shrink to; under that the plate clips its own text,
		-- which is the bug this section exists for.
		do
			local chip = panel.progressChip
			local need = math.floor(widestLine(chip.Text) * 5.5 + 12)
			check(
				chip.Size.X.Offset >= need,
				`       "{chip.Text:gsub("\n", " / ")}" has room to be read ({chip.Size.X.Offset} >= {need})`
			)
			local lines = select(2, chip.Text:gsub("\n", "")) + 1
			check(
				lines == (if (case.progress.streak or 0) > 1 then 2 else 1),
				`       the streak is line two of the career plate, not a plate of its own ({lines} line(s))`
			)
		end
		-- NO BUTTON NARROWER THAN ITS LONGEST WORD. "WARDR / OBE" on an iPhone
		-- was a button given less than the word needs at its smallest text.
		for _, b in panel.rowButtons do
			if b.Parent ~= nil and b.Parent.Visible then
				local word = 0
				for w in string.gmatch(b.Text, "%S+") do
					word = math.max(word, textWeight(w))
				end
				local need = math.floor(word * 8 + 14)
				check(
					b.Parent.Size.X.Offset >= need,
					`       "{b.Text}" holds its longest word whole ({b.Parent.Size.X.Offset} >= {need})`
				)
			end
		end
		-- Every plate and button inside the bar has to fit the row it is in,
		-- which is the specific thing that failed: the row was the right width
		-- and one child inside it was not.
		for _, row in { panel.rows[1], panel.rows[2] } do
			if row.Visible then
				local sum = 0
				local kids = 0
				for _, c in row:GetChildren() do
					if c.Size ~= nil and c.ClassName ~= "UIListLayout" and c.Visible then
						sum += c.Size.X.Offset
						kids += 1
					end
				end
				-- The bar's own gap: 4px on a compact viewport (< 720), 8 otherwise.
				local width = sum + (if vp.w < 720 then 4 else 8) * math.max(0, kids - 1)
				check(width <= row.Size.X.Offset, `       row holds its {kids} children ({width} <= {row.Size.X.Offset})`)
			end
		end
	end
end
-- THE HARNESS'S OWN Loc STUB IS SHORTER THAN THE REAL THING. It returns
-- "fmt.lv_coins:99", fifteen characters, where the shipping English is "Lv 99
-- · 9999999 coins" and the German is longer still -- so the cases above pass on
-- strings easier than any real player will ever see. Drive the actual worst
-- case: the longest of the seven translations, at the largest numbers, with the
-- streak showing.
print("A4b. and holds the longest translation, not just the stub's")
for _, case in
	{
		{ name = "de", lv = "Lv 99  ·  9999999 Münzen", streak = "🔥365 Tage in Folge" },
		{ name = "ja", lv = "Lv99  ·  9999999コイン", streak = "🔥365日連続" },
		{ name = "en", lv = "Lv 99  ·  9999999 coins", streak = "🔥365 day streak" },
	}
do
	for _, vp in { { w = 874, h = 402, name = "iPhone 16 Pro" }, { w = 667, h = 375, name = "iPhone SE" }, { w = 1920, h = 1080, name = "desktop" } } do
		-- Set the text, then lay out: relayout measures whatever is there.
		panel:setProgress({ level = 99, coins = 9999999, streak = 365 })
		panel.progressChip.Text = case.lv .. "\n" .. case.streak
		local m = measure(vp.w, vp.h)
		check(m.barLeft >= m.pillsEnd, `{case.name} @ {vp.name}: bar clears Roblox's controls ({m.barLeft} >= {m.pillsEnd})`)
		check(m.barBottom <= m.bandTop, `       and stays above the face band ({m.barBottom} <= {m.bandTop})`)
		do
			local chip = panel.progressChip
			local need = math.floor(widestLine(chip.Text) * 5.5 + 12)
			check(
				chip.Size.X.Offset >= need,
				`       "{chip.Text:gsub("\n", " / ")}" is readable ({chip.Size.X.Offset} >= {need})`
			)
		end
	end
end

-- Leave the panel as the later tests expect to find it.
panel:setProgress({ level = 1, coins = 0, streak = 0 })

-- --------------------------- A5. a brand-new player never sees this screen
--
-- REPORTED FROM STAGING: "it seemed like it started me at the START SHIFT
-- screen where you select four people, and then it dropped me into the single
-- player tutorial".
--
-- That is what the code did. The panel rendered from the first frame, because
-- its default phase is "countdown" and nothing gated it on knowing who the
-- player was. The profile then arrived, the client auto-readied a first-timer
-- into First Shift, and the crew-select screen they had been looking at for a
-- profile-load's worth of time vanished. The first thing a new player saw was
-- a screen that was not for them, taken away before they could use it.
print("A5. the panel waits until it knows whether the player is new")
do
	local fresh = ShiftPanel.new(newInstance("ScreenGui"), {
		onStart = function() end,
		onOpenTab = function() end,
		onNewServer = function() end,
		onJoinFriend = function() end,
		onSeatAction = function() end,
		onToast = function() end,
	})
	fresh:relayout(nil, Vector2.new(874, 402))
	fresh:setPhase({ phase = "countdown", seats = {}, readyCount = 0, readyTotal = 1 }, false)
	check(not fresh.root.Visible, "on the very first frame, before any profile, it is hidden")
	check(not fresh.topBar.Visible, "and so is the top bar, which is not parented to the column")

	-- The profile lands and says this is somebody's first ever session.
	fresh:setProgress({ level = 1, coins = 0, streak = 0, sessions = 1, rounds = 0 })
	fresh:setPhase({ phase = "countdown", seats = {}, readyCount = 0, readyTotal = 1 }, false)
	check(not fresh.root.Visible, "a first-ever session stays hidden -- First Shift owns this moment")

	-- ...and once they have played it, it is their home screen like anyone's.
	fresh:setProgress({ level = 1, coins = 40, streak = 0, sessions = 1, rounds = 1, tutorialDone = true })
	fresh:setPhase({ phase = "intermission", seats = {}, readyCount = 0, readyTotal = 1 }, false)
	check(fresh.root.Visible, "after the tutorial round it appears")
end

do
	local returning = ShiftPanel.new(newInstance("ScreenGui"), {
		onStart = function() end,
		onOpenTab = function() end,
		onNewServer = function() end,
		onJoinFriend = function() end,
		onSeatAction = function() end,
		onToast = function() end,
	})
	returning:relayout(nil, Vector2.new(874, 402))
	returning:setProgress({ level = 6, coins = 2978, streak = 3, sessions = 12, rounds = 40 })
	returning:setPhase({ phase = "countdown", seats = {}, readyCount = 0, readyTotal = 1 }, false)
	check(returning.root.Visible, "a returning player gets it as soon as the profile lands")
end

-- THE HOLD MUST ALWAYS END. If the profile never arrives -- a DataStore
-- outage, a dropped remote -- a held panel means no Start button and no way
-- into the game at all, which is a far worse bug than the flash being fixed
-- here. Six seconds of stepping and it gives up waiting.
do
	local stuck = ShiftPanel.new(newInstance("ScreenGui"), {
		onStart = function() end,
		onOpenTab = function() end,
		onNewServer = function() end,
		onJoinFriend = function() end,
		onSeatAction = function() end,
		onToast = function() end,
	})
	stuck:relayout(nil, Vector2.new(874, 402))
	stuck:setPhase({ phase = "countdown", seats = {}, readyCount = 0, readyTotal = 1 }, false)
	check(not stuck.root.Visible, "with no profile at all it starts hidden")
	-- Half the window: still waiting. Without this the test would also pass if
	-- the hold released immediately, which is the behaviour being replaced.
	for _ = 1, 30 do
		stuck:step(0.1)
	end
	check(not stuck.root.Visible, "three seconds in it is still waiting for the profile")
	for _ = 1, 40 do
		stuck:step(0.1)
	end
	check(stuck.root.Visible, "and past six seconds it shows anyway, rather than stranding them")
end

-- --------------------------------------------------- B. four fixed characters
print("B. the chairs are four fixed characters, and people move between them")
local function setSeats(seats: { any })
	panel:setPhase({ phase = "intermission", seats = seats, readyCount = 0, readyTotal = #seats }, false)
end

setSeats({
	{ chefId = 0, species = "bramble", kind = "player", userId = 1001, name = "Me", ready = false, afk = false },
	{ chefId = 1, species = "pip", kind = "player", userId = 2002, name = "Sam", ready = true, afk = false },
	{ chefId = 2, species = "nori", kind = "bot" },
	{ chefId = 3, species = "mochi", kind = "empty" },
})
for i, want in { "BRAMBLE", "PIP", "NORI", "MOCHI" } do
	check(panel.slots[i].name.Text == want, `chair {i} is {want} -- the character is the headline`)
end
check(panel.slots[1].state.Text == "you", `and the caption is the occupant ({panel.slots[1].state.Text})`)
check(panel.slots[2].state.Text == "✅ Sam", `a ready crewmate is named and ticked ({panel.slots[2].state.Text})`)
check(panel.slots[3].state.Text == "bot · tap to play", `a bot chair offers itself ({panel.slots[3].state.Text})`)
check(panel.slots[4].state.Text == "empty · tap to play", `and so does an empty one ({panel.slots[4].state.Text})`)

-- THE CHAIRS DO NOT MOVE WHEN PEOPLE DO. Swap who is in bramble and nori: the
-- labels must be identical afterwards, only the captions change.
setSeats({
	{ chefId = 2, species = "bramble", kind = "bot" },
	{ chefId = 1, species = "pip", kind = "player", userId = 2002, name = "Sam", ready = true, afk = false },
	{ chefId = 0, species = "nori", kind = "player", userId = 1001, name = "Me", ready = false, afk = false },
	{ chefId = 3, species = "mochi", kind = "empty" },
})
for i, want in { "BRAMBLE", "PIP", "NORI", "MOCHI" } do
	check(panel.slots[i].name.Text == want, `chair {i} is STILL {want} after a swap`)
end
check(panel.slots[3].state.Text == "you", "and I am now in the chair I claimed")
check(panel.slots[1].state.Text == "bot · tap to play", "with a bot in the one I left")

-- the corner is only offered where there is a second verb to perform
check(panel.slots[1].dismiss.Visible == true and panel.slots[1].dismiss.Text == "x", "a bot chair offers x")
check(panel.slots[4].dismiss.Visible == true and panel.slots[4].dismiss.Text == "+", "an empty chair offers +")
check(panel.slots[2].dismiss.Visible == false, "somebody else's chair offers neither")
check(panel.slots[3].dismiss.Visible == false, "and neither does mine")

-- an AFK player is still on their chair, said out loud
setSeats({
	{ chefId = 0, species = "bramble", kind = "player", userId = 2002, name = "Sam", ready = false, afk = true },
	{ chefId = 1, species = "pip", kind = "bot" },
	{ chefId = 2, species = "nori", kind = "bot" },
	{ chefId = 3, species = "mochi", kind = "bot" },
})
check(
	string.find(panel.slots[1].state.Text, "away", 1, true) ~= nil,
	`an AFK player keeps their chair and it says away ({panel.slots[1].state.Text})`
)

-- ------------------------------------------------------- C. tapping a chair
print("C. the face claims; the corner does the other thing")
setSeats({
	{ chefId = 0, species = "bramble", kind = "player", userId = 1001, name = "Me", ready = false, afk = false },
	{ chefId = 1, species = "pip", kind = "player", userId = 2002, name = "Sam", ready = false, afk = false },
	{ chefId = 2, species = "nori", kind = "bot" },
	{ chefId = 3, species = "mochi", kind = "empty" },
})
acted = {}
panel.slots[3].face.__press()
check(#acted == 1 and acted[1].kind == "claim" and acted[1].chefId == 2, "tapping a bot chair claims that character")
acted = {}
panel.slots[3].dismiss.__press()
check(#acted == 1 and acted[1].kind == "dismiss" and acted[1].chefId == 2, "its x dismisses the bot")

-- THE REPORTED BUG: the empty chair said INVITE across its whole face and
-- tapping it swapped your skin. The label described one action and the tap
-- performed another. Face claims, corner invites, and they are different
-- targets.
acted = {}
panel.slots[4].face.__press()
check(#acted == 1 and acted[1].kind == "claim" and acted[1].chefId == 3, "tapping an empty chair takes the character")
acted = {}
panel.slots[4].dismiss.__press()
check(#acted == 1 and acted[1].kind == "fill" and acted[1].chefId == 3, "and its + puts a bot in it")

-- THE CORNER IS ONE QUESTION: is there a bot in this chair? It briefly meant
-- "invite" on an empty chair, which everybody read as "add a bot" -- opposite
-- an x that removes one -- and which then did nothing at all, because
-- PromptGameInvite throws with no platform sheet and the pcall swallowed it.
panel:setFriends({ { name = "Kim", jobId = "abc" } })
acted = {}
panel.slots[4].dismiss.__press()
check(#acted == 1 and acted[1].kind == "fill", "and it still means bot even when a friend is reachable")
check(
	string.find(panel.inviteButton.Text, "Kim", 1, true) ~= nil,
	`inviting is a row button, and it offers the friend ({panel.inviteButton.Text})`
)
acted = {}
panel.inviteButton.__press()
check(#acted == 1 and acted[1].kind == "join", "which joins them")
panel:setFriends({})
check(
	string.find(panel.inviteButton.Text, "INVITE", 1, true) ~= nil,
	`and asks for one when nobody is cooking ({panel.inviteButton.Text})`
)
acted = {}
panel.slots[2].face.__press()
check(#acted == 0, "tapping somebody else's chair does nothing")
acted = {}
panel.slots[1].face.__press()
check(#acted == 0, "and neither does tapping your own")

-- ------------------------------------------------- D. the pre-press verb
print("D. the button says which situation you are in, before you commit")
panel:setPhase({ phase = "intermission", seats = {}, readyCount = 0, readyTotal = 1 }, false)
check(panel.startButton.Text == "START SHIFT", `alone it is Start ({panel.startButton.Text})`)
panel:setPhase({ phase = "intermission", seats = {}, readyCount = 0, readyTotal = 3 }, false)
check(panel.startButton.Text == "READY", `in a crew it is a pledge ({panel.startButton.Text})`)
panel:setPhase({
	phase = "intermission",
	seats = { { chefId = 0, species = "bramble", kind = "player", userId = 1001, name = "Me", ready = true } },
	readyCount = 2,
	readyTotal = 3,
}, false)
check(
	string.find(panel.startButton.Text, "waiting_crew", 1, true) ~= nil,
	`and once pledged it counts the crew ({panel.startButton.Text})`
)

print(if failures > 0 then `{failures} FAILURES` else "PASS: panel")
if failures > 0 then
	error(`{failures} checks failed`)
end
