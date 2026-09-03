-- DOES THE CELEBRATION ACTUALLY COME OUT?
--
-- Vfx:burst returns SILENTLY when all 30 pooled emitters are busy. That is the
-- right behaviour during a service -- a dropped spark is better than a stall --
-- but it means an end-of-shift volley fired all at once would quietly throw
-- most of itself away and look thinner than an ordinary serve, with nothing
-- anywhere saying so. The whole reason the volley is spread over time is to
-- stay under that ceiling, so the ceiling is what this checks.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

-- A stub Instance: Vfx only ever sets properties and reparents.
local emitted = 0
local function newInstance(class: string): any
	return setmetatable({
		ClassName = class,
		Emit = function(_self, n)
			emitted += n
		end,
	}, {
		__index = function()
			return nil
		end,
		__newindex = function(t, k, v)
			rawset(t, k, v)
		end,
	})
end

local shakes = 0
local env = {
	Instance = { new = newInstance },
	-- Vector3.one is multiplied by a scalar in the pool builder.
	Vector3 = {
		one = setmetatable({ X = 1, Y = 1, Z = 1 }, {
			__mul = function(v, k)
				return { X = v.X * k, Y = v.Y * k, Z = v.Z * k }
			end,
		}),
		new = function(x, y, z)
			return { X = x, Y = y, Z = z }
		end,
	},
	Color3 = {
		fromRGB = function(r, g, b)
			return { R = r, G = g, B = b }
		end,
		new = function(r, g, b)
			return { R = r, G = g, B = b }
		end,
	},
	CFrame = { new = function() return {} end },
	Vector2 = { new = function(x, y) return { X = x, Y = y } end },
	NumberRange = { new = function() return {} end },
	NumberSequence = { new = function() return {} end },
	NumberSequenceKeypoint = { new = function() return {} end },
	ColorSequence = { new = function() return {} end },
	ColorSequenceKeypoint = { new = function() return {} end },
	Enum = setmetatable({}, { __index = function()
		return setmetatable({}, { __index = function() return 0 end })
	end }),
	math = math,
	table = table,
	ipairs = ipairs,
	pairs = pairs,
	setmetatable = setmetatable,
	rawset = rawset,
	type = type,
	tostring = tostring,
	print = print,
}
local Vfx = luau.load(luau.compile(fs.readFile("game-src/client/Vfx.luau")), { environment = env })()

local vfx = Vfx.new(newInstance("Folder"), function(n)
	shakes += n
end)
local POOL = #vfx.pool
check(POOL == 30, `the pool is {POOL} emitters`)

local MARKS = { { x = 5.9, y = 8.45 }, { x = 6.9, y = 7.45 }, { x = 8.1, y = 7.45 }, { x = 9.1, y = 8.45 } }

print("A. a three-star volley is spread, not dumped")
vfx:celebrate(MARKS, 3)
local queued = #vfx.queued
check(queued >= 8, `it schedules {queued} volleys`)
local firstAt, lastAt = math.huge, -math.huge
for _, b in vfx.queued do
	firstAt = math.min(firstAt, b.at)
	lastAt = math.max(lastAt, b.at)
end
check(lastAt - firstAt > 1.5, `spread over {string.format("%.1f", lastAt - firstAt)}s rather than one frame`)
check(shakes > 0, "and it nudges the camera")

print("B. no frame ever asks the pool for more than it has")
-- Drain it the way the render loop does and count how many are in flight.
local mostBusyAtOnce = 0
for _ = 1, 60 * 6 do
	vfx:tick(1 / 60)
	local busy = 0
	for _, slot in vfx.pool do
		if vfx.clock < slot.busyUntil then
			busy += 1
		end
	end
	mostBusyAtOnce = math.max(mostBusyAtOnce, busy)
end
check(mostBusyAtOnce < POOL, `peak {mostBusyAtOnce} emitters in flight, under the {POOL} available`)
check(#vfx.queued == 0, "and the whole volley eventually fired")
check(emitted > 0, `with {emitted} particles actually emitted, not silently dropped`)

print("C. every finish gets something, not just a three-star one")
for stars = 0, 3 do
	local v = Vfx.new(newInstance("Folder"), function() end)
	v:celebrate(MARKS, stars)
	check(#v.queued > 0, `{stars} stars still schedules {#v.queued} volleys`)
end
local zero = Vfx.new(newInstance("Folder"), function() end)
zero:celebrate(MARKS, 0)
local three = Vfx.new(newInstance("Folder"), function() end)
three:celebrate(MARKS, 3)
check(#three.queued > #zero.queued, `and three stars is bigger than none ({#three.queued} vs {#zero.queued})`)

print(if failures > 0 then `{failures} FAILURES` else "PASS: vfx")
if failures > 0 then
	error(`{failures} checks failed`)
end
