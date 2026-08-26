--!strict
-- Our own touch thumbstick.
--
-- WHY, given Roblox ships one: because its jump button comes with it, and the
-- jump button cannot be reliably removed. PlayerModule's TouchJump re-creates
-- and re-shows it on respawn, on device change, and on every
-- ControlModule:Enable() -- which the menu triggers every time it closes. Every
-- hide is a race against code that legitimately owns that button.
--
-- ControlModule:Disable() DOES remove the whole touch UI, jump button
-- included, and it is supported and total. It just takes the movement stick
-- with it. So on touch-only devices we disable Roblox's controls outright and
-- drive movement from this instead. Nothing left to fight.
--
-- Desktop and gamepad keep PlayerModule (there is no touch UI there to hide,
-- and GetMoveVector already unifies WASD and stick).

local UserInputService = game:GetService("UserInputService")

local Thumbstick = {}
Thumbstick.__index = Thumbstick

local RADIUS = 62 -- travel to full deflection
local DEAD = 0.12

function Thumbstick.new(gui: Instance)
	local self = setmetatable({}, Thumbstick)
	self.vector = Vector2.zero
	self.touchId = nil :: any
	self.enabled = true

	self.base = Instance.new("Frame")
	self.base.Name = "Thumbstick"
	self.base.AnchorPoint = Vector2.new(0.5, 0.5)
	self.base.Size = UDim2.fromOffset(RADIUS * 2, RADIUS * 2)
	self.base.BackgroundColor3 = Color3.fromRGB(255, 244, 221)
	self.base.BackgroundTransparency = 0.75
	self.base.BorderSizePixel = 0
	self.base.Visible = false
	self.base.ZIndex = 2
	self.base.Parent = gui
	local c1 = Instance.new("UICorner")
	c1.CornerRadius = UDim.new(1, 0)
	c1.Parent = self.base

	self.knob = Instance.new("Frame")
	self.knob.AnchorPoint = Vector2.new(0.5, 0.5)
	self.knob.Position = UDim2.fromScale(0.5, 0.5)
	self.knob.Size = UDim2.fromOffset(RADIUS, RADIUS)
	self.knob.BackgroundColor3 = Color3.fromRGB(255, 244, 221)
	self.knob.BackgroundTransparency = 0.35
	self.knob.BorderSizePixel = 0
	self.knob.ZIndex = 3
	self.knob.Parent = self.base
	local c2 = Instance.new("UICorner")
	c2.CornerRadius = UDim.new(1, 0)
	c2.Parent = self.knob

	self:bind()
	return self
end

function Thumbstick:bind()
	UserInputService.InputBegan:Connect(function(input, processed)
		-- `processed` means a GUI button took it: the action button, an emote,
		-- anything in the menu. Never steal those.
		if processed or not self.enabled or self.touchId ~= nil then
			return
		end
		if input.UserInputType ~= Enum.UserInputType.Touch then
			return
		end
		local cam = workspace.CurrentCamera
		local viewport = if cam ~= nil then cam.ViewportSize else Vector2.new(1280, 720)
		-- Left half only, so the right thumb stays free for the action button.
		if input.Position.X > viewport.X * 0.5 then
			return
		end
		self.touchId = input
		self.origin = Vector2.new(input.Position.X, input.Position.Y)
		self.base.Position = UDim2.fromOffset(self.origin.X, self.origin.Y)
		self.knob.Position = UDim2.fromScale(0.5, 0.5)
		self.base.Visible = true
	end)

	UserInputService.InputChanged:Connect(function(input)
		if self.touchId ~= input or not self.enabled then
			return
		end
		local p = Vector2.new(input.Position.X, input.Position.Y)
		local delta = p - self.origin
		local len = delta.Magnitude
		local clamped = if len > RADIUS then delta * (RADIUS / len) else delta
		self.knob.Position = UDim2.new(0.5, clamped.X, 0.5, clamped.Y)
		local v = delta / RADIUS
		if v.Magnitude > 1 then
			v = v.Unit
		end
		self.vector = if v.Magnitude < DEAD then Vector2.zero else v
	end)

	local function release(input: any)
		if self.touchId ~= input then
			return
		end
		self.touchId = nil
		self.vector = Vector2.zero
		self.base.Visible = false
	end
	UserInputService.InputEnded:Connect(release)
	UserInputService.TouchEnded:Connect(release)
end

function Thumbstick:setEnabled(on: boolean)
	self.enabled = on
	if not on then
		self.touchId = nil
		self.vector = Vector2.zero
		self.base.Visible = false
	end
end

--- Screen-space move vector, y DOWN (matches Roblox's GetMoveVector Z).
function Thumbstick:move(): Vector2
	return self.vector
end

return Thumbstick
