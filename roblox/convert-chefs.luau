-- chef-parts.json -> ../roblox-game/assets/chef-rigs.rbxm
-- A Folder "Rigs" holding one Model per species; parts grouped in sub-Models
-- by skeleton part. Each group Model carries a "Joint" Vector3 attribute
-- (bind-pose pivot, model space, studs) — the client animator rotates the
-- group's parts around it. All parts anchored; the client drives them with
-- BulkMoveTo.
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local roblox = require("@lune/roblox")

local Instance = roblox.Instance
local Color3 = (roblox :: any).Color3
local Vector3 = (roblox :: any).Vector3
local CFrame = (roblox :: any).CFrame
local Enum = (roblox :: any).Enum

local data = serde.decode("json", fs.readFile("chef-parts.json"))

local folder = Instance.new("Folder")
folder.Name = "Rigs"

local SHAPE = {
	Block = Enum.PartType.Block,
	Ball = Enum.PartType.Ball,
	Cylinder = Enum.PartType.Cylinder,
}

local total = 0
for skin, entry in data.skins do
	local parts = entry.parts
	local joints = entry.joints or {}
	local model = Instance.new("Model")
	model.Name = skin
	local rootPart = Instance.new("Part")
	rootPart.Name = "Root"
	rootPart.Anchored = true
	rootPart.CanCollide = false
	rootPart.Transparency = 1
	rootPart.Size = Vector3.new(0.5, 0.5, 0.5)
	rootPart.CFrame = CFrame.new(0, 0, 0)
	rootPart.Parent = model
	model.PrimaryPart = rootPart

	local groups: { [string]: any } = {}
	local counters: { [string]: number } = {}
	for _, p in parts do
		local g = groups[p.group]
		if g == nil then
			g = Instance.new("Model")
			g.Name = p.group
			g.Parent = model
			local j = joints[p.group]
			if j ~= nil then
				g:SetAttribute("Joint", Vector3.new(j[1], j[2], j[3]))
			end
			groups[p.group] = g
		end
		counters[p.group] = (counters[p.group] or 0) + 1
		local part = Instance.new("Part")
		part.Name = `{p.group}_{counters[p.group]}`
		part.Anchored = true
		part.CanCollide = false
		part.CastShadow = true
		part.Size = Vector3.new(p.size[1], p.size[2], p.size[3])
		part.CFrame = CFrame.new(
			p.cf[1], p.cf[2], p.cf[3],
			p.cf[4], p.cf[5], p.cf[6],
			p.cf[7], p.cf[8], p.cf[9],
			p.cf[10], p.cf[11], p.cf[12]
		)
		part.Color = Color3.fromRGB(p.color[1], p.color[2], p.color[3])
		part.Material = Enum.Material.SmoothPlastic
		part.TopSurface = Enum.SurfaceType.Smooth
		part.BottomSurface = Enum.SurfaceType.Smooth
		if p.shape == "SphereMesh" then
			part.Shape = Enum.PartType.Block
			local mesh = Instance.new("SpecialMesh")
			mesh.MeshType = Enum.MeshType.Sphere
			mesh.Parent = part
		else
			part.Shape = SHAPE[p.shape] or Enum.PartType.Block
		end
		part.Parent = g
		total += 1
	end
	model.Parent = folder
end

pcall(function()
	fs.writeDir("../roblox-game/assets")
end)
fs.writeFile("../roblox-game/assets/chef-rigs.rbxm", roblox.serializeModel({ folder }))
print(`wrote chef-rigs.rbxm ({total} parts, joint attributes on groups)`)
