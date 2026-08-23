--!strict
-- Chef bodies + the procedural animator.
--
-- Captured rigs are part-groups (Hips/Torso/Head/ArmL/ArmR/LegL/LegR/Hands/
-- Tail/Ears), each carrying a "Joint" attribute — its bind-pose pivot. Every
-- frame the animator computes a model-space transform per group (gait swings,
-- carry/chop poses, lean, secondary tail/ear motion, stun flail), composes
-- them with each part's bind CFrame, and commits the whole cast with one
-- BulkMoveTo. Signals mirror the web ChefView's: speed (from rendered
-- displacement, smoothed), step phase, carry tier, working, stun.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ItemViz = require(script.Parent.ItemViz) :: any
local Hats = require(script.Parent.Hats) :: any

local ChefVisuals = {}
ChefVisuals.__index = ChefVisuals

local SCALE = 5
local CHEF_HEIGHT = 0.72 * SCALE
local MAX_SPEED = 6.2
local SKIN_COLORS: { [string]: Color3 } = {
	bramble = Color3.fromRGB(160, 82, 45),
	pip = Color3.fromRGB(106, 190, 48),
	nori = Color3.fromRGB(99, 105, 209),
	mochi = Color3.fromRGB(235, 165, 50),
}

function ChefVisuals.new(parent: Instance)
	local self = setmetatable({}, ChefVisuals)
	self.parent = parent
	self.rigsFolder = ReplicatedStorage:FindFirstChild("Rigs")
	self.chefs = {} :: { [number]: any }
	self.time = 0
	return self
end

local function buildPlaceholder(skin: string): Model
	local model = Instance.new("Model")
	local color = SKIN_COLORS[skin] or Color3.fromRGB(200, 200, 200)
	local body = Instance.new("Part")
	body.Name = "Body"
	body.Shape = Enum.PartType.Cylinder
	body.Size = Vector3.new(CHEF_HEIGHT * 0.62, CHEF_HEIGHT * 0.52, CHEF_HEIGHT * 0.52)
	body.Color = color
	body.Material = Enum.Material.SmoothPlastic
	body.Anchored = true
	body.CanCollide = false
	body.Parent = model
	local head = Instance.new("Part")
	head.Name = "Head"
	head.Shape = Enum.PartType.Ball
	head.Size = Vector3.one * CHEF_HEIGHT * 0.5
	head.Color = color:Lerp(Color3.new(1, 1, 1), 0.25)
	head.Material = Enum.Material.SmoothPlastic
	head.Anchored = true
	head.CanCollide = false
	head.Parent = model
	model.PrimaryPart = body
	return model
end

function ChefVisuals:ensure(id: number, skin: string): any
	local entry = self.chefs[id]
	if entry ~= nil then
		return entry
	end

	local model: Model
	local rigTemplate = self.rigsFolder and self.rigsFolder:FindFirstChild(skin)
	local isRig = rigTemplate ~= nil
	if isRig then
		model = (rigTemplate :: Model):Clone()
	else
		model = buildPlaceholder(skin)
	end
	model.Name = `Chef_{id}_{skin}`
	model.Parent = self.parent

	entry = {
		model = model,
		isRig = isRig,
		phase = 0,
		smSpeed = 0,
		carryBlend = 0,
		lastPos = nil :: Vector2?,
		carryKey = "-",
		carryModel = nil :: Model?,
		hatId = nil :: string?,
		hatModel = nil :: Model?,
		nameGui = nil :: BillboardGui?,
		-- articulation tables (rig only)
		animParts = {} :: { BasePart },
		animBind = {} :: { CFrame },
		animGroup = {} :: { string },
		animCFrames = {} :: { CFrame },
		joints = {} :: { [string]: Vector3 },
		headAttach = Vector3.new(0, CHEF_HEIGHT, 0),
		headAnchor = nil :: BasePart?,
	}

	if isRig then
		local headTop = 0
		local headCx, headCz, headN = 0, 0, 0
		for _, group in model:GetChildren() do
			if group:IsA("Model") then
				local joint = group:GetAttribute("Joint")
				if typeof(joint) == "Vector3" then
					entry.joints[group.Name] = joint
				end
				for _, p in group:GetChildren() do
					if p:IsA("BasePart") then
						table.insert(entry.animParts, p)
						table.insert(entry.animBind, p.CFrame)
						table.insert(entry.animGroup, group.Name)
						table.insert(entry.animCFrames, p.CFrame)
						if group.Name == "Head" then
							headTop = math.max(headTop, p.CFrame.Y + p.Size.Y / 2)
							headCx += p.CFrame.X
							headCz += p.CFrame.Z
							headN += 1
							entry.headAnchor = entry.headAnchor or p
						end
					end
				end
			end
		end
		if headN > 0 then
			entry.headAttach = Vector3.new(headCx / headN, headTop - 0.2, headCz / headN)
		end
	end

	self.chefs[id] = entry
	return entry
