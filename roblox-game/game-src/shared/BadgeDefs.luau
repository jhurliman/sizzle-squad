--!strict
-- Badge display metadata, shared so the client can render a badge case.
--
-- Ids live server-side in Badges.luau and deliberately do NOT appear here:
-- the client never needs them, and the award decision is the server's alone.
-- This is names and copy only, in the order they should read.

export type BadgeDef = { key: string, name: string, blurb: string, icon: string }

local BadgeDefs: { BadgeDef } = {
	{ key = "firstDish", name = "First Dish", icon = "🍽️", blurb = "Your first plate over the pass." },
	{ key = "perfectRound", name = "Clean Service", icon = "✨", blurb = "A whole shift without missing a ticket." },
	{ key = "firstThreeStar", name = "Three Stars", icon = "⭐", blurb = "Finish a shift with all three stars." },
	{ key = "fullHumanCrewThreeStar", name = "Full House", icon = "👥", blurb = "Three stars with a full crew of four." },
	{ key = "levelTen", name = "Head Chef", icon = "👨‍🍳", blurb = "Reach level 10." },
	{ key = "hundredDishes", name = "Century", icon = "💯", blurb = "Serve 100 dishes." },
	{ key = "thousandDishes", name = "Thousand Plates", icon = "🏆", blurb = "Serve 1,000 dishes." },
	{ key = "foundingChef", name = "Founding Chef", icon = "🔥", blurb = "Worked the line during the launch window." },
}

local byKey: { [string]: BadgeDef } = {}
for _, d in BadgeDefs do
	byKey[d.key] = d
end

return { list = BadgeDefs, byKey = byKey }
