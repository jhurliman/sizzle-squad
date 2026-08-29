--!strict
-- Wardrobe: species, hat and palette on ONE screen, against a live 3D chef.
--
-- These were three disconnected surfaces before -- separate buttons, separate
-- remotes (PickSpecies vs ShopAction), separate corners of the screen -- when
-- they are obviously one idea: what my chef looks like. This is also where the
-- 44 hand-tuned FitLab hat fits finally become visible; until now they were
-- only ever seen as a small object on a chef mid-round.
--
-- Tapping something you OWN wears it immediately -- there is no Apply step,
-- because a confirm button between "I tapped the hat" and "I am wearing the
-- hat" is pure ceremony. Tapping something you do NOT own only previews it,
-- and the footer offers to buy; buying then wears it automatically.

local Theme = require(script.Parent.Theme) :: any
local Loc = require(script.Parent.Parent.Loc) :: any
local ChefPreview = require(script.Parent.ChefPreview) :: any

local WardrobeTab = {}
WardrobeTab.__index = WardrobeTab

local mk = Theme.mk

local LOCAL_USER_ID = game:GetService("Players").LocalPlayer.UserId

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
	-- `equipped` is server truth; `pending` is what the preview shows (they
	-- differ only while trying on something unowned); `selected` is that
	-- unowned item, and is what the BUY footer acts on.
	self.equipped = { skin = "bramble", hat = nil, palette = nil }
	self.pending = { skin = "bramble", hat = nil, palette = nil }
	self.selected = nil :: any

	self.preview = ChefPreview.new(parent)
	self.preview.frame.Size = UDim2.new(0, 260, 1, -60)
	self.preview.frame.Position = UDim2.fromOffset(0, 0)

	-- BOTTOM-left of the preview, not top-left. Hats are on heads, so a button
	-- in the top corner sat exactly where a tall hat renders and clipped it.
	self.gaitButton = Theme.button({
		AnchorPoint = Vector2.new(0, 1),
		Size = UDim2.fromOffset(110, 30),
		Position = UDim2.new(0, 10, 1, -10),
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

	-- THE FOOTER EXISTS TO SELL THINGS, SO IT ONLY EXISTS WHEN SOMETHING IS
	-- FOR SALE.
	--
	-- It reserved 60px at the bottom unconditionally, which on a phone is a
	-- large slice of a short panel -- enough that the species list needed
	-- scrolling to show four entries. When there is no BUY button the bar
	-- holds one line of hint text, which is not worth that much screen.
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

	return self
end

-- ------------------------------------------------------------------ state

--- Own-chef appearance as the server sees it.
function WardrobeTab:setEquipped(e: any)
	self.equipped = { skin = e.skin or self.equipped.skin, hat = e.hat, palette = e.palette }
	-- Follow the server unless the player is mid-try-on of something unowned.
	if self.selected == nil then
		self.pending = { skin = self.equipped.skin, hat = self.equipped.hat, palette = self.equipped.palette }
		self:pushPreview()
	end
	self:render()
end

function WardrobeTab:setProgress(progress: any)
	self.progress = progress
	-- The purchase landed: stop offering to sell it and put it on. Without
	-- this the BUY button survived the purchase and only cleared when some
	-- other interaction happened to re-render.
	local sel = self.selected
	if sel ~= nil and self:owns(sel.id) then
		self.selected = nil
		self:commit(self.catalog.slotKey(sel), sel.id)
	end
	self:render()
end

--- Equip one slot. `false` clears it; absent slots are left alone, so this
--- can never strip something the wardrobe does not manage (plates, bells).
function WardrobeTab:commit(slot: string, id: string?)
	self.deps.onShopAction({ action = "equipSet", set = { [slot] = id or false } })
end

function WardrobeTab:pushPreview()
	self.preview:setSkin(self.pending.skin)
	self.preview:setHat(self.pending.hat)
	self.preview:setPalette(self.pending.palette)
end

function WardrobeTab:owns(id: string): boolean
	return self.progress ~= nil and self.progress.owned ~= nil and self.progress.owned[id] == true
end

--- Tap handler for a wearable card: wear it if it is yours, otherwise put it
--- on the preview and offer to sell it.
function WardrobeTab:pick(slot: string, item: any?)
	local id = if item ~= nil then item.id else nil
	if slot == "hat" then
		self.pending.hat = id
	else
		self.pending.palette = id
	end
	if item == nil or self:owns(item.id) then
		self.selected = nil
		self:commit(slot, id)
	else
		self.selected = if item.exclusive ~= nil then nil else item
	end
	self:pushPreview()
	self:render()
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
		BackgroundColor3 = if state == "WORN" then Theme.GREEN else Theme.BROWN_LIGHT,
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

--- Species other seated players are wearing right now (species -> UserId).
function WardrobeTab:setTaken(taken: any)
	self.taken = taken
	if self.built then
		self:render()
	end
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
		-- A species another player is already wearing stays TAPPABLE on purpose.
		-- Trying hats on is the whole reason this screen exists, and the pick
		-- still saves your preference for the next server where the character
		-- is free — the server simply will not hand you a duplicate here. The
		-- label is what stops that reading as the wardrobe being broken.
		local owner = self.taken and self.taken[s.id]
		local byOther = owner ~= nil and owner ~= LOCAL_USER_ID
		local state = if self.pending.skin == s.id then "WORN" elseif byOther then "IN USE" else "pick"
		-- A STRING WENT INTO THE COLOUR SLOT AND TOOK THE LIST WITH IT.
		--
		-- `card`'s fifth argument is `tint: Color3?`, and this used to pass a
		-- sentence of explanatory text. `BackgroundColor3 = "Another chef here
		-- is this one…"` throws, which aborted :render midway through the
		-- species loop — so in any server where somebody else was already a
		-- species, half the wardrobe simply did not draw and the list trailed
		-- off into a blank row. It only ever showed up in multiplayer, because
		-- `taken` is empty on your own.
		--
		-- The "IN USE" chip already says what the sentence said.
		self:card(next_(), s.label, state, false, nil, function()
			self.pending.skin = s.id
			-- Palettes are species-bound; a palette from another species does
			-- nothing at all, so drop it rather than silently no-op.
			local pal = if self.pending.palette ~= nil then self.catalog.byId[self.pending.palette] else nil
			if pal ~= nil and pal.species ~= s.id then
				-- palettes are species-bound; a mismatched one does nothing
				self.pending.palette = nil
				self:commit("palette", nil)
			end
			self.selected = nil
			self.deps.onPickSpecies(s.id)
			self:pushPreview()
			self:render()
		end)
	end

	-- ---- hats --------------------------------------------------------
	self:sectionTitle(next_(), "HATS")
	self:card(next_(), "No hat", if self.pending.hat == nil then "WORN" else "pick", false, nil, function()
		self:pick("hat", nil)
	end)
	for _, item in self.catalog.items do
		if item.kind ~= "hat" or item.hidden then
			continue
		end
		local owned = self:owns(item.id)
		local locked = (item.level ~= nil and level < item.level) or (item.exclusive ~= nil and not owned)
		local state = if item.exclusive ~= nil and not owned
			then "★ PASS"
			elseif self.equipped.hat == item.id
			then "WORN"
			elseif self.pending.hat == item.id
			then "trying on"
			elseif owned then "owned"
			elseif locked then Loc.f("fmt.level_gate", item.level)
			else `{item.cost}c`
		self:card(next_(), item.name, state, locked, nil, function()
			if locked then
				return
			end
			-- Try-before-you-buy: unowned hats still preview.
			self:pick("hat", item)
		end)
	end

	-- ---- palettes (this species only) ---------------------------------
	self:sectionTitle(next_(), `PALETTES — {self.pending.skin}`)
	self:card(next_(), "Default coat", if self.pending.palette == nil then "WORN" else "pick", false, nil, function()
		self:pick("palette", nil)
	end)
	for _, item in self.catalog.items do
		if item.kind ~= "palette" or item.species ~= self.pending.skin or item.hidden then
			continue
		end
		local owned = self:owns(item.id)
		local locked = (item.level ~= nil and level < item.level) or (item.exclusive ~= nil and not owned)
		local tint = if item.color ~= nil
			then Color3.fromRGB(item.color[1], item.color[2], item.color[3])
			else nil
		local state = if item.exclusive ~= nil and not owned
			then "★ PASS"
			elseif self.equipped.palette == item.id
			then "WORN"
			elseif self.pending.palette == item.id
			then "trying on"
			elseif owned then "owned"
			elseif locked then Loc.f("fmt.level_gate", item.level)
			else `{item.cost}c`
		self:card(next_(), item.name, state, locked, tint, function()
			if locked then
				return
			end
			self:pick("palette", item)
		end)
	end

	-- ---- footer ------------------------------------------------------
	local sel = self.selected
	if sel ~= nil then
		local affordable = coins >= sel.cost
		self.buyButton.Visible = true
		self.footer.Visible = true
		self.buyButton.Text = Loc.f("fmt.buy_cost", sel.cost)
		self.buyButton.BackgroundColor3 = if affordable then Theme.GOLD else Theme.GREY
		self.hint.Text = if affordable
			then `Trying on {sel.name}. Buy it to keep it.`
			else `{sel.name} costs {sel.cost}c — you have {coins}.`
	else
		self.buyButton.Visible = false
		self.footer.Visible = false
	end
	self:fitColumns()
end

--- Preview and rail run to the bottom of the panel unless the BUY footer is
--- there to be cleared. Called from both `render` and `relayout` because
--- either the selection or the viewport can change which applies.
function WardrobeTab:fitColumns()
	local reserve = if self.footer.Visible then 60 else 0
	self.preview.frame.Size = UDim2.new(0, self.previewW or 260, 1, -reserve)
	self.rail.Size = UDim2.new(1, -(self.railInset or 270), 1, -reserve)
end

function WardrobeTab:relayout(L: any, _viewport: Vector2)
	if L.twoColumn then
		local w = L.previewW
		self.preview.frame.Visible = true
		self.previewW = w
		self.gaitButton.Visible = true
		self.rail.Position = UDim2.fromOffset(w + 10, 0)
		self.railInset = w + 10
		self.hint.Size = UDim2.fromOffset(280, 40)
	else
		-- No room for a 3D panel AND a readable rail: the rail wins, because
		-- you cannot buy what you cannot read.
		self.preview.frame.Visible = false
		self.gaitButton.Visible = false
		self.rail.Position = UDim2.fromOffset(0, 0)
		self.railInset = 0
		self.hint.Size = UDim2.fromOffset(120, 40)
	end
	self:fitColumns()
end

return WardrobeTab
