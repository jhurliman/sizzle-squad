--!strict
-- Chef bodies + procedural animation. Captured species rigs from
-- ReplicatedStorage.Rigs when present, capsule placeholders otherwise.
--
-- Animation signals are derived HERE from rendered positions (not from
-- network-quantized velocities, which jitter): speed comes from frame-to-
-- frame displacement, smoothed, and the stride runs at a footstep-plausible
-- cadence (~4.5 steps/s at full sprint) instead of a vibration.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ItemViz = require(script.Parent.ItemViz) :: any

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

function ChefVisuals:ensure(id: number, skin: string): any
	local entry = self.chefs[id]
	if entry ~= nil then
		return entry
	end

	local model: Model
	local rigTemplate = self.rigsFolder and self.rigsFolder:FindFirstChild(skin)
	if rigTemplate ~= nil then
		model = (rigTemplate :: Model):Clone()
	else
		model = Instance.new("Model")
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
	end
	model.Name = `Chef_{id}_{skin}`
	model.Parent = self.parent
	entry = {
		model = model,
		isRig = rigTemplate ~= nil,
		phase = 0,
		squash = 0,
		smSpeed = 0,
		lastPos = nil :: Vector2?,
		carryKey = "-",
		carryModel = nil :: Model?,
	}
	self.chefs[id] = entry
	return entry
end

--- pose: { x, y (kitchen cells), heading, effort, stun }
function ChefVisuals:update(id: number, skin: string, pose: any, flags: number, dt: number, carrying: any)
	local entry = self:ensure(id, skin)
	self.time += dt
	dt = math.max(dt, 1e-3)

	-- speed from rendered displacement, smoothed hard: quantized network
	-- velocity is what made everyone vibrate.
	local p = Vector2.new(pose.x, pose.y)
	local rawSpeed = 0
	if entry.lastPos ~= nil then
		rawSpeed = math.min((p - entry.lastPos).Magnitude / dt, MAX_SPEED * 1.3)
	end
	entry.lastPos = p
	entry.smSpeed += (rawSpeed - entry.smSpeed) * math.min(1, dt * 8)
	local speed = entry.smSpeed
	local moveBlend = math.clamp((speed - 0.25) / 2.2, 0, 1)

	-- stride: ~1.5 steps/s ambling, ~4.5 at full sprint
	if moveBlend > 0 then
		entry.phase += dt * (1.2 + speed * 0.55)
	end
	local hop = math.abs(math.sin(entry.phase * math.pi)) * moveBlend * CHEF_HEIGHT * 0.07
	local rock = math.sin(entry.phase * math.pi * 2) * 0.06 * moveBlend

	local squashTarget = math.clamp((pose.effort or 0) * 0.1, 0, 0.1)
	entry.squash += (squashTarget - entry.squash) * math.min(1, dt * 8)
	local sq = 1 - entry.squash

	local stunned = (pose.stun or 0) > 0
	local wobble = if stunned then math.sin(self.time * 24) * 0.1 else 0

	local base = CFrame.new(pose.x * SCALE, 0, pose.y * SCALE) * CFrame.Angles(0, -pose.heading + math.pi / 2, 0)

	local model = entry.model :: Model
	if entry.isRig and model.PrimaryPart ~= nil then
		model:PivotTo(base * CFrame.new(0, hop - CHEF_HEIGHT * entry.squash * 0.3, 0) * CFrame.Angles(wobble, 0, rock))
	else
		local body = model:FindFirstChild("Body") :: Part?
		local head = model:FindFirstChild("Head") :: Part?
		if body ~= nil then
			body.CFrame = base
				* CFrame.new(0, CHEF_HEIGHT * 0.33 * sq + hop, 0)
				* CFrame.Angles(0, 0, math.pi / 2)
				* CFrame.Angles(wobble + rock, 0, 0)
		end
		if head ~= nil then
			head.CFrame = base * CFrame.new(0, CHEF_HEIGHT * 0.72 * sq + hop * 1.15, 0) * CFrame.Angles(wobble, 0, 0)
		end
	end

	-- carried item: a real ItemViz model riding the hands
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
		entry.carryModel:PivotTo(base * CFrame.new(0, CHEF_HEIGHT * 0.95 + hop, -CHEF_HEIGHT * 0.45))
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
