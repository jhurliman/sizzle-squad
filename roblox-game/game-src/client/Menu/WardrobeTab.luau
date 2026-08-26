--!strict
-- Wardrobe: species, hat and palette on ONE screen, against a live 3D chef.
--
-- These were three disconnected surfaces before -- separate buttons, separate
-- remotes (PickSpecies vs ShopAction), separate corners of the screen -- when
-- they are obviously one idea: what my chef looks like. This is also where the
-- 44 hand-tuned FitLab hat fits finally become visible; until now they were
-- only ever seen as a small object on a chef mid-round.
--
-- PREVIEW IS PURELY LOCAL. Tapping a card changes only what you are looking
-- at; nothing reaches the server until APPLY. A server round-trip per tap
-- would feel laggy and would let a scrolling player drive broadcastEquips
-- (which fans out to every client) at scroll frequency.

local Theme = require(script.Parent.Theme) :: any
local ChefPreview = require(script.Parent.ChefPreview) :: any

local WardrobeTab = {}
WardrobeTab.__index = WardrobeTab

local mk = Theme.mk

local SPECIES = {
	{ id = "bramble", label = "🐻 Bramble" },
	{ id = "pip", label = "🐸 Pip" },
	{ id = "nori", label = "🐱 Nori" },
	{ id = "mochi", label = "🐤 Mochi" },
}

local NO_HAT = "__none"

function WardrobeTab.new(parent: Instance, deps: any)
	local self = setmetatable({}, WardrobeTab)
	self.catalog = deps.catalog
	self.deps = deps
	self.equipped = { skin = "bramble", hat = nil, palette = nil }
	self.pending = { skin = "bramble", hat = nil, palette = nil }
	self.selected = nil :: any

	self.preview = ChefPreview.new(parent)
	self.preview.frame.Size = UDim2.new(0, 260, 1, -60)
	self.preview.frame.Position = UDim2.fromOffset(0, 0)

	self.gaitButton = Theme.button({
		Size = UDim2.fromOffset(110, 30),
		Position = UDim2.fromOffset(10, 10),
		Fill = Theme.BROWN_MID,
		BackgroundTransparency = 0.2,
		TextSize = 13,
		ZIndex = 6,
		Text = "▶ WALK",
	}, parent)
	self.walking = false
	self.gaitButton.Activated:Connect(function()
		self.walking = not self.walking
		self.preview:setGait(if self.walking then "walk" else "idle")
		self.gaitButton.Text = if self.walking then "⏸ IDLE" else "▶ WALK"
	end)

	self.rail = Theme.scrollList({
		Position = UDim2.fromOffset(270, 0),
		Size = UDim2.new(1, -270, 1, -60),
		ZIndex = 4,
	}, parent)

	-- footer
	self.footer = mk("Frame", {
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 0, 1, 0),
		Size = UDim2.new(1, 0, 0, 52),
		BackgroundTransparency = 1,
		ZIndex = 5,
	}, parent)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 8),
		HorizontalAlignment = Enum.HorizontalAlignment.Right,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.footer)

	self.hint = Theme.label({
		Size = UDim2.fromOffset(300, 40),
		TextSize = 13,
		TextColor3 = Theme.DIM,
		TextWrapped = true,
		LayoutOrder = 1,
		ZIndex = 6,
		Text = "Drag the chef to spin.",
	}, self.footer)

	self.buyButton = Theme.button({
		Size = UDim2.fromOffset(150, Theme.MIN_TAP),
		Fill = Theme.GOLD,
		TextColor3 = Theme.BROWN_DEEP,
		TextSize = 17,
		LayoutOrder = 2,
		Visible = false,
		ZIndex = 6,
		Text = "BUY",
	}, self.footer)
	self.buyButton.Activated:Connect(function()
		local sel = self.selected
		if sel == nil then
			return
		end
		self.deps.onShopAction({ action = "buy", id = sel.id })
	end)

	self.resetButton = Theme.button({
		Size = UDim2.fromOffset(90, Theme.MIN_TAP),
		Fill = Theme.BROWN_LIGHT,
		TextSize = 15,
		LayoutOrder = 3,
		ZIndex = 6,
		Text = "RESET",
	}, self.footer)
	self.resetButton.Activated:Connect(function()
		self.pending = { skin = self.equipped.skin, hat = self.equipped.hat, palette = self.equipped.palette }
		self.selected = nil
		self:pushPreview()
		self:render()
	end)

	self.applyButton = Theme.button({
		Size = UDim2.fromOffset(150, Theme.MIN_TAP),
		TextSize = 18,
		LayoutOrder = 4,
		ZIndex = 6,
		Text = "APPLY",
	}, self.footer)
	self.applyButton.Activated:Connect(function()
		self:apply()
	end)

	return self
