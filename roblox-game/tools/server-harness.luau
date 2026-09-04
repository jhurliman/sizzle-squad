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

local Staging = require("../game-src/shared/Staging")
-- Injected here as it is in the real server, or walkToMark no-ops and the
-- lobby checks below would pass by doing nothing.
local simService = SimService.new(shared, { seed = 4242, botFill = true, staging = Staging })
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

-- ------------------------------------------------- the lobby seat roster
--
-- The phase payload used to carry `readyIds`, a bare list of UserIds of the
-- players who had pressed Start. The lobby roster cannot be drawn from that:
-- names and skins are keyed by chefId, so it needed a two-hop join through the
-- skin table, and there was no way at all to learn who had NOT pressed, since
-- an absent UserId and an absent player look identical.
--
-- The 3/2 bug is the one worth pinning. readyIds did not check seat.afk while
-- readyTally excluded AFK seats from BOTH halves of its count, so an
-- AFK-but-ready player made #readyIds exceed readyCount and any roster built
-- from it rendered more ready players than there were players.
local function lastPhasePayload()
	local fired = remotes.RoundPhase.allFired
	return fired[#fired][1]
end

-- The emulated client above spends the whole round sending packets with no
-- real movement in them, so by now the AFK gate has correctly parked it. Clear
-- that first: the AFK case gets its own check below, and this one is about the
-- shape of the payload.
crew:touch(crew.seats[playerA])
-- setReady no-ops outside a lobby phase and the round has just ended, so set
-- the flag and ask for the broadcast directly rather than reading a payload
-- from thirty seconds ago.
director.ready[playerA] = true
director:broadcastPhase()
local pay = lastPhasePayload()
check(pay.seats ~= nil, "the phase payload carries a seat roster")
check(pay.readyIds == nil, "and the old readyIds list is gone")
check(pay.awaitingStart == nil and pay.waiting == nil, "along with two fields nothing ever read")

local seatA = nil
for _, st in pay.seats do
	if st.userId == playerA.UserId then
		seatA = st
	end
end
check(seatA ~= nil, "the seated player is in the roster")
if seatA ~= nil then
	check(seatA.chefId ~= nil, `carrying a chefId ({tostring(seatA.chefId)}), so names need no join`)
	check(seatA.name ~= nil and seatA.name ~= "", `and a display name ({tostring(seatA.name)})`)
	check(seatA.ready == true, "and their ready state")
end

-- AFK SEATS STAY ON THE ROSTER, FLAGGED.
--
-- The first version of this dropped them, on the theory that it fixed the 3/2
-- bug. It did, and it broke something worse: the lobby parks you on a mark for
-- the crew shot, standing still counted as idle, and a present player watched
-- their own chair turn into a bot and back. The roster answers "who is in this
-- room"; readyTally answers "who can still answer". Different questions, and
-- conflating them is what produced both bugs.
crew.seats[playerA].afk = true
director:broadcastPhase()
local afkPay = lastPhasePayload()
local n, total = director:readyTally()
local afkRow = nil
for _, st in afkPay.seats do
	if st.userId == playerA.UserId then
		afkRow = st
	end
end
check(afkRow ~= nil, "an AFK player is still on the roster -- the lobby must not deny they are here")
if afkRow ~= nil then
	check(afkRow.afk == true, "and is flagged so the chair can say 'away'")
end
check(total == 0, `but readyTally still excludes them ({total} seats can answer)`)
check(n == 0, "so an AFK-but-ready player cannot start the round on their own")
crew.seats[playerA].afk = false
director:broadcastPhase()

-- ---------------------------------------------- a chair is a character
--
-- Replaces a single global BOTS: ON toggle, which could not express "three
-- bots but not a fourth" and hid a server-wide setting behind a button that
-- said nothing about its scope. Every chef slot is now a chair with three
-- possible occupants, and the chair is the control.
local function chairs()
	return lastPhasePayload().seats
end
-- seatAction mutates; the payload is only rebuilt on a broadcast, which the
-- remote handler does for us in the real server.
local function act(who: any, msg: any)
	local claimed = crew:seatAction(who, msg)
	director:broadcastPhase()
	return claimed
end
local function chairFor(chefId: number): any
	for _, c in chairs() do
		if c.chefId == chefId then
			return c
		end
	end
	return nil
end

director:broadcastPhase()
check(#chairs() == #simService.sim.chefs, `every chef slot is a chair ({#chairs()})`)
local mine = chairFor(crew.seats[playerA].chefId)
check(mine ~= nil and mine.kind == "player", "the seated player's chair says player")
check(mine ~= nil and mine.species ~= nil, `and names the character in it ({tostring(mine and mine.species)})`)

-- find a chair a bot is in
local botChair = nil
for _, c in chairs() do
	if c.kind == "bot" then
		botChair = c
	end
end
check(botChair ~= nil, "and there is a bot chair to take")

if botChair ~= nil then
	local wanted = botChair.species
	local before = chairFor(crew.seats[playerA].chefId).species
	check(wanted ~= before, `the bot chair is a different character ({before} -> {wanted})`)

	-- CLAIM: play as that character.
	act(playerA, { chefId = botChair.chefId, action = "claim" })
	local after = chairFor(crew.seats[playerA].chefId).species
	check(after == wanted, `claiming a bot chair makes you that character ({after})`)
	local stillFour = #chairs()
	check(stillFour == 4, `still four chairs afterwards ({stillFour})`)
	local players = 0
	for _, c in chairs() do
		if c.kind == "player" then
			players += 1
		end
	end
	check(players == 1, "and still exactly one person at the table, not two")
end

-- DISMISS: send a bot away and leave the chair for a human.
local target = nil
for _, c in chairs() do
	if c.kind == "bot" then
		target = c
	end
end
if target ~= nil then
	act(playerA, { chefId = target.chefId, action = "dismiss" })
	local now = chairFor(target.chefId)
	check(now.kind == "empty", `dismissing a bot empties its chair ({now.kind})`)

	-- FILL: and it can be given back.
	act(playerA, { chefId = target.chefId, action = "fill" })
	check(chairFor(target.chefId).kind == "bot", "and a bot can be put back into it")
	act(playerA, { chefId = target.chefId, action = "dismiss" })
end

-- A CHAIR WITH A PERSON IN IT IS NOT ON OFFER, whatever the client sends.
local occupied = crew.seats[playerA].chefId
local speciesBefore = chairFor(occupied).species
act(playerA, { chefId = occupied, action = "dismiss" })
check(chairFor(occupied).kind == "player", "a crafted dismiss cannot evict a person")
check(chairFor(occupied).species == speciesBefore, "and cannot change what they are playing as")

-- A DISMISSED BOT IS NOT A BODY IN THE KITCHEN.
--
-- Dismissal only flipped a flag. The chef stayed exactly where it was --
-- invisible, because the client hides inactive chefs, but still in every
-- collidePhase: players walked into it, were shoved by it, and could be
-- stunned by it. Now it is parked on the apron with the other out-of-play
-- chefs, and brought back inside when a bot is put back in the chair.
if target ~= nil then
	local parked = simService.sim.chefs[target.chefId + 1]
	local inPlay = shared.isWalkable(simService.sim.kitchen, math.floor(parked.pos.x), math.floor(parked.pos.y))
	check(not inPlay, `a dismissed bot is parked off the walkable floor ({parked.pos.x}, {parked.pos.y})`)
	check(not simService:isActive(parked), "and it is inactive")
	act(playerA, { chefId = target.chefId, action = "fill" })
	inPlay = shared.isWalkable(simService.sim.kitchen, math.floor(parked.pos.x), math.floor(parked.pos.y))
	check(inPlay, `filling the chair stands the bot back inside the kitchen ({parked.pos.x}, {parked.pos.y})`)
	act(playerA, { chefId = target.chefId, action = "dismiss" })
end

-- AND THE DISMISSAL FOLLOWS THE SPECIES THROUGH A SKIN SWAP. A joiner dealt
-- the parked chef is stood on the floor and its dismissal ends; a claim that
-- swaps a dismissed species onto a bot parks THAT bot. Either way there is
-- never an inactive chef standing on the walkable floor.
do
	local function noGhosts(): (boolean, string)
		for _, c in simService.sim.chefs do
			local onFloor = shared.isWalkable(simService.sim.kitchen, math.floor(c.pos.x), math.floor(c.pos.y))
			if not c.isPlayer and not simService:isActive(c) and onFloor then
				return false, `chef {c.id} ({c.skin}) is inactive but on the floor`
			end
			if (c.isPlayer or simService:isActive(c)) and not onFloor then
				return false, `chef {c.id} ({c.skin}) is active but parked`
			end
		end
		return true, "no inactive chef is on the floor and no active one is parked"
	end
	local G = { UserId = 7777, Name = "Ghost" }
	if target ~= nil then
		-- Every bot dismissed, so the only free chefs are parked ones and the
		-- joiner is certain to be dealt one.
		for _, c in chairs() do
			if c.kind == "bot" then
				act(playerA, { chefId = c.chefId, action = "dismiss" })
			end
		end
		check(simService:activeBotCount() == 0, "every bot is dismissed and parked")
		local seatG = crew:playerAdded(G)
		local gChef = simService.sim.chefs[seatG.chefId + 1]
		check(seatG ~= nil, "a joiner is dealt one of the parked chefs")
		check(shared.isWalkable(simService.sim.kitchen, math.floor(gChef.pos.x), math.floor(gChef.pos.y)), "and stood on the floor")
		check(simService.dismissed[gChef.skin] == nil, "and their character is no longer dismissed")
		check(noGhosts())
		-- Now G claims a dismissed chair's character: the swap moves G's old
		-- species onto that chef, which must then be a live bot on the floor,
		-- while the two still-dismissed species stay parked.
		local emptyChair = nil
		for _, c in chairs() do
			if c.kind == "empty" then
				emptyChair = c
			end
		end
		act(G, { chefId = emptyChair.chefId, action = "claim" })
		local ok, why = noGhosts()
		check(ok, `after the claim swaps species: {why}`)
		check(simService:activeBotCount() == 1, `the bot that took G's old character is live ({simService:activeBotCount()} active)`)
		crew:playerRemoving(G)
		ok, why = noGhosts()
		check(ok, `after G leaves: {why}`)
		-- Restore the room the later checks expect: one dismissed chair.
		for _, c in chairs() do
			if c.kind == "empty" then
				act(playerA, { chefId = c.chefId, action = "fill" })
			end
		end
		act(playerA, { chefId = target.chefId, action = "dismiss" })
	end
end

-- PACING FOLLOWS WHO IS ACTUALLY COOKING. Sending bots away leaves botFill
-- true, and the pacing used to key off that switch alone: a solo player who
-- dismissed all three bots kept the four-chef order rate and ticket clock.
do
	local before = simService:activeBotCount()
	for _, c in chairs() do
		if c.kind == "bot" then
			act(playerA, { chefId = c.chefId, action = "dismiss" })
		end
	end
	check(simService:activeBotCount() == 0, `every bot dismissed ({before} -> 0 active)`)
	director:applyPacing()
	local solo = Config.PACING[1]
	local knobs = simService.sim.director
	-- orderGapMul/maxOrdersBonus are the knobs ASSIST leaves alone, so they
	-- identify the table without an assist multiplier in the way.
	check(
		knobs.orderGapMul == solo.orderGapMul and knobs.maxOrdersBonus == solo.maxOrdersBonus,
		`alone with no bots, pacing is the one-human table (gap x{knobs.orderGapMul}, bonus {knobs.maxOrdersBonus})`
	)
	for _, c in chairs() do
		if c.kind == "empty" then
			act(playerA, { chefId = c.chefId, action = "fill" })
		end
	end
	director:applyPacing()
	local full = Config.PACING_BOTFILL[1]
	check(
		simService:activeBotCount() == 3 and knobs.orderGapMul == full.orderGapMul,
		`with the bots back, pacing is the bot-fill table again (gap x{knobs.orderGapMul})`
	)
	-- Leave one chair empty so the passer-by checks below see the same room
	-- they used to.
	act(playerA, { chefId = target.chefId, action = "dismiss" })
end

-- AND A PASSER-BY CANNOT REARRANGE A SHIFT THEY ARE NOT WORKING.
local stranger = { UserId = 999999, Name = "Stranger" }
local kindBefore = chairFor(occupied).kind
act(stranger, { chefId = occupied, action = "claim" })
check(chairFor(occupied).kind == kindBefore, "an unseated client's seat action is ignored")
act(playerA, { chefId = 0, action = "nonsense" })
act(playerA, "not a table")
check(#chairs() == 4, "and junk on the wire changes nothing")

-- ------------------------------- everybody's appearance reaches the client
--
-- THE DUPLICATE-CHARACTER BUG. EquipDeltas used to be built from crew.seats,
-- so it described only humans. Claiming a character swaps species between two
-- chefs, and the bot on the other end of that swap was never mentioned to
-- anyone -- the client kept drawing it as the character it used to be. Take
-- Mochi from a bot and the room has two Mochis and no Bramble.
local function appearance()
	return crew:appearanceList(function(player)
		return progression.profiles[player]
	end, function(player)
		return player.DisplayName or player.Name
	end)
end

local look = appearance()
check(#look == #simService.sim.chefs, `every chef is described, not just the seated ones ({#look})`)
local seenSkin, dupes = {}, 0
for _, e in look do
	check(e.skin ~= nil, `chef {e.chefId} ships a skin`)
	if seenSkin[e.skin] then
		dupes += 1
	end
	seenSkin[e.skin] = true
end
check(dupes == 0, `and no two chefs claim the same character ({dupes} duplicates)`)

-- the invariant has to survive a claim, which is when it used to break
local botToTake = nil
for _, c in chairs() do
	if c.kind == "bot" then
		botToTake = c
	end
end
if botToTake ~= nil then
	act(playerA, { chefId = botToTake.chefId, action = "claim" })
	local after = appearance()
	local seen2, dupes2 = {}, 0
	for _, e in after do
		if seen2[e.skin] then
			dupes2 += 1
		end
		seen2[e.skin] = true
	end
	check(dupes2 == 0, `still four distinct characters after claiming one ({dupes2} duplicates)`)
	check(#after == 4, "and still four of them")
	local named = 0
	for _, e in after do
		if e.name ~= nil then
			named += 1
		end
	end
	check(named == 1, `exactly one chef carries a player name ({named})`)
end

-- ------------------------------- the first lobby anybody sees is a lobby
--
-- tickMovementOnly ran for results and intermission only. It is also what
-- walks bots onto their marks now, so on a fresh server -- countdown, the one
-- phase a player actually starts in -- nobody walked anywhere and the crew
-- shot framed an empty floor with one person in it.
local moved = 0
for _, chef in simService.sim.chefs do
	if simService.humans[chef.id] == nil then
		chef.pos.x, chef.pos.y = 2.5, 2.5
	end
end
director.phase = "countdown"
for _ = 1, 240 do
	director:heartbeat(1 / 60)
end
for _, chef in simService.sim.chefs do
	if simService.humans[chef.id] == nil and (math.abs(chef.pos.x - 2.5) > 0.5 or math.abs(chef.pos.y - 2.5) > 0.5) then
		moved += 1
	end
end
check(moved > 0, `bots walk to their marks during countdown too ({moved} moved)`)

-- ORDERED BY CHARACTER, so the four chairs never move.
--
-- This asserted chefId order until the chairs became characters. Ordering by
-- chefId kept the chairs in step with the bodies, but claiming a character
-- swaps species between chefs, so the LABELS slid along the row every time
-- anybody picked anybody -- the chair you were about to tap had moved by the
-- time you tapped it.
local ordered = true
local prev = -1
for _, st in lastPhasePayload().seats do
	local at = Staging.indexOf(st.species)
	if at <= prev then
		ordered = false
	end
	prev = at
end
check(ordered, "the roster is ordered by character, so the chairs never move")

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

-- ==========================================================================
-- The scripted opening. A brand-new chef must meet the kitchen in a teachable
-- order -- chop, then the pan, then a bigger chop -- rather than whatever the
-- dice hand them, which opened roughly half of first shifts on the pan.
-- ==========================================================================

-- At CONSTRUCTION: createSim seeds two tickets immediately, so a script set
-- afterwards would miss the first two -- which is the whole point of it.
local scripted = shared.createSim({
	seed = 99,
	botCount = 0,
	director = { scriptedRecipes = { "salad", "baconroll", "chopped" } },
})
local issued = {}
local seenOrder = {}
local ticks = 0
while #issued < 3 and ticks < 60 * 200 do
	shared.step(scripted, {})
	scripted.events = {}
	for _, o in scripted.orders do
		if not seenOrder[o.id] then
			seenOrder[o.id] = true
			table.insert(issued, o.recipe.id)
		end
	end
	ticks += 1
end
check(issued[1] == "salad", `first ticket is the salad ({issued[1]})`)
check(issued[2] == "baconroll", `second ticket teaches the pan ({issued[2]})`)
check(issued[3] == "chopped", `third ticket is the bigger chop ({issued[3]})`)

-- An unscripted board must be untouched by any of this.
local plain = shared.createSim({ seed = 99, botCount = 0 })
local plainFirst = nil
ticks = 0
while plainFirst == nil and ticks < 60 * 200 do
	shared.step(plain, {})
	plain.events = {}
	if #plain.orders > 0 then
		plainFirst = plain.orders[1].recipe.id
	end
	ticks += 1
end
check(plainFirst ~= nil, `an unscripted board still issues tickets ({plainFirst})`)
check(#plain.director.scriptedRecipes == 0, "the default board carries no script")

-- ==========================================================================
-- THE RACK ALWAYS HANDS OVER A CLEAN PLATE.
--
-- It used to own eight, and every serve dirtied one, so the NINTH plate of a
-- round came out dirty -- and a dirty plate is refused by every plating action
-- there is. Nothing outside First Shift explains washing-up and the only cue
-- is that the plate looks slightly grey, so the ninth plate silently stopped
-- accepting food. Deterministic, and it fires for every crew that serves eight
-- dishes, which is to say the ones playing well.
--
-- Washing-up returns in a content update with legible crockery and a tutorial
-- beat. Until then the contract is: press the rack, get a clean plate, always.
-- ==========================================================================

local pe = shared.createSim({ seed = 5, botCount = 0 })
local peRack
for _, st in pe.kitchen.stations do
	if st.kind == "plates" then
		peRack = st
		break
	end
end
check(peRack ~= nil, "the kitchen has a plate rack")

-- Through the real input path, not by poking the private verb: stand at the
-- rack and press, a hundred times, discarding each plate rather than putting
-- it back. The old rack owned eight, so anything past the ninth press is the
-- regime where this used to break.
local peChef = pe.chefs[1]
peChef.isPlayer = true
peChef.pos.x = peRack.cell.x + 0.5 + peRack.facing.x * 1.4
peChef.pos.y = peRack.cell.y + 0.5 + peRack.facing.y * 1.4
peChef.vel.x, peChef.vel.y = 0, 0
peChef.heading = math.atan2(-(peRack.facing.y), -(peRack.facing.x))

local peInputs = {}
for _, c in pe.chefs do
	peInputs[c.id + 1] = shared.NO_INPUT
end
for _ = 1, 10 do
	shared.step(pe, peInputs)
	pe.events = {}
end

local handed, everDirty = 0, false
for _ = 1, 100 do
	peChef.carrying = nil
	-- Rising edge, then release: grabPressed is an edge, not a held state.
	peInputs[peChef.id + 1] = { move = { x = 0, y = 0 }, grabPressed = true, useHeld = false }
	shared.step(pe, peInputs)
	peInputs[peChef.id + 1] = shared.NO_INPUT
	shared.step(pe, peInputs)
	pe.events = {}
	local held = peChef.carrying
	if held ~= nil and held.type == "plate" then
		handed += 1
		if held.plate.dirty then
			everDirty = true
		end
	end
end
check(handed == 100, `the rack is bottomless (handed over {handed} of 100)`)
check(not everDirty, "and never hands over a dirty one")

-- And across a whole round with bots actually serving, which is where the
-- dirty plates used to come from.
local live = shared.createSim({ seed = 11, botCount = 0 })
shared.seedPans(live)
local botDir = shared.makeBotDirector()
botDir:setDrivePlayer(true)
local sawDirty, refused = false, false
local liveRack
for _, st in live.kitchen.stations do
	if st.kind == "plates" then
		liveRack = st
		break
	end
end
for _ = 1, 60 * 190 do
	local bi = botDir:update(live, shared.SIM_DT)
	local inputs = {}
	for _, chef in live.chefs do
		inputs[chef.id + 1] = bi:get(chef.id) or shared.NO_INPUT
	end
	shared.step(live, inputs)
	live.events = {}
	for _, chef in live.chefs do
		local c = chef.carrying
		if c ~= nil and c.type == "plate" and c.plate.dirty then
			sawDirty = true
		end
		-- An empty-handed chef must always be offered a plate. This is the
		-- exact check that would have caught the original bug: it went false
		-- the moment the eighth plate was served.
		if c == nil and shared.planGrab(live, chef, liveRack) ~= "dispense" then
			refused = true
		end
	end
	if live.over then
		break
	end
end
-- Past the old cliff, or the round proves nothing: the eighth serve is where
-- the rack used to start handing out dirty plates.
check(live.score.served > 8, `the round serves past the old eight-plate cliff ({live.score.served})`)
check(not sawDirty, "no dirty plate reaches anybody's hands over a full round")
check(not refused, "and an empty-handed chef is never refused a plate")

print(if failures > 0 then `{failures} FAILURES` else "PASS: equip slots")
if failures > 0 then
	error(`{failures} checks failed`)
end