end

--- Rotation of a group about its bind-pose joint.
local function around(joint: Vector3, rx: number, ry: number, rz: number): CFrame
	return CFrame.new(joint) * CFrame.Angles(rx, ry, rz) * CFrame.new(-joint)
end

--- pose: { x, y (kitchen cells), heading, effort, stun }
--- extras: { carrying, hat, label, working }
function ChefVisuals:update(id: number, skin: string, pose: any, flags: number, dt: number, carrying: any, hat: string?, label: string?)
	local entry = self:ensure(id, skin)
	self.time += dt
	dt = math.max(dt, 1e-3)

	-- ---- signals -----------------------------------------------------------
	local p = Vector2.new(pose.x, pose.y)
	local rawSpeed = 0
	if entry.lastPos ~= nil then
		rawSpeed = math.min((p - entry.lastPos).Magnitude / dt, MAX_SPEED * 1.3)
	end
	entry.lastPos = p
	entry.smSpeed += (rawSpeed - entry.smSpeed) * math.min(1, dt * 8)
	local speed = entry.smSpeed
	local moveBlend = math.clamp((speed - 0.25) / 2.2, 0, 1)

	if moveBlend > 0.01 then
		entry.phase += dt * (1.2 + speed * 0.55) -- ~4.5 steps/s at sprint
	end
	local stepSin = math.sin(entry.phase * math.pi) -- alternates each step
	local hop = math.abs(stepSin) * moveBlend * CHEF_HEIGHT * 0.06

	local carryingNow = bit32.band(flags, 4) ~= 0
	entry.carryBlend += ((if carryingNow then 1 else 0) - entry.carryBlend) * math.min(1, dt * 10)
	local carryBlend = entry.carryBlend
	local working = bit32.band(flags, 2) ~= 0
	local stunned = (pose.stun or 0) > 0
	local wobble = if stunned then math.sin(self.time * 24) * 0.12 else 0
	local rock = stepSin * 0.05 * moveBlend

	local base = CFrame.new(pose.x * SCALE, 0, pose.y * SCALE) * CFrame.Angles(0, -pose.heading + math.pi / 2, 0)
	local baseCF = base * CFrame.new(0, hop, 0) * CFrame.Angles(wobble, 0, rock)

	local model = entry.model :: Model
	if entry.isRig and #entry.animParts > 0 then
		-- ---- group poses ---------------------------------------------------
		local legAmp = 0.85 * moveBlend
		local armAmp = 0.55 * moveBlend * (1 - carryBlend)
		local legSwing = stepSin * legAmp
		local armSwing = -stepSin * armAmp
		local torsoPitch = 0.1 * moveBlend
		local torsoYaw = math.sin(entry.phase * math.pi * 2) * 0.045 * moveBlend
		local flail = if stunned then 0.9 else 0

		local armPitchL = armSwing - carryBlend * 1.2
		local armPitchR = -armSwing - carryBlend * 1.2
		if working then
			-- committed chop/wash: right arm hammers, left braces
			armPitchR = -0.85 + math.sin(self.time * 12) * 0.55
			armPitchL = -0.45
		end

		local J = entry.joints
		local pose_: { [string]: CFrame } = {}
		local function set(name: string, rx: number, ry: number, rz: number)
			local j = J[name]
			if j ~= nil then
				pose_[name] = around(j, rx, ry, rz)
			end
		end
		set("LegL", legSwing, 0, 0)
		set("LegR", -legSwing, 0, 0)
		set("ArmL", armPitchL, 0, -flail)
		set("ArmR", armPitchR, 0, flail)
		set("Torso", torsoPitch, torsoYaw, 0)
		set("Head", -torsoPitch * 0.6 + (if stunned then math.sin(self.time * 20) * 0.15 else 0), 0, 0)
		set("Tail", 0, math.sin(entry.phase * math.pi - 1.1) * 0.45 * moveBlend + math.sin(self.time * 1.7) * 0.08, 0)
		set(
			"Ears",
			math.abs(stepSin) * 0.22 * moveBlend + (if stunned then math.sin(self.time * 28) * 0.3 else 0),
			0,
			0
		)

		-- ---- compose + commit ---------------------------------------------
		local cframes = entry.animCFrames
		for i, bind in entry.animBind do
			local t = pose_[entry.animGroup[i]]
			cframes[i] = if t ~= nil then baseCF * t * bind else baseCF * bind
		end
		workspace:BulkMoveTo(entry.animParts, cframes, Enum.BulkMoveMode.FireCFrameChanged)
	else
		local body = model:FindFirstChild("Body") :: Part?
		local head = model:FindFirstChild("Head") :: Part?
		if body ~= nil then
			body.CFrame = baseCF * CFrame.new(0, CHEF_HEIGHT * 0.33, 0) * CFrame.Angles(0, 0, math.pi / 2)
		end
		if head ~= nil then
			head.CFrame = baseCF * CFrame.new(0, CHEF_HEIGHT * 0.72, 0)
		end
	end

	-- ---- hat ---------------------------------------------------------------
	if hat ~= entry.hatId then
		entry.hatId = hat
		if entry.hatModel ~= nil then
			entry.hatModel:Destroy()
			entry.hatModel = nil
		end
		local hatModel = Hats.build(hat)
		if hatModel ~= nil then
			hatModel.Parent = model
		end
		entry.hatModel = hatModel
	end
	if entry.hatModel ~= nil then
		local headPose = CFrame.new()
		if entry.isRig then
			-- ride the head group's transform so the hat bobs with the head
			local j = entry.joints.Head
			if j ~= nil then
				headPose = around(j, -0.1 * moveBlend, 0, 0)
			end
		end
		entry.hatModel:PivotTo(baseCF * headPose * CFrame.new(entry.headAttach))
	end

	-- ---- nametag -----------------------------------------------------------
	if label ~= nil and entry.nameGui == nil then
		local anchor = entry.headAnchor or model.PrimaryPart
		if anchor ~= nil then
			local bb = Instance.new("BillboardGui")
			bb.Size = UDim2.fromOffset(120, 22)
			bb.StudsOffset = Vector3.new(0, 2.6, 0)
			bb.AlwaysOnTop = true
			bb.Parent = anchor
			local text = Instance.new("TextLabel")
			text.Size = UDim2.fromScale(1, 1)
			text.BackgroundTransparency = 1
			text.TextColor3 = Color3.fromRGB(255, 244, 221)
			text.TextStrokeTransparency = 0.4
			text.TextSize = 14
			text.Font = Enum.Font.GothamBold
			text.Text = label
			text.Parent = bb
			entry.nameGui = bb
		end
	elseif label == nil and entry.nameGui ~= nil then
		entry.nameGui:Destroy()
		entry.nameGui = nil
	end

	-- ---- carried item ------------------------------------------------------
	local key = ItemViz.key(carrying)
	if key ~= entry.carryKey then
		entry.carryKey = key
		if entry.carryModel ~= nil then
			entry.carryModel:Destroy()
			entry.carryModel = nil
		end
		local item = ItemViz.build(carrying)
		if item ~= nil then
			item.Parent = entry.model
		end
		entry.carryModel = item
	end
	if entry.carryModel ~= nil then
		entry.carryModel:PivotTo(baseCF * CFrame.new(0, CHEF_HEIGHT * 0.62, CHEF_HEIGHT * 0.5))
	end
end

function ChefVisuals:remove(id: number)
	local entry = self.chefs[id]
	if entry ~= nil then
		entry.model:Destroy()
		self.chefs[id] = nil
	end
end

return ChefVisuals