end

-- ------------------------------------------------------------------ state

--- Own-chef appearance as the server sees it.
function WardrobeTab:setEquipped(e: any)
	local dirty = self:isDirty()
	self.equipped = { skin = e.skin or self.equipped.skin, hat = e.hat, palette = e.palette }
	-- Don't stomp an in-progress edit; only follow the server when the player
	-- has nothing pending (e.g. the equip we just applied came back).
	if not dirty then
		self.pending = { skin = self.equipped.skin, hat = self.equipped.hat, palette = self.equipped.palette }
		self:pushPreview()
	end
	self:render()
end

function WardrobeTab:setProgress(progress: any)
	self.progress = progress
	self:render()
end

function WardrobeTab:isDirty(): boolean
	return self.pending.skin ~= self.equipped.skin
		or self.pending.hat ~= self.equipped.hat
		or self.pending.palette ~= self.equipped.palette
end

function WardrobeTab:pushPreview()
	self.preview:setSkin(self.pending.skin)
	self.preview:setHat(self.pending.hat)
	self.preview:setPalette(self.pending.palette)
end

function WardrobeTab:owns(id: string): boolean
	return self.progress ~= nil and self.progress.owned ~= nil and self.progress.owned[id] == true
end

function WardrobeTab:apply()
	if not self:isDirty() then
		return
	end
	if self.pending.skin ~= self.equipped.skin then
		self.deps.onPickSpecies(self.pending.skin)
	end
	-- One atomic commit for every slot, instead of an equip per card tap.
	self.deps.onShopAction({
		action = "equipSet",
		set = { hat = self.pending.hat, palette = self.pending.palette },
	})
end

--- Hand-off from the Shop's "TRY IT": preview the item, select it so the
--- footer offers to buy, and let the caller switch tabs.
function WardrobeTab:tryOn(item: any)
	if item.kind == "hat" then
		self.pending.hat = item.id
	elseif item.kind == "palette" then
		if item.species ~= nil then
			self.pending.skin = item.species
		end
		self.pending.palette = item.id
	else
		return
	end
	self.selected = if self:owns(item.id) then nil else item
	self:pushPreview()
	self:render()
end

function WardrobeTab:onShow()
	self.preview:setActive(true)
	self:render()
end

function WardrobeTab:onHide()
	self.preview:setActive(false)
end

function WardrobeTab:step(dt: number)
	self.preview:step(dt)
end

-- ----------------------------------------------------------------- render

function WardrobeTab:sectionTitle(order: number, text: string)
	return Theme.label({
		Size = UDim2.new(1, -10, 0, 24),
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		TextSize = 14,
		LayoutOrder = order,
		ZIndex = 5,
		Text = text,
	}, self.rail)
end

--- One selectable card. `state` drives the badge on the right.
function WardrobeTab:card(order: number, label: string, state: string, locked: boolean, tint: Color3?, onPick: () -> ())
	local row = mk("TextButton", {
		Size = UDim2.new(1, -10, 0, Theme.MIN_TAP),
		BackgroundColor3 = if state == "equipped" then Theme.GREEN else Theme.BROWN_LIGHT,
		BackgroundTransparency = if state == "locked" then 0.55 else 0.2,
		BorderSizePixel = 0,
		AutoButtonColor = state ~= "locked",
		Text = "",
		LayoutOrder = order,
		ZIndex = 4,
	}, self.rail)
	Theme.corner(row, 8)
	if tint ~= nil then
		local swatch = mk("Frame", {
			Size = UDim2.fromOffset(22, 22),
			Position = UDim2.fromOffset(10, 13),
			BackgroundColor3 = tint,
			BorderSizePixel = 0,
			ZIndex = 5,
		}, row)
		Theme.corner(swatch, 11)
	end
	Theme.label({
		Size = UDim2.new(1, -150, 1, 0),
		Position = UDim2.fromOffset(if tint ~= nil then 42 else 12, 0),
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		TextColor3 = if locked then Theme.DIM else Theme.CREAM,
		TextTruncate = Enum.TextTruncate.AtEnd,
		ZIndex = 5,
		Text = label,
	}, row)
	Theme.chip({
		Size = UDim2.fromOffset(96, 28),
		Position = UDim2.new(1, -106, 0.5, -14),
		TextSize = 13,
		BackgroundTransparency = 0.35,
		TextColor3 = if locked then Theme.DIM else Theme.CREAM,
		ZIndex = 5,
		Text = state,
	}, row)
	row.Activated:Connect(onPick)
	return row
end

