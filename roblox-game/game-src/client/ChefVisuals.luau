--!strict
-- Chef bodies + procedural animation. If captured species rigs exist under
-- ReplicatedStorage.Game.Rigs they are used (Motor6D pose mapping, task-9
-- pipeline); otherwise stylized capsule placeholders so the game is playable
-- the moment the place builds. All animation is client-side, driven by the
-- same signals the web game's ChefView reads: speed, heading, effort, stun,
-- carry tier.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ChefVisuals = {}
ChefVisuals.__index = ChefVisuals

local SCALE = 5
local CHEF_HEIGHT = 0.72 * SCALE
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
		-- Placeholder: capsule body + ball head + cap, tinted per species.
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
		body.CastShadow = true
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
		local hat = Instance.new("Part")
		hat.Name = "Hat"
		hat.Shape = Enum.PartType.Cylinder
		hat.Size = Vector3.new(CHEF_HEIGHT * 0.18, CHEF_HEIGHT * 0.34, CHEF_HEIGHT * 0.34)
		hat.Color = Color3.fromRGB(245, 240, 230)
		hat.Material = Enum.Material.SmoothPlastic
		hat.Anchored = true
		hat.CanCollide = false
		hat.Parent = model
		local nose = Instance.new("Part")
		nose.Name = "Nose"
		nose.Shape = Enum.PartType.Ball
		nose.Size = Vector3.one * CHEF_HEIGHT * 0.12
		nose.Color = Color3.fromRGB(60, 40, 30)
		nose.Material = Enum.Material.SmoothPlastic
		nose.Anchored = true
		nose.CanCollide = false
		nose.Parent = model
		model.PrimaryPart = body
	end
	model.Name = `Chef_{id}_{skin}`

	-- carried-item prop (simple colored block/plate swapped by carry tier)
	local carry = Instance.new("Part")
	carry.Name = "Carry"
	carry.Anchored = true
	carry.CanCollide = false
	carry.Transparency = 1
	carry.Size = Vector3.new(1.4, 0.5, 1.4)
	carry.Material = Enum.Material.SmoothPlastic
	carry.Parent = model

	model.Parent = self.parent
	entry = { model = model, isRig = rigTemplate ~= nil, phase = 0, squash = 0 }
	self.chefs[id] = entry
	return entry
end

--- pose: { x, y (kitchen cells), heading, effort, stun, speed?, flags? }
function ChefVisuals:update(id: number, skin: string, pose: any, flags: number, dt: number)
	local entry = self:ensure(id, skin)
	self.time += dt

	local speed = pose.speed or 0
	entry.phase += dt * (4 + speed * 2.2)
	local walk = math.sin(entry.phase * 6) * math.min(1, speed / 4)
	local hop = math.abs(walk) * 0.35 * SCALE * 0.12
	local squashTarget = math.clamp((pose.effort or 0) * 0.12, 0, 0.12)
	entry.squash += (squashTarget - entry.squash) * math.min(1, dt * 10)

	local stunned = (pose.stun or 0) > 0
	local wobble = if stunned then math.sin(self.time * 30) * 0.12 else 0

	local base = CFrame.new(pose.x * SCALE, 0, pose.y * SCALE) * CFrame.Angles(0, -pose.heading + math.pi / 2, 0)

	local model = entry.model :: Model
	if entry.isRig and model.PrimaryPart ~= nil then
		-- Captured rig: root the whole model; Motor6D pose layer comes from
		-- the animator signals (kept minimal until the art pass).
		model:PivotTo(base * CFrame.new(0, CHEF_HEIGHT * 0.5 + hop, 0) * CFrame.Angles(wobble, 0, walk * 0.08))
	else
		local body = model:FindFirstChild("Body") :: Part?
		local head = model:FindFirstChild("Head") :: Part?
		local hat = model:FindFirstChild("Hat") :: Part?
		local nose = model:FindFirstChild("Nose") :: Part?
		local sq = 1 - entry.squash
		if body ~= nil then
			body.CFrame = base
				* CFrame.new(0, CHEF_HEIGHT * 0.33 * sq + hop, 0)
				* CFrame.Angles(0, 0, math.pi / 2)
				* CFrame.Angles(wobble + walk * 0.1, 0, 0)
		end
		if head ~= nil then
			head.CFrame = base * CFrame.new(0, CHEF_HEIGHT * 0.72 * sq + hop * 1.15, 0) * CFrame.Angles(wobble, 0, 0)
		end
		if hat ~= nil then
			hat.CFrame = base
				* CFrame.new(0, CHEF_HEIGHT * (0.72 + 0.24) * sq + hop * 1.2, 0)
				* CFrame.Angles(0, 0, math.pi / 2)
		end
		if nose ~= nil then
			nose.CFrame = base * CFrame.new(0, CHEF_HEIGHT * 0.7 * sq + hop * 1.15, -CHEF_HEIGHT * 0.24)
		end
	end

	-- carried item indicator by tier bits (Net flags 3-4)
	local carry = model:FindFirstChild("Carry") :: Part?
	if carry ~= nil then
		local tier = bit32.band(bit32.rshift(flags, 3), 3)
		if tier == 0 then
			carry.Transparency = 1
		else
			carry.Transparency = 0
			carry.Color = if tier == 2 then Color3.fromRGB(220, 207, 178) else Color3.fromRGB(230, 90, 70)
			carry.Size = if tier == 2 then Vector3.new(1.6, 0.35, 1.6) else Vector3.new(1.1, 1.1, 1.1)
			carry.CFrame = base * CFrame.new(0, CHEF_HEIGHT * 0.95, -CHEF_HEIGHT * 0.4)
		end
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
