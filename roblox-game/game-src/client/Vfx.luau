--!strict
-- Particle juice, ported semantically from the web game's src/view/vfx.ts:
-- every effect is driven by a SimEvent so the juice can never disagree with
-- what the sim did. A small pool of ParticleEmitter parts is reconfigured and
-- :Emit()'d per burst; screenshake is pushed to the CameraRig.
--
-- Kitchen space -> studs: positions x SCALE, and burst speeds/sizes x SCALE.

local Vfx = {}
Vfx.__index = Vfx

local SCALE = 5
local POOL = 30
local SMOKE = "rbxasset://textures/particles/smoke_main.dds"
local SPARK = "rbxasset://textures/particles/sparkles_main.dds"

-- food colors (confetti is the colour of the food, like the web game)
local FOOD: { [string]: Color3 } = {
	tomato = Color3.fromRGB(230, 28, 10),
	lettuce = Color3.fromRGB(111, 209, 18),
	bacon = Color3.fromRGB(196, 92, 62),
	bun = Color3.fromRGB(216, 143, 63),
	onion = Color3.fromRGB(154, 111, 168),
	cheese = Color3.fromRGB(224, 184, 45),
}
local function foodColor(kind: string?): Color3
	return FOOD[kind or ""] or Color3.fromRGB(255, 240, 207)
end

-- kind -> emitter character (texture, spread, tumble, fade shape)
type Preset = { texture: string, spread: number, tumble: boolean, glow: boolean }
local PRESETS: { [string]: Preset } = {
	spark = { texture = SPARK, spread = 22, tumble = false, glow = true },
	confetti = { texture = "", spread = 55, tumble = true, glow = false },
	puff = { texture = SMOKE, spread = 60, tumble = false, glow = false },
	smoke = { texture = SMOKE, spread = 40, tumble = false, glow = false },
	ring = { texture = SPARK, spread = 85, tumble = false, glow = true },
}

function Vfx.new(parent: Instance, addShake: (number) -> ())
	local self = setmetatable({}, Vfx)
	self.addShake = addShake
	self.pool = {} :: { { part: BasePart, emitter: ParticleEmitter, busyUntil: number } }
	for _ = 1, POOL do
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.Transparency = 1
		p.Size = Vector3.one * 0.2
		p.Parent = parent
		local e = Instance.new("ParticleEmitter")
		e.Enabled = false
		e.Rate = 0
		e.Parent = p
		table.insert(self.pool, { part = p, emitter = e, busyUntil = 0 })
	end
	self.clock = 0
	return self
end

function Vfx:tick(dt: number)
	self.clock += dt
end

--- Configure a free emitter and fire a one-shot burst.
--- opts: { speed, life, size, gravity, up } (all in kitchen units; converted).
function Vfx:burst(atx: number, aty: number, height: number, count: number, kind: string, color: Color3, opts: any)
	local preset = PRESETS[kind]
	if preset == nil then
		return
	end
	local slot = nil
	for _, s in self.pool do
		if self.clock >= s.busyUntil then
			slot = s
			break
		end
	end
	if slot == nil then
		return
	end

	local life = opts.life or 0.4
	local size = (opts.size or 0.1) * SCALE
	local up = (opts.up or 1) * SCALE
	local speed = (opts.speed or 1) * SCALE
	local gravity = (opts.gravity or 0) * SCALE

	slot.part.CFrame = CFrame.new(atx * SCALE, height * SCALE, aty * SCALE)
	local e = slot.emitter
	e.Texture = preset.texture
	e.EmissionDirection = Enum.NormalId.Top
	e.SpreadAngle = Vector2.new(preset.spread, preset.spread)
	-- launch speed blends the upward kick and the lateral scatter
	e.Speed = NumberRange.new((up + speed) * 0.45, (up + speed) * 0.9)
	e.Lifetime = NumberRange.new(life * 0.7, life)
	e.Acceleration = Vector3.new(0, gravity, 0)
	e.Rotation = if preset.tumble then NumberRange.new(0, 360) else NumberRange.new(0)
	e.RotSpeed = if preset.tumble then NumberRange.new(-220, 220) else NumberRange.new(0)
	e.Color = ColorSequence.new(color)
	e.LightEmission = if preset.glow then 0.8 else 0.15
	e.Drag = if kind == "smoke" then 4 else 1.5
	e.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, size),
		NumberSequenceKeypoint.new(1, if kind == "smoke" then size * 1.8 else size * 0.4),
	})
	e.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, if kind == "smoke" then 0.4 else 0.1),
		NumberSequenceKeypoint.new(0.7, 0.35),
		NumberSequenceKeypoint.new(1, 1),
	})
	e:Emit(count)
	slot.busyUntil = self.clock + life + 0.1
