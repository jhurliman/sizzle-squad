--!strict
-- Fixed camera, as a set of named SHOTS with a real move between them.
--
-- The gameplay shot is the web game's one framing invariant: a 22.5° pitch
-- aimed at the kitchen, width-solved so the room fits every aspect ratio. It
-- is unchanged -- the port of cameraRig.ts's solve, picking a distance so the
-- room's width (plus margin) fits the horizontal FOV, clamped so the back
-- wall's play band stays in frame vertically.
--
-- WHY SHOTS, RATHER THAN ONE SOLVE PLUS OVERRIDES.
--
-- The results push-in used to live inline in main.client.luau: it grabbed the
-- camera on its own RenderStepped, held for four seconds, then Disconnect()ed
-- -- which SNAPPED the camera back in a single frame with eight seconds of the
-- ceremony still running. It only won control at all because its connection
-- was made later than this rig's and therefore ran after it, every frame, in a
-- fight nobody had written down. Two things drive the camera now and both are
-- here, so a move has somewhere to end.
--
-- EVERY SHOT IS RE-SOLVED EVERY FRAME, including mid-move. That is what keeps
-- a device rotation (or a Studio window drag) from stranding a blend between
-- two poses that were correct for an aspect ratio nobody is looking at any
-- more. The blend interpolates the SOLVED position, look-at and FOV
-- separately and rebuilds the CFrame with lookAt, rather than slerping two
-- finished CFrames -- that keeps the subject pinned to frame centre for the
-- whole move instead of letting it drift and swing back.
--
-- FOV is deliberately equal across the shots. The lobby closeup is pure dolly:
-- moving the camera and changing the lens at the same time is the one thing
-- that reliably makes a game camera feel cheap.
--
-- THE LOBBY PUSHES THE KITCHEN BACK WITH HAZE, and that is a deliberate
-- second choice.
--
-- The first attempt was DepthOfFieldEffect, which is the only depth-aware
-- effect Roblox has -- and it does not render. Proven, not assumed: a DOF at
-- physically absurd settings (FocusDistance 1, InFocusRadius 0, both
-- intensities at 1, which should reduce the whole viewport to mush) changed
-- nothing, while a ColorCorrectionEffect greyscale planted beside it as a
-- control worked. DOF is among the first things the engine drops below high
-- render quality, developers cannot raise a client's quality setting, and this
-- game is played on phones.
--
-- Atmosphere is not post-processing. It is part of the base render path, so it
-- survives where the post effects do not, and it attenuates with DISTANCE --
-- which is the property that matters here. Not blur: the background washes out
-- rather than softening. But visible to the people actually playing, which the
-- blur was not.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Staging = require(ReplicatedStorage:WaitForChild("Game"):WaitForChild("Staging")) :: any

local CameraRig = {}
CameraRig.__index = CameraRig

local SCALE = 5
local ROOM_W = 15 * SCALE
local FOV = 40

-- The gameplay framing.
local PLAY_LOOK = Vector3.new(7.5 * SCALE, 0.9 * SCALE, 4.6 * SCALE)
local PLAY_PITCH = math.rad(22.5)

-- THE CLOSE SHOTS ARE SOLVED FROM THE MARKS, NOT FROM CONSTANTS.
--
-- Staging.LINEUP is where the crew actually ends up standing. Deriving the
-- framing from it means moving a mark moves the camera to match, instead of
-- leaving a hardcoded half-width behind to frame a patch of floor nobody
-- stands on any more.
--
-- Verified against the built place before choosing the pitch: nothing above
-- knee height sits forward of z=44 in the middle third of the room, and the
-- floor aprons out to z≈70, so a low camera in front of the lineup has both a
-- clear sightline and somewhere to stand.
local BODY = 0.36 -- cells, TUNING.chefRadius
local CHEF_H = 1.6 -- cells, head clearance to keep in frame

-- HOW MUCH THE BACKGROUND SOFTENS, PER SHOT.
--
-- Far only. The ask was blur BEHIND the crew, and the camera sits low and
-- pitched over open floor, so any near blur would land on the foreground
-- boards a player is about to walk over.
--
-- How strongly the room behind the crew washes out, 0..1, per shot. Anything
-- not listed -- gameplay -- is 0, and at 0 the atmosphere is unparented rather
-- than left at zero density: it is a global environmental object, and a kitchen
-- that is meant to be crisp should not have one hanging off Lighting at all.
local SHOT_HAZE = { lobby = 1, photo = 0.75 }

-- What a strength of 1 means. Density is how much there is; Haze is how much it
-- veils what is behind it, and is the one doing the visible work.
--
-- Deliberately WARM. The room is lit by a hearth and hanging timber lights, and
-- a neutral grey fog in a warm kitchen reads as a rendering fault rather than
-- as air.
local HAZE_DENSITY = 0.45
local HAZE_AMOUNT = 3
local HAZE_COLOR = Color3.fromRGB(255, 236, 206)

local ATMO_NAME = "SizzleLobbyHaze"

local function hazeFor(name: string): number
	return SHOT_HAZE[name] or 0
end

