-- End-to-end server-stack test under Lune: SimService + Replicator +
-- CrewManager + RoundDirector + Progression with stub remotes and an
-- emulated client that runs the real shared movePhase and streams packed
-- move buffers through the real remote handlers.
--
-- Scenario: countdown -> round 1 (1 human walking circles + 3 bots) ->
-- results -> intermission -> round 2 -> AFK takeover -> resume -> shop.
local shared = require("../out/shared-bundle")
local SimService = require("../game-src/server/SimService")
local Replicator = require("../game-src/server/Replicator")
local CrewManager = require("../game-src/server/CrewManager")
local RoundDirector = require("../game-src/server/RoundDirector")
local Progression = require("../game-src/server/Progression")
local Net = require("../game-src/shared/Net")
local Config = require("../game-src/shared/Config")
local Catalog = require("../game-src/shared/Catalog")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

-- ---------------------------------------------------------------- stubs

local function stubRemote(name: string)
	local handlers = {}
	local remote = {
		name = name,
		allFired = {},
		clientFired = {},
		OnServerEvent = {
			Connect = function(_, fn)
				table.insert(handlers, fn)
				return { Disconnect = function() end }
			end,
		},
	}
	function remote:FireAllClients(...)
		table.insert(self.allFired, { ... })
	end
	function remote:FireClient(player, ...)
		table.insert(self.clientFired, { player = player, args = { ... } })
	end
	function remote:_serverFire(player, ...)
		for _, fn in handlers do
			fn(player, ...)
		end
	end
	return remote
end

local remotes = {}
for name in Net.REMOTES do
	remotes[name] = stubRemote(name)
end

local clock = { t = 0 }
local now = function()
	return clock.t
end

local playerA = { UserId = 1001, Name = "Alice" }

-- ---------------------------------------------------------------- stack

local simService = SimService.new(shared, { seed = 4242, botFill = true })
local replicator = Replicator.new(shared, Net, remotes, function(chef)
	return simService:chefFlags(chef)
end)
local crew = CrewManager.new(simService, Net, remotes, replicator, now)
local progression = Progression.new(Config, remotes, Catalog)
local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	seedFn = function()
		return 999
	end,
	assistFn = function()
		return progression:crewQualifiesForAssist(crew)
	end,
	onRoundEnd = function(results)
		progression:awardRound(crew, results)
	end,
})

-- ---------------------------------------------------------------- client emu

local clientSim = shared.createSim({ seed = 1, botCount = 3 })
local mirror = nil
local myChefId = nil
local seq = 0

