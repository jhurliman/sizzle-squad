-- Executes the real client Hats.luau and dumps each hat's parts to
-- hats-dump.json for headless preview rendering (preview-hats.mjs).
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local Instance = roblox.Instance
local Color3 = (roblox :: any).Color3
local Vector3 = (roblox :: any).Vector3
local CFrame = (roblox :: any).CFrame
local Enum = (roblox :: any).Enum

local src = fs.readFile("../roblox-game/game-src/client/Hats.luau")
local Hats = luau.load(luau.compile(src), {
	debugName = "Hats",
	environment = {
		Instance = Instance, Enum = Enum, CFrame = CFrame, Vector3 = Vector3, Color3 = Color3,
		math = math, table = table, string = string, pairs = pairs, ipairs = ipairs,
	},
})()

local HAT_IDS = {
	"hat_paper", "hat_toque", "hat_bandana_red", "hat_bandana_green", "hat_beret", "hat_paperboat",
	"hat_colander", "hat_tophat", "hat_crown", "hat_pan", "hat_mushroom", "hat_halo",
}

local out = {}
for _, id in HAT_IDS do
	local hat = Hats.build(id)
	local parts = {}
	for _, d in hat:GetDescendants() do
		if d:IsA("BasePart") and d.Transparency < 1 then
			local cf = d.CFrame
			local shape = "Block"
			if d.Shape == Enum.PartType.Ball then
				shape = "Ball"
			elseif d.Shape == Enum.PartType.Cylinder then
				shape = "Cylinder"
			end
			-- CFrame components: position + rotation matrix (row-major for viewer)
			local x, y, z = cf.X, cf.Y, cf.Z
			local r = { cf:GetComponents() }
			table.insert(parts, {
				shape = shape,
				size = { d.Size.X, d.Size.Y, d.Size.Z },
				-- viewer expects cf = [px,py,pz, R00,R01,R02, R10,R11,R12, R20,R21,R22]
				cf = { x, y, z, r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12] },
				color = { math.floor(d.Color.R * 255 + 0.5), math.floor(d.Color.G * 255 + 0.5), math.floor(d.Color.B * 255 + 0.5) },
			})
		end
	end
	out[id] = parts
end

fs.writeFile("hats-dump.json", (require("@lune/serde")).encode("json", out))
print("wrote hats-dump.json")
