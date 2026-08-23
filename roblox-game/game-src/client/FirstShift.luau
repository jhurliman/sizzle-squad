--!strict
-- "First Shift" onboarding (plan §2.6): contextual prompts only, layered on
-- the focus-glow system. One instruction on screen at a time, per-player
-- overlay, never pauses the kitchen, skippable, silently retires at level 3
-- or 3 rounds. The rules read the client's mirrored state each tick and pick
-- the single most relevant next step.

local FirstShift = {}
FirstShift.__index = FirstShift

local function mk(class: string, props: { [string]: any }, parent: Instance?): any
	local inst = Instance.new(class) :: any
	for k, v in props do
		inst[k] = v
	end
	if parent ~= nil then
		inst.Parent = parent
	end
	return inst
end

function FirstShift.new(gui: Instance)
	local self = setmetatable({}, FirstShift)
	self.active = false
	self.skipped = false
	self.frame = mk("Frame", {
		Size = UDim2.fromOffset(420, 54),
		Position = UDim2.new(0.5, -210, 1, -120),
		BackgroundColor3 = Color3.fromRGB(255, 248, 235),
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 14) }, self.frame)
	self.label = mk("TextLabel", {
		Size = UDim2.new(1, -60, 1, 0),
		Position = UDim2.new(0, 14, 0, 0),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(58, 32, 19),
		TextSize = 19,
		Font = Enum.Font.FredokaOne,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextWrapped = true,
		Text = "",
	}, self.frame)
	local skip = mk("TextButton", {
		Size = UDim2.fromOffset(40, 28),
		Position = UDim2.new(1, -48, 0.5, -14),
		BackgroundColor3 = Color3.fromRGB(200, 190, 170),
		TextColor3 = Color3.fromRGB(58, 32, 19),
		TextSize = 14,
		Font = Enum.Font.GothamBold,
		Text = "✕",
	}, self.frame)
	mk("UICorner", { CornerRadius = UDim.new(0, 8) }, skip)
	skip.Activated:Connect(function()
		self.skipped = true
		self.frame.Visible = false
	end)
	return self
end

function FirstShift:setEligible(progress: any)
	self.active = not self.skipped
		and (progress.level or 1) < 3
		and (progress.rounds or 0) < 3
end

--- One instruction, chosen from the mirrored state. Priority order matters:
--- the player is told what to do with what's in their hands first.
function FirstShift:update(state: any, flags: number)
	if not self.active or self.skipped or state.phase.phase ~= "round" then
		self.frame.Visible = false
		return
	end
	local carrying = bit32.band(flags, 4) ~= 0
	local tier = bit32.band(bit32.rshift(flags, 3), 3)
	local working = bit32.band(flags, 2) ~= 0

	-- Is something sitting cooked in a pan right now? The plate-scoop is the
	-- game's least discoverable move; it gets its own dedicated coaching.
	local cookedInPan = false
	for _, st in state.stations do
		local h = st.holding
		if h ~= nil and h.type == "pan" then
			for _, c in h.contents or {} do
				if c.state == "cooked" then
					cookedInPan = true
					break
				end
			end
		end
	end

	local tip: string
	if working then
		tip = "Working! Stay put — or press again to stop."
	elseif carrying and tier == 2 then
		if cookedInPan then
			tip = "Food's ready! Press at the pan to scoop it onto your plate."
		else
			tip = "Carrying a plate: scoop cooked food off pans, then take it to a serve window!"
		end
	elseif cookedInPan and not carrying then
		tip = "Cooked food never leaves a pan by hand — grab a PLATE, then press at the pan."
	elseif carrying then
		tip = "Take it to a glowing station — chop raw veggies at a board, cook bacon in a pan."
	elseif #state.orders > 0 then
		local o = state.orders[1]
		tip = `Ticket: {o.name}. Grab ingredients from the crates — walk up and press the button!`
	else
		tip = "One button does everything: walk to a glowing station and press it."
	end
	self.label.Text = "👨‍🍳 " .. tip
	self.frame.Visible = true
end

return FirstShift