-- ONE ATMOSPHERE FOR THE WHOLE CLIENT, HELD AT MODULE LEVEL.
--
-- It was per-rig, and that was wrong twice over. Lighting takes ONE
-- atmosphere, so it is not per-instance state to begin with -- and because the
-- off state is "unparented", a second rig could not find the first one's to
-- reuse it and simply made another. Caught by the harness building more than
-- one rig, which is what a Rojo hot-sync does in Studio: two atmospheres, one
-- of them stale and still attached.
local sharedAtmo: any = nil
local atmoResolved = false

local function ensureAtmo(): any
	if atmoResolved then
		return sharedAtmo
	end
	atmoResolved = true
	pcall(function()
		local lighting = game:GetService("Lighting")
		local existing = lighting:FindFirstChildOfClass("Atmosphere")
		-- IF THE PLACE ALREADY HAS ONE, LEAVE IT ALONE. Parenting ours beside an
		-- artist-authored atmosphere would either be ignored or quietly rewrite
		-- the look of the whole game.
		if existing ~= nil and existing.Name ~= ATMO_NAME then
			return
		end
		local atmo = existing
		if atmo == nil then
			atmo = Instance.new("Atmosphere")
			atmo.Name = ATMO_NAME
		end
		atmo.Color = HAZE_COLOR
		atmo.Parent = nil
		sharedAtmo = atmo
	end)
	return sharedAtmo
end

local SHOTS = {
	lobby = { marks = Staging.LINEUP, pitch = math.rad(14), lookH = 1.0, air = 0.62, minDist = 4.0 * SCALE },
	-- A touch further back and higher, so the confetti arc has room to read
	-- above their heads.
	photo = { marks = Staging.POSE, pitch = math.rad(17), lookH = 1.15, air = 1.05, minDist = 4.8 * SCALE },
}

--- Solve one shot for the current aspect ratio.
--- Returns position, look-at and field of view.
local function solve(name: string, aspect: number): (Vector3, Vector3, number)
	local hfov = 2 * math.atan(math.tan(math.rad(FOV) / 2) * aspect)
	local tanH = math.tan(hfov / 2)

	local shot = SHOTS[name]
	if shot == nil then
		-- gameplay: unchanged from the original solve
		local halfW = ROOM_W * 0.5 + SCALE * 0.8
		local dist = math.max(halfW / tanH, 11.5 * SCALE)
		local back = CFrame.Angles(-PLAY_PITCH, 0, 0):VectorToWorldSpace(Vector3.new(0, 0, 1))
		return PLAY_LOOK + back * dist, PLAY_LOOK, FOV
	end

	local cx, cy = Staging.centre(shot.marks)
	local look = Vector3.new(cx * SCALE, shot.lookH * SCALE, cy * SCALE)
	local edge = (BODY + shot.air) * SCALE

	-- A mark nearer the camera than the look plane subtends a wider angle, so
	-- the half-width the solve needs is not simply the widest mark: each one is
	-- projected back onto the look plane first. Distance is what decides that
	-- projection and distance is what we are solving for, so run it twice --
	-- the second pass is already inside a stud.
	local maxOff = 0
	for _, m in shot.marks do
		maxOff = math.max(maxOff, math.abs(m.x - cx) * SCALE)
	end
	local dist = math.max((maxOff + edge) / tanH, shot.minDist)
	for _ = 1, 2 do
		local depthToLook = dist * math.cos(shot.pitch)
		local need = 0
		for _, m in shot.marks do
			local off = math.abs(m.x - cx) * SCALE + edge
			local depth = math.max(SCALE, depthToLook - (m.y - cy) * SCALE)
			need = math.max(need, off * depthToLook / depth)
		end
		-- Heads must survive too, or a tight aspect crops the hats off.
		local needV = ((CHEF_H - shot.lookH) + shot.air) * SCALE
		dist = math.max(need / tanH, needV / math.tan(math.rad(FOV) / 2), shot.minDist)
	end

	local back = CFrame.Angles(-shot.pitch, 0, 0):VectorToWorldSpace(Vector3.new(0, 0, 1))
	return look + back * dist, look, FOV
end

-- Smootherstep. Zero velocity AND zero acceleration at both ends, which is
-- what stops a dolly from reading as a lurch at the start and a stop at the
-- end. No overshoot, so the framing never has to settle back.
local function smootherstep(t: number): number
	t = math.clamp(t, 0, 1)
	return t * t * t * (t * (t * 6 - 15) + 10)
end

local function easeOutCubic(t: number): number
	t = math.clamp(t, 0, 1)
	return 1 - (1 - t) ^ 3
end

function CameraRig.new(camera: Camera)
	local self = setmetatable({}, CameraRig)
	self.camera = camera
	self.shake = 0
	self.shot = "gameplay"
	-- Move state. `from` is either a shot name (re-solved every frame, so it
	-- survives an aspect change) or a frozen pose, used when a move is
	-- interrupted part-way and there is no clean shot to come from.
	self.fromShot = nil :: string?
	self.fromPose = nil :: any
	self.moveT = 0
	self.moveDur = 0
	self.easing = "smooth"
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = FOV

	-- Shared, not owned: see ensureAtmo. nil in a harness with no Lighting to
	-- hang it on, and applyHaze no-ops in that case.
	pcall(function()
		self.lighting = game:GetService("Lighting")
	end)
	self.atmo = ensureAtmo()
	return self
