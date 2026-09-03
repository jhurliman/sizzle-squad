-- IS THE CREW ACTUALLY IN SHOT, AND DOES THE MOVE LAND?
--
-- Written because the usual answer -- look at it -- is not available: the
-- Studio MCP's screen_capture returns a flat magenta frame in this setup, so
-- there is no way to eyeball a camera framing at all. Everything the eye would
-- have checked is arithmetic anyway: project the four lineup marks through the
-- solved camera and see where they land in the frame.
--
-- It also pins the gameplay shot. That solve is the web game's one framing
-- invariant and it is now sharing a file with two new shots; a regression in it
-- would show up as "the kitchen looks a bit off" weeks later.
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

-- ---------------------------------------------------------------- fakes

local V3 = {}
V3.__index = V3
local function v3(x: number, y: number, z: number)
	return setmetatable({ X = x, Y = y, Z = z }, V3)
end
V3.__add = function(a, b)
	return v3(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
end
V3.__sub = function(a, b)
	return v3(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
end
V3.__mul = function(a, b)
	if type(b) == "number" then
		return v3(a.X * b, a.Y * b, a.Z * b)
	end
	return v3(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
function V3:Lerp(o, t)
	return v3(self.X + (o.X - self.X) * t, self.Y + (o.Y - self.Y) * t, self.Z + (o.Z - self.Z) * t)
end

-- Only the pitch-about-X rotation CameraRig actually uses.
local function cframeAngles(rx: number, _ry: number, _rz: number)
	return {
		VectorToWorldSpace = function(_self, v)
			local c, s = math.cos(rx), math.sin(rx)
			return v3(v.X, v.Y * c - v.Z * s, v.Y * s + v.Z * c)
		end,
	}
end

local camera = {
	ViewportSize = v3(1600, 900, 0),
	CameraType = "Scriptable",
	FieldOfView = 40,
	CFrame = nil,
}

local staging = luau.load(luau.compile(fs.readFile("game-src/shared/Staging.luau")), {
	environment = { math = math, table = table, ipairs = ipairs, pairs = pairs },
})()

local env = {
	game = {
		GetService = function()
			return {
				WaitForChild = function(_s, name)
					if name == "Game" then
						return { WaitForChild = function() return "STAGING" end }
					end
					return "STAGING"
				end,
			}
		end,
	},
	require = function(what)
		if what == "STAGING" then
			return staging
		end
		error("unexpected require in CameraRig: " .. tostring(what))
	end,
	Vector3 = { new = v3, zero = v3(0, 0, 0) },
	CFrame = {
		Angles = cframeAngles,
		lookAt = function(pos, look)
			return { pos = pos, look = look }
		end,
	},
	Enum = { CameraType = { Scriptable = "Scriptable" } },
	math = math,
	table = table,
	ipairs = ipairs,
	pairs = pairs,
	setmetatable = setmetatable,
	type = type,
	tostring = tostring,
	print = print,
}

local CameraRig = luau.load(luau.compile(fs.readFile("game-src/client/CameraRig.luau")), { environment = env })()

-- ---------------------------------------------------------------- helpers

local SCALE = 5
local CHEF_H = 1.6 * SCALE
local FOV = 40

--- Project a world point into frame fractions. (0,0) is centre; ±1 is the edge.
local function project(pos, look, p, aspect: number): (number, number, number)
	-- Camera basis: the rig only ever pitches about X, so forward/right/up are
	-- recoverable without a full CFrame.
	local fwd = v3(look.X - pos.X, look.Y - pos.Y, look.Z - pos.Z)
	local flen = math.sqrt(fwd.X ^ 2 + fwd.Y ^ 2 + fwd.Z ^ 2)
	fwd = v3(fwd.X / flen, fwd.Y / flen, fwd.Z / flen)
	local right = v3(1, 0, 0) -- no yaw or roll in any shot
	-- up = right x fwd
	local up = v3(
		right.Y * fwd.Z - right.Z * fwd.Y,
		right.Z * fwd.X - right.X * fwd.Z,
		right.X * fwd.Y - right.Y * fwd.X
	)
	local d = v3(p.X - pos.X, p.Y - pos.Y, p.Z - pos.Z)
	local z = d.X * fwd.X + d.Y * fwd.Y + d.Z * fwd.Z
	local x = d.X * right.X + d.Y * right.Y + d.Z * right.Z
	local y = d.X * up.X + d.Y * up.Y + d.Z * up.Z
	local tanV = math.tan(math.rad(FOV) / 2)
	local tanH = tanV * aspect
	return x / (z * tanH), y / (z * tanV), z
end

local function rigFor(aspect: number)
	camera.ViewportSize = v3(1000 * aspect, 1000, 0)
	return CameraRig.new(camera)
end

-- ---------------------------------------------------------------- 1. gameplay is unchanged

print("A. the gameplay shot is exactly what it always was")
for _, aspect in { 1.333, 1.777, 2.17 } do
	local rig = rigFor(aspect)
	rig:cutTo("gameplay", 0)
	local pos, look = rig:resolve(aspect)
	-- the original solve, transcribed
	local hfov = 2 * math.atan(math.tan(math.rad(40) / 2) * aspect)
	local halfW = 15 * SCALE * 0.5 + SCALE * 0.8
	local want = math.max(halfW / math.tan(hfov / 2), 11.5 * SCALE)
	local lookAt = v3(7.5 * SCALE, 0.9 * SCALE, 4.6 * SCALE)
	local dz = pos.Z - lookAt.Z
	local dy = pos.Y - lookAt.Y
	local got = math.sqrt(dz * dz + dy * dy)
	check(math.abs(got - want) < 0.01, `aspect {aspect}: distance {string.format("%.2f", got)} matches the original solve`)
	check(math.abs(look.X - lookAt.X) < 0.01 and math.abs(look.Z - lookAt.Z) < 0.01, `aspect {aspect}: look-at unchanged`)
end

-- ---------------------------------------------------------------- 2. the crew is in shot

print("B. every chef is inside the frame, in both close shots")
local BODY = 0.36 * SCALE
for _, shot in { "lobby", "photo" } do
	for _, aspect in { 1.333, 1.777, 2.17, 2.33 } do
		local rig = rigFor(aspect)
		rig:cutTo(shot, 0)
		local pos, look = rig:resolve(aspect)
		local worstX, worstTop, minH = 0, 0, 1
		for _, m in staging.LINEUP do
			-- widest point of the body, and the top of the head
			for _, dx in { -BODY, 0, BODY } do
				local fx, fy = project(pos, look, v3(m.x * SCALE + dx, 0, m.y * SCALE), aspect)
				worstX = math.max(worstX, math.abs(fx))
				local _, fyTop = project(pos, look, v3(m.x * SCALE + dx, CHEF_H, m.y * SCALE), aspect)
				worstTop = math.max(worstTop, math.abs(fyTop))
				minH = math.min(minH, fyTop - fy)
			end
		end
		check(worstX < 0.97, `{shot} @ {aspect}: widest chef edge at {string.format("%.2f", worstX)} of half-width`)
		check(worstTop < 0.97, `{shot} @ {aspect}: tallest head at {string.format("%.2f", worstTop)} of half-height`)
		-- and they must be BIG: the point of the shot
		check(minH > 0.28, `{shot} @ {aspect}: a chef spans {string.format("%.0f", minH * 50)}% of frame height`)
	end
end

-- ---------------------------------------------------------------- 3. the move

print("C. the move starts where it was and ends where it is going")
local rig = rigFor(1.777)
rig:cutTo("gameplay", 0)
local gPos = rig:resolve(1.777)
rig:cutTo("lobby", 0)
local lPos = rig:resolve(1.777)
check(math.abs(gPos.Z - lPos.Z) > 20, `the two shots are actually far apart ({string.format("%.0f", math.abs(gPos.Z - lPos.Z))} studs)`)

rig:cutTo("gameplay", 0)
rig:cutTo("lobby", 1.0, "smooth")
local p0 = rig:resolve(1.777)
check(math.abs(p0.Z - gPos.Z) < 0.01, "at t=0 the camera is still exactly on the old shot")
rig:update(0.5)
local pMid = rig:resolve(1.777)
local lo, hi = math.min(gPos.Z, lPos.Z), math.max(gPos.Z, lPos.Z)
check(pMid.Z > lo and pMid.Z < hi, "half way through it is between the two, not past either")
check(rig:isMoving(), "and it knows it is still moving")
rig:update(0.6)
local p1 = rig:resolve(1.777)
check(math.abs(p1.Z - lPos.Z) < 0.01, "when the clock runs out it is exactly on the new shot")
check(not rig:isMoving(), "and the move is over")

print("D. smootherstep never overshoots, so the framing never settles back")
rig:cutTo("gameplay", 0)
rig:cutTo("lobby", 1.0, "smooth")
local prev, monotonic = gPos.Z, true
for _ = 1, 20 do
	rig:update(0.05)
	local p = rig:resolve(1.777)
	if p.Z < lo - 0.001 or p.Z > hi + 0.001 then
		monotonic = false
	end
	prev = p.Z
end
check(monotonic, "every frame of the move stayed between the two shots")
check(math.abs(prev - lPos.Z) < 0.01, "and it finished on the mark")

print("E. interrupting a move picks up from what is on screen")
rig:cutTo("gameplay", 0)
rig:cutTo("lobby", 1.0, "smooth")
rig:update(0.5)
local seen = rig:resolve(1.777)
rig:cutTo("gameplay", 1.0, "smooth")
local afterCut = rig:resolve(1.777)
check(
	math.abs(afterCut.Z - seen.Z) < 0.01,
	`the new move begins at the visible pose, not a jump ({string.format("%.2f", math.abs(afterCut.Z - seen.Z))} studs)`
)
rig:update(1.0)
local back = rig:resolve(1.777)
check(math.abs(back.Z - gPos.Z) < 0.01, "and it still arrives exactly on gameplay")

print(if failures > 0 then `{failures} FAILURES` else "PASS: camera")
if failures > 0 then
	error(`{failures} checks failed`)
end
