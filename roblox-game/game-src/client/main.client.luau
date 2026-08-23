--!strict
-- P1 stub: fixed camera aimed at the kitchen (the game's one framing
-- invariant). Replaced by the ported cameraRig + movement client in P2.
local Workspace = game:GetService("Workspace")

local SCALE = 5 -- studs per kitchen cell (matches roblox/prepare.mjs)
local camera = Workspace.CurrentCamera :: Camera
camera.CameraType = Enum.CameraType.Scriptable
camera.FieldOfView = 40
camera.CFrame = CFrame.lookAt(
	Vector3.new(7.5 * SCALE, 11 * SCALE, 21 * SCALE),
	Vector3.new(7.5 * SCALE, 0.8 * SCALE, 4.4 * SCALE)
)