end

--- How far back the kitchen sits, 0..1.
---
--- Unparented rather than zeroed at 0: Atmosphere has no Enabled property, and
--- an atmosphere at zero density is still an environmental object attached to
--- Lighting. The parent only changes when the on/off state flips, not every
--- frame.
function CameraRig:applyHaze(strength: number)
	local atmo = self.atmo
	if atmo == nil then
		return
	end
	if strength <= 0.001 then
		if atmo.Parent ~= nil then
			atmo.Parent = nil
		end
		return
	end
	-- Both scale from zero, so the room clears as the camera pulls out rather
	-- than the haze simply being switched off at the end of the move.
	atmo.Density = HAZE_DENSITY * strength
	atmo.Haze = HAZE_AMOUNT * strength
	if atmo.Parent ~= self.lighting then
		atmo.Parent = self.lighting
	end
end

--- Add a shake impulse (0..~0.5). Decays each update; Vfx drives this off
--- SimEvents (serve, bump, fire, order expiry), like the web game.
function CameraRig:addShake(n: number)
	self.shake = math.min(0.6, self.shake + n)
end

--- Move to a named shot: "gameplay", "lobby" or "photo".
--- `duration` of 0 (or a repeat of the current shot) cuts immediately.
function CameraRig:cutTo(shot: string, duration: number?, easing: string?)
	if shot == self.shot and self.moveDur <= 0 then
		return
	end
	local dur = duration or 0
	if dur <= 0 then
		self.shot = shot
		self.fromShot, self.fromPose, self.moveDur, self.moveT = nil, nil, 0, 0
		return
	end
	if self.moveDur > 0 then
		-- Interrupted mid-move: freeze where we actually are so the new move
		-- starts from the visible pose rather than jumping to a shot we never
		-- reached.
		local aspect = self:aspect()
		local pos, look, fov, haze = self:resolve(aspect)
		self.fromShot = nil
		self.fromPose = { pos = pos, look = look, fov = fov, haze = haze }
	else
		self.fromShot = self.shot
		self.fromPose = nil
	end
	self.shot = shot
	self.moveDur = dur
	self.moveT = 0
	self.easing = easing or "smooth"
end

function CameraRig:isMoving(): boolean
	return self.moveDur > 0
end

function CameraRig:aspect(): number
	local vp = self.camera.ViewportSize
	return math.max(0.4, vp.X / math.max(1, vp.Y))
end

--- The pose for this frame, blend included, before shake. Fourth return is the
--- haze strength, blended on the SAME curve as the pose -- the whole point of a
--- move is that nothing in it steps, and the kitchen coming back into clear air
--- is half of what sells the pull-out at go time.
function CameraRig:resolve(aspect: number): (Vector3, Vector3, number, number)
	local pos, look, fov = solve(self.shot, aspect)
	local haze = hazeFor(self.shot)
	if self.moveDur <= 0 then
		return pos, look, fov, haze
	end
	local fPos, fLook, fFov, fHaze
	if self.fromPose ~= nil then
		fPos, fLook, fFov = self.fromPose.pos, self.fromPose.look, self.fromPose.fov
		fHaze = self.fromPose.haze or 0
	else
		fPos, fLook, fFov = solve(self.fromShot or "gameplay", aspect)
		fHaze = hazeFor(self.fromShot or "gameplay")
	end
	local raw = math.clamp(self.moveT / self.moveDur, 0, 1)
	local k = if self.easing == "out" then easeOutCubic(raw) else smootherstep(raw)
	return fPos:Lerp(pos, k), fLook:Lerp(look, k), fFov + (fov - fFov) * k, fHaze + (haze - fHaze) * k
end

function CameraRig:update(dt: number)
	local camera = self.camera
	-- Character respawns can hand the camera back to the default scripts.
	if camera.CameraType ~= Enum.CameraType.Scriptable then
		camera.CameraType = Enum.CameraType.Scriptable
	end
	dt = dt or 1 / 60

	if self.moveDur > 0 then
		self.moveT += dt
		if self.moveT >= self.moveDur then
			self.moveT, self.moveDur = 0, 0
			self.fromShot, self.fromPose = nil, nil
		end
	end

	local pos, look, fov, haze = self:resolve(self:aspect())
	if math.abs(camera.FieldOfView - fov) > 0.01 then
		camera.FieldOfView = fov
	end
	self:applyHaze(haze)

	-- screenshake: a decaying random look-at jitter
	self.shake = math.max(0, self.shake - dt * 2.6)
	local s = self.shake * self.shake * 3 -- squared falloff, in studs
	local jitter = Vector3.zero
	if s > 0.001 then
		jitter = Vector3.new((math.random() * 2 - 1) * s, (math.random() * 2 - 1) * s, 0)
	end
	camera.CFrame = CFrame.lookAt(pos + jitter, look + jitter)
end

return CameraRig
