--!strict
-- Item visuals: builds a small Model for any Carryable summary (ingredient/
-- plate/pan) so held items and station contents actually read as food, not
-- colored cubes. Models are cached by key and repositioned externally.

local ItemViz = {}

local SCALE = 5

local KIND_COLORS: { [string]: Color3 } = {
	tomato = Color3.fromRGB(230, 28, 10),
	lettuce = Color3.fromRGB(111, 209, 18),
	bacon = Color3.fromRGB(196, 92, 62),
	bun = Color3.fromRGB(216, 143, 63),
	onion = Color3.fromRGB(154, 111, 168),
	cheese = Color3.fromRGB(224, 184, 45),
}

local function stateColor(kind: string, state: string): Color3
	local base = KIND_COLORS[kind] or Color3.fromRGB(150, 150, 150)
	if state == "cooked" then
		return base:Lerp(Color3.fromRGB(120, 70, 30), 0.45)
	elseif state == "burnt" then
		return Color3.fromRGB(38, 30, 24)
	end
	return base
end

local function part(props: { [string]: any }, parent: Instance): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

--- Stable identity for a summary, so callers rebuild only on change.
function ItemViz.key(summary: any): string
	if summary == nil then
		return "-"
	end
	if summary.type == "ingredient" then
		return `i:{summary.kind}:{summary.state}`
	elseif summary.type == "plate" then
		local k = `p:{if summary.dirty then "d" else "c"}`
		for _, c in summary.contents do
			k ..= `:{c.kind}.{c.state}`
		end
		return k
	elseif summary.type == "pan" then
		local k = "n"
		for _, c in summary.contents do
			k ..= `:{c.kind}.{c.state}`
		end
		return k
	end
	return "?"
end

--- One ingredient's look: raw = whole ball; prepped = two chopped halves;
--- cooked/burnt = recolored. `s` scales the whole item.
local function ingredientParts(parent: Instance, kind: string, state: string, s: number)
	local color = stateColor(kind, state)
	if state == "prepped" or state == "cooked" or state == "burnt" then
		for i = -1, 1, 2 do
			part({
				Shape = Enum.PartType.Ball,
				Size = Vector3.new(0.42, 0.3, 0.42) * s,
				Color = color,
				CFrame = CFrame.new(i * 0.14 * s, 0, 0),
				Name = "Piece",
			}, parent)
		end
	else
		part({
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * 0.5 * s,
			Color = color,
			CFrame = CFrame.new(),
			Name = "Whole",
		}, parent)
	end
end

--- Build a fresh model for the summary (positioned by the caller via PivotTo).
function ItemViz.build(summary: any): Model?
	if summary == nil then
		return nil
	end
	local model = Instance.new("Model")
	model.Name = "Item"
	local root = part({
		Transparency = 1,
		Size = Vector3.one * 0.2,
		CFrame = CFrame.new(),
		Name = "Root",
	}, model)
	model.PrimaryPart = root

	if summary.type == "ingredient" then
		ingredientParts(model, summary.kind, summary.state, SCALE * 0.55)
	elseif summary.type == "plate" then
		local plate = part({
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(0.14, 1.9, 1.9),
			Color = if summary.dirty then Color3.fromRGB(150, 135, 110) else Color3.fromRGB(238, 231, 214),
			CFrame = CFrame.Angles(0, 0, math.rad(90)),
			Name = "Plate",
		}, model)
		if summary.dirty then
			part({
				Shape = Enum.PartType.Ball,
				Size = Vector3.new(0.7, 0.12, 0.7),
				Color = Color3.fromRGB(110, 95, 70),
				CFrame = CFrame.new(0.2, 0.1, 0.15),
				Name = "Grime",
			}, model)
		end
		for i, c in summary.contents or {} do
			local holder = Instance.new("Model")
			holder.Name = `Content{i}`
			holder.Parent = model
			ingredientParts(holder, c.kind, c.state, SCALE * 0.42)
			holder:PivotTo(CFrame.new(((i - 1) % 2 - 0.5) * 0.5, 0.28 + math.floor((i - 1) / 2) * 0.45, 0))
		end
	elseif summary.type == "pan" then
		part({
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(0.3, 1.7, 1.7),
			Color = Color3.fromRGB(52, 50, 56),
			CFrame = CFrame.Angles(0, 0, math.rad(90)),
			Name = "Pan",
		}, model)
		for i, c in summary.contents or {} do
			local holder = Instance.new("Model")
			holder.Name = `Content{i}`
			holder.Parent = model
			ingredientParts(holder, c.kind, c.state, SCALE * 0.4)
			holder:PivotTo(CFrame.new(((i - 1) % 2 - 0.5) * 0.45, 0.3, (math.floor((i - 1) / 2) - 0.5) * 0.4))
		end
	end
	return model
end

return ItemViz
