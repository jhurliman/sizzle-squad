--!strict
-- LIGHT THE OVEN.
--
-- The hearth is the biggest object in the room and it sat cold. That was easy
-- to miss while the only camera was the wide gameplay solve, where the arch is
-- a small dark shape at the back; the lobby closeup put it dead centre behind
-- the crew and the empty grate became the most conspicuous thing on screen.
--
-- The model already ships OvenGlow parts -- the orange bar you can see through
-- the arch -- so the heat was drawn and the fire was not. This adds the fire,
-- a light, and the flicker that makes the two read as one thing.
--
-- Placed off the glow parts' OWN CFrames, the way BinDress works off the
-- barrel's, so it stays correct if the oven is ever re-exported or moved. If
-- the kitchen ever ships with a lit oven, delete this file.
--
-- Client-side and cosmetic: no replication, no sim, nothing to get out of step.

local HearthFire = {}

local FLAME_INNER = Color3.fromRGB(255, 196, 92)
local FLAME_OUTER = Color3.fromRGB(214, 74, 28)
local LIGHT = Color3.fromRGB(255, 154, 74)

-- THE LIGHT IS A HINT, NOT A HEADLAMP.
--
-- First pass was Brightness 2.4 over a 26-stud Range, which in a Voxel scene
-- that is already at Lighting.Brightness 2 and midday ClockTime blew out the
-- decor either side of the hearth -- 26 studs reaches well past the oven's own
-- 15-stud span and onto the counters. The flames themselves came out well and
-- are untouched; this is only the pool of light around them.
--
-- Kept as named numbers because they are taste, and taste gets retuned.
local LIGHT_BRIGHTNESS = 0.9
local LIGHT_RANGE = 12
local FLICKER = 0.15

--- Every OvenGlow part in the model, which is where the heat already is.
local function glows(oven: Instance): { BasePart }
	local out = {}
	for _, d in oven:GetDescendants() do
		if d:IsA("BasePart") and string.find(d.Name, "OvenGlow", 1, true) ~= nil then
			table.insert(out, d)
		end
	end
	return out
end

--- Light the oven in `kitchenRoot`. Safe to call more than once.
function HearthFire.apply(kitchenRoot: Instance)
	local oven = kitchenRoot:FindFirstChild("Oven", true)
	if oven == nil then
		return
	end
	if oven:FindFirstChild("HearthFire") ~= nil then
		return
	end
	local parts = glows(oven)
	if #parts == 0 then
		return
	end

	-- A marker child, so a second call is a no-op rather than a second fire.
	local marker = Instance.new("Folder")
	marker.Name = "HearthFire"
	marker.Parent = oven

	local lit = {}
	for _, glow in parts do
		local fire = Instance.new("Fire")
		-- Sized off the part rather than a constant: the glow bars differ, and
		-- a flame wider than its grate reads as a bug rather than a fire.
		local span = math.max(glow.Size.X, glow.Size.Z)
		fire.Size = math.clamp(span * 0.9, 2, 7)
		fire.Heat = 6
		fire.Color = FLAME_INNER
		fire.SecondaryColor = FLAME_OUTER
		fire.Parent = glow
		table.insert(lit, fire)
	end

	-- ONE light, not one per glow bar. Three overlapping PointLights in a
	-- confined stone arch is three shadow casters and a blown-out hotspot.
	--
	-- AND IT GOES IN THE MIDDLE. It used to hang off parts[1], meaning whichever
	-- part GetDescendants happened to return first -- and the glow parts are a
	-- wide bar across the back plus a narrow panel down each side, so "first"
	-- was as likely to be the left-hand wall as the centre. The result was a
	-- hearth lit from one side, which is what a lopsided glow is.
	local cx = 0
	for _, g in parts do
		cx += g.Position.X
	end
	cx /= #parts
	local centre, best = parts[1], math.huge
	for _, g in parts do
		local d = math.abs(g.Position.X - cx)
		if d < best then
			best, centre = d, g
		end
	end

	local light = Instance.new("PointLight")
	light.Color = LIGHT
	light.Brightness = LIGHT_BRIGHTNESS
	light.Range = LIGHT_RANGE
	-- Shadows off: a point light inside a stone box casts hard voxel shadows
	-- onto the arch it is sitting in, which reads as banding rather than depth,
	-- and costs a caster for something nobody is looking at.
	light.Shadows = false
	light.Parent = centre

	HearthFire.lit = lit
	HearthFire.light = light
end

--- Breathe. Called from the render loop.
---
--- A Fire already animates its own particles, but its BRIGHTNESS is constant,
--- so the room it lights stays perfectly still and the effect reads as a
--- texture rather than a flame. Two detuned sines beat at a period nobody can
--- count, which is what stops it looking like a pulsing lamp.
function HearthFire.tick(t: number)
	local light = HearthFire.light
	if light == nil then
		return
	end
	local flicker = math.sin(t * 5.3) * 0.5 + math.sin(t * 8.9) * 0.3
	light.Brightness = LIGHT_BRIGHTNESS + flicker * FLICKER
end

return HearthFire
