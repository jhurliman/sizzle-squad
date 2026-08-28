--!strict
-- "First Shift" onboarding (plan §2.6): contextual prompts only, layered on
-- the focus-glow system. One instruction on screen at a time, no dismiss, and
-- it runs exactly once -- on the player's first ever shift, which now happens
-- alone in a reserved server (see server/Tutorial.luau).
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
	self.frame = mk("Frame", {
		Size = UDim2.fromOffset(420, 54),
		Position = UDim2.new(0.5, -210, 1, -120),
		BackgroundColor3 = Color3.fromRGB(255, 248, 235),
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 14) }, self.frame)
	self.label = mk("TextLabel", {
		Size = UDim2.new(1, -28, 1, 0),
		Position = UDim2.new(0, 14, 0, 0),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(58, 32, 19),
		TextSize = 19,
		Font = Enum.Font.FredokaOne,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextWrapped = true,
		Text = "",
	}, self.frame)
	-- NO DISMISS BUTTON.
	--
	-- There was an X here from when these tips were drawn over ordinary public
	-- rounds and could reappear at the top of every match. They now show in one
	-- place only -- the solo First Shift server -- where the tip IS the shift:
	-- dismissing it leaves a brand-new player alone in a kitchen with two
	-- tickets, no clock, and nothing telling them what any of it does.
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

--- The station holding a clean plate that is waiting to be built on, if any.
---
--- Returns the ID rather than a boolean because "put it on a plate" has to
--- glow the plate the player actually staged. Pointing at the plate DISPENSER
--- instead sends them across the kitchen to fetch a second plate.
local function stagedPlateId(state: any): number?
	for _, st in state.mirrorSim.kitchen.stations do
		local h = state.stations[st.id] and state.stations[st.id].holding
		if h ~= nil and h.type == "plate" and h.dirty ~= true then
			return st.id
		end
	end
	return nil
end

--- A station holding a loose ingredient that has reached the state its ticket
--- wants: finished work sitting there waiting to be collected and plated.
---
--- Without this the coach went quiet on its own instructions. It told you to
--- chop the lettuce, and the moment you did, the board no longer held anything
--- "unfinished", your hands were empty, and it sent you back to the crate for
--- more lettuce -- past the chopped lettuce it had just had you make.
local function readyAt(state: any, order: any): (number?, string?)
	for _, st in state.mirrorSim.kitchen.stations do
		local h = state.stations[st.id] and state.stations[st.id].holding
		if h ~= nil and h.type == "ingredient" then
			local wanted = nil
			if order ~= nil then
				for _, c in order.components do
					if c.kind == h.kind then
						wanted = c.state
					end
				end
			end
			if wanted == nil or h.state == wanted then
				return st.id, h.kind
			end
		end
	end
	return nil, nil
end

--- The first component of `order` that nothing has covered yet.
---
--- The coach used to read components[1] every single time, so once the lettuce
--- was chopped and plated it went right on saying "grab lettuce" -- naming the
--- one ingredient the player had just finished. It has to subtract what is
--- already accounted for: on the staged plate, in the player's hands, loose on
--- a station, or cooking in a pan.
---
--- Matching is on kind AND state, which is what makes the half-done cases fall
--- out correctly: raw lettuce on a board does not satisfy a "lettuce prepped"
--- line, so it is still owed -- and the chop branch above has already claimed
--- that situation anyway.
local function nextNeeded(state: any, order: any, held: any): any?
	local need: { [string]: number } = {}
	for _, c in order.components do
		local k = `{c.kind}:{c.state}`
		need[k] = (need[k] or 0) + 1
	end
	local function consume(kind: string?, st: string?)
		if kind == nil then
			return
		end
		local k = `{kind}:{st}`
		if (need[k] or 0) > 0 then
			need[k] -= 1
		end
	end
	local function consumeAll(h: any)
		if h == nil then
			return
		end
		if h.type == "ingredient" then
			consume(h.kind, h.state)
		elseif h.type == "plate" then
			for _, c in h.contents or {} do
				consume(c.kind, c.state)
			end
		elseif h.type == "pan" then
			-- A PAN FINISHES ITS OWN WORK. Anything in it is already accounted
			-- for against the ticket's `cooked` line, whatever state it is in
			-- this instant, because the stove will get it there without the
			-- player doing anything. That is the difference from a board: raw
			-- lettuce sitting on one is NOT accounted for, since it needs a
			-- press, and the chop branch above claims that case anyway.
			for _, c in h.contents or {} do
				consume(c.kind, "cooked")
			end
		end
	end
	for _, st in state.mirrorSim.kitchen.stations do
		consumeAll(state.stations[st.id] and state.stations[st.id].holding)
	end
	consumeAll(held)
	for _, c in order.components do
		local k = `{c.kind}:{c.state}`
		if (need[k] or 0) > 0 then
			need[k] -= 1
			return c
		end
	end
	return nil
