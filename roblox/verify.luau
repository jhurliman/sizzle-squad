-- Re-opens sizzle-squad.rbxl and prints a structural audit.
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local game = roblox.deserializePlace(fs.readFile("sizzle-squad.rbxl"))
local workspace = game:GetService("Workspace")
local root = workspace:FindFirstChild("SizzleSquadKitchen")
assert(root, "SizzleSquadKitchen missing")

local function partsUnder(inst): number
	local n = 0
	for _, d in inst:GetDescendants() do
		if d:IsA("BasePart") then
			n += 1
		end
	end
	return n
end

print("=== tree ===")
for _, child in root:GetChildren() do
	local line = child.ClassName .. "  " .. child.Name .. "  parts=" .. partsUnder(child)
	local subs = {}
	for _, sub in child:GetChildren() do
		if sub:IsA("Model") or sub:IsA("Folder") then
			table.insert(subs, sub.Name .. "(" .. partsUnder(sub) .. ")")
		end
	end
	print(line)
	if #subs > 0 and #subs <= 40 then
		print("   " .. table.concat(subs, " "))
	end
end

-- bounds + landmark checks
local minX, minY, minZ = math.huge, math.huge, math.huge
local maxX, maxY, maxZ = -math.huge, -math.huge, -math.huge
local total = 0
for _, d in root:GetDescendants() do
	if d:IsA("BasePart") and d.Transparency < 1 then
		total += 1
		local p = d.CFrame.Position
		minX = math.min(minX, p.X); maxX = math.max(maxX, p.X)
		minY = math.min(minY, p.Y); maxY = math.max(maxY, p.Y)
		minZ = math.min(minZ, p.Z); maxZ = math.max(maxZ, p.Z)
	end
end
print("=== audit ===")
print(("visible parts: %d"):format(total))
print(("bounds x[%.1f, %.1f] y[%.1f, %.1f] z[%.1f, %.1f]"):format(minX, maxX, minY, maxY, minZ, maxZ))

local spawns = root:FindFirstChild("Spawns")
print("spawns: " .. (spawns and #spawns:GetChildren() or 0))

local stations = root:FindFirstChild("Stations")
if stations then
	local kinds = {}
	for _, m in stations:GetChildren() do
		local k = m.Name:match("^(%a+)_")
		kinds[k] = (kinds[k] or 0) + 1
	end
	local out = {}
	for k, v in kinds do
		table.insert(out, k .. "=" .. v)
	end
	table.sort(out)
	print("station kinds: " .. table.concat(out, " "))
end

-- serve counters must carry the team red/green
local reds, greens = 0, 0
for _, d in root:GetDescendants() do
	if d:IsA("BasePart") then
		local c = d.Color
		if c.R > 0.6 and c.G < 0.45 and c.B < 0.45 then reds += 1 end
		if c.G > 0.55 and c.R < 0.5 and c.B < 0.45 then greens += 1 end
	end
end
print(("team colors: red-ish=%d green-ish=%d"):format(reds, greens))
