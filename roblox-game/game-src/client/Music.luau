--!strict
-- Adaptive background music: the web game's tickMusic score, pre-rendered as
-- four beat-aligned looping stems (roblox/render-music.mjs) and cross-faded
-- at runtime instead of synthesized note-by-note.
--
--   base    bass + comp chords + shaker   always on (the bed)
--   groove  swing hats                    fades in with HEAT
--   melody  the sine lead                 fades in with HEAT, ducks at high TENSION
--   tension low drone + heartbeat kick    fades in as patience drains
--
-- heat    = round progress (sim: min(1, time/240)) -> density/energy
-- tension = 1 - patience                           -> dread
--
-- Ids are empty until the stems are uploaded; empty ids make this a silent
-- no-op, exactly like Sfx before its upload.

local Music = {}
Music.__index = Music

-- Uploaded stems (roblox/audio-out/music/*.wav); ids also in
-- roblox/audio-out/asset-ids.csv
local STEM_IDS: { [string]: number } = {
	base = 129864158072696,
	groove = 118440772838108,
	melody = 102104965215015,
	tension = 83239315866871,
}

-- The stems are rendered at the web engine's own note gains, which are quiet
-- by design (peaks ~0.1-0.26). MASTER lifts them to a musical bed level that
-- still sits UNDER the SFX (whose volumes are 0.15-0.7).
local MASTER = 1.6
local LOOP_SECONDS = 7.5
local RESYNC_TOLERANCE = 0.04

function Music.new(parent: Instance)
	local self = setmetatable({}, Music)
	self.sounds = {} :: { [string]: Sound }
	self.gain = { base = 0, groove = 0, melody = 0, tension = 0 }
	self.duck = 0
	self.resyncAcc = 0
	self.enabled = false

	for name, id in STEM_IDS do
		if id ~= 0 then
			local s = Instance.new("Sound")
			s.Name = `music_{name}`
			s.SoundId = `rbxassetid://{id}`
			s.Looped = true
			s.Volume = 0
			s.Parent = parent
			self.sounds[name] = s
			self.enabled = true
		end
	end
	if self.enabled then
		-- start every stem on the same frame so they stay phase-locked
		for _, s in self.sounds do
			s.TimePosition = 0
			s:Play()
		end
	end
	return self
end

--- Sidechain: the music steps aside briefly for the events that decide the
--- run (serve, fire, expiry), like the web engine's duck().
function Music:sidechain(amount: number)
	self.duck = math.max(self.duck, math.clamp(amount, 0, 0.85))
end

--- heat 0..1 (round progress), patience 0..1 (1 = calm)
function Music:update(dt: number, heat: number, patience: number, playing: boolean)
	if not self.enabled then
		return
	end
	local tension = math.clamp(1 - patience, 0, 1)
	heat = math.clamp(heat, 0, 1)

	-- target mix (mirrors tickMusic's gates, as continuous fades)
	local target
	if not playing then
		-- between rounds: just the bed, low
		target = { base = 0.35, groove = 0, melody = 0, tension = 0 }
	else
		target = {
			base = 1,
			groove = math.clamp((heat - 0.05) / 0.45, 0, 1),
			-- melody arrives once the kitchen is busy and DROPS OUT when it is
			-- desperate (web: tension < 0.85 gate)
			melody = math.clamp((heat - 0.15) / 0.4, 0, 1) * (1 - math.clamp((tension - 0.6) / 0.25, 0, 1)),
			tension = math.clamp((tension - 0.3) / 0.35, 0, 1),
		}
	end

	self.duck = math.max(0, self.duck - dt * 2.2)
	local duckMul = 1 - self.duck

	for name, s in self.sounds do
		local want = target[name] or 0
		-- fade toward the target (slow enough that layers swell, not pop)
		local g = self.gain[name] or 0
		g += (want - g) * math.min(1, dt * 1.6)
		self.gain[name] = g
		s.Volume = g * MASTER * duckMul
	end

	-- keep the stems phase-locked: drift accumulates over a long round
	self.resyncAcc += dt
	if self.resyncAcc >= 1 then
		self.resyncAcc = 0
		local ref = self.sounds.base
		if ref ~= nil and ref.IsPlaying then
			local t = ref.TimePosition
			for name, s in self.sounds do
				if name ~= "base" and s.IsPlaying then
					local drift = math.abs(s.TimePosition - t)
					-- ignore wrap-around at the loop seam
					if drift > RESYNC_TOLERANCE and drift < LOOP_SECONDS - RESYNC_TOLERANCE then
						s.TimePosition = t
					end
				end
			end
		end
	end
end

return Music
