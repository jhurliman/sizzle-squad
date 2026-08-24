--!strict
-- Procedural hat models for the cosmetics catalog — simple part builds,
-- attached to the rig's head by ChefVisuals. Every builder returns a Model
-- whose origin sits at the head-top attach point, +Z facing forward.

local Hats = {}

local function part(props: { [string]: any }, parent: Instance): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CastShadow = true
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local WHITE = Color3.fromRGB(245, 240, 230)

-- A tied headscarf: cloth dome over the crown, a rolled brow band, a knot at
-- the back and two trailing tails. `light`/`dark` are the two cloth shades.
local function bandana(m: Model, light: Color3, dark: Color3)
	-- cloth over the skull crown
	part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.62, 0.9, 1.62), Color = light, CFrame = CFrame.new(0, 0.12, 0) }, m)
	-- rolled brow band (a squashed torus-ish ring, faked as a fat flat ring)
	part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.28, 1.66, 1.66), Color = dark, CFrame = CFrame.new(0, -0.08, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
	-- knot at the back
	part({ Shape = Enum.PartType.Ball, Size = Vector3.new(0.42, 0.42, 0.42), Color = dark, CFrame = CFrame.new(0, 0.02, -0.82) }, m)
	-- two trailing tails
	for _, side in { -1, 1 } do
		part({
			Size = Vector3.new(0.16, 0.5, 0.14),
			Color = light,
			CFrame = CFrame.new(0.14 * side, -0.12, -0.9) * CFrame.Angles(math.rad(28), math.rad(10 * side), 0),
		}, m)
	end
end

local BUILDERS: { [string]: (Model) -> () } = {
	hat_paper = function(m)
		-- Folded paper cook's toque: a headband, a SHORT pleated crown drum
		-- (pleats are shallow ribs half-buried in the drum, not free-standing
		-- pillars), and a big overhanging puff that dominates the silhouette.
		local cream = WHITE
		local shade = Color3.fromRGB(228, 221, 206)
		local base = CFrame.Angles(math.rad(3), 0, math.rad(5))
		-- headband + crease
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.34, 1.46, 1.46), Color = cream, CFrame = base * CFrame.new(0, 0.16, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.06, 1.5, 1.5), Color = shade, CFrame = base * CFrame.new(0, 0.33, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		-- solid flared crown drum the ribs live on
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.46, 1.3, 1.3), Color = cream, CFrame = base * CFrame.new(0, 0.5, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		-- shallow vertical rib lines, embedded in the drum surface (fold lines,
		-- not pillars)
		for i = 0, 11 do
			local a = (i / 12) * math.pi * 2
			part({
				Size = Vector3.new(0.05, 0.44, 0.1),
				Color = shade,
				CFrame = base * CFrame.new(math.cos(a) * 0.64, 0.5, math.sin(a) * 0.64) * CFrame.Angles(0, -a, 0),
			}, m)
		end
		-- the big overhanging puff (dominant crown) + a soft pinch on top
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.74, 1.02, 1.74), Color = cream, CFrame = base * CFrame.new(0, 0.94, 0) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(0.8, 0.4, 0.8), Color = cream, CFrame = base * CFrame.new(0, 1.36, 0) }, m)
	end,
	hat_toque = function(m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.9, 1.3, 1.3), Color = WHITE, CFrame = CFrame.new(0, 0.45, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.5, 0.9, 1.5), Color = WHITE, CFrame = CFrame.new(0, 1.05, 0) }, m)
	end,
	hat_bandana_red = function(m)
		bandana(m, Color3.fromRGB(204, 60, 50), Color3.fromRGB(168, 42, 34))
	end,
	hat_bandana_green = function(m)
		bandana(m, Color3.fromRGB(84, 160, 60), Color3.fromRGB(60, 122, 42))
	end,
	hat_beret = function(m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.7, 0.5, 1.7), Color = Color3.fromRGB(60, 60, 130), CFrame = CFrame.new(0.15, 0.2, 0) * CFrame.Angles(0, 0, math.rad(-8)) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(0.2, 0.25, 0.2), Color = Color3.fromRGB(45, 45, 100), CFrame = CFrame.new(0.15, 0.5, 0) }, m)
	end,
	hat_paperboat = function(m)
		part({ Size = Vector3.new(1.7, 0.45, 0.85), Color = WHITE, CFrame = CFrame.new(0, 0.25, 0) }, m)
		part({ Size = Vector3.new(1.1, 0.4, 0.12), Color = Color3.fromRGB(232, 226, 212), CFrame = CFrame.new(0, 0.6, 0) }, m)
	end,
	hat_colander = function(m)
		local steel = Color3.fromRGB(170, 174, 180)
		local dark = Color3.fromRGB(70, 72, 78)
		-- the inverted bowl
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.72, 1.06, 1.72), Color = steel, Material = Enum.Material.Metal, CFrame = CFrame.new(0, 0.2, 0) }, m)
		-- rolled rim
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.14, 1.78, 1.78), Color = steel, Material = Enum.Material.Metal, CFrame = CFrame.new(0, 0.02, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		-- drainage holes: two concentric rings of dark pits punched into the dome
		for _, ring in { { r = 0.62, y = 0.42, n = 10, tilt = 0.5 }, { r = 0.32, y = 0.6, n = 6, tilt = 0.9 } } do
			for i = 0, ring.n - 1 do
				local a = (i / ring.n) * math.pi * 2
				part({
					Shape = Enum.PartType.Cylinder,
					Size = Vector3.new(0.12, 0.16, 0.16),
					Color = dark,
					Material = Enum.Material.Metal,
					CFrame = CFrame.new(math.cos(a) * ring.r, ring.y, math.sin(a) * ring.r)
						* CFrame.Angles(ring.tilt * math.cos(a), 0, -ring.tilt * math.sin(a))
						* CFrame.Angles(0, 0, math.rad(90)),
				}, m)
			end
		end
		-- one loop handle, attached at the rim (not floating)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 0.36, 0.36), Color = dark, Material = Enum.Material.Metal, CFrame = CFrame.new(0.9, 0.06, 0) * CFrame.Angles(0, math.rad(90), 0) }, m)
	end,
	hat_tophat = function(m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.18, 1.9, 1.9), Color = Color3.fromRGB(35, 32, 30), CFrame = CFrame.new(0, 0.09, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.4, 1.15, 1.15), Color = Color3.fromRGB(35, 32, 30), CFrame = CFrame.new(0, 0.85, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 1.2, 1.2), Color = Color3.fromRGB(140, 30, 30), CFrame = CFrame.new(0, 0.3, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
	end,
	hat_crown = function(m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.55, 1.35, 1.35), Color = Color3.fromRGB(235, 190, 60), Material = Enum.Material.Metal, CFrame = CFrame.new(0, 0.28, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		for i = 0, 3 do
			local a = (i / 4) * math.pi * 2
			part({ Size = Vector3.new(0.22, 0.5, 0.22), Color = Color3.fromRGB(235, 190, 60), Material = Enum.Material.Metal, CFrame = CFrame.new(math.cos(a) * 0.6, 0.75, math.sin(a) * 0.6) }, m)
		end
	end,
	hat_pan = function(m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.25, 1.6, 1.6), Color = Color3.fromRGB(70, 70, 76), Material = Enum.Material.Metal, CFrame = CFrame.new(0, 0.15, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(0.35, 0.35, 0.35), Color = Color3.fromRGB(50, 50, 56), CFrame = CFrame.new(0, 0.45, 0) }, m)
	end,
	hat_mushroom = function(m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.9, 1.1, 1.9), Color = Color3.fromRGB(210, 70, 60), CFrame = CFrame.new(0, 0.45, 0) }, m)
		for _, o in { Vector3.new(0.5, 0.65, 0.3), Vector3.new(-0.4, 0.7, -0.2), Vector3.new(0.1, 0.5, -0.55) } do
			part({ Shape = Enum.PartType.Ball, Size = Vector3.new(0.35, 0.25, 0.35), Color = WHITE, CFrame = CFrame.new(o) }, m)
		end
	end,
	hat_halo = function(m)
		-- a real RING with a hole: a torus faked from segments around a circle,
		-- floating flat above the head (Roblox has no torus primitive)
		local gold = Color3.fromRGB(255, 226, 120)
		-- overlapping spheres around a horizontal circle: a smooth ring with a
		-- clear hole, no harsh flat cylinder end-caps (Roblox has no torus)
		local R, tube, N = 0.72, 0.19, 42
		for i = 0, N - 1 do
			local a = (i / N) * math.pi * 2
			part({
				Shape = Enum.PartType.Ball,
				Size = Vector3.new(tube, tube * 0.85, tube),
				Color = gold,
				Material = Enum.Material.Neon,
				CFrame = CFrame.new(math.cos(a) * R, 0.9, math.sin(a) * R),
			}, m)
		end
	end,
}

--- Build the hat model for a catalog id, or nil for unknown/none.
function Hats.build(hatId: string?): Model?
	if hatId == nil then
		return nil
	end
	local builder = BUILDERS[hatId]
	if builder == nil then
		return nil
	end
	local m = Instance.new("Model")
	m.Name = hatId
	local root = part({ Transparency = 1, Size = Vector3.one * 0.2, CFrame = CFrame.new(), Name = "Root" }, m)
	m.PrimaryPart = root
	builder(m)
	return m
end

return Hats
