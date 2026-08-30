--!strict
-- The ping row. Gameplay, not meta, so it parents into the HUD gui rather
-- than the menu -- but it lives here because it is the consumer that finally
-- makes emote cosmetics mean something: owning more emotes visibly grows your
-- bar. Before this, all five emotes in the catalog could be bought and did
-- nothing at all.
--
-- Buttons send IDS, never text. The server allowlists built-in pings plus
-- emotes the sender owns; the glyph is resolved client-side from the Catalog.

local Theme = require(script.Parent.Theme) :: any

local EmoteBar = {}
EmoteBar.__index = EmoteBar

-- THE BOTTOM OF THE SCREEN, AS A NUMBER OTHER FILES CAN READ.
--
-- The Start Shift column is pinned directly above this row, so its position is
-- now derived from these rather than from a `- 34` written out by hand in two
-- other places. They are used to build the row itself a few lines down, so the
-- constants cannot drift from the geometry they describe.
EmoteBar.HEIGHT = 26
EmoteBar.BOTTOM_MARGIN = 8

--- Y of the top edge of the emote row, in pixels from the top of the screen.
function EmoteBar.topOf(viewportY: number): number
	return viewportY - EmoteBar.HEIGHT - EmoteBar.BOTTOM_MARGIN
end

local mk = Theme.mk

function EmoteBar.new(gui: Instance, deps: any)
	local self = setmetatable({}, EmoteBar)
	self.catalog = deps.catalog
	self.deps = deps
	self.buttons = {}

	self.root = mk("Frame", {
		Name = "EmoteBar",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -EmoteBar.BOTTOM_MARGIN),
		Size = UDim2.fromOffset(560, EmoteBar.HEIGHT),
		BackgroundTransparency = 1,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 4),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.root)

	self:render()
	return self
end

function EmoteBar:setProgress(progress: any)
	local owned = progress.owned or {}
	local key = ""
	for _, item in self.catalog.items do
		if item.kind == "emote" and owned[item.id] then
			key ..= item.id
		end
	end
	if key == self.ownedKey then
		return
	end
	self.ownedKey = key
	self.owned = owned
	self:render()
end

function EmoteBar:setHidden(on: boolean)
	self.root.Visible = not on
end

function EmoteBar:render()
	for _, b in self.buttons do
		b:Destroy()
	end
	self.buttons = {}

	local entries = {}
	for _, ping in self.catalog.pings do
		table.insert(entries, { id = ping.id, glyph = ping.glyph })
	end
	local owned = self.owned or {}
	for _, item in self.catalog.items do
		if item.kind == "emote" and owned[item.id] then
			table.insert(entries, { id = item.id, glyph = item.glyph or item.name, cosmetic = true })
		end
	end

	-- Keep the row inside the dead floor band: the ticket queue owns the right
	-- edge and the action button owns the bottom-right corner.
	local n = math.max(1, #entries)
	local w = math.clamp(math.floor(560 / n) - 4, 44, 84)
	for i, e in entries do
		local btn = Theme.button({
			Size = UDim2.fromOffset(w, 26),
			Fill = if e.cosmetic then Theme.BROWN_LIGHT else Theme.BROWN_MID,
			BackgroundTransparency = 0.25,
			TextColor3 = Theme.CREAM,
			TextSize = 12,
			LayoutOrder = i,
			Text = e.glyph,
		}, self.root)
		btn.Activated:Connect(function()
			self.deps.onEmote(e.id)
		end)
		table.insert(self.buttons, btn)
	end
end

function EmoteBar:relayout(_L: any, viewport: Vector2)
	self.root.Size = UDim2.fromOffset(math.min(560, viewport.X - 240), EmoteBar.HEIGHT)
	self:render()
end

return EmoteBar
