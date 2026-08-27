--!strict
-- "First Shift" onboarding (plan §2.6): contextual prompts only, layered on
-- the focus-glow system. One instruction on screen at a time, per-player
-- overlay, never pauses the kitchen, skippable, silently retires at level 3
-- or 3 rounds.
--
-- IT POINTS AT A STATION, which is the part that actually teaches. The old
-- version said things like "grab ingredients from the crates" -- but a new
-- player cannot tell a crate from a counter from a bin, and the kitchen has
-- twenty-odd stations. Every tip now resolves to a specific station id that
-- the caller highlights, so the instruction and the target arrive together.
--
-- The target is derived from the TICKET rather than hardcoded content: a
-- component wanting `prepped` means a board, `cooked` means a stove, `raw`
-- means it goes straight on a plate. Add an ingredient to the game and this
-- keeps working.

local Theme = require(script.Parent.Menu.Theme) :: any

local FirstShift = {}
FirstShift.__index = FirstShift

-- Shared with the HUD and every menu surface.
local mk = Theme.mk

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
		-- Clear of the skip button, which sits at -48 and is 40 wide: at -60
		-- the wrapped text ran to within 12px of it and read as touching.
		Size = UDim2.new(1, -84, 1, 0),
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
		Text = "X",
	}, self.frame)
	mk("UICorner", { CornerRadius = UDim.new(0, 8) }, skip)
	skip.Activated:Connect(function()
		self.skipped = true
		self.frame.Visible = false
	end)
	return self
end

--- Nearest station of a kind to the chef, preferring an unoccupied one.
local function nearest(state: any, pred: (any) -> boolean): number?
	local mirror = state.mirror
	if mirror == nil then
		return nil
	end
	local bestId, bestD = nil, math.huge
	for _, st in state.mirrorSim.kitchen.stations do
		if pred(st) then
			local dx = st.cell.x + 0.5 - mirror.pos.x
			local dy = st.cell.y + 0.5 - mirror.pos.y
			local d = dx * dx + dy * dy
			-- A station with something already on it is a worse suggestion
			-- than an empty one even if it is closer.
			if st.holding ~= nil then
				d += 400
			end
			if d < bestD then
				bestD, bestId = d, st.id
			end
		end
	end
	return bestId
end

local function stationOfKind(kind: string)
	return function(st: any)
		return st.kind == kind
	end
end

--- Where does an ingredient in `state` need to go, for a ticket that wants it
--- in `wanted` state? Driven by the recipe, not by a hardcoded ingredient list.
local function processingFor(wanted: string): (string, string)
	if wanted == "cooked" then
		return "stove", "Drop it in a pan on the stove to cook."
	elseif wanted == "prepped" then
		return "board", "Take it to a chopping board and press to chop."
	end
	return "plates", "That's ready to plate."
end

--- A station of `kind` holding an ingredient that has not reached `doneState`.
---
--- The coach used to be driven ENTIRELY by what was in your hands, so the
--- instant you set lettuce down on a board your hands were empty and it told
--- you to fetch lettuce from the crate -- while the lettuce you had just
--- delivered sat there unchopped, one press from done. Work already started
--- outranks starting anything new.
local function unfinishedAt(state: any, kind: string, doneState: string): number?
	for _, st in state.mirrorSim.kitchen.stations do
		if st.kind == kind then
			local h = state.stations[st.id] and state.stations[st.id].holding
			if h ~= nil and h.type == "ingredient" and h.state ~= doneState then
				return st.id
			end
		end
	end
	return nil
end

--- Is a clean plate already down somewhere, waiting to be built on?
local function stagedPlate(state: any): boolean
	for _, st in state.mirrorSim.kitchen.stations do
		local h = state.stations[st.id] and state.stations[st.id].holding
		if h ~= nil and h.type == "plate" and h.dirty ~= true then
			return true
		end
	end
	return false
end

function FirstShift:setEligible(progress: any)
	self.active = not self.skipped
		and (progress.level or 1) < 3
		and (progress.rounds or 0) < 3
end

