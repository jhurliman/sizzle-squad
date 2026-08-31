--!strict
-- World-space station state: renders each station's held item (via ItemViz)
-- on top of the station model, plus a progress bar (chop/wash green, cook
-- amber shading to red as burn rises) and a persistent fire while a pan is
-- fully burnt. Data comes from the client's mirrored station table.

local StationVisuals = {}
StationVisuals.__index = StationVisuals

local ItemViz = require(script.Parent.ItemViz) :: any
-- Per-cell work-surface heights measured off the captured kitchen; see
-- tools/gen-surfaces.luau.
local SurfaceH = require(script.Parent.SurfaceH) :: { [string]: { h: number, dx: number, dz: number } }

local SCALE = 5

function StationVisuals.new(parent: Instance)
	local self = setmetatable({}, StationVisuals)
	self.parent = parent
	self.entries = {} :: { [number]: any }
	self.version = -1
	return self
end

-- Work-surface heights in sim units, from the web game's proportions
-- (COUNTER_H 0.86, TABLE_H 0.38 + plank, HEARTH_TOP 0.61). Bounding boxes
-- are useless here: station models include tall dressing (plate stacks, the
-- serve counters' Toad figures), which floated items a full counter too high.
local SURFACE_H: { [string]: number } = {
	serve = 0.92,
	plates = 0.92,
	counter = 0.92,
	stove = 0.66,
	bin = 0.78,
	crate = 0.85,
	board = 0.55,
	sink = 0.6,
}

--- Where an item rests on a station.
---
--- Anchors are GENERATED from the captured kitchen (tools/gen-surfaces.luau):
--- height, plus a nudge in the bench plane that clears the dressing props
--- parked in the back corner WITHOUT letting the item overhang the furniture.
--- Both parts have to be measured -- the per-kind fallback below read
--- `counter` as one height when floor benches top out at 0.37-0.48 and the
--- back-wall run at 0.86, and a flat forward nudge pushed items off the end of
--- benches whose far cell sits at the very edge.
local function topOf(kind: string?, cell: any): Vector3
	local a = SurfaceH[`{cell.x},{cell.y}`]
	if a ~= nil then
		return Vector3.new((cell.x + 0.5 + a.dx) * SCALE, a.h * SCALE, (cell.y + 0.5 + a.dz) * SCALE)
	end
	-- Fallback for a cell the capture knows nothing about.
	local h = SURFACE_H[kind or ""] or 0.8
	if kind == "counter" and cell.y > 1 then
		h = 0.55
	end
	return Vector3.new((cell.x + 0.5) * SCALE, h * SCALE, (cell.y + 0.5) * SCALE)
end

--- Tint the plate RACKS to match the equipped crockery.
---
--- ItemViz only ever tints the plate in your hands or on a bench, because the
--- racks are captured kitchen geometry rather than item models. That made the
--- cosmetic read as a bug: you took a white plate off a white stack and it
--- turned gold in your hands. The rack is the thing you take it FROM, so it
--- has to match.
---
--- Originals are cached on first tint so unequipping restores them.
function StationVisuals:setPlateTint(catalog: any, kitchen: { [string]: string }?)
	local id = kitchen ~= nil and kitchen.plate or nil
	local item = if id ~= nil then catalog.byId[id] else nil
	local color = if item ~= nil and item.color ~= nil
		then Color3.fromRGB(item.color[1], item.color[2], item.color[3])
		else nil
	if self.plateTintKey == tostring(id) then
		return
	end
	self.plateTintKey = tostring(id)
	self.plateTint = color
	self.plateTintDirty = true
end

--- Applied from update(), where the station models are known.
function StationVisuals:applyPlateTint(stations: { [number]: any }, models: { [number]: Model })
	if not self.plateTintDirty then
		return
	end
	self.plateTintDirty = false
	self.plateOrig = self.plateOrig or {}
	for id, st in stations do
		if st.kind ~= "plates" then
			continue
		end
		local model = models[id]
		if model == nil then
			-- Models are indexed from the first snapshot; try again next frame.
			self.plateTintDirty = true
			continue
		end
		for _, p in model:GetDescendants() do
			if not p:IsA("BasePart") then
				continue
			end
			if self.plateOrig[p] == nil then
				self.plateOrig[p] = p.Color
			end
			p.Color = if self.plateTint ~= nil
				then self.plateOrig[p]:Lerp(self.plateTint, 0.75)
				else self.plateOrig[p]
		end
	end
end

function StationVisuals:ensure(id: number, anchor: Vector3): any
	local e = self.entries[id]
	if e ~= nil then
		return e
	end
	local holder = Instance.new("Part")
	holder.Name = `Station_{id}`
	holder.Anchored = true
	holder.CanCollide = false
	holder.Transparency = 1
	holder.Size = Vector3.one * 0.2
	holder.CFrame = CFrame.new(anchor)
	holder.Parent = self.parent
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(56, 8)
	bb.StudsOffset = Vector3.new(0, 2.4, 0)
	bb.AlwaysOnTop = true
	bb.Enabled = false
	bb.Parent = holder
	local track = Instance.new("Frame")
	track.Size = UDim2.fromScale(1, 1)
	track.BackgroundColor3 = Color3.fromRGB(40, 24, 12)
	track.BorderSizePixel = 0
	track.Parent = bb
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = track
	local fill = Instance.new("Frame")
	fill.Size = UDim2.fromScale(0, 1)
	fill.BackgroundColor3 = Color3.fromRGB(120, 200, 80)
	fill.BorderSizePixel = 0
	fill.Parent = track
	local fillCorner = Instance.new("UICorner")
	fillCorner.CornerRadius = UDim.new(0, 4)
	fillCorner.Parent = fill
	e = { holder = holder, bb = bb, fill = fill, itemKey = "-", item = nil, fire = nil, anchor = anchor }
	self.entries[id] = e
	return e
end

--- stations: the mirrored station table; models: station id -> kitchen Model
--- The model of whatever is SITTING ON a station right now, or nil.
---
--- The focus highlight prefers this over the bench: a plate on a counter is
--- what the button is about to act on, and outlining the furniture underneath
--- it says the wrong thing (and, on a bench that runs three cells, says it
--- across the whole worktop).
function StationVisuals:itemModel(id: number): Model?
	local e = self.entries and self.entries[id]
	return e ~= nil and e.item or nil
end

function StationVisuals:update(stations: { [number]: any }, models: { [number]: Model })
	self:applyPlateTint(stations, models)
	for id, st in stations do
		local anchor = topOf(st.kind, st.cell or { x = 7, y = 5 })
		local e = self:ensure(id, anchor)

		-- held item
		local key = ItemViz.key(st.holding)
		if key ~= e.itemKey then
			e.itemKey = key
			if e.item ~= nil then
				e.item:Destroy()
				e.item = nil
			end
			local model = ItemViz.build(st.holding)
			if model ~= nil then
				model.Parent = e.holder
				model:PivotTo(CFrame.new(e.anchor + Vector3.new(0, 0.35, 0)))
			end
			e.item = model
		end

		-- progress bar: prefer cook (with burn shading), else work
		local cook = st.cook or 0
		local work = st.work or 0
		local burn = st.burn or 0
		local value = 0
		local color = Color3.fromRGB(120, 200, 80)
		if cook > 0.01 then
			value = cook
			color = Color3.fromRGB(240, 170, 60):Lerp(Color3.fromRGB(230, 60, 40), math.clamp(burn, 0, 1))
		elseif burn > 0.01 then
			value = burn
			color = Color3.fromRGB(230, 60, 40)
		elseif work > 0.01 then
			value = work
		end
		if value > 0.01 and value < 0.995 then
			e.bb.Enabled = true
			e.fill.Size = UDim2.fromScale(math.clamp(value, 0, 1), 1)
			e.fill.BackgroundColor3 = color
		else
			e.bb.Enabled = false
		end

		-- fire while fully burnt
		if burn >= 0.99 and st.holding ~= nil and st.holding.type == "pan" then
			if e.fire == nil then
				local fire = Instance.new("Fire")
				fire.Size = 5
				fire.Heat = 9
				fire.Parent = e.holder
				e.fire = fire
			end
		elseif e.fire ~= nil then
			e.fire:Destroy()
			e.fire = nil
		end
	end
end

return StationVisuals
