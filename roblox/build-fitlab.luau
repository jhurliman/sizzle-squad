-- Builds FitLab.rbxl: a Studio-editable grid of ALL species x ALL hats, each
-- hat placed at its currently-resolved fit from hat-fits.json. Tune with the
-- editor's move/rotate/scale tools, then run fitlab-export.lua in the
-- command bar and send back the printed JSON (merge with merge-fits.mjs).
--
-- The hats are built by executing the REAL client Hats.luau under Lune with
-- an injected environment, so lab geometry == shipped geometry.
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local Instance = roblox.Instance
local Color3 = (roblox :: any).Color3
local Vector3 = (roblox :: any).Vector3
local CFrame = (roblox :: any).CFrame
local Enum = (roblox :: any).Enum
local UDim2 = (roblox :: any).UDim2

local fits = serde.decode("json", fs.readFile("hat-fits.json"))

-- load the shipped hat builders
local hatsSource = fs.readFile("../roblox-game/game-src/client/Hats.luau")
local hatsFn = luau.load(luau.compile(hatsSource), {
	debugName = "Hats",
	environment = {
		Instance = Instance,
		Enum = Enum,
		CFrame = CFrame,
		Vector3 = Vector3,
		Color3 = Color3,
		math = math,
		table = table,
		string = string,
		pairs = pairs,
		ipairs = ipairs,
		print = print,
	},
})
local Hats = hatsFn()

local HAT_IDS = {
	"hat_paper", "hat_toque", "hat_bandana_red", "hat_bandana_green", "hat_beret", "hat_paperboat",
	"hat_colander", "hat_tophat", "hat_crown", "hat_pan", "hat_mushroom", "hat_halo",
}

local rigsFolder = roblox.deserializeModel(fs.readFile("../roblox-game/assets/chef-rigs.rbxm"))[1]
local SPECIES = {}
for _, m in rigsFolder:GetChildren() do
	table.insert(SPECIES, m.Name)
end
table.sort(SPECIES)

local function resolveFit(skin: string, hatId: string)
	local merged = { scale = 1, offset = { 0, 0, 0 }, tilt = { 0, 0, 0 }, hideEars = false }
	for k, v in fits.defaults do
		if k ~= "COMMENT" then
			(merged :: any)[k] = v
		end
	end
	local species = fits.species[skin]
	if species ~= nil then
		for _, layer in { species.default, species[hatId] } do
			if layer ~= nil then
				for k, v in layer do
					(merged :: any)[k] = v
				end
			end
		end
	end
	return merged
end

local game = Instance.new("DataModel")
local workspaceService = game:GetService("Workspace")
local lab = Instance.new("Folder")
lab.Name = "FitLab"
lab.Parent = workspaceService

local base = Instance.new("Part")
base.Name = "Baseplate"
base.Anchored = true
base.Size = Vector3.new(320, 1, 180)
base.CFrame = CFrame.new(120, -0.5, 55)
base.Color = Color3.fromRGB(130, 124, 112)
base.Parent = lab

for row, skin in SPECIES do
	local rigTemplate = rigsFolder:FindFirstChild(skin)
	for col, hatId in HAT_IDS do
		local slotX = (col - 1) * 22
		local slotZ = (row - 1) * 40
		local slot = Instance.new("Model")
		slot.Name = `Slot_{skin}_{hatId}`

		local rig = (rigTemplate :: any):Clone()
		rig.Name = "Rig"
		local skull: any = nil
		local skullVolume = 0
		local headTop = 0
		for _, d in rig:GetDescendants() do
			if d:IsA("BasePart") then
				d.CFrame = CFrame.new(slotX, 0, slotZ) * d.CFrame
				local group = d.Parent
				if group and group.Name == "Head" then
					headTop = math.max(headTop, d.CFrame.Y + d.Size.Y / 2)
					local vol = d.Size.X * d.Size.Y * d.Size.Z
					if vol > skullVolume then
						skullVolume = vol
						skull = d
					end
				end
			end
		end
		rig.Parent = slot

		if skull ~= nil then
			local fit = resolveFit(skin, hatId)
			local attachPos = Vector3.new(
				skull.CFrame.X,
				math.max(headTop - 0.25, skull.CFrame.Y + skull.Size.Y * 0.3),
				skull.CFrame.Z
			)
			local hatScaleBase = math.max(skull.Size.X, skull.Size.Z) / 1.55
			local s = hatScaleBase * fit.scale

			-- equipped-state preview: built-in hat (and per-fit ears) hidden
			for _, d in rig:GetDescendants() do
				if d:IsA("BasePart") and d.Parent then
					if d.Parent.Name == "BuiltinHat" or (fit.hideEars and d.Parent.Name == "Ears") then
						d.Transparency = 1
					end
				end
			end

			local hat = Hats.build(hatId)
			if hat ~= nil then
				hat.Name = "Hat"
				local attachCF = CFrame.new(attachPos + Vector3.new(fit.offset[1], fit.offset[2], fit.offset[3]))
					* CFrame.Angles(
						math.rad(fit.tilt[1] or 0),
						math.rad(fit.tilt[3] or 0),
						math.rad(fit.tilt[2] or 0)
					)
				local minX, maxX = math.huge, -math.huge
				for _, d in hat:GetDescendants() do
					if d:IsA("BasePart") then
						local cf = d.CFrame
						d.Size = d.Size * s
						d.CFrame = attachCF * (CFrame.new(cf.Position * s) * cf.Rotation)
						minX = math.min(minX, d.CFrame.X - d.Size.X / 2)
						maxX = math.max(maxX, d.CFrame.X + d.Size.X / 2)
					end
				end
				hat:SetAttribute("BuiltScale", fit.scale)
				hat:SetAttribute("BuiltExtentX", math.max(0.1, maxX - minX))
				hat.Parent = slot
			end

			local ref = Instance.new("Part")
			ref.Name = "AttachRef"
			ref.Anchored = true
			ref.CanCollide = false
			ref.Transparency = 1
			ref.Size = Vector3.new(0.4, 0.4, 0.4)
			ref.CFrame = CFrame.new(attachPos)
			ref:SetAttribute("HatScaleBase", hatScaleBase)
			ref.Parent = slot
		end

		-- floating label
		local labelPart = Instance.new("Part")
		labelPart.Anchored = true
		labelPart.CanCollide = false
		labelPart.Transparency = 1
		labelPart.Size = Vector3.new(1, 1, 1)
		labelPart.CFrame = CFrame.new(slotX, 11, slotZ)
		labelPart.Name = "Label"
		local bb = Instance.new("BillboardGui")
		bb.Size = UDim2.new(0, 200, 0, 28)
		bb.AlwaysOnTop = true
		bb.Parent = labelPart
		local text = Instance.new("TextLabel")
		text.Size = UDim2.new(1, 0, 1, 0)
		text.BackgroundTransparency = 1
		text.TextColor3 = Color3.fromRGB(30, 30, 30)
		text.TextSize = 14
			text.Text = `{skin} · {hatId}`
		text.Parent = bb
		labelPart.Parent = slot

		slot.Parent = lab
	end
end

fs.writeFile("FitLab.rbxl", roblox.serializePlace(game))
local slots = 0
for _, c in lab:GetChildren() do
	if c.Name:find("^Slot_") then
		slots += 1
	end
end
print(`wrote FitLab.rbxl ({slots} slots)`)
