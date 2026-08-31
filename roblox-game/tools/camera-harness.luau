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
-- Magnitude as a computed property, not a stored one: CameraRig measures the
-- focal distance with `(look - pos).Magnitude`, and shipping code should not
-- be contorted into `math.sqrt(...)` to suit a test double.
V3.__index = function(t, k)
	if k == "Magnitude" then
		return math.sqrt(t.X * t.X + t.Y * t.Y + t.Z * t.Z)
	end
	return rawget(V3, k)
end
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

-- A Lighting with just enough behaviour for the rig to hang an effect on it,
-- so the depth-of-field path below runs for real rather than being skipped by
-- the pcall that guards it.
local lighting = { children = {} :: { any } }
function lighting:FindFirstChild(name: string)
	for _, c in self.children do
		if c.Name == name then
			return c
		end
	end
	return nil
end

local env = {
	game = {
		GetService = function(_s, name)
			if name == "Lighting" then
				return lighting
			end
			return {
				WaitForChild = function(_s2, child)
					if child == "Game" then
						return { WaitForChild = function() return "STAGING" end }
					end
					return "STAGING"
				end,
			}
		end,
	},
	Instance = {
		new = function(class: string)
			local inst = { ClassName = class, Name = class }
			setmetatable(inst, {
				__newindex = function(t, k, v)
					if k == "Parent" and v ~= nil then
						table.insert(v.children, t)
					end
					rawset(t, k, v)
				end,
			})
			return inst
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
	rawset = rawset,
	rawget = rawget,
	pcall = pcall,
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

-- ------------------------------------------------ F. DEPTH OF FIELD
--
-- Roblox gives no programmable shaders, so this is DepthOfFieldEffect on
-- Lighting -- a GLOBAL effect, which is the whole risk. It is not scoped to a
-- view, so if it is ever left on when a round starts the player cooks through
-- a soft-focus lens, and the one thing a harness cannot do here is look at it.
--
-- What can be checked is everything except how it looks: that it is off during
-- play, that it focuses on the crew and not on a constant, and that it moves
-- on the same curve as the camera rather than snapping at either end.
print("F. depth of field")
do
	local rig = CameraRig.new(camera)
	local dof = lighting:FindFirstChild("SizzleLobbyDof")
	check(dof ~= nil, "the rig hangs a DepthOfFieldEffect on Lighting")
	check(dof.ClassName == "DepthOfFieldEffect", "and it is the depth-aware one, not a BlurEffect")

	-- A second rig must not stack a second effect (Rojo re-syncs this file).
	CameraRig.new(camera)
	check(#lighting.children == 1, `re-creating the rig reuses it ({#lighting.children} on Lighting)`)

	rig:update(1 / 60)
	check(not dof.Enabled, "during gameplay it is switched off, not merely at zero")
	check(dof.NearIntensity == 0, "nothing in FRONT of the crew is ever blurred")

	rig:cutTo("lobby", 0)
	rig:update(1 / 60)
	check(dof.Enabled, "on the lobby shot it is on")
	check(dof.FarIntensity > 0 and dof.FarIntensity < 0.6, `subtle, not a smear ({dof.FarIntensity})`)

	-- The focal plane must sit ON the crew. Solve the shot and compare.
	local pos, look = rig:resolve(rig:aspect())
	local want = math.sqrt((look.X - pos.X) ^ 2 + (look.Y - pos.Y) ^ 2 + (look.Z - pos.Z) ^ 2)
	check(
		math.abs(dof.FocusDistance - want) < 0.01,
		`focused on the crew, {string.format("%.1f", dof.FocusDistance)} studs out, not a constant`
	)
	-- ...and the whole lineup has to be inside the sharp band, or the two chefs
	-- standing further back go soft and it reads as a bug, not as a lens.
	local depths = {}
	for _, m in staging.LINEUP do
		-- Chest height, matching how section B frames them, not the floor.
		local p = v3(m.x * SCALE, CHEF_H * 0.5, m.y * SCALE)
		local fwd = v3(look.X - pos.X, look.Y - pos.Y, look.Z - pos.Z)
		local flen = fwd.Magnitude
		fwd = v3(fwd.X / flen, fwd.Y / flen, fwd.Z / flen)
		local rel = v3(p.X - pos.X, p.Y - pos.Y, p.Z - pos.Z)
		table.insert(depths, rel.X * fwd.X + rel.Y * fwd.Y + rel.Z * fwd.Z)
	end
	local lo, hi = depths[1], depths[1]
	for _, d in depths do
		if d < lo then
			lo = d
		end
		if d > hi then
			hi = d
		end
	end
	local worst = math.max(math.abs(hi - dof.FocusDistance), math.abs(dof.FocusDistance - lo))
	check(
		worst <= dof.InFocusRadius,
		`all four chefs are inside the sharp band (worst {string.format("%.1f", worst)} <= {dof.InFocusRadius})`
	)

	-- And it has to RIDE the move, not step at one end of it.
	rig:cutTo("gameplay", 1.2, "smooth")
	local seen = {}
	local stepped = false
	local prev = dof.Enabled and dof.FarIntensity or 0
	for _ = 1, 72 do
		rig:update(1 / 60)
		local now = if dof.Enabled then dof.FarIntensity else 0
		if math.abs(now - prev) > 0.08 then
			stepped = true
		end
		prev = now
		table.insert(seen, now)
	end
	check(not stepped, "it eases out with the camera instead of popping")
	check(seen[#seen] == 0 and not dof.Enabled, "and is off again by the time the round starts")
end

print(if failures > 0 then `{failures} FAILURES` else "PASS: camera")
if failures > 0 then
	error(`{failures} checks failed`)
end
