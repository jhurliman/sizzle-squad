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
	pickup = { 116565307628688, 98244731534332, 120725568891115 },
	place = { 82765328173683, 87794863632237, 90683806890518 },
	grabMiss = { 103994059414693, 120313926599024, 104404837997058 },
	chopTick = { 86199251799477, 87051733570954, 118937905609456 },
	chopDone = { 87078574467127, 99748852850393, 77153225992651 },
	cookDone = { 108628575941283, 134874026924168, 74875496334875 },
	burn = { 96222589240342, 118496230616846, 127414958737688 },
	fireStart = { 96570570851553, 76145888669676, 130549729938719 },
	serveWrong = { 113140804420381, 126004456443753, 130050130652167 },
	orderNew = { 123206417309153, 123837868019919, 86285926640367 },
	orderExpired = { 114291548596392, 92752925284168, 86202552948986 },
	trash = { 140226776501946, 120454781991214, 117211499101727 },
	bump = { 106119264790382, 73150088543705, 78896764394313 },
	wallHit = { 71460847969100, 131886397254237, 74132530380504 },
	footstep = { 101406510333811, 106934543954293, 86889340339827 },
	gameOver = { 119109576484336, 122807603685583, 117901360747545 },
	washDone = { 94498378532704, 112844666713796, 76440005123987 },
	serve = { 108006776436290 }, -- base; combo tiers picked from SERVE_COMBO
}

-- serve sweetener by combo tier: highest tier <= combo wins
local SERVE_COMBO = { { 8, 87647306496856 }, { 4, 119217968287732 }, { 1, 73582064874002 } }

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

--- Serve-bell cosmetics. There is no separate bell upload, so the variant is
--- a playback-rate shift on the existing serve chime: audible, honest, and it
--- needs no asset, no replication and no election (it is LOCAL audio -- only
--- the owner hears their own bell, so two players can never conflict).
local BELL_RATE: { [string]: number } = { deep = 0.75, chime = 1.35 }

function Sfx:setKitchen(catalog: any, equipped: any)
	self.bellRate = nil
	local id = equipped ~= nil and equipped.kitchen_bell or nil
	if id == nil then
		return
	end
	local item = catalog.byId[id]
	if item ~= nil and item.variant ~= nil then
		self.bellRate = BELL_RATE[item.variant]
	end
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
	-- equipped serve bell retunes the serve chime
	if ev.t == "serve" and self.bellRate ~= nil then
		clone.PlaybackSpeed *= self.bellRate
	end
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
