-- FIRST SHIFT COACH DECISIONS.
--
-- Five bugs have been reported in this logic in a row, every one of them the
-- same shape: the coach answered from the current instant instead of the job in
-- flight, and sent the player back to a step they had already completed. They
-- were all found by a human playing the tutorial, which is an expensive way to
-- find them. This walks the opening Garden Salad ticket end to end.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then print(`  ok   {m}`) else failures += 1 print(`  FAIL {m}`) end
end

-- FirstShift.new builds GUI; the decision helpers do not, so a stub Instance
-- is enough to load the module.
local env = {
	math = math, table = table, string = string, pairs = pairs, ipairs = ipairs,
	setmetatable = setmetatable, warn = function() end, print = print, bit32 = bit32,
	Instance = { new = function() return { Parent = nil } end },
	game = { GetService = function() return { LocalPlayer = {} } end },
	Color3 = { fromRGB = function() return {} end },
	UDim2 = { new = function() return {} end, fromOffset = function() return {} end, fromScale = function() return {} end },
	UDim = { new = function() return {} end },
	Enum = setmetatable({}, { __index = function() return setmetatable({}, { __index = function() return 0 end }) end }),
	Vector2 = { new = function() return {} end },
	script = nil :: any,
	require = nil :: any,
}
-- Auto-vivifying stubs: FirstShift pulls Theme in through script.Parent, and
-- Theme's helpers are only ever CALLED from :new, which this never runs.
local function auto(): any
	return setmetatable({}, {
		__index = function(t, k)
			local v = auto()
			rawset(t, k, v)
			return v
		end,
		__call = function()
			return auto()
		end,
	})
end
env.script = auto()
env.require = function()
	return auto()
end
local ok, FirstShift = pcall(function()
	return luau.load(luau.compile(fs.readFile("game-src/client/FirstShift.luau")), { environment = env })()
end)
if not ok then
	print(`  FAIL could not load FirstShift: {FirstShift}`)
	print("1 FAILURES")
	return
end
local D = FirstShift._debug

-- Garden Salad: the scripted opening ticket (content.ts RECIPES[1]).
local order = { name = "Garden Salad", components = {
	{ kind = "lettuce", state = "prepped" },
	{ kind = "tomato", state = "prepped" },
} }

-- A kitchen of four stations; `holding` is set per scenario.
local function world(holdings: { [number]: any })
	local stations = {}
	local mirror = { kitchen = { stations = {
		{ id = 1, kind = "plates" }, { id = 2, kind = "counter" },
		{ id = 3, kind = "board" }, { id = 4, kind = "serve" },
	} } }
	for _, st in mirror.kitchen.stations do
		stations[st.id] = { id = st.id, holding = holdings[st.id] }
	end
	return { mirrorSim = mirror, stations = stations }
end

local PLATE = function(contents) return { type = "plate", contents = contents or {} } end
local ING = function(kind, st) return { type = "ingredient", kind = kind, state = st } end

-- 1. nothing done yet
local s = world({})
check(D.stagedPlateId(s) == nil, "no plate staged at the start")
check(D.nextNeeded(s, order, nil).kind == "lettuce", "first thing needed is lettuce")

-- 2. plate staged on the counter
s = world({ [2] = PLATE() })
check(D.stagedPlateId(s) == 2, "the staged plate is found on the counter, not the dispenser")

-- 3. raw lettuce set down on the board
s = world({ [2] = PLATE(), [3] = ING("lettuce", "raw") })
check(D.unfinishedAt(s, "board", "prepped") == 3, "raw lettuce on the board is unfinished work")
check(D.nextNeeded(s, order, nil).kind == "lettuce", "raw lettuce does not yet satisfy the prepped line")

-- 4. chopped, still on the board
s = world({ [2] = PLATE(), [3] = ING("lettuce", "prepped") })
check(D.unfinishedAt(s, "board", "prepped") == nil, "chopped lettuce is no longer unfinished")
local rid, rkind = D.readyAt(s, order)
check(rid == 3 and rkind == "lettuce", "chopped lettuce is ready to collect")

-- 5. carried in hand
s = world({ [2] = PLATE() })
check(D.nextNeeded(s, order, ING("lettuce", "prepped")).kind == "tomato",
	"lettuce in hand counts toward the ticket")

-- 6. THE REPORTED BUG: lettuce plated, so the next ask must be tomato
s = world({ [2] = PLATE({ { kind = "lettuce", state = "prepped" } }) })
local nxt = D.nextNeeded(s, order, nil)
check(nxt ~= nil and nxt.kind == "tomato", `plated lettuce advances the ticket to tomato (got {nxt and nxt.kind})`)

-- 7. both plated: nothing left to fetch
s = world({ [2] = PLATE({ { kind = "lettuce", state = "prepped" }, { kind = "tomato", state = "prepped" } }) })
check(D.nextNeeded(s, order, nil) == nil, "a complete ticket asks for nothing more")

-- 8. duplicates are counted, not just matched (Chopped Salad wants two tomatoes)
local chopped = { name = "Chopped Salad", components = {
	{ kind = "lettuce", state = "prepped" },
	{ kind = "tomato", state = "prepped" },
	{ kind = "tomato", state = "prepped" },
} }
s = world({ [2] = PLATE({ { kind = "lettuce", state = "prepped" }, { kind = "tomato", state = "prepped" } }) })
check(D.nextNeeded(s, chopped, nil).kind == "tomato", "a second tomato is still owed on Chopped Salad")

print(if failures > 0 then `{failures} FAILURES` else "PASS: coach")
