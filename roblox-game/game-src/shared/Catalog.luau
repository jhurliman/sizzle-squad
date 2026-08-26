--!strict
-- Cosmetics catalog (plan §2.5): four tracks layered on the animal chefs.
-- kind: "hat" | "palette" | "emote" | "kitchen". Everything is cosmetic —
-- nothing in here may ever touch the sim.

export type Item = {
	id: string,
	name: string,
	kind: string,
	cost: number, -- career coins; 0 = milestone/level grant only
	level: number?, -- required level (shop shows it locked below)
	species: string?, -- palettes bind to a species
	color: { number }?, -- palette / prop tint (RGB 0-255)
	glyph: string?, -- emotes: the speech-bubble text sent over the wire
	slot: string?, -- kitchen cosmetics: which shared prop this dresses
	variant: string?, -- kitchen cosmetics: sound variant for bells
	hidden: boolean?, -- reserved id with no consumer yet: never shown or sold
}

local Catalog: { Item } = {
	-- starter grant
	{ id = "hat_paper", name = "Paper Hat", kind = "hat", cost = 0 },
	-- hats & accessories (the workhorse track)
	{ id = "hat_toque", name = "Classic Toque", kind = "hat", cost = 150 },
	{ id = "hat_bandana_red", name = "Red Bandana", kind = "hat", cost = 120 },
	{ id = "hat_bandana_green", name = "Green Bandana", kind = "hat", cost = 120 },
	{ id = "hat_beret", name = "Beret", kind = "hat", cost = 200 },
	{ id = "hat_paperboat", name = "Paper Boat", kind = "hat", cost = 90 },
	{ id = "hat_colander", name = "Colander Helm", kind = "hat", cost = 260, level = 5 },
	{ id = "hat_tophat", name = "Top Hat", kind = "hat", cost = 400, level = 8 },
	{ id = "hat_crown", name = "Butter Crown", kind = "hat", cost = 650, level = 12 },
	{ id = "hat_pan", name = "Pan Lid Cap", kind = "hat", cost = 180 },
	{ id = "hat_mushroom", name = "Mushroom Cap", kind = "hat", cost = 220 },
	{ id = "hat_halo", name = "Sous-Chef Halo", kind = "hat", cost = 800, level = 15 },
	-- species palettes (retextures)
	{ id = "pal_bramble_panda", name = "Panda Bramble", kind = "palette", cost = 300, species = "bramble", color = { 240, 238, 232 } },
	{ id = "pal_bramble_polar", name = "Polar Bramble", kind = "palette", cost = 300, species = "bramble", color = { 220, 230, 240 } },
	{ id = "pal_pip_tree", name = "Tree Frog Pip", kind = "palette", cost = 300, species = "pip", color = { 60, 160, 60 } },
	{ id = "pal_pip_axolotl", name = "Axolotl Pip", kind = "palette", cost = 300, species = "pip", color = { 240, 170, 190 } },
	{ id = "pal_nori_calico", name = "Calico Nori", kind = "palette", cost = 300, species = "nori", color = { 230, 180, 120 } },
	{ id = "pal_nori_void", name = "Void Nori", kind = "palette", cost = 300, species = "nori", color = { 40, 40, 50 } },
	{ id = "pal_mochi_cardinal", name = "Cardinal Mochi", kind = "palette", cost = 300, species = "mochi", color = { 200, 40, 40 } },
	{ id = "pal_mochi_bluejay", name = "Blue Jay Mochi", kind = "palette", cost = 300, species = "mochi", color = { 70, 110, 200 } },
	-- emotes (speech-bubble set beyond the built-in pings)
	{ id = "emote_cheer", name = "Cheer", kind = "emote", cost = 100, glyph = "🎉 Yeah!" },
	{ id = "emote_facepalm", name = "Facepalm", kind = "emote", cost = 100, glyph = "🤦 Oops" },
	{ id = "emote_chefkiss", name = "Chef's Kiss", kind = "emote", cost = 180, glyph = "😙👌" },
	{ id = "emote_zzz", name = "Zzz", kind = "emote", cost = 80, glyph = "😴 Zzz" },
	{ id = "emote_onfire", name = "On Fire!", kind = "emote", cost = 180, level = 4, glyph = "🔥 On fire!" },
	-- kitchen cosmetics (team-visible flexes)
	-- `slot` names the shared prop each one dresses. Plates and pans are
	-- team-visible (elected server-side, see main.server broadcastKitchen);
	-- bells are local audio only, so they never need an election.
	{ id = "kit_plates_gold", name = "Gilded Plates", kind = "kitchen", cost = 500, level = 6, slot = "plate", color = { 226, 184, 74 } },
	{ id = "kit_plates_blue", name = "Blue China", kind = "kitchen", cost = 350, slot = "plate", color = { 132, 170, 220 } },
	{ id = "kit_pan_copper", name = "Copper Pans", kind = "kitchen", cost = 500, level = 6, slot = "pan", color = { 196, 118, 62 } },
	{ id = "kit_bell_deep", name = "Deep Serve Bell", kind = "kitchen", cost = 250, slot = "bell", variant = "deep" },
	{ id = "kit_bell_chime", name = "Chime Serve Bell", kind = "kitchen", cost = 250, slot = "bell", variant = "chime" },
}

local byId: { [string]: Item } = {}
for _, item in Catalog do
	byId[item.id] = item
end

-- The four built-in pings, moved out of main.client.luau. They travel as IDS,
-- not as free text: the Emote remote used to rebroadcast any client string to
-- every player, which is an unmoderated-text hole. The server allowlists these
-- plus emote cosmetics the sender actually owns.
local Pings = {
	{ id = "ping_nice", glyph = "Nice!" },
	{ id = "ping_help", glyph = "Help!" },
	{ id = "ping_fire", glyph = "Fire!" },
	{ id = "ping_order", glyph = "Order up!" },
}

local pingById: { [string]: any } = {}
for _, ping in Pings do
	pingById[ping.id] = ping
end

--- Wire id -> the text a speech bubble should show, or nil if not allowed.
local function glyphFor(id: string): string?
	local ping = pingById[id]
	if ping ~= nil then
		return ping.glyph
	end
	local item = byId[id]
	if item ~= nil and item.kind == "emote" then
		return item.glyph or item.name
	end
	return nil
end

return {
	items = Catalog,
	byId = byId,
	pings = Pings,
	pingById = pingById,
	glyphFor = glyphFor,
	-- milestone level -> granted item id (plan: visible drip early)
	milestones = {
		[3] = "hat_bandana_red",
		[5] = "hat_colander",
		[7] = "pal_pip_tree",
		[10] = "hat_tophat",
		[15] = "hat_halo",
	},
}
