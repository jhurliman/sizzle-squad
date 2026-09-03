--!strict
-- Adaptive background music: "Service Starts Now" (roblox/music), rendered as
-- four beat-aligned looping stems and cross-faded at runtime.
--
--   base    bass + Rhodes comp + shaker   always on (the bed; the lobby)
--   groove  drums + kitchen percussion    fades in with HEAT
--   melody  the vibes lead                fades in with HEAT, ducks at high TENSION
--   tension clock ride + riser            fades in as patience drains
--
-- heat    = round progress (sim: min(1, time/240)) -> density/energy
-- tension = 1 - patience                           -> hurry
--
-- The loop is 8 bars at 124 BPM. The stems were rendered from the Ableton set
-- with the returns baked in and the master limiter bypassed, because they are
-- summed HERE, and a limiter applied per-stem breaks the balance between them.
--
-- Ids are empty until the stems are uploaded; empty ids make this a silent
-- no-op, exactly like Sfx before its upload.

local Music = {}
Music.__index = Music

-- Uploaded stems (roblox/audio-out/music/*.wav, uploaded as OGG so the loop
-- seam is gapless); ids also in roblox/audio-out/asset-ids.csv
local STEM_IDS: { [string]: number } = {
	base = 103917816819685,
	groove = 124381822721660,
	melody = 102525063094031,
	tension = 72491671314574,
}

-- GAIN STAGING, FROM MEASUREMENT (roblox/music/gain-staging.mjs).
--
-- The four stems summed at full gain peak at +1.6 dBFS, so MASTER = 0.74 is
-- the most the mix can take before the worst case clips (it lands at -1.0).
-- The first value shipped here was 0.38, calibrated on PEAK against the old
-- sine stems -- but real music has ~13 dB more crest factor than a sine, so
-- matching peaks put the lobby bed at -36 dB RMS against the old -20, and
-- players heard no music at all. Loudness is what to match; peak is only
-- the ceiling.
local MASTER = 0.74
-- 8 bars at 124 BPM: 32 beats * 60 / 124. Must match the rendered files to the
-- sample or the resync in step() fights the loop point every few seconds.
local LOOP_SECONDS = 15.483871
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
		-- See Sfx:verify. A stem that will not load plays silently forever and
		-- nothing anywhere says so.
		task.spawn(function()
			local list = {}
			for _, s in self.sounds do
				table.insert(list, s)
			end
			local ok = pcall(function()
				game:GetService("ContentProvider"):PreloadAsync(list)
			end)
			if not ok then
				warn("[sizzle] audio: PreloadAsync threw; cannot verify music")
				return
			end
			for name, s in self.sounds do
				if not s.IsLoaded then
					warn(`[sizzle] audio: music stem '{name}' ({s.SoundId}) FAILED to load`)
				elseif not s.IsPlaying then
					warn(`[sizzle] audio: music stem '{name}' loaded but is not playing`)
				end
			end
		end)
	else
		warn("[sizzle] audio: no music stems configured (all STEM_IDS are 0)")
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
		-- between rounds: just the bed. At full, not "low": the round is lifted
		-- by the groove arriving, not by the bed getting louder, and 0.35 here
		-- (tuned for the sine stems) was a third of what made the lobby inaudible.
		target = { base = 1, groove = 0, melody = 0, tension = 0 }
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
