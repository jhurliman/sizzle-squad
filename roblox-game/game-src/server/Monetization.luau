--!strict
-- Ownership of the premium passes: checks it on join, grants the cosmetics
-- into the profile, and exposes the XP/coin multipliers Progression applies.
--
-- Deliberately fail-open-as-free: every Roblox call is wrapped, and any error
-- leaves the player treated as a non-owner for this session rather than
-- blocking their round. A missed entitlement is recoverable on the next join;
-- a thrown error in PlayerAdded is not.

local Server = {}
Server.__index = Server

--- `defs` is shared/Monetization (injected rather than required, so this
--- module has no opinion about where shared code is mounted).
function Server.new(catalog: any, defs: any)
	local self = setmetatable({}, Server)
	self.catalog = catalog
	self.defs = defs
	self.owned = {} :: { [any]: { [string]: boolean } }
	self.market = nil
	pcall(function()
		self.market = game:GetService("MarketplaceService")
	end)
	-- Grant on purchase, so the wardrobe fills in without a rejoin.
	if self.market ~= nil then
		pcall(function()
			self.market.PromptGamePassPurchaseFinished:Connect(function(player, passId, wasPurchased)
				if not wasPurchased then
					return
				end
				local product = self.defs.byPass[passId]
				if product ~= nil then
					self:grant(player, product)
				end
			end)
		end)
	end
	return self
end

function Server:playerAdded(player: any)
	self.owned[player] = {}
	if self.market == nil or not self.defs.configured() then
		return
	end
	-- Yielding web call: off the join path so a slow response never delays
	-- seating the player into a chef.
	task.spawn(function()
		for _, product in self.defs.PRODUCTS do
			if product.gamePassId == 0 then
				continue
			end
			local ok, has = pcall(function()
				return self.market:UserOwnsGamePassAsync(player.UserId, product.gamePassId)
			end)
			if ok and has then
				self:grant(player, product)
			end
		end
	end)
end

function Server:playerRemoving(player: any)
	self.owned[player] = nil
end

--- Mark owned and push the product's cosmetics into the profile.
function Server:grant(player: any, product: any)
	local set = self.owned[player]
	if set == nil then
		set = {}
		self.owned[player] = set
	end
	if set[product.id] then
		return
	end
	set[product.id] = true
	if self.onGrant ~= nil then
		self.onGrant(player, self.defs.grantsOf(self.catalog, product.id))
	end
end

function Server:owns(player: any, productId: string): boolean
	local set = self.owned[player]
	return set ~= nil and set[productId] == true
end

local function multiplier(self: any, player: any, field: string): number
	local set = self.owned[player]
	if set == nil then
		return 1
	end
	local mul = 1
	for _, product in self.defs.PRODUCTS do
		if set[product.id] and product[field] ~= nil then
			mul *= product[field]
		end
	end
	return mul
end

function Server:xpMultiplier(player: any): number
	return multiplier(self, player, "xpMul")
end

function Server:coinMultiplier(player: any): number
	return multiplier(self, player, "coinMul")
end

--- Nametag prefix for the highest-tier product the player owns.
function Server:flairFor(player: any): string
	local set = self.owned[player]
	if set == nil then
		return ""
	end
	for _, product in self.defs.PRODUCTS do
		if set[product.id] and product.flair ~= nil then
			return product.flair
		end
	end
	return ""
end

return Server
