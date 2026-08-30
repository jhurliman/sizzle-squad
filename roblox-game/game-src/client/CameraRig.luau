--!strict
-- Fixed camera: the web game's one framing invariant is a 22.5° pitch aimed
-- at the kitchen, width-solved so the room fits every aspect ratio. This is
-- the simplified port of cameraRig.ts's solve: pick a distance so the room's
-- width (plus margin) fits the horizontal FOV, clamp so the back wall's play
-- band stays in frame vertically.

local CameraRig = {}
CameraRig.__index = CameraRig

local SCALE = 5
local ROOM_W = 15 * SCALE
local LOOK_AT = Vector3.new(7.5 * SCALE, 0.9 * SCALE, 4.6 * SCALE)
local PITCH = math.rad(22.5)
local FOV = 40

function CameraRig.new(camera: Camera)
	local self = setmetatable({}, CameraRig)
	self.camera = camera
	self.shake = 0
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = FOV
	return self
end

--- Add a shake impulse (0..~0.5). Decays each update; Vfx drives this off
--- SimEvents (serve, bump, fire, order expiry), like the web game.
function CameraRig:addShake(n: number)
	self.shake = math.min(0.6, self.shake + n)
end

function CameraRig:update(dt: number)
	local camera = self.camera
	-- Character respawns can hand the camera back to the default scripts.
	if camera.CameraType ~= Enum.CameraType.Scriptable then
		camera.CameraType = Enum.CameraType.Scriptable
	end
	local vp = camera.ViewportSize
	local aspect = math.max(0.4, vp.X / math.max(1, vp.Y))
	local vfov = math.rad(camera.FieldOfView)
	local hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
	-- distance so the room width (with a small apron) fits horizontally
	local halfW = ROOM_W * 0.5 + SCALE * 0.8
	local dist = halfW / math.tan(hfov / 2)
	-- never closer than what keeps the play field (floor rows 1..9) vertically framed
	dist = math.max(dist, 11.5 * SCALE)
	local back = CFrame.Angles(-PITCH, 0, 0):VectorToWorldSpace(Vector3.new(0, 0, 1))
	local pos = LOOK_AT + back * dist

	-- screenshake: a decaying random look-at jitter
	self.shake = math.max(0, self.shake - (dt or 1 / 60) * 2.6)
	local s = self.shake * self.shake * 3 -- squared falloff, in studs
	local jitter = Vector3.zero
	if s > 0.001 then
		jitter = Vector3.new((math.random() * 2 - 1) * s, (math.random() * 2 - 1) * s, 0)
	end
	camera.CFrame = CFrame.lookAt(pos + jitter, LOOK_AT + jitter)
end

return CameraRig
