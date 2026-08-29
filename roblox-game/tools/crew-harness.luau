-- NO CHARACTER TWICE IN ONE KITCHEN.
--
-- sim.ts seeds four chefs with four distinct skins, so the invariant holds by
-- construction right up until something assigns a skin directly. CrewManager
-- used to do exactly that with the player's wardrobe preference, so two
-- players who both liked pip got two pips. These assertions pin the swap.
local shared = require("../out/shared-bundle")
local SimService = require("../game-src/server/SimService")
local Replicator = require("../game-src/server/Replicator")
local CrewManager = require("../game-src/server/CrewManager")
local Net = require("../game-src/shared/Net")

local failures = 0
local function check(c: boolean, m: string)
	if c then print(`  ok   {m}`) else failures += 1 print(`  FAIL {m}`) end
end

local function stubRemote()
	local r = { OnServerEvent = { Connect = function() return { Disconnect = function() end } end } }
	function r:FireAllClients() end
	function r:FireClient() end
	return r
end
local remotes = {}
for name in Net.REMOTES do remotes[name] = stubRemote() end

local prefs: { [any]: string } = {}
local simService = SimService.new(shared, { seed = 7, botFill = true })
local replicator = Replicator.new(shared, Net, remotes, function(chef) return simService:chefFlags(chef) end)
local crew = CrewManager.new(simService, Net, remotes, replicator, function() return 0 end, function(p)
	return prefs[p]
end)

local function skins(): { string }
	local out = {}
	for _, c in simService.sim.chefs do table.insert(out, c.skin) end
	return out
end
local function allDistinct(): boolean
	local seen = {}
	for _, s in skins() do
		if seen[s] then return false end
		seen[s] = true
	end
	return true
end
local function skinOf(player: any): string?
	local seat = crew.seats[player]
	return seat and simService.sim.chefs[seat.chefId + 1].skin
end

check(allDistinct(), `a fresh kitchen starts with four distinct chefs ({table.concat(skins(), ", ")})`)

-- ---- two players, same preference ---------------------------------------
local A = { UserId = 1, Name = "A" }
local B = { UserId = 2, Name = "B" }
prefs[A] = "pip"
prefs[B] = "pip"
crew:playerAdded(A)
check(skinOf(A) == "pip", `first claimant gets their preference (got {tostring(skinOf(A))})`)
crew:playerAdded(B)
check(skinOf(B) ~= "pip", `second player with the same preference does NOT get pip (got {tostring(skinOf(B))})`)
check(skinOf(A) == "pip", "and the first player keeps it")
check(allDistinct(), `still four distinct chefs ({table.concat(skins(), ", ")})`)

-- ---- taking a species a BOT holds ---------------------------------------
local free = nil
for _, c in simService.sim.chefs do
	if c.skin ~= skinOf(A) and c.skin ~= skinOf(B) then free = c.skin break end
end
local before = skinOf(B)
crew:claimSkin(crew.seats[B].chefId, free)
check(skinOf(B) == free, `a species a bot holds can be taken ({tostring(before)} -> {tostring(free)})`)
check(allDistinct(), "the displaced bot took the vacated skin, so all four are still distinct")

-- ---- taking a species a HUMAN holds -------------------------------------
local held = skinOf(B)
crew:claimSkin(crew.seats[A].chefId, held)
check(skinOf(A) ~= held, "a species a seated human wears cannot be taken")
check(skinOf(B) == held, "and its wearer is undisturbed")
check(allDistinct(), "still four distinct chefs")

-- ---- what the wardrobe is told ------------------------------------------
local taken = crew:takenSkins()
local n = 0
for _ in taken do n += 1 end
check(n == 2 and taken[skinOf(A)] and taken[skinOf(B)],
	`takenSkins reports exactly the two human-worn species ({n})`)

-- ---- reseat (every round start) -----------------------------------------
crew:reseat()
check(allDistinct(), `chefs stay distinct across a reseat ({table.concat(skins(), ", ")})`)
check(skinOf(A) ~= skinOf(B), "and the two players are still different characters")

-- ---- a leaver frees their species ---------------------------------------
local wasA = skinOf(A)
crew:playerRemoving(A)
check(crew:takenSkins()[wasA] == nil, "a departed player's species is released")
crew:claimSkin(crew.seats[B].chefId, wasA)
check(skinOf(B) == wasA, "and the remaining player can then claim it")

-- ---- a bumped human must not stay stunned forever ----------------------
--
-- chef.stun is decremented inside moveChef, which a client-authoritative chef
-- never runs on the server. Without an explicit run-down a single bump froze
-- the player permanently: applyHuman refuses input while stunned, the
-- transform packets kept re-freezing the client's mirror, and collidePhase
-- kept nudging the body — the reported "vibrating and won't move".
local seat = crew.seats[B]
local chef = simService.sim.chefs[seat.chefId + 1]
chef.stun = 0.16
local before = chef.stun
for _ = 1, 30 do
	simService:tick(1 / 60)
end
check(chef.stun < before, `a human's stun runs down on the server ({before} -> {chef.stun})`)
check(chef.stun == 0, "and reaches zero rather than sticking")

-- And once clear, client movement is accepted again. Assert the POSITION
-- moved, not the reject streak: applyHuman returns before touching the streak
-- while stunned, so a streak of 0 is equally true of a frozen chef and proves
-- nothing (it passed against the broken build).
local from = { x = chef.pos.x, y = chef.pos.y }
simService:humanMove(seat.chefId, {
	seq = 1, px = from.x + 0.05, py = from.y, vx = 0, vy = 0, heading = 0, useHeld = false,
})
simService:tick(1 / 60)
check(math.abs(chef.pos.x - (from.x + 0.05)) < 1e-6,
	`and the server takes the client's position again ({from.x} -> {chef.pos.x})`)

-- ---- and a BOT must not stay stunned between rounds --------------------
--
-- THE REPORTED BUG: with three humans and one bot, the bot got into a
-- vibrating body state during the lobby while still drifting around the level.
-- tickMovementOnly (the between-rounds path) cleared working/stun for HUMANS
-- only, and nothing else can clear a bot's — movePhase is what decrements it
-- and this path never calls movePhase for anyone. So a lobby bump left the bot
-- stunned forever: the flag rode every transform, the client looped the wobble
-- and flail, and collidePhase kept shoving the frozen body around.
--
-- Exactly the same shape as the human freeze above, one code path over.
local bot
for _, c in simService.sim.chefs do
	if simService.humans[c.id] == nil then
		bot = c
		break
	end
end
check(bot ~= nil, "there is a bot chef to test")
if bot ~= nil then
	bot.stun = 0.16
	bot.working = 7
	for _ = 1, 4 do
		simService:tickMovementOnly(1 / 60)
	end
	check(bot.stun == 0, `a bot's stun clears between rounds ({bot.stun})`)
	check(bot.working == nil, "and it is not left holding work either")
	-- the flag is what the client actually renders from
	check(bit32.band(simService:chefFlags(bot), 1) == 0, "so no FLAG_STUN reaches the client")
end

print(if failures > 0 then `{failures} FAILURES` else "PASS: crew")
