--!strict
-- Shop: the catalog, categorised.
--
-- Replaces Hud:buildShop -- a single flat ScrollingFrame listing all 30 items
-- as "{name} · {kind}" text rows with no icon, no grouping and no preview.
-- Wearables hand off to the Wardrobe rather than asking you to buy blind.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

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
	{ id = "premium", label = "★ PREMIUM" },
}

function ShopTab.new(parent: Instance, deps: any)
	local self = setmetatable({}, ShopTab)
	self.catalog = deps.catalog
	self.money = deps.monetization
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
		Text = "0 coins",
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
	self.coinChip.Text = `{progress.coins or 0} coins`
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
	if self.filter == "premium" then
		self:renderPremium(progress)
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
			action.Text = `{item.cost}c`
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

--- Robux products. Rendered from shared/Monetization, and a product whose
--- gamePassId is still 0 is simply not shown -- the same inert-until-configured
--- convention the badge ids use.
function ShopTab:renderPremium(progress: any)
	local owned = progress.owned or {}
	local order, shown = 0, 0
	for _, product in self.money.PRODUCTS do
		if product.gamePassId == 0 then
			continue
		end
		shown += 1
		order += 1
		-- "Owned" is inferred from the grants actually in the profile, so the
		-- card reflects what the server believes, not a local guess.
		local grants = self.money.grantsOf(self.catalog, product.id)
		local has = #grants > 0
		for _, id in grants do
			if owned[id] ~= true then
				has = false
			end
		end

		local card = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 96),
			BackgroundColor3 = if has then Theme.GREEN else Theme.BROWN_LIGHT,
			BackgroundTransparency = 0.2,
			BorderSizePixel = 0,
			LayoutOrder = order,
			ZIndex = 4,
		}, self.list)
		Theme.corner(card, 10)
		Theme.label({
			Size = UDim2.new(1, -170, 0, 26),
			Position = UDim2.fromOffset(14, 8),
			TextSize = 18,
			Font = Theme.TITLE_FONT,
			TextColor3 = Theme.GOLD,
			ZIndex = 5,
			Text = product.name,
		}, card)
		Theme.label({
			Size = UDim2.new(1, -170, 0, 54),
			Position = UDim2.fromOffset(14, 34),
			TextSize = 13,
			TextWrapped = true,
			TextYAlignment = Enum.TextYAlignment.Top,
			ZIndex = 5,
			Text = product.blurb,
		}, card)
		local buy = Theme.button({
			Size = UDim2.fromOffset(140, Theme.MIN_TAP),
			Position = UDim2.new(1, -150, 0.5, -Theme.MIN_TAP / 2),
			Fill = if has then Theme.GREY else Theme.GOLD,
			TextColor3 = if has then Theme.CREAM else Theme.BROWN_DEEP,
			TextSize = 16,
			ZIndex = 5,
			Text = if has then "OWNED" else `R$ {product.robux}`,
		}, card)
		if not has then
			buy.Activated:Connect(function()
				pcall(function()
					MarketplaceService:PromptGamePassPurchase(Players.LocalPlayer, product.gamePassId)
				end)
			end)
		end
	end

	if shown == 0 then
		Theme.label({
			Size = UDim2.new(1, -20, 0, 80),
			TextXAlignment = Enum.TextXAlignment.Center,
			TextWrapped = true,
			TextColor3 = Theme.DIM,
			LayoutOrder = 1,
			ZIndex = 5,
			Text = "No passes are set up yet.\nCreate them on the Creator Dashboard and put their ids in shared/Monetization.luau.",
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
