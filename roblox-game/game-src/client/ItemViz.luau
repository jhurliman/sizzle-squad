--!strict
-- Item visuals: builds a small Model for any Carryable summary (ingredient/
-- plate/pan) so held items and station contents actually read as food, not
-- colored cubes. Models are cached by key and repositioned externally.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ItemViz = {}

local SCALE = 5

-- Captured item art from the web game (roblox/capture-items.mjs). When a
-- template exists it's cloned; the primitive-sphere path below is the
-- fallback for anything uncaptured.
local templatesFolder: Instance? = ReplicatedStorage:FindFirstChild("Items")

local function cloneTemplate(name: string): Model?
	if templatesFolder == nil then
		return nil
	end
	local t = templatesFolder:FindFirstChild(name)
	if t ~= nil and t:IsA("Model") then
		return t:Clone()
	end
	return nil
end

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
-- Team-visible kitchen cosmetics. The server elects ONE item per slot across
-- the crew (see main.server electKitchen) so everyone sees the same crockery;
-- this is just the tint that election resolves to.
local kitchenTint: { [string]: Color3? } = { plate = nil, pan = nil }

-- Bumped whenever the elected crockery changes. ItemViz.key folds it in for
-- plates and pans, so callers that cache by key rebuild with the new tint
-- instead of showing the old crockery until the item happens to change.
local kitchenGen = 0

--- slot -> catalog item id (or nil). Called from the EquipDeltas handler.
function ItemViz.setKitchen(catalog: any, kitchen: { [string]: string }?)
	kitchenTint.plate = nil
	kitchenTint.pan = nil
	if kitchen == nil then
		return
	end
	for slot, id in kitchen do
		local item = catalog.byId[id]
		if item ~= nil and item.color ~= nil then
			kitchenTint[slot] = Color3.fromRGB(item.color[1], item.color[2], item.color[3])
		end
	end
	kitchenGen += 1
end

--- Lerp every BasePart in `model` toward `color`. Used only on the crockery
--- itself, never on a whole-pan composition (those bake the food in, and
--- tinting one would recolour the bacon along with the pan).
local function tint(model: Instance?, color: Color3?)
	if model == nil or color == nil then
		return
	end
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Color = d.Color:Lerp(color, 0.75)
		end
	end
	if model:IsA("BasePart") then
		model.Color = model.Color:Lerp(color, 0.75)
	end
end

function ItemViz.key(summary: any): string
	if summary == nil then
		return "-"
	end
	if summary.type == "ingredient" then
		return `i:{summary.kind}:{summary.state}`
	elseif summary.type == "plate" then
		local k = `p{kitchenGen}:{if summary.dirty then "d" else "c"}`
		for _, c in summary.contents do
			k ..= `:{c.kind}.{c.state}`
		end
		return k
	elseif summary.type == "pan" then
		local k = `n{kitchenGen}`
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

--- Assemble a template-based model for the summary, or nil if templates are
--- unavailable (caller falls through to the primitive path).
local function buildFromTemplates(summary: any): Model?
	if templatesFolder == nil then
		return nil
	end
	local wrapper = Instance.new("Model")
	wrapper.Name = "Item"
	local root = part({ Transparency = 1, Size = Vector3.one * 0.2, CFrame = CFrame.new(), Name = "Root" }, wrapper)
	wrapper.PrimaryPart = root

	local function addIngredient(kind: string, state: string, offset: CFrame): boolean
		local t = cloneTemplate(`ing_{kind}_{state}`) or cloneTemplate(`ing_{kind}_raw`)
		if t == nil then
			return false
		end
		t.Parent = wrapper
		t:PivotTo(offset)
		return true
	end

	if summary.type == "ingredient" then
		if not addIngredient(summary.kind, summary.state, CFrame.new()) then
			wrapper:Destroy()
			return nil
		end
		return wrapper
	elseif summary.type == "plate" then
		local plate = cloneTemplate(if summary.dirty then "plate_dirty" else "plate")
		if plate == nil then
			wrapper:Destroy()
			return nil
		end
		tint(plate, kitchenTint.plate)
		plate.Parent = wrapper
		plate:PivotTo(CFrame.new())
		-- Stacking measured off the web's own plate_full composition: items
		-- climb ~0.17 studs per layer from just above the plate, spread ±0.4.
		for i, c in summary.contents or {} do
			addIngredient(
				c.kind,
				c.state,
				CFrame.new(((i - 1) % 2 - 0.5) * 0.5, 0.45 + (i - 1) * 0.17, (math.floor((i - 1) / 2) - 0.5) * 0.45)
			)
		end
		return wrapper
	elseif summary.type == "pan" then
		-- Single-content pans use the web's own whole-composition capture, so
		-- the food sits exactly where the original renders it (a lone cooked
		-- rasher otherwise hides inside the pan's silhouette).
		local contents = summary.contents or {}
		if #contents == 1 then
			local whole = cloneTemplate(`pan_{contents[1].kind}_{contents[1].state}`)
			if whole ~= nil then
				whole.Parent = wrapper
				whole:PivotTo(CFrame.new())
				return wrapper
			end
		end
		local pan = cloneTemplate("pan")
		if pan == nil then
			wrapper:Destroy()
			return nil
		end
		tint(pan, kitchenTint.pan)
		pan.Parent = wrapper
		pan:PivotTo(CFrame.new())
		for i, c in contents do
			-- raised well above the rim so composed contents always read
			addIngredient(c.kind, c.state, CFrame.new(((i - 1) % 2 - 0.5) * 0.5, 0.55 + (i - 1) * 0.2, (math.floor((i - 1) / 2) - 0.5) * 0.4))
		end
		return wrapper
	end
	wrapper:Destroy()
	return nil
end

--- Build a fresh model for the summary (positioned by the caller via PivotTo).
function ItemViz.build(summary: any): Model?
	if summary == nil then
		return nil
	end
	local fromTemplates = buildFromTemplates(summary)
	if fromTemplates ~= nil then
		return fromTemplates
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
		tint(plate, kitchenTint.plate)
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
