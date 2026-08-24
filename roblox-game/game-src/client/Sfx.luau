--!strict
-- SFX: SimEvent -> Sound. Asset ids are the offline-rendered WebAudio synth
-- (roblox/render-audio.mjs) uploaded to Roblox. Most events have 3 variants
-- rotated at random for variety; serve picks a combo-tier sweetener. Runtime
-- PlaybackSpeed jitter adds further per-play variation.

local Sfx = {}
Sfx.__index = Sfx

local SCALE = 5

-- variant id pools per event (rbxassetid appended at load)
local IDS: { [string]: { number } } = {
	pickup = { 70742498292239, 123560608675260, 126860492685486 },
	place = { 78682289069941, 104311216877665, 104903357333113 },
	grabMiss = { 101025025823140, 129680454867105, 74477525430397 },
	chopTick = { 131347064338351, 112028826116185, 134728812834873 },
	chopDone = { 115141055918463, 110850012407489, 122749974832353 },
	cookDone = { 132192473235728, 123520689449664, 80188608697103 },
	burn = { 102502156885329, 112026922117984, 113529459573263 },
	fireStart = { 73372412080497, 95174122725246, 73270780016751 },
	serveWrong = { 82987546658291, 77960911261094, 132950795845457 },
	orderNew = { 135203721574687, 124199116815750, 132220638377490 },
	orderExpired = { 85656585787859, 86003663197057, 124453697851064 },
	trash = { 119397322627718, 86963719289809, 92707612390285 },
	bump = { 128013935045428, 74578977729813, 78549598528309 },
	wallHit = { 100703255477899, 130669918705753 },
	footstep = { 115509335528663, 131433980369331, 110103705046747 },
	gameOver = { 95283739076504, 116993630334280, 78403453730326 },
	serve = { 78725832933494 }, -- base; combo tiers picked from SERVE_COMBO
	-- washDone: not yet uploaded — falls back to chopDone (both "task done")
}

-- serve sweetener by combo tier: highest tier <= combo wins
local SERVE_COMBO = { { 8, 86410763274543 }, { 4, 98280134619867 }, { 1, 82738875157205 } }

local SPEC: { [string]: { volume: number, jitter: number } } = {
	pickup = { volume = 0.5, jitter = 0.06 },
	place = { volume = 0.5, jitter = 0.06 },
	grabMiss = { volume = 0.35, jitter = 0.02 },
	chopTick = { volume = 0.45, jitter = 0.08 },
	chopDone = { volume = 0.55, jitter = 0.04 },
	cookDone = { volume = 0.55, jitter = 0.04 },
	burn = { volume = 0.6, jitter = 0.03 },
	fireStart = { volume = 0.7, jitter = 0 },
	serve = { volume = 0.65, jitter = 0.03 },
	serveWrong = { volume = 0.5, jitter = 0.02 },
	orderNew = { volume = 0.45, jitter = 0.02 },
	orderExpired = { volume = 0.5, jitter = 0.02 },
	trash = { volume = 0.45, jitter = 0.05 },
	washDone = { volume = 0.5, jitter = 0.04 },
	bump = { volume = 0.55, jitter = 0.08 },
	wallHit = { volume = 0.4, jitter = 0.08 },
	footstep = { volume = 0.15, jitter = 0.12 },
	gameOver = { volume = 0.7, jitter = 0 },
}

-- washDone has no dedicated upload yet — reuse the chop-done chime
IDS.washDone = IDS.chopDone

function Sfx.new()
	local self = setmetatable({}, Sfx)
	self.emitter = Instance.new("Part")
	self.emitter.Anchored = true
	self.emitter.CanCollide = false
	self.emitter.Transparency = 1
	self.emitter.Size = Vector3.one
	self.emitter.Parent = workspace
	-- one template Sound per unique asset id, cloned on play
	self.byId = {} :: { [number]: Sound }
	for _, ids in IDS do
		for _, id in ids do
			if self.byId[id] == nil then
				local s = Instance.new("Sound")
				s.SoundId = `rbxassetid://{id}`
				s.RollOffMaxDistance = 200
				s.Parent = self.emitter
				self.byId[id] = s
			end
		end
	end
	for _, entry in SERVE_COMBO do
		local id = entry[2]
		if self.byId[id] == nil then
			local s = Instance.new("Sound")
			s.SoundId = `rbxassetid://{id}`
			s.RollOffMaxDistance = 200
			s.Parent = self.emitter
			self.byId[id] = s
		end
	end
	return self
end

function Sfx:handle(ev: any)
	local spec = SPEC[ev.t]
	if spec == nil then
		return
	end

	-- pick the asset id: serve is combo-tiered, everything else is a random
	-- variant from its pool
	local id: number? = nil
	if ev.t == "serve" then
		local combo = ev.combo or 1
		for _, entry in SERVE_COMBO do
			if combo >= entry[1] then
				id = entry[2]
				break
			end
		end
	else
		local pool = IDS[ev.t]
		if pool ~= nil and #pool > 0 then
			id = pool[math.random(#pool)]
		end
	end
	if id == nil then
		return
	end
	local template = self.byId[id]
	if template == nil then
		return
	end

	if ev.at ~= nil then
		self.emitter.CFrame = CFrame.new(ev.at.x * SCALE, 1 * SCALE, ev.at.y * SCALE)
	end
	local clone = template:Clone()
	clone.Volume = spec.volume
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
