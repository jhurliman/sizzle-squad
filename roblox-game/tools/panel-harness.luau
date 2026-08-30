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
			if k == "Parent" and v ~= nil then
				table.insert(v.__children, inst)
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

-- ---------------------------------- A2. does the bottom strip fit the screen?
--
-- REAL COLLISION, REPORTED ON MOBILE: the panel grew a roster row and the info
-- chip at its bottom landed on top of the emote row.
--
-- THE SHAPE OF THIS CHECK CHANGED. The panel used to be centred at 0.58 of the
-- height and lift only as far as it had to; the guard measured that lift, and
-- was only ever one-sided -- deliberately over-estimating the column height by
-- 200px passed clean, because over-lifting just moved the panel up and nothing
-- looked at where it ended up. The panel now hangs from its BOTTOM edge, a
-- fixed 12px above the emote row, so the bottom clearance is true by
-- construction and measuring it would only be measuring the constant.
--
-- What can still go wrong is at the OTHER end: the column grows upward, so a
-- taller column on a short screen runs into the WARDROBE row pinned in the
-- top-left corner, and then off the top of the screen. That is what is
-- measured here, and unlike the old one it is genuinely two-sided -- adding a
-- row to the column moves this number, in the direction that hurts.
--
-- Panel: AnchorPoint (0.5, 1), AutomaticSize.Y, so its height is its three
-- children plus two 18px gaps and its top is Position.Y - that.
-- EmoteBar: AnchorPoint (0.5, 1) at (1, -8), 26 tall, so its top is H - 34.
print("A2. the bottom strip fits above the emote row and below the corner")
local EMOTE_CLEARANCE = 12
local function clearance(w: number, h: number): (number, number, number, number, number)
	panel:relayout(nil, Vector2.new(w, h))
	-- The tab row is pinned to the top-left corner now, not stacked in this
	-- column, so it is not part of the panel's height and there are two gaps
	-- between three children rather than three between four.
	local children = panel.startRoot.Size.Y.Offset
		+ panel.friendRow.Size.Y.Offset
		+ panel.progressChip.Size.Y.Offset
	local panelH = children + 18 * 2
	-- Anchored (0.5, 1): Position.Y IS the bottom edge, not the centre.
	local panelBottom = panel.root.Position.Y.Offset
	-- From EmoteBar itself rather than a `- 34` copied here, which is what the
	-- panel does too. Which does mean the gap check below is weak -- both sides
	-- read the same constant, so it proves the panel WIRED the geometry up, not
	-- that the geometry is right. The top-edge check is the load-bearing one.
	local emoteTop = EmoteBar.topOf(h)
	return emoteTop - panelBottom, panelH, panel.tabRow.Size.Y.Offset, panelBottom - panelH, panel.tabRow.Size.X.Offset
end

for _, vp in
	{
		{ w = 1920, h = 1080, name = "desktop" },
		{ w = 1366, h = 768, name = "laptop" },
		{ w = 1024, h = 768, name = "iPad 4:3" },
		{ w = 896, h = 414, name = "iPhone 11 landscape" },
		{ w = 844, h = 390, name = "iPhone 12 landscape" },
		{ w = 812, h = 375, name = "iPhone X landscape" },
		{ w = 736, h = 414, name = "iPhone 8+ landscape" },
		{ w = 667, h = 375, name = "iPhone SE landscape" },
	}
do
	local gap, panelH, rowsH, top, tabsW = clearance(vp.w, vp.h)
	local rows = if rowsH > 60 then 2 else 1
	-- The corner row must not run off the right edge either.
	check(12 + tabsW <= vp.w, `{vp.name}: the corner row fits ({tabsW}px from x=12 in {vp.w})`)
	-- Sitting ON the emote row is the intent, so this is an equality, not a
	-- floor: it fails if the column drifts up as well as down.
	check(
		gap == EMOTE_CLEARANCE,
		`{vp.name} {vp.w}x{vp.h}: panel {panelH}px, tabs {rows} row(s), sits {string.format("%.0f", gap)}px above the emote row`
	)
	-- The column grows upward from that line. It must not reach the WARDROBE
	-- row in the corner, which is 48 tall at y=84, nor the screen edge above it.
	local cornerBottom = 84 + rowsH
	check(top >= cornerBottom, `       and its top edge clears the corner row ({string.format("%.0f", top)} >= {cornerBottom})`)
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
