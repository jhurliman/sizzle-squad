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
--- A stack of dirty crockery at the wash-up.
---
--- Dirty plates are a COUNT in the sim, not objects on benches, so this is the
--- only place the player ever sees them. Without it the plate economy is
--- invisible -- reported from play as "I had no clue there were dirty plates
--- and washing in this game."
function StationVisuals:updateDishPile(stations: { [number]: any }, count: number)
	-- The wash-up at the pass (the back-wall sink) owns the pile; that is the
	-- one nearest where plates actually come back.
	if self.pileId == nil then
		local best
		for id, st in stations do
			if st.kind == "sink" and (best == nil or st.cell.y < best.cell.y) then
				best, self.pileId = st, id
			end
		end
	end
	local st = self.pileId ~= nil and stations[self.pileId] or nil
	if st == nil then
		return
	end
	local shown = math.min(count, 6)
	if self.pileShown == shown then
		return
	end
	self.pileShown = shown
	if self.pile ~= nil then
		self.pile:Destroy()
		self.pile = nil
	end
	if shown <= 0 then
		return
	end
	local base = topOf(st.kind, st.cell)
	local holder = Instance.new("Model")
	holder.Name = "DishPile"
	for i = 1, shown do
		local plate = Instance.new("Part")
		plate.Shape = Enum.PartType.Cylinder
		plate.Size = Vector3.new(0.16, 1.7, 1.7)
		-- Grimy, not just "slightly darker": the captured dirty-plate mesh is
		-- only ~9% off clean, which reads as nothing at all.
		plate.Color = Color3.fromRGB(150, 140, 116)
		plate.Anchored = true
		plate.CanCollide = false
		plate.CFrame = CFrame.new(base + Vector3.new((i % 2) * 0.12 - 0.06, (i - 1) * 0.2, (i % 3) * 0.1 - 0.1))
			* CFrame.Angles(0, math.rad(i * 24), math.rad(90))
		plate.Parent = holder
	end
	holder.Parent = self.parent
	self.pile = holder
end

function StationVisuals:update(stations: { [number]: any }, models: { [number]: Model })
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