end

--- IT IS CALLED FIRST SHIFT, SO IT RUNS ON THE FIRST SHIFT.
---
--- This used to run for the first THREE rounds (and below level 3), which
--- meant the coach reappeared at the top of every match for a player who
--- already knew the game and had to be dismissed each time -- a tax on exactly
--- the players who had decided to come back. `rounds` is server-persisted and
--- increments at round end, so `< 1` is true for the whole of the genuine
--- first shift and false forever after; a player who quits mid-first-round
--- correctly gets it again, because they never finished one.
function FirstShift:setEligible(progress: any)
	self.active = (progress.rounds or 0) < 1
end

--- One instruction plus the station it refers to. Returns the target station
--- id so the caller can glow it; priority order matters, because the player is
--- told what to do with what is in their hands before anything else.
function FirstShift:update(state: any, flags: number): number?
	if not self.active or state.phase.phase ~= "round" then
		self.frame.Visible = false
		return nil
	end
	local carrying = bit32.band(flags, 4) ~= 0
	local tier = bit32.band(bit32.rshift(flags, 3), 3)
	local working = bit32.band(flags, 2) ~= 0

	-- Is something sitting cooked in a pan right now? The plate-scoop is the
	-- game's least discoverable move; it gets its own dedicated coaching.
	local panId = nil
	-- ...and is something still COOKING? A different question with a different
	-- answer: one says "go and collect it", the other says "leave it alone".
	-- Without the second, a rasher three seconds off being ready looked to the
	-- coach exactly like no bacon at all, and it sent the player back to the
	-- crate for more.
	local cookingId = nil
	for _, st in state.mirrorSim.kitchen.stations do
		local h = state.stations[st.id] and state.stations[st.id].holding
		if h ~= nil and h.type == "pan" then
			for _, c in h.contents or {} do
				if c.state == "cooked" then
					panId = st.id
				elseif c.state ~= "burnt" then
					cookingId = st.id
				end
			end
		end
	end

	-- Something half-done on a board: one press from finished.
	local chopId = unfinishedAt(state, "board", "prepped")

	local held = if state.myChefId ~= nil then state.carrying[state.myChefId] else nil
	local order = state.orders[1]
	-- Finished work waiting to be collected, resolved against the live ticket.
	local readyId, readyKind = readyAt(state, order)
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
			tip = "That's ready — put it on your plate."
			target = stagedPlateId(state) or nearest(state, stationOfKind("plates"))
		end
	elseif carrying then
		tip = "Take it to the glowing station and press."
		target = nearest(state, stationOfKind("board"))
	elseif chopId ~= nil then
		tip = "Press at the glowing board to chop it."
		target = chopId
	elseif readyId ~= nil then
		tip = `That {readyKind} is ready — pick it up and add it to your plate.`
		target = readyId
	elseif panId ~= nil then
		tip = "Food's ready! Press at the glowing pan to take it."
		target = panId
	elseif cookingId ~= nil and order ~= nil and nextNeeded(state, order, held) == nil then
		-- Everything the ticket needs is either plated or in the pan, and the
		-- pan is not done. There is genuinely nothing to do but wait, and
		-- saying so is better coaching than inventing an errand.
		tip = "It's cooking — give it a few seconds."
		target = cookingId
	elseif stagedPlateId(state) == nil then
		-- THE PLATE COMES FIRST. Everything you prepare needs somewhere to go,
		-- and a player who chops before staging one ends up holding food with
		-- nowhere to put it. Opening on the crate taught that order backwards.
		tip = "Start with a plate: take one from the stack and set it on a counter."
		target = nearest(state, stationOfKind("plates"))
	elseif order ~= nil then
		-- Nothing in hand: point at the crate for the first thing the oldest
		-- ticket still needs.
		local want = nextNeeded(state, order, held)
		if want ~= nil then
			tip = `Ticket: {order.name}. Grab {want.kind} from the glowing crate.`
			target = nearest(state, function(st)
				return st.kind == "crate" and st.dispenses == want.kind
			end)
		end
		if want == nil then
			-- Everything the ticket asks for is on the plate: the only move
			-- left is to run it to the window.
			tip = `{order.name} is complete — pick up the plate and serve it.`
			target = stagedPlateId(state) or nearest(state, stationOfKind("serve"))
		elseif target == nil then
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

-- The coaching DECISIONS are pure functions of replicated state, and five
-- separate bugs have now been reported in them (hands-only reasoning, chopped
-- food invisible, the dispenser glowed instead of the staged plate, and this
-- one). Exposed so tools/coach-harness.luau can walk a whole ticket without
-- needing a DataModel -- FirstShift.new builds GUI, the logic does not.
FirstShift._debug = {
	nextNeeded = nextNeeded,
	readyAt = readyAt,
	stagedPlateId = stagedPlateId,
	unfinishedAt = unfinishedAt,
}

return FirstShift
