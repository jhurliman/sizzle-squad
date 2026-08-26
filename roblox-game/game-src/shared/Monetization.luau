--!strict
-- Premium products (plan §2.5). Everything here is cosmetic or a progression
-- boost; NOTHING touches the sim, so a paying player never has a gameplay
-- advantage over anyone else in the kitchen.
--
-- gamePassId is 0 until the passes are created on the Creator Dashboard. A 0
-- id makes the product inert -- it is hidden from the shop and can never be
-- granted -- which is the same convention Badges.IDS uses. Fill the ids in and
-- the products light up with no other change.

local Monetization = {}

export type Product = {
	id: string, -- matches Catalog `exclusive`
	name: string,
	blurb: string,
	gamePassId: number,
	robux: number, -- display only; Roblox charges whatever the pass says
	xpMul: number?,
	coinMul: number?,
	flair: string?, -- prefix on the in-world nametag
}

Monetization.PRODUCTS = {
	{
		id = "supporter",
		name = "Supporter Pass",
		blurb = "+10% XP and coins forever, four Gilded coats, the Sizzle! emote, Supporter Plates, and a star on your nametag.",
		gamePassId = 0,
		robux = 199,
		xpMul = 1.1,
		coinMul = 1.1,
		flair = "★ ",
	},
	{
		id = "trunk",
		name = "Chef's Trunk",
		blurb = "Four Midnight coats, the Boom! emote and Obsidian Pans.",
		gamePassId = 0,
		robux = 149,
	},
} :: { Product }

local byId: { [string]: Product } = {}
local byPass: { [number]: Product } = {}
for _, p in Monetization.PRODUCTS do
	byId[p.id] = p
	if p.gamePassId ~= 0 then
		byPass[p.gamePassId] = p
	end
end
Monetization.byId = byId
Monetization.byPass = byPass

--- Is anything actually purchasable? False until the dashboard ids are filled.
function Monetization.configured(): boolean
	for _, p in Monetization.PRODUCTS do
		if p.gamePassId ~= 0 then
			return true
		end
	end
	return false
end

--- Catalog items a product grants (everything tagged with its id).
function Monetization.grantsOf(catalog: any, productId: string): { string }
	local out = {}
	for _, item in catalog.items do
		if item.exclusive == productId then
			table.insert(out, item.id)
		end
	end
	return out
end

return Monetization
