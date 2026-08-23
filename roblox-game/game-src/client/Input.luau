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
		ContextActionService:SetPosition(ACTION, UDim2.new(1, -90, 1, -140))
		pcall(function()
			ContextActionService:GetButton(ACTION).Size = UDim2.fromOffset(76, 76)
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
	local m = { x = mv.X, y = mv.Z }
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
