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

print(if failures > 0 then `{failures} FAILURES` else "PASS: crew")
