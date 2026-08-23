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
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = FOV
	return self
end

function CameraRig:update()
	local camera = self.camera
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
	camera.CFrame = CFrame.lookAt(pos, LOOK_AT)
end

return CameraRig
