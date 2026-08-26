--!strict
-- Shop: the catalog, categorised.
--
-- Replaces Hud:buildShop -- a single flat ScrollingFrame listing all 30 items
-- as "{name} · {kind}" text rows with no icon, no grouping and no preview.
-- Wearables hand off to the Wardrobe rather than asking you to buy blind.

local Theme = require(script.Parent.Theme) :: any

local ShopTab = {}
ShopTab.__index = ShopTab

local mk = Theme.mk

local FILTERS = {
	{ id = "all", label = "ALL" },
	{ id = "hat", label = "HATS" },
	{ id = "palette", label = "COATS" },
	{ id = "emote", label = "EMOTES" },
	{ id = "kitchen", label = "KITCHEN" },
}

function ShopTab.new(parent: Instance, deps: any)
	local self = setmetatable({}, ShopTab)
	self.catalog = deps.catalog
	self.deps = deps
	self.filter = "all"

	self.filterRow = mk("Frame", {
		Size = UDim2.new(1, 0, 0, 32),
		BackgroundTransparency = 1,
		ZIndex = 4,
	}, parent)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.filterRow)

	self.filterButtons = {}
	for i, f in FILTERS do
		local btn = Theme.button({
			Size = UDim2.fromOffset(110, 30),
			Fill = Theme.BROWN_LIGHT,
			TextSize = 13,
			LayoutOrder = i,
			ZIndex = 5,
			Text = f.label,
		}, self.filterRow)
		btn.Activated:Connect(function()
			self.filter = f.id
			self:render()
		end)
		self.filterButtons[f.id] = btn
	end

	self.coinChip = Theme.chip({
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, 0, 0, 0),
		Size = UDim2.fromOffset(130, 30),
		TextColor3 = Theme.GOLD,
		ZIndex = 6,
		Text = "0 🪙",
	}, parent)

	self.list = Theme.scrollList({
		Position = UDim2.fromOffset(0, 40),
		Size = UDim2.new(1, 0, 1, -40),
		ZIndex = 4,
	}, parent)

	return self
end

function ShopTab:setProgress(progress: any)
	self.progress = progress
	self.coinChip.Text = `{progress.coins or 0} 🪙`
	self:render()
end

function ShopTab:onShow()
	self:render()
end

function ShopTab:render()
	for id, btn in self.filterButtons do
		btn.BackgroundColor3 = if id == self.filter then Theme.GREEN else Theme.BROWN_LIGHT
	end
	for _, c in self.list:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	local progress = self.progress
	if progress == nil then
		return
	end
	local level, coins = progress.level or 1, progress.coins or 0
	local owned, equipped = progress.owned or {}, progress.equipped or {}

	local order = 0
	for _, item in self.catalog.items do
		-- `hidden` items are reserved ids whose in-game consumer is not built
		-- yet; taking coins for something invisible is the bug this pass is
		-- fixing, so they never reach the shelf.
		if item.hidden then
			continue
		end
		if self.filter ~= "all" and item.kind ~= self.filter then
			continue
		end
		-- cost 0 = milestone grant, not purchasable.
		if item.cost <= 0 and owned[item.id] ~= true then
			continue
		end
		order += 1
		local isOwned = owned[item.id] == true
		local isEquipped = equipped[item.kind] == item.id
		local locked = item.level ~= nil and level < item.level
		local wearable = item.kind == "hat" or item.kind == "palette"

		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 56),
			BackgroundColor3 = if isEquipped then Theme.GREEN else Theme.BROWN_LIGHT,
			BackgroundTransparency = if locked then 0.55 else 0.25,
			BorderSizePixel = 0,
			LayoutOrder = order,
			ZIndex = 4,
		}, self.list)
		Theme.corner(row, 10)

		if item.color ~= nil then
			local swatch = mk("Frame", {
				Size = UDim2.fromOffset(26, 26),
				Position = UDim2.fromOffset(12, 15),
				BackgroundColor3 = Color3.fromRGB(item.color[1], item.color[2], item.color[3]),
				BorderSizePixel = 0,
				ZIndex = 5,
			}, row)
			Theme.corner(swatch, 13)
		end

		Theme.label({
			Size = UDim2.new(1, -280, 0, 24),
			Position = UDim2.fromOffset(if item.color ~= nil then 48 else 14, 6),
			TextSize = 16,
			Font = Theme.BOLD_FONT,
			TextColor3 = if locked then Theme.DIM else Theme.CREAM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			Text = item.name,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -280, 0, 18),
			Position = UDim2.fromOffset(if item.color ~= nil then 48 else 14, 28),
			TextSize = 12,
			TextColor3 = Theme.DIM,
			ZIndex = 5,
			Text = if locked then `{item.kind}  ·  unlocks at level {item.level}` else item.kind,
		}, row)

		-- Try-on shortcut for anything you can actually see on a chef.
		if wearable and not locked then
			local try = Theme.button({
				Size = UDim2.fromOffset(84, 34),
				Position = UDim2.new(1, -232, 0.5, -17),
				Fill = Theme.BROWN_MID,
				TextSize = 13,
				ZIndex = 5,
				Text = "TRY IT",
			}, row)
			try.Activated:Connect(function()
				self.deps.onTryOn(item)
			end)
		end

		local action = Theme.button({
			Size = UDim2.fromOffset(130, Theme.MIN_TAP),
			Position = UDim2.new(1, -140, 0.5, -Theme.MIN_TAP / 2),
			TextSize = 15,
			ZIndex = 5,
			Text = "",
		}, row)
		if isEquipped then
			action.Text = "EQUIPPED"
			action.BackgroundColor3 = Theme.GREY
		elseif isOwned then
			action.Text = "EQUIP"
			action.BackgroundColor3 = Theme.BLUE
		elseif locked then
			action.Text = `Lv {item.level}`
			action.BackgroundColor3 = Theme.GREY
		else
			action.Text = `{item.cost} 🪙`
			action.BackgroundColor3 = if coins >= item.cost then Theme.GOLD else Theme.GREY
			action.TextColor3 = if coins >= item.cost then Theme.BROWN_DEEP else Theme.CREAM
		end
		action.Activated:Connect(function()
			if locked then
				return
			end
			if isOwned then
				self.deps.onShopAction({ action = "equip", id = item.id })
			elseif coins >= item.cost then
				self.deps.onShopAction({ action = "buy", id = item.id })
			end
		end)
	end

	if order == 0 then
		Theme.label({
			Size = UDim2.new(1, -10, 0, 40),
			TextXAlignment = Enum.TextXAlignment.Center,
			TextColor3 = Theme.DIM,
			LayoutOrder = 1,
			ZIndex = 5,
			Text = "Nothing here yet.",
		}, self.list)
	end
end

function ShopTab:relayout(L: any, _viewport: Vector2)
	local w = math.min(110, (L.panelW - 180) / #FILTERS - 6)
	for _, btn in self.filterButtons do
		btn.Size = UDim2.fromOffset(math.max(64, w), 30)
	end
end

return ShopTab
