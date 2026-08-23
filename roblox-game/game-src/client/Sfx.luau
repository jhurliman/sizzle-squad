--!strict
-- SFX: SimEvent -> Sound mapping. Asset ids ship empty (the WebAudio synth
-- must be offline-rendered and uploaded via Open Cloud — user-gated step);
-- an empty id is a silent no-op, so this is wired and ready. PlaybackSpeed
-- jitter recovers the synth's per-play variation.

local SoundService = game:GetService("SoundService")

local Sfx = {}
Sfx.__index = Sfx

local SCALE = 5

-- Fill SoundId values ("rbxassetid://...") after the audio upload pass.
local MANIFEST: { [string]: { id: string, volume: number, jitter: number } } = {
	pickup = { id = "", volume = 0.5, jitter = 0.06 },
	place = { id = "", volume = 0.5, jitter = 0.06 },
	grabMiss = { id = "", volume = 0.35, jitter = 0.02 },
	chopTick = { id = "", volume = 0.45, jitter = 0.08 },
	chopDone = { id = "", volume = 0.55, jitter = 0.04 },
	cookDone = { id = "", volume = 0.55, jitter = 0.04 },
	burn = { id = "", volume = 0.6, jitter = 0.03 },
	fireStart = { id = "", volume = 0.7, jitter = 0 },
	serve = { id = "", volume = 0.65, jitter = 0.03 },
	serveWrong = { id = "", volume = 0.5, jitter = 0.02 },
	orderNew = { id = "", volume = 0.45, jitter = 0.02 },
	orderExpired = { id = "", volume = 0.5, jitter = 0.02 },
	trash = { id = "", volume = 0.45, jitter = 0.05 },
	washDone = { id = "", volume = 0.5, jitter = 0.04 },
	bump = { id = "", volume = 0.55, jitter = 0.08 },
	wallHit = { id = "", volume = 0.4, jitter = 0.08 },
	footstep = { id = "", volume = 0.15, jitter = 0.12 },
	gameOver = { id = "", volume = 0.7, jitter = 0 },
}

function Sfx.new()
	local self = setmetatable({}, Sfx)
	self.emitter = Instance.new("Part")
	self.emitter.Anchored = true
	self.emitter.CanCollide = false
	self.emitter.Transparency = 1
	self.emitter.Size = Vector3.one
	self.emitter.Parent = workspace
	self.sounds = {} :: { [string]: Sound }
	for key, spec in MANIFEST do
		if spec.id ~= "" then
			local s = Instance.new("Sound")
			s.SoundId = spec.id
			s.Volume = spec.volume
			s.RollOffMaxDistance = 200
			s.Parent = self.emitter
			self.sounds[key] = s
		end
	end
	return self
end

function Sfx:handle(ev: any)
	local spec = MANIFEST[ev.t]
	local sound = self.sounds[ev.t]
	if spec == nil or sound == nil then
		return
	end
	if ev.at ~= nil then
		self.emitter.CFrame = CFrame.new(ev.at.x * SCALE, 1 * SCALE, ev.at.y * SCALE)
	end
	local clone = sound:Clone()
	clone.PlaybackSpeed = 1 + (math.random() * 2 - 1) * spec.jitter
	-- wallHit scales with impact speed, like the web game
	if ev.t == "wallHit" and ev.speed ~= nil then
		clone.Volume = spec.volume * math.clamp(ev.speed / 6, 0.2, 1)
	end
	clone.Parent = self.emitter
	clone:Play()
	clone.Ended:Once(function()
		clone:Destroy()
	end)
end

return Sfx