local function syncMirrorFromAssign()
	local msgs = remotes.ChefAssign.clientFired
	local last = msgs[#msgs]
	if last ~= nil then
		myChefId = last.args[1].chefId
		mirror = clientSim.chefs[myChefId + 1]
		-- adopt the server's spawn position
		for _, chef in simService.sim.chefs do
			if chef.id == myChefId then
				mirror.pos.x, mirror.pos.y = chef.pos.x, chef.pos.y
				mirror.vel.x, mirror.vel.y = 0, 0
				mirror.working = nil
				mirror.stun = 0
			end
		end
	end
end

local sendInput = true
local corrections = 0
local function clientTick(dt: number, t: number)
	if mirror == nil or not sendInput then
		return
	end
	local ang = t * 0.8
	local input = { move = { x = math.cos(ang), y = math.sin(ang) * 0.6 }, grabPressed = false, useHeld = false }
	shared.movePhase(clientSim, mirror, input, dt)
	clientSim.events = {}
	seq += 1
	local b = Net.packMove(seq, mirror.pos.x, mirror.pos.y, mirror.vel.x, mirror.vel.y, mirror.heading, false)
	remotes.MoveStream:_serverFire(playerA, b)
	local slot = simService.humans[myChefId]
	if slot ~= nil and slot.corrected then
		corrections += 1
	end
end

-- ---------------------------------------------------------------- run

local phaseLog = {}
local function logPhase()
	local p = director.phase
	if phaseLog[#phaseLog] ~= p then
		table.insert(phaseLog, p)
	end
end

progression:playerAdded(playerA)
crew:playerAdded(playerA)
syncMirrorFromAssign()

local DT = 1 / 60
local roundOneCoins = nil
local sawAfk = false
local resumed = false

for i = 1, 60 * 320 do
	clock.t += DT
	crew:heartbeat()
	director:heartbeat(DT)
	logPhase()

	-- Rounds no longer start on a timer: the lobby waits for Start. Stand in
	-- for the player pressing the button, but NOT during the AFK stretch --
	-- an idle player must not be able to start a shift.
	if (director.phase == "countdown" or director.phase == "intermission") and sendInput then
		director:setReady(playerA, true)
	end

	if director.phase == "round" then
		if #phaseLog >= 4 and not sawAfk then
			-- Round 2: go idle to trigger AFK takeover.
			sendInput = false
			local seat = crew.seats[playerA]
			if seat ~= nil and seat.afk then
				sawAfk = true
			end
		else
			if mirror == nil or (myChefId ~= nil and simService.humans[myChefId] == nil and not sawAfk) then
				syncMirrorFromAssign()
			end
			clientTick(DT, clock.t)
		end
	end
	if sawAfk and not resumed then
		-- Any input resumes control instantly.
		syncMirrorFromAssign()
		sendInput = true
		clientTick(DT, clock.t)
		local seat = crew.seats[playerA]
		resumed = seat ~= nil and not seat.afk
	end
	if director.phase == "results" and roundOneCoins == nil then
		roundOneCoins = director.lastResults.coins
	end
	if resumed and #phaseLog >= 5 then
		break
	end
end

print("phases:", table.concat(phaseLog, " -> "))
check(phaseLog[1] == "countdown" and phaseLog[2] == "round", "countdown leads into round 1")
check(table.find(phaseLog, "results") ~= nil, "round 1 reached results")
check(table.find(phaseLog, "intermission") ~= nil, "results lead to intermission")
check(#phaseLog >= 4, "intermission started round 2")
check(roundOneCoins ~= nil and roundOneCoins > 0, `round 1 scored coins ({roundOneCoins})`)
check(corrections == 0, `honest client was never corrected ({corrections} corrections)`)
check(sawAfk, "idle player was covered by a bot after 20s")
check(resumed, "input resumed control instantly after AFK")

local results = director.lastResults
check(results.stars ~= nil and results.cards ~= nil, "results carry stars + superlative cards")
local myCard = results.cards[myChefId]
check(myCard ~= nil, `human got a superlative card ({myCard and myCard.title or "none"})`)

-- pacing: 1 human -> base gap 1.0, pressure director stays in band.
-- Derived from Config, not hardcoded: the band is the 4-player difficulty
-- dial and is expected to be retuned (see Config.PRESSURE_BAND_MUL).
local gapMul = simService.sim.director.orderGapMul
local band = Config.PRESSURE_BAND_MUL
check(
	gapMul >= (1 - band) - 0.01 and gapMul <= (1 + band) + 0.01,
	`pressure director inside band (gapMul={gapMul}, band=+/-{band})`
)
check(simService.sim.director.botServeValueMul == Config.BOT_SERVE_VALUE_MUL, "bot serve cut applied")

-- progression: profile grew after rounds
local profile = progression.profiles[playerA]
check(profile.coins > 0, `career coins paid out ({profile.coins})`)
check(profile.rounds >= 1, `rounds counted ({profile.rounds})`)
check(profile.xp > 0 or profile.level > 1, `xp granted (level {profile.level}, xp {profile.xp})`)

-- shop: buy + equip
profile.coins += 500
progression:shopAction(playerA, { action = "buy", id = "hat_bandana_red" })
progression:shopAction(playerA, { action = "equip", id = "hat_bandana_red" })
check(profile.owned.hat_bandana_red == true, "shop buy works")
check(profile.equipped.hat == "hat_bandana_red", "shop equip works")

-- replication sanity: transforms + events + phases flowed
check(#remotes.Transforms.allFired > 100, `transforms streamed ({#remotes.Transforms.allFired} packets)`)
check(#remotes.SimEvents.allFired > 10, `events streamed ({#remotes.SimEvents.allFired} batches)`)
check(#remotes.RoundPhase.allFired > 5, "round phases broadcast")

-- buffer round-trip
local b = Net.packMove(7, 3.25, 4.5, 1.5, -2.25, 0.7, true)
local p = Net.unpackMove(b)
check(p ~= nil and math.abs(p.px - 3.25) < 0.001 and math.abs(p.vy - -2.25) < 0.07 and p.useHeld, "move buffer round-trips")

if failures > 0 then
	error(`{failures} checks failed`)
end
print("PASS: server stack end-to-end")

-- ---------------------------------------------------------- bots-off checks

local svc2 = SimService.new(shared, { seed = 7, botFill = false })
local allParked = true
for _, chef in svc2.sim.chefs do
	if chef.pos.y < 11 then
		allParked = false
	end
end
check(allParked, "bots-off: fresh server parks every chef outside the kitchen")
svc2:setHuman(0, true)
local activeCount = 0
local humanChef = nil
for _, chef in svc2.sim.chefs do
	if svc2:isActive(chef) then
		activeCount += 1
		humanChef = chef
	end
end
check(activeCount == 1, "bots-off: exactly the seated human is active")
check(
	humanChef ~= nil and shared.isWalkable(svc2.sim.kitchen, math.floor(humanChef.pos.x), math.floor(humanChef.pos.y)),
	"bots-off: human spawned on a walkable cell"
)
svc2.sim.events = {}
local batch2 = svc2:tick(0.1, 0)
check(true, "bots-off: sim ticks without a bot director")

print(if failures > 0 then `{failures} FAILURES` else "PASS: bots-off mode")
if failures > 0 then
	error(`{failures} checks failed`)
end

-- ==========================================================================
-- Explicit start: a round NEVER begins on a timer. countdown and intermission
-- are open-ended lobbies, and the only way into a shift is every non-AFK chef
-- pressing Start.
-- ==========================================================================

failures = 0

local svc3 = SimService.new(shared, { seed = 77, botFill = true })
local rep3 = Replicator.new(shared, Net, remotes, function(chef)
	return svc3:chefFlags(chef)
end)
local clock3 = { t = 0 }
local crew3 = CrewManager.new(svc3, Net, remotes, rep3, function()
	return clock3.t
end)
local dir3
dir3 = RoundDirector.new(shared, Config, svc3, crew3, rep3, remotes, {
	seedFn = function()
		return 7
	end,
})
crew3:playerAdded(playerA)
dir3:setPhase("intermission", 0)

-- Sit in the lobby for a long time; nothing should start on its own.
for _ = 1, 1200 do
	clock3.t += 0.1
	crew3:touch(crew3.seats[playerA])
	crew3:heartbeat()
	dir3:heartbeat(0.1)
end
check(dir3.phase == "intermission", `no auto-start after 120s idle (phase={dir3.phase})`)

-- Pressing Start is the only way in.
dir3:setReady(playerA, true)
check(dir3.phase == "round", "pressing Start begins the shift")

-- Same rule from the fresh-server countdown lobby.
local dir4
dir4 = RoundDirector.new(shared, Config, svc3, crew3, rep3, remotes, {
	seedFn = function()
		return 7
	end,
})
check(dir4.phase == "countdown", "a fresh server opens in the countdown lobby")
for _ = 1, 600 do
	clock3.t += 0.1
	crew3:touch(crew3.seats[playerA])
	crew3:heartbeat()
	dir4:heartbeat(0.1)
end
check(dir4.phase == "countdown", "countdown never auto-starts either")
dir4:setReady(playerA, true)
check(dir4.phase == "round", "Start works from the countdown lobby too")

-- An AFK chef must not be able to strand the crew in the lobby forever.
local dir5
dir5 = RoundDirector.new(shared, Config, svc3, crew3, rep3, remotes, {
	seedFn = function()
		return 7
	end,
})
dir5:setPhase("intermission", 0)
local seat = crew3.seats[playerA]
seat.afk = true
dir5:setReady(playerA, true)
check(dir5.phase == "intermission", "an AFK chef's stale ready cannot start a shift alone")
seat.afk = false

print(if failures > 0 then `{failures} FAILURES` else "PASS: explicit start")
if failures > 0 then
	error(`{failures} checks failed`)
end

-- ==========================================================================
-- Equip slots: plates, pans and the serve bell dress DIFFERENT props, so they
-- must be independently equippable. Keying them all under "kitchen" meant
-- buying a pan silently took your plates off -- "feels like a ripoff".
-- ==========================================================================

failures = 0

local prog = Progression.new(Config, remotes, Catalog)
prog:playerAdded(playerA)
local prof = prog.profiles[playerA]
for _, id in { "kit_plates_blue", "kit_pan_copper", "kit_bell_deep", "kit_plates_gold", "hat_toque" } do
	prof.owned[id] = true
end

prog:shopAction(playerA, { action = "equipSet", set = {
	kitchen_plate = "kit_plates_blue",
	kitchen_pan = "kit_pan_copper",
	kitchen_bell = "kit_bell_deep",
} })
check(prof.equipped.kitchen_plate == "kit_plates_blue", "plates equipped")
check(prof.equipped.kitchen_pan == "kit_pan_copper", "pans equip alongside plates")
check(prof.equipped.kitchen_bell == "kit_bell_deep", "bell equips alongside both")

-- Swapping one slot must leave the others alone.
prog:shopAction(playerA, { action = "equip", id = "kit_plates_gold" })
check(prof.equipped.kitchen_plate == "kit_plates_gold", "swapping plates changes the plate slot")
check(prof.equipped.kitchen_pan == "kit_pan_copper", "swapping plates leaves pans on")
check(prof.equipped.kitchen_bell == "kit_bell_deep", "swapping plates leaves the bell on")

-- A partial set must not strip slots it does not mention.
prog:shopAction(playerA, { action = "equipSet", set = { hat = "hat_toque" } })
check(prof.equipped.hat == "hat_toque", "hat equipped from a partial set")
check(prof.equipped.kitchen_pan == "kit_pan_copper", "a hat-only equipSet leaves kitchen slots alone")
-- ...but an explicit false does clear one.
prog:shopAction(playerA, { action = "equipSet", set = { kitchen_pan = false } })
check(prof.equipped.kitchen_pan == nil, "explicit false clears a slot")
check(prof.equipped.kitchen_plate == "kit_plates_gold", "clearing pans leaves plates on")

-- Pass-only content can never be bought with coins.
prof.coins = 999999
prog:shopAction(playerA, { action = "buy", id = "hat_halo" })
check(prof.owned.hat_halo ~= true, "a pass-exclusive hat cannot be bought with coins")

print(if failures > 0 then `{failures} FAILURES` else "PASS: equip slots")
if failures > 0 then
	error(`{failures} checks failed`)
end