end

--- Map a SimEvent to its burst(s) + shake, faithful to vfx.ts.
function Vfx:handle(ev: any)
	local at = ev.at
	if at == nil and ev.t ~= "orderExpired" then
		return
	end
	local t = ev.t
	if t == "pickup" then
		self:burst(at.x, at.y, 1.05, 4, "ring", Color3.new(1, 1, 1), { speed = 0.8, life = 0.28, size = 0.09, up = 0.6 })
	elseif t == "place" then
		self:burst(at.x, at.y, 1.0, 5, "puff", Color3.fromRGB(255, 240, 207), { speed = 1.1, life = 0.3, size = 0.1, gravity = -2, up = 0.5 })
	elseif t == "chopTick" then
		self:burst(at.x, at.y, 1.05, 2, "spark", Color3.fromRGB(255, 246, 216), { speed = 1.7, life = 0.26, size = 0.055, up = 1.7 })
	elseif t == "chopDone" then
		self:burst(at.x, at.y, 1.05, 10, "confetti", foodColor(ev.kind), { speed = 2.2, life = 0.55, size = 0.075, gravity = -5, up = 2.6 })
		self:burst(at.x, at.y, 1.05, 5, "spark", Color3.fromRGB(255, 243, 176), { speed = 2.4, life = 0.34, size = 0.06, up = 2.0 })
	elseif t == "cookDone" then
		self:burst(at.x, at.y, 1.1, 10, "confetti", foodColor(ev.kind), { speed = 1.8, life = 0.65, size = 0.08, gravity = -5, up = 2.8 })
		self:burst(at.x, at.y, 1.1, 8, "spark", Color3.fromRGB(255, 209, 102), { speed = 1.6, life = 0.5, size = 0.08, up = 2.1 })
	elseif t == "burn" then
		self:burst(at.x, at.y, 1.15, 14, "smoke", Color3.fromRGB(107, 83, 68), { speed = 0.7, life = 1.4, size = 0.24, gravity = 0.4, up = 1.2 })
	elseif t == "fireStart" then
		self:burst(at.x, at.y, 1.15, 26, "puff", Color3.fromRGB(255, 107, 61), { speed = 1.3, life = 0.9, size = 0.24, gravity = 1.4, up = 2.4 })
		self.addShake(0.4)
	elseif t == "serve" then
		self:burst(at.x, at.y, 1.2, 18, "confetti", Color3.fromRGB(255, 209, 102), { speed = 3.0, life = 0.95, size = 0.13, gravity = -6.5, up = 4.0 })
		self:burst(at.x, at.y, 1.2, 10, "confetti", Color3.fromRGB(255, 90, 74), { speed = 2.6, life = 0.9, size = 0.12, gravity = -6.5, up = 3.6 })
		self:burst(at.x, at.y, 1.2, 10, "confetti", Color3.fromRGB(123, 217, 58), { speed = 2.4, life = 0.85, size = 0.12, gravity = -6.5, up = 3.2 })
		self.addShake(0.16 + math.min(0.2, (ev.combo or 1) * 0.02))
	elseif t == "serveWrong" then
		self:burst(at.x, at.y, 1.2, 10, "puff", Color3.fromRGB(201, 115, 122), { speed = 1.4, life = 0.5, size = 0.14, up = 1.4 })
		self.addShake(0.12)
	elseif t == "grabMiss" then
		self:burst(at.x, at.y, 1.0, 4, "puff", Color3.fromRGB(207, 195, 178), { speed = 0.7, life = 0.12, size = 0.075, gravity = -1.5, up = 0.4 })
	elseif t == "trash" then
		self:burst(at.x, at.y, 1.05, 8, "smoke", Color3.fromRGB(216, 196, 164), { speed = 0.9, life = 0.6, size = 0.14, gravity = -1, up = 1.0 })
	elseif t == "washDone" then
		self:burst(at.x, at.y, 1.05, 10, "spark", Color3.fromRGB(191, 233, 255), { speed = 1.6, life = 0.45, size = 0.07, up = 1.8 })
	elseif t == "bump" then
		self:burst(at.x, at.y, 0.7, 7, "spark", Color3.new(1, 1, 1), { speed = 2.4, life = 0.3, size = 0.07, up = 0.8 })
		self.addShake(0.1)
	elseif t == "wallHit" then
		self:burst(at.x, at.y, 0.22, 5, "puff", Color3.fromRGB(224, 207, 174), { speed = 0.9, life = 0.3, size = 0.09, gravity = -0.3, up = 0.4 })
	elseif t == "orderExpired" then
		self.addShake(0.22)
	end
end

return Vfx
