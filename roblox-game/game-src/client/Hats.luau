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

local BUILDERS: { [string]: (Model) -> () } = {
	hat_paper = function(m)
		-- Folded paper cook's hat, earned-asset grade: creased band, ring of
		-- alternating pleat columns, puffed dome, jaunty roll.
		local tilt = CFrame.Angles(math.rad(4), 0, math.rad(6))
		local base = tilt
		-- band with crease line
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 1.42, 1.42), Color = WHITE, CFrame = base * CFrame.new(0, 0.18, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.07, 1.46, 1.46), Color = Color3.fromRGB(226, 219, 203), CFrame = base * CFrame.new(0, 0.38, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		-- pleated crown: alternating light/shadow columns around the rim
		for i = 0, 9 do
			local a = (i / 10) * math.pi * 2
			local shade = if i % 2 == 0 then WHITE else Color3.fromRGB(233, 227, 213)
			part({
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.68, 0.30, 0.30),
				Color = shade,
				CFrame = base * CFrame.new(math.cos(a) * 0.56, 0.72, math.sin(a) * 0.56) * CFrame.Angles(0, 0, math.rad(90)),
			}, m)
		end
		-- puffed dome with a soft overhang past the pleats
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.5, 0.78, 1.5), Color = WHITE, CFrame = base * CFrame.new(0, 1.02, 0) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.1, 0.55, 1.1), Color = Color3.fromRGB(250, 246, 238), CFrame = base * CFrame.new(0.1, 1.22, 0.05) }, m)
	end,
	hat_toque = function(m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.9, 1.3, 1.3), Color = WHITE, CFrame = CFrame.new(0, 0.45, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.5, 0.9, 1.5), Color = WHITE, CFrame = CFrame.new(0, 1.05, 0) }, m)
	end,
	hat_bandana_red = function(m)
		part({ Size = Vector3.new(1.6, 0.35, 1.6), Color = Color3.fromRGB(204, 60, 50), CFrame = CFrame.new(0, 0.1, 0) }, m)
		part({ Size = Vector3.new(0.4, 0.5, 0.25), Color = Color3.fromRGB(178, 46, 38), CFrame = CFrame.new(0.55, -0.15, -0.6) * CFrame.Angles(math.rad(25), 0, 0) }, m)
	end,
	hat_bandana_green = function(m)
		part({ Size = Vector3.new(1.6, 0.35, 1.6), Color = Color3.fromRGB(84, 160, 60), CFrame = CFrame.new(0, 0.1, 0) }, m)
		part({ Size = Vector3.new(0.4, 0.5, 0.25), Color = Color3.fromRGB(66, 130, 46), CFrame = CFrame.new(0.55, -0.15, -0.6) * CFrame.Angles(math.rad(25), 0, 0) }, m)
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
		part({ Shape = Enum.PartType.Ball, Size = Vector3.new(1.7, 1.0, 1.7), Color = Color3.fromRGB(160, 165, 172), Material = Enum.Material.Metal, CFrame = CFrame.new(0, 0.3, 0) }, m)
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.12, 0.5, 0.5), Color = Color3.fromRGB(140, 145, 152), Material = Enum.Material.Metal, CFrame = CFrame.new(0.95, 0.25, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
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
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.12, 1.5, 1.5), Color = Color3.fromRGB(255, 226, 120), Material = Enum.Material.Neon, CFrame = CFrame.new(0, 0.8, 0) * CFrame.Angles(0, 0, math.rad(90)) }, m)
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
