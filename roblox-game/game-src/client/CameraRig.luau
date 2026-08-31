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
	return self
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
		local pos, look, fov = self:resolve(aspect)
		self.fromShot = nil
		self.fromPose = { pos = pos, look = look, fov = fov }
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

--- The pose for this frame, blend included, before shake.
function CameraRig:resolve(aspect: number): (Vector3, Vector3, number)
	local pos, look, fov = solve(self.shot, aspect)
	if self.moveDur <= 0 then
		return pos, look, fov
	end
	local fPos, fLook, fFov
	if self.fromPose ~= nil then
		fPos, fLook, fFov = self.fromPose.pos, self.fromPose.look, self.fromPose.fov
	else
		fPos, fLook, fFov = solve(self.fromShot or "gameplay", aspect)
	end
	local raw = math.clamp(self.moveT / self.moveDur, 0, 1)
	local k = if self.easing == "out" then easeOutCubic(raw) else smootherstep(raw)
	return fPos:Lerp(pos, k), fLook:Lerp(look, k), fFov + (fov - fFov) * k
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

	local pos, look, fov = self:resolve(self:aspect())
	if math.abs(camera.FieldOfView - fov) > 0.01 then
		camera.FieldOfView = fov
	end

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
