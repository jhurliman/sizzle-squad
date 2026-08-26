-- Emits client/SurfaceH.luau: where an item RESTS on every station -- height,
-- plus a nudge within the bench plane -- measured from the captured kitchen.
--
-- StationVisuals used one hand-tuned height per station KIND. Bounding boxes
-- were rejected for good reason (station models carry tall dressing -- plate
-- stacks, the serve counters' Toad -- which floats items a whole counter too
-- high), but a flat per-kind table is wrong in the other direction: the floor
-- benches top out at 0.37-0.45 cells while `counter` assumed 0.55, so a plate
-- put down on one hovered ~0.9 studs in the air.
--
-- The in-plane nudge exists because bench dressing parks props in the BACK
-- corner, so an item at dead centre lands inside the stockpot. And it is
-- CLAMPED to the surface it sits on, because some stations sit at the very end
-- of their bench -- the counter at (13,7) is 0.05 cells from the end of a
-- bench that spans 10.45 to 13.55 -- where any forward nudge pushes the item
-- clean off the furniture.
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local SCALE = 5
-- Forward of centre, and how much room an item needs to its own edge.
local FORWARD = 0.2
local ITEM_HALF = 0.2

local root = roblox.deserializeModel(fs.readFile("assets/kitchen.rbxm"))[1]

type Surface = { top: number, minX: number, maxX: number, minZ: number, maxZ: number }

local function boundsOf(parts: { BasePart }): Surface?
	if #parts == 0 then
		return nil
	end
	local top = -math.huge
	local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
	for _, p in parts do
		local pos, size = p.CFrame.Position, p.Size
		top = math.max(top, (pos.Y + size.Y / 2) / SCALE)
		minX = math.min(minX, (pos.X - size.X / 2) / SCALE)
		maxX = math.max(maxX, (pos.X + size.X / 2) / SCALE)
		minZ = math.min(minZ, (pos.Z - size.Z / 2) / SCALE)
		maxZ = math.max(maxZ, (pos.Z + size.Z / 2) / SCALE)
	end
	return { top = top, minX = minX, maxX = maxX, minZ = minZ, maxZ = maxZ }
end

--- The part an item actually rests on.
---
--- Widest alone is not enough: a chopping board's slab sits on a bench whose
--- top is wider, so widest-wins measures the bench and buries the item inside
--- the board. Highest alone is not enough either -- that is what picks the
--- Toad off a serve counter. Highest among the wide ones is both.
local function surfacePartOf(m: Instance): BasePart?
	local flat, maxArea = {}, 0
	for _, p in m:GetDescendants() do
		if not p:IsA("BasePart") then
			continue
		end
		local size = p.Size
		-- Skip anything taller than it is wide: legs, faucets, chimneys.
		if size.Y > math.min(size.X, size.Z) * 1.6 then
			continue
		end
		local top = (p.CFrame.Position.Y + size.Y / 2) / SCALE
		if top <= 0.15 or top >= 1.4 then
			continue
		end
		local area = size.X * size.Z
		maxArea = math.max(maxArea, area)
		table.insert(flat, { area = area, top = top, part = p })
	end
	local best = nil
	for _, f in flat do
		if f.area >= maxArea * 0.35 and (best == nil or f.top > best.top) then
			best = f
		end
	end
	return if best ~= nil then best.part else nil
end

local byCell: { [string]: { h: number, dx: number, dz: number } } = {}
for _, group in root:GetChildren() do
	if group.Name ~= "Stations" and group.Name ~= "Benches" then
		continue
	end
	for _, m in group:GetChildren() do
		local _kind, cxs, cys = m.Name:match("^(%a+)_(%d+)_(%d+)$")
		if cxs == nil then
			continue
		end
		local surf: Surface?
		if group.Name == "Benches" then
			-- Benches carry no dressing in the capture, so their whole top IS
			-- the work surface. Used for the floor counters, which have no
			-- Station model of their own.
			local parts = {}
			for _, p in m:GetDescendants() do
				if p:IsA("BasePart") then
					table.insert(parts, p)
				end
			end
			surf = boundsOf(parts)
		else
			local part = surfacePartOf(m)
			surf = if part ~= nil then boundsOf({ part }) else nil
		end
		if surf == nil then
			continue
		end
		--- Place an item on `surf` for one cell, clamped to stay on it.
		local function anchor(key: string, ccx: number, ccz: number)
			local x, z = ccx, ccz + FORWARD
			-- Clamp inside the surface, unless it is too small to clamp within
			-- -- then centre on it and accept the overhang, which is still
			-- better than sitting off the end.
			if surf.maxX - surf.minX > ITEM_HALF * 2 then
				x = math.clamp(x, surf.minX + ITEM_HALF, surf.maxX - ITEM_HALF)
			else
				x = (surf.minX + surf.maxX) / 2
			end
			if surf.maxZ - surf.minZ > ITEM_HALF * 2 then
				z = math.clamp(z, surf.minZ + ITEM_HALF, surf.maxZ - ITEM_HALF)
			else
				z = (surf.minZ + surf.maxZ) / 2
			end
			byCell[key] = { h = surf.top, dx = x - ccx, dz = z - ccz }
		end

		if group.Name == "Benches" then
			-- A BENCH COVERS SEVERAL CELLS AND IS NAMED AFTER ONLY ONE.
			--
			-- Floor counters get no Station model of their own, so they rely on
			-- the bench underneath -- and registering just the bench's name
			-- cell left every OTHER cell it spans with no anchor at all,
			-- falling back to the per-kind guess. That is why the counter at
			-- (13,7) floated and hung off: its bench is named 12_7, and 13,7
			-- was simply missing.
			for cx = math.floor(surf.minX), math.floor(surf.maxX) do
				for cz = math.floor(surf.minZ), math.floor(surf.maxZ) do
					local ccx, ccz = cx + 0.5, cz + 0.5
					if ccx > surf.minX and ccx < surf.maxX and ccz > surf.minZ and ccz < surf.maxZ then
						local key = `{cx},{cz}`
						if byCell[key] == nil then
							anchor(key, ccx, ccz)
						end
					end
				end
			end
		else
			anchor(`{cxs},{cys}`, tonumber(cxs) + 0.5, tonumber(cys) + 0.5)
		end
	end
end

local keys = {}
for k in byCell do
	table.insert(keys, k)
end
table.sort(keys)

local out = {
	"--!strict",
	"-- GENERATED by tools/gen-surfaces.luau -- do not edit by hand.",
	"--",
	"-- Per station cell: `h` is the work-surface height in sim units, and",
	"-- `dx`/`dz` nudge a resting item off the bench dressing WITHOUT letting it",
	"-- overhang the furniture. Regenerate after any change to the capture.",
	"",
	"return {",
}
for _, k in keys do
	local v = byCell[k]
	table.insert(out, string.format("\t[\"%s\"] = { h = %.3f, dx = %.3f, dz = %.3f },", k, v.h, v.dx, v.dz))
end
table.insert(out, "}")
fs.writeFile("game-src/client/SurfaceH.luau", table.concat(out, "\n") .. "\n")
print(`wrote {#keys} station anchors`)
for _, k in keys do
	local v = byCell[k]
	print(string.format("  %-7s h %.2f  dx %+.2f  dz %+.2f", k, v.h, v.dx, v.dz))
end
