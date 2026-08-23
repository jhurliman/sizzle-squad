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
	color: { number }?, -- palette tint (RGB 0-255)
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
	{ id = "emote_cheer", name = "Cheer", kind = "emote", cost = 100 },
	{ id = "emote_facepalm", name = "Facepalm", kind = "emote", cost = 100 },
	{ id = "emote_chefkiss", name = "Chef's Kiss", kind = "emote", cost = 180 },
	{ id = "emote_zzz", name = "Zzz", kind = "emote", cost = 80 },
	{ id = "emote_onfire", name = "On Fire!", kind = "emote", cost = 180, level = 4 },
	-- kitchen cosmetics (team-visible flexes)
	{ id = "kit_plates_gold", name = "Gilded Plates", kind = "kitchen", cost = 500, level = 6 },
	{ id = "kit_plates_blue", name = "Blue China", kind = "kitchen", cost = 350 },
	{ id = "kit_pan_copper", name = "Copper Pans", kind = "kitchen", cost = 500, level = 6 },
	{ id = "kit_bell_deep", name = "Deep Serve Bell", kind = "kitchen", cost = 250 },
	{ id = "kit_bell_chime", name = "Chime Serve Bell", kind = "kitchen", cost = 250 },
}

local byId: { [string]: Item } = {}
for _, item in Catalog do
	byId[item.id] = item
end

return {
	items = Catalog,
	byId = byId,
	-- milestone level -> granted item id (plan: visible drip early)
	milestones = {
		[3] = "hat_bandana_red",
		[5] = "hat_colander",
		[7] = "pal_pip_tree",
		[10] = "hat_tophat",
		[15] = "hat_halo",
	},
}
