-- CAN EVERY STATION ACTUALLY GLOW?
--
-- A station with no model in the place has nothing for a Highlight to adorn,
-- and the failure is completely silent: planGrab is right, findFocus is right,
-- the verb is right, and nothing lights up. It was reported from play three
-- separate times before the cause was found, because every headless check in
-- the repo was looking at the SIM and the gap was between the sim's 23
-- stations and the asset's 20 models.
--
-- This is the check that closes it: resolve every station the sim builds
-- against the geometry kitchen.rbxm actually ships, using the same two rules
-- the client uses (Stations/{Kind}_{x}_{y}, then the bench standing over the
-- cell). Nothing here needs Studio.
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")
local Vector3 = roblox.Vector3
local shared = require("../out/shared-bundle")

local SCALE = 5
local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

local kitchen = roblox.deserializeModel(fs.readFile("assets/kitchen.rbxm"))[1]
local stationsFolder = kitchen:FindFirstChild("Stations")
local benches = kitchen:FindFirstChild("Benches")
check(stationsFolder ~= nil, "the kitchen ships a Stations folder")
check(benches ~= nil, "and a Benches folder")

--- Lune reads properties strictly and some parts in the asset store only a
--- CFrame, so a bare `.Position` throws here where it would be fine in Roblox.
local function posSize(part: any): (any?, any?)
	local okP, cf = pcall(function()
		return part.CFrame
	end)
	local okS, sz = pcall(function()
		return part.Size
	end)
	if not okP or not okS then
		return nil, nil
	end
	return cf.Position, sz
end

--- The client's rule, in the same order.
local function resolve(st: any): (string?, string?)
	local cap = st.kind:sub(1, 1):upper() .. st.kind:sub(2)
	local direct = stationsFolder and stationsFolder:FindFirstChild(`{cap}_{st.cell.x}_{st.cell.y}`)
	if direct ~= nil then
		return "station", direct.Name
	end
	if benches == nil then
		return nil, nil
	end
	local exact = benches:FindFirstChild(`Bench_{st.cell.x}_{st.cell.y}`)
	if exact ~= nil then
		return "bench", exact.Name
	end
	local wx, wz = (st.cell.x + 0.5) * SCALE, (st.cell.y + 0.5) * SCALE
	for _, bench in benches:GetChildren() do
		for _, part in bench:GetDescendants() do
			if part:IsA("BasePart") then
				local p, sz = posSize(part)
				if p ~= nil and math.abs(p.X - wx) <= sz.X / 2 + 0.1 and math.abs(p.Z - wz) <= sz.Z / 2 + 0.1 and p.Y > 0.6 then
					return "bench", bench.Name
				end
			end
		end
	end
	return nil, nil
end

local sim = shared.createSim({ seed = 1 })
local direct, viaBench, orphan = 0, 0, {}
for _, st in sim.kitchen.stations do
	local how, name = resolve(st)
	if how == "station" then
		direct += 1
	elseif how == "bench" then
		viaBench += 1
		print(`  note {st.kind}_{st.cell.x}_{st.cell.y} has no Stations model — adorning {name}`)
	else
		table.insert(orphan, `{st.kind}_{st.cell.x}_{st.cell.y}`)
	end
end

print(`  {#sim.kitchen.stations} stations: {direct} with their own model, {viaBench} via a bench, {#orphan} with nothing`)
check(#orphan == 0, `every station resolves to something a Highlight can adorn{if #orphan > 0 then ` (orphans: {table.concat(orphan, ", ")})` else ""}`)

-- A BENCH IS THREE CELLS WIDE; A HIGHLIGHT MUST NOT BE.
--
-- The client clips the bench's extent to the station's own cell and adorns that
-- box. Assert the clip really does land inside one cell, because adorning the
-- whole bench is what lit up the entire worktop in the playtest.
local SCALE_C = 5
for _, st in sim.kitchen.stations do
	local how, name = resolve(st)
	if how ~= "bench" then
		continue
	end
	local bench = benches:FindFirstChild(name)
	local lo, hi
	for _, part in bench:GetDescendants() do
		if part:IsA("BasePart") then
			local p, sz = posSize(part)
			if p ~= nil then
				local a, b = p - sz / 2, p + sz / 2
				lo = if lo == nil then a else Vector3.new(math.min(lo.X, a.X), math.min(lo.Y, a.Y), math.min(lo.Z, a.Z))
				hi = if hi == nil then b else Vector3.new(math.max(hi.X, b.X), math.max(hi.Y, b.Y), math.max(hi.Z, b.Z))
			end
		end
	end
	local x0 = math.max(lo.X, st.cell.x * SCALE_C)
	local x1 = math.min(hi.X, (st.cell.x + 1) * SCALE_C)
	local z0 = math.max(lo.Z, st.cell.y * SCALE_C)
	local z1 = math.min(hi.Z, (st.cell.y + 1) * SCALE_C)
	local w, d = x1 - x0, z1 - z0
	check(
		w > 0.5 and w <= SCALE_C + 0.01 and d > 0.5 and d <= SCALE_C + 0.01,
		`{st.kind}_{st.cell.x}_{st.cell.y} clips to one cell ({string.format("%.1f", w)} x {string.format("%.1f", d)} studs, cell is {SCALE_C})`
	)
	-- and the raw bench really is wider than that, or the clip proves nothing
	check(hi.X - lo.X > SCALE_C + 0.01 or hi.Z - lo.Z > SCALE_C + 0.01,
		`  (and {name} really does span more than one cell: {string.format("%.1f", hi.X - lo.X)} x {string.format("%.1f", hi.Z - lo.Z)})`)
end

-- The bench fallback must not silently grab something on the far side of the
-- kitchen: whatever it picks has to actually stand over the station's cell.
for _, st in sim.kitchen.stations do
	local how, name = resolve(st)
	if how ~= "bench" then
		continue
	end
	local bench = benches:FindFirstChild(name)
	local wx, wz = (st.cell.x + 0.5) * SCALE, (st.cell.y + 0.5) * SCALE
	local covers = false
	for _, part in bench:GetDescendants() do
		if part:IsA("BasePart") then
			local p, sz = posSize(part)
			if p ~= nil and math.abs(p.X - wx) <= sz.X / 2 + 0.1 and math.abs(p.Z - wz) <= sz.Z / 2 + 0.1 then
				covers = true
				break
			end
		end
	end
	check(covers, `{name} really does stand over {st.kind}_{st.cell.x}_{st.cell.y}`)
end

print("")
print(if failures > 0 then `{failures} FAILURES` else "PASS: adornee")