--- One instruction plus the station it refers to. Returns the target station
--- id so the caller can glow it; priority order matters, because the player is
--- told what to do with what is in their hands before anything else.
function FirstShift:update(state: any, flags: number): number?
	if not self.active or self.skipped or state.phase.phase ~= "round" then
		self.frame.Visible = false
		return nil
	end
	local carrying = bit32.band(flags, 4) ~= 0
	local tier = bit32.band(bit32.rshift(flags, 3), 3)
	local working = bit32.band(flags, 2) ~= 0

	-- Is something sitting cooked in a pan right now? The plate-scoop is the
	-- game's least discoverable move; it gets its own dedicated coaching.
	local panId = nil
	for _, st in state.mirrorSim.kitchen.stations do
		local h = state.stations[st.id] and state.stations[st.id].holding
		if h ~= nil and h.type == "pan" then
			for _, c in h.contents or {} do
				if c.state == "cooked" then
					panId = st.id
					break
				end
			end
		end
	end

	-- Something half-done on a board: one press from finished.
	local chopId = unfinishedAt(state, "board", "prepped")

	local held = if state.myChefId ~= nil then state.carrying[state.myChefId] else nil
	local order = state.orders[1]
	local tip, target

	if working then
		tip = "Working! Stay put — or press again to stop."
	elseif state.plateStock <= 0 and state.dirtyPlates > 0 then
		-- Nothing else can make progress: no clean plates left anywhere.
		tip = "Out of clean plates! Wash up at the sink to get more."
		target = nearest(state, stationOfKind("sink"))
	elseif tier == 2 and held ~= nil and held.dirty then
		-- Washing is the one step nobody discovers on their own, because a
		-- dirty plate looks like a plate.
		tip = "That plate's dirty — take it to the sink and press to wash it."
		target = nearest(state, stationOfKind("sink"))
	elseif tier == 2 then
		-- Holding a plate.
		if panId ~= nil then
			tip = "Food's ready — press at the glowing pan to scoop it onto your plate."
			target = panId
		elseif held ~= nil and #(held.contents or {}) == 0 then
			-- An EMPTY plate has no business at the serve window; glowing one
			-- there teaches the wrong loop on the very first shift.
			tip = "Set the plate down on a free counter — that's where the dish gets built."
			target = nearest(state, stationOfKind("counter"))
		else
			tip = "Plate in hand. Take it to the serve window when the ticket is complete."
			target = nearest(state, stationOfKind("serve"))
		end
	elseif carrying and held ~= nil and held.type == "ingredient" then
		-- Holding an ingredient: does the ticket want it processed first?
		local wanted = nil
		if order ~= nil then
			for _, c in order.components do
				if c.kind == held.kind then
					wanted = c.state
				end
			end
		end
		if wanted ~= nil and wanted ~= held.state then
			local kind, line = processingFor(wanted)
			tip = line
			target = nearest(state, stationOfKind(kind))
		else
			tip = "That's ready — put it on a plate."
			target = nearest(state, stationOfKind("plates"))
		end
	elseif carrying then
		tip = "Take it to the glowing station and press."
		target = nearest(state, stationOfKind("board"))
	elseif chopId ~= nil then
		tip = "Press at the glowing board to chop it."
		target = chopId
	elseif panId ~= nil then
		tip = "Food's ready! Press at the glowing pan to take it."
		target = panId
	elseif not stagedPlate(state) then
		-- THE PLATE COMES FIRST. Everything you prepare needs somewhere to go,
		-- and a player who chops before staging one ends up holding food with
		-- nowhere to put it. Opening on the crate taught that order backwards.
		tip = "Start with a plate: take one from the stack and set it on a counter."
		target = nearest(state, stationOfKind("plates"))
	elseif order ~= nil then
		-- Nothing in hand: point at the crate for the first thing the oldest
		-- ticket still needs.
		local want = order.components[1]
		if want ~= nil then
			tip = `Ticket: {order.name}. Grab {want.kind} from the glowing crate.`
			target = nearest(state, function(st)
				return st.kind == "crate" and st.dispenses == want.kind
			end)
		end
		if target == nil then
			tip = `Ticket: {order.name}. Grab what it needs from a crate.`
			target = nearest(state, stationOfKind("crate"))
		end
	else
		tip = "One button does everything: walk to a glowing station and press it."
		target = nearest(state, stationOfKind("crate"))
	end

	self.label.Text = "🍳 " .. tip
	self.frame.Visible = true
	return target
end

return FirstShift