function WardrobeTab:render()
	for _, c in self.rail:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	local level = if self.progress ~= nil then (self.progress.level or 1) else 1
	local coins = if self.progress ~= nil then (self.progress.coins or 0) else 0
	local order = 0
	local function next_(): number
		order += 1
		return order
	end

	-- ---- species -----------------------------------------------------
	self:sectionTitle(next_(), "SPECIES")
	for _, s in SPECIES do
		local state = if self.pending.skin == s.id then "equipped" else "pick"
		self:card(next_(), s.label, state, false, nil, function()
			self.pending.skin = s.id
			-- Palettes are species-bound; a palette from another species does
			-- nothing at all, so drop it rather than silently no-op.
			local pal = if self.pending.palette ~= nil then self.catalog.byId[self.pending.palette] else nil
			if pal ~= nil and pal.species ~= s.id then
				self.pending.palette = nil
			end
			self.selected = nil
			self:pushPreview()
			self:render()
		end)
	end

	-- ---- hats --------------------------------------------------------
	self:sectionTitle(next_(), "HATS")
	self:card(next_(), "No hat", if self.pending.hat == nil then "equipped" else "pick", false, nil, function()
		self.pending.hat = nil
		self.selected = nil
		self:pushPreview()
		self:render()
	end)
	for _, item in self.catalog.items do
		if item.kind ~= "hat" or item.hidden then
			continue
		end
		local owned = self:owns(item.id)
		local locked = item.level ~= nil and level < item.level
		local state = if self.pending.hat == item.id
			then "equipped"
			elseif owned then "owned"
			elseif locked then `Lv {item.level}`
			else `{item.cost} 🪙`
		self:card(next_(), item.name, state, locked, nil, function()
			if locked then
				return
			end
			-- Try-before-you-buy: unowned hats still preview.
			self.pending.hat = item.id
			self.selected = if owned then nil else item
			self:pushPreview()
			self:render()
		end)
	end

	-- ---- palettes (this species only) ---------------------------------
	self:sectionTitle(next_(), `PALETTES — {self.pending.skin}`)
	self:card(next_(), "Default coat", if self.pending.palette == nil then "equipped" else "pick", false, nil, function()
		self.pending.palette = nil
		self.selected = nil
		self:pushPreview()
		self:render()
	end)
	for _, item in self.catalog.items do
		if item.kind ~= "palette" or item.species ~= self.pending.skin or item.hidden then
			continue
		end
		local owned = self:owns(item.id)
		local locked = item.level ~= nil and level < item.level
		local tint = if item.color ~= nil
			then Color3.fromRGB(item.color[1], item.color[2], item.color[3])
			else nil
		local state = if self.pending.palette == item.id
			then "equipped"
			elseif owned then "owned"
			elseif locked then `Lv {item.level}`
			else `{item.cost} 🪙`
		self:card(next_(), item.name, state, locked, tint, function()
			if locked then
				return
			end
			self.pending.palette = item.id
			self.selected = if owned then nil else item
			self:pushPreview()
			self:render()
		end)
	end

	-- ---- footer ------------------------------------------------------
	local sel = self.selected
	if sel ~= nil then
		local affordable = coins >= sel.cost
		self.buyButton.Visible = true
		self.buyButton.Text = `BUY  {sel.cost} 🪙`
		self.buyButton.BackgroundColor3 = if affordable then Theme.GOLD else Theme.GREY
		self.hint.Text = if affordable
			then `Trying on {sel.name}. Buy it to keep it.`
			else `{sel.name} costs {sel.cost} 🪙 — you have {coins}.`
	else
		self.buyButton.Visible = false
		self.hint.Text = "Drag the chef to spin. Tap anything to try it on."
	end
	local dirty = self:isDirty()
	self.applyButton.BackgroundColor3 = if dirty then Theme.GREEN else Theme.GREY
	self.applyButton.Text = if dirty then "APPLY" else "APPLIED"
end

function WardrobeTab:relayout(L: any, _viewport: Vector2)
	if L.twoColumn then
		local w = L.previewW
		self.preview.frame.Visible = true
		self.preview.frame.Size = UDim2.new(0, w, 1, -60)
		self.gaitButton.Visible = true
		self.rail.Position = UDim2.fromOffset(w + 10, 0)
		self.rail.Size = UDim2.new(1, -(w + 10), 1, -60)
		self.hint.Size = UDim2.fromOffset(280, 40)
	else
		-- No room for a 3D panel AND a readable rail: the rail wins, because
		-- you cannot buy what you cannot read.
		self.preview.frame.Visible = false
		self.gaitButton.Visible = false
		self.rail.Position = UDim2.fromOffset(0, 0)
		self.rail.Size = UDim2.new(1, 0, 1, -60)
		self.hint.Size = UDim2.fromOffset(120, 40)
	end
end

return WardrobeTab
