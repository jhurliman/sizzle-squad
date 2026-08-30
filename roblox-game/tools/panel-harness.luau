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
	local props: { [string]: any } = { ClassName = class, Name = class }
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

-- ShiftPanel resolves its two requires off `script`.
local panelEnv = table.clone(env)
panelEnv.script = { Parent = { Theme = "THEME", Parent = { Loc = "LOC" } } }
panelEnv.require = function(what)
	if what == "THEME" then
		return Theme
	elseif what == "LOC" then
		return Loc
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

-- --------------------------------------------------- B. the four chair states
print("B. every chair state renders and says something")
local function setSeats(seats: { any })
	panel:setPhase({ phase = "intermission", seats = seats, readyCount = 0, readyTotal = #seats }, false)
end

setSeats({
	{ chefId = 0, species = "bramble", kind = "player", userId = 1001, name = "Me", ready = false, afk = false },
	{ chefId = 1, species = "pip", kind = "player", userId = 2002, name = "Sam", ready = true, afk = false },
	{ chefId = 2, species = "nori", kind = "bot" },
	{ chefId = 3, species = "mochi", kind = "empty" },
})
check(panel.slots[1].name.Text == "Me", `chair 1 is me ({panel.slots[1].name.Text})`)
check(panel.slots[1].state.Text == "choosing", `and says what I am doing ({panel.slots[1].state.Text})`)
check(panel.slots[2].state.Text == "✅ ready", `chair 2 is ready ({panel.slots[2].state.Text})`)
check(panel.slots[3].name.Text == "Bot", "chair 3 is a bot")
check(panel.slots[3].dismiss.Visible == true, "and offers an x to send it away")
check(panel.slots[4].dismiss.Visible == false, "an empty chair has no x -- there is nothing to dismiss")
check(panel.slots[1].dismiss.Visible == false, "and neither does a person's chair")
for i, want in { "BRAMBLE", "PIP", "NORI", "MOCHI" } do
	check(panel.slots[i].species.Text == want, `chair {i} is labelled {want}`)
end

-- an AFK player is still on their chair, said out loud
setSeats({
	{ chefId = 0, species = "bramble", kind = "player", userId = 1001, name = "Me", ready = false, afk = true },
	{ chefId = 1, species = "pip", kind = "bot" },
	{ chefId = 2, species = "nori", kind = "bot" },
	{ chefId = 3, species = "mochi", kind = "bot" },
})
check(panel.slots[1].name.Text == "Me", "an AFK player keeps their chair rather than turning into a bot")
check(panel.slots[1].state.Text == "away", `and it says away ({panel.slots[1].state.Text})`)

-- ------------------------------------------------------- C. tapping a chair
print("C. a tap does the obvious thing for the chair it is on")
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
check(#acted == 1 and acted[1].kind == "dismiss" and acted[1].chefId == 2, "and its x dismisses the bot")
acted = {}
panel.slots[4].face.__press()
check(#acted == 1 and acted[1].kind == "claim" and acted[1].chefId == 3, "tapping an empty chair takes it")
acted = {}
panel.slots[2].face.__press()
check(#acted == 0, "tapping somebody else's chair does nothing")
acted = {}
panel.slots[1].face.__press()
check(#acted == 0, "and neither does tapping your own")

-- an empty chair offers the friend first, when there is one
panel:setFriends({ { name = "Kim", jobId = "abc" } })
acted = {}
panel.slots[4].face.__press()
check(#acted == 1 and acted[1].kind == "join", "an empty chair offers a reachable friend before offering itself")
panel:setFriends({})

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
