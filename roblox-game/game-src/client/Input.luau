--!strict
-- Input: one context action button + the platform move vector, exactly the
-- web game's scheme (tap = the sim decides via planGrab; no separate verbs).
-- Keyboard: E / Space. Gamepad: ButtonA. Touch: CAS-created button, bottom
-- right, whose icon text swaps to the current focusAction verb.

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local Input = {}
Input.__index = Input

local ACTION = "SizzleAction"

function Input.new()
	local self = setmetatable({}, Input)
	self.grabQueued = false
	self.useHeld = false
	self.moveVector = Vector2.zero
	self.controlModule = nil
	-- Roblox's default control module maps Left/Right arrows to CAMERA
	-- rotation (dead under a scriptable camera) — only Up/Down move. Track
	-- the horizontal arrows ourselves and merge them into the move vector.
	self.arrowX = 0
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed then
			return
		end
		if input.KeyCode == Enum.KeyCode.Left then
			self.arrowX = -1
		elseif input.KeyCode == Enum.KeyCode.Right then
			self.arrowX = 1
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.KeyCode == Enum.KeyCode.Left and self.arrowX < 0 then
			self.arrowX = 0
		elseif input.KeyCode == Enum.KeyCode.Right and self.arrowX > 0 then
			self.arrowX = 0
		end
	end)

	-- PlayerModule's ControlModule unifies WASD/thumbstick/gamepad.
	task.spawn(function()
		local player = Players.LocalPlayer
		local scripts = player:WaitForChild("PlayerScripts")
		local ok, module = pcall(function()
			return require(scripts:WaitForChild("PlayerModule")):GetControls()
		end)
		if ok then
			self.controlModule = module
		end
	end)

	ContextActionService:BindAction(ACTION, function(_, state)
		if state == Enum.UserInputState.Begin then
			self.grabQueued = true
			self.useHeld = true
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			self.useHeld = false
		end
		return Enum.ContextActionResult.Sink
	end, true, Enum.KeyCode.E, Enum.KeyCode.Space, Enum.KeyCode.ButtonA)
	if UserInputService.TouchEnabled then
		-- Roblox's default touch JUMP button (dark circle, up arrow) sits in
		-- the bottom-right thumb spot and our action button landed on top of
		-- it. Chefs never jump, so retire it and take that spot: it is the
		-- best thumb real estate on the screen and the action button is the
		-- ONLY button this game has.
		--
		-- Hidden by name wherever it appears, and re-hidden on DescendantAdded
		-- because the touch GUI is rebuilt on respawn and device changes.
		local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")
		local function hideJump(inst: Instance)
			if inst.Name == "JumpButton" and inst:IsA("GuiObject") then
				inst.Visible = false
			end
		end
		for _, d in playerGui:GetDescendants() do
			hideJump(d)
		end
		playerGui.DescendantAdded:Connect(function(d)
			task.defer(hideJump, d)
		end)

		ContextActionService:SetPosition(ACTION, UDim2.new(1, -104, 1, -124))
		pcall(function()
			ContextActionService:GetButton(ACTION).Size = UDim2.fromOffset(88, 88)
		end)
	end
	self:setVerb("none")
	return self
end

local VERB_LABEL: { [string]: string } = {
	none = "",
	take = "TAKE",
	dispense = "TAKE",
	place = "PUT",
	combine = "ADD",
	load = "PLATE",
	swap = "SWAP",
	["return"] = "RETURN",
	serve = "SERVE!",
	discard = "BIN",
	prep = "WORK",
	unload = "TAKE",
}

function Input:setVerb(action: string)
	pcall(function()
		ContextActionService:SetTitle(ACTION, VERB_LABEL[action] or "")
	end)
end

--- Kitchen-space move vector. Camera faces -Z, so screen-up is kitchen -y:
--- world X -> kitchen x, world Z -> kitchen y, no rotation needed.
function Input:move(): { x: number, y: number }
	local mv = Vector3.zero
	if self.controlModule ~= nil then
		local ok, v = pcall(function()
			return self.controlModule:GetMoveVector()
		end)
		if ok and typeof(v) == "Vector3" then
			mv = v
		end
	end
	local m = { x = mv.X + self.arrowX, y = mv.Z }
	local len = math.sqrt(m.x * m.x + m.y * m.y)
	if len > 1 then
		m.x /= len
		m.y /= len
	end
	return m
end

--- Consume the queued rising edge (one per call).
function Input:takeGrab(): boolean
	local g = self.grabQueued
	self.grabQueued = false
	return g
end

return Input
