-- Builds sizzle-squad.rbxl from parts.json (emitted by prepare.mjs).
-- Run with: lune run convert.luau
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local roblox = require("@lune/roblox")

local Instance = roblox.Instance
local Color3 = (roblox :: any).Color3
local Vector3 = (roblox :: any).Vector3
local CFrame = (roblox :: any).CFrame
local Enum = (roblox :: any).Enum
local data = serde.decode("json", fs.readFile("parts.json"))

local game = Instance.new("DataModel")
local workspace = game:GetService("Workspace")
local lighting = game:GetService("Lighting")

-- Warm late-afternoon light to suit the kitchen's ochre palette. Technology is
-- declared explicitly (legacy Compatibility is sunset and triggers a Studio
-- migration notice if left as the serialized default).
pcall(function()
	lighting.Technology = Enum.Technology.Voxel
end)
lighting.ClockTime = 14.5
lighting.Brightness = 2
lighting.Ambient = Color3.fromRGB(120, 105, 90)
lighting.OutdoorAmbient = Color3.fromRGB(140, 120, 100)

local rootModel = Instance.new("Model")
rootModel.Name = "SizzleSquadKitchen"
rootModel.Parent = workspace

-- Folder/Model tree, created on demand from each part's group path.
local groupCache: { [string]: any } = {}
local FOLDER_GROUPS = { Stations = true, Benches = true, Walls = true }

local function containerFor(path: { string }): any
	local key = table.concat(path, "/")
	local hit = groupCache[key]
	if hit then
		return hit
	end
	local parent = rootModel
	if #path > 1 then
		parent = containerFor({ table.unpack(path, 1, #path - 1) })
	end
	local inst
	if #path == 1 and FOLDER_GROUPS[path[1]] then
		inst = Instance.new("Folder")
	else
		inst = Instance.new("Model")
	end
	inst.Name = path[#path]
	inst.Parent = parent
	groupCache[key] = inst
	return inst
end

local function cframeOf(cf: { number }): any
	return CFrame.new(
		cf[1], cf[2], cf[3],
		cf[4], cf[5], cf[6],
		cf[7], cf[8], cf[9],
		cf[10], cf[11], cf[12]
	)
end

local SHAPE_ENUM = {
	Block = Enum.PartType.Block,
	Ball = Enum.PartType.Ball,
	Cylinder = Enum.PartType.Cylinder,
}

local count = 0
for _, p in data.parts do
	local part = Instance.new("Part")
	part.Name = p.name
	part.Anchored = true
	part.Size = Vector3.new(p.size[1], p.size[2], p.size[3])
	part.CFrame = cframeOf(p.cf)
	part.Color = Color3.fromRGB(p.color[1], p.color[2], p.color[3])
	part.Material = (Enum.Material :: any)[p.material]
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.CastShadow = true
	if p.shape == "SphereMesh" then
		part.Shape = Enum.PartType.Block
		local mesh = Instance.new("SpecialMesh")
		mesh.MeshType = Enum.MeshType.Sphere
		mesh.Parent = part
	else
		part.Shape = SHAPE_ENUM[p.shape] or Enum.PartType.Block
	end
	part.Parent = containerFor(p.group)
	count += 1
end

-- Spawn points for four players, resting invisibly on the kitchen floor.
local spawns = Instance.new("Folder")
spawns.Name = "Spawns"
spawns.Parent = rootModel
for _, s in data.spawns do
	local sp = Instance.new("SpawnLocation")
	sp.Name = s.name
	sp.Anchored = true
	sp.Size = Vector3.new(s.size[1], s.size[2], s.size[3])
	sp.CFrame = cframeOf(s.cf)
	sp.Transparency = 1
	sp.CanCollide = false
	sp.Neutral = true
	sp.Duration = 0
	local decal = sp:FindFirstChildOfClass("Decal")
	if decal then
		decal:Destroy()
	end
	sp.Parent = spawns
end

-- Invisible perimeter walls so nobody sprints off the floor slab.
local colliders = Instance.new("Folder")
colliders.Name = "Colliders"
colliders.Parent = rootModel
local fb = data.floorBounds
local wallH = 60
local wallT = 2
local sides = {
	{ fb.cx, fb.cz - fb.d / 2 - wallT / 2, fb.w + 2 * wallT, wallT },
	{ fb.cx, fb.cz + fb.d / 2 + wallT / 2, fb.w + 2 * wallT, wallT },
	{ fb.cx - fb.w / 2 - wallT / 2, fb.cz, wallT, fb.d + 2 * wallT },
	{ fb.cx + fb.w / 2 + wallT / 2, fb.cz, wallT, fb.d + 2 * wallT },
}
for i, s in sides do
	local wall = Instance.new("Part")
	wall.Name = "Barrier_" .. i
	wall.Anchored = true
	wall.Transparency = 1
	wall.CanCollide = true
	wall.Size = Vector3.new(s[3], wallH, s[4])
	wall.CFrame = CFrame.new(s[1], wallH / 2, s[2])
	wall.Parent = colliders
end

local place = roblox.serializePlace(game)
fs.writeFile("sizzle-squad.rbxl", place)
print("wrote sizzle-squad.rbxl with " .. count .. " parts")

-- Also emit the kitchen as a model file for the Rojo-built place
-- (roblox-game/default.project.json mounts it under Workspace).
pcall(function()
	fs.writeDir("../roblox-game/assets")
end)
local model = roblox.serializeModel({ rootModel })
fs.writeFile("../roblox-game/assets/kitchen.rbxm", model)
print("wrote ../roblox-game/assets/kitchen.rbxm")
