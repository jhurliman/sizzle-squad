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

-- Records what was connected and what was sent, so a test can drive the wire
-- in both directions rather than only asserting on internal state.
local function stubRemote()
	local r = { handlers = {}, sent = {} }
	r.OnServerEvent = {
		Connect = function(_self, fn)
			table.insert(r.handlers, fn)
			return { Disconnect = function() end }
		end,
	}
	function r:FireAllClients() end
	function r:FireClient(player, payload)
		table.insert(self.sent, { player = player, payload = payload })
	end
	function r:receive(...)
		for _, h in self.handlers do
			h(...)
		end
	end
	return r
end
local remotes = {}
for name in Net.REMOTES do remotes[name] = stubRemote() end

local prefs: { [any]: string } = {}
local simService = SimService.new(shared, { seed = 7, botFill = true })
local replicator = Replicator.new(shared, Net, remotes, function(chef) return simService:chefFlags(chef) end)
local clock = 0
local crew = CrewManager.new(simService, Net, remotes, replicator, function() return clock end, function(p)
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

-- ---- an idle client must go AFK even though it never stops talking -------
--
-- THE BUG: the client streams a move packet every 1/30s for as long as it has
-- a mirror, whether or not anyone is touching the controls, and the server
-- touched the seat on EVERY valid packet. lastInputAt was therefore reset
-- thirty times a second and `t - lastInputAt > AFK_SECONDS` could never be
-- true. No bot ever took over, and because readyTally only counts non-AFK
-- seats, one abandoned tab held the ready lobby open for everybody else --
-- with no round timer to break the deadlock.
local function movePacket(vx: number, vy: number, useHeld: boolean): buffer
	return Net.packMove(1, 5, 5, vx, vy, 0, useHeld)
end
local idle = movePacket(0, 0, false)
local moving = movePacket(1.5, 0, false)

-- A fresh seat: earlier tests above deliberately remove players.
local C = { UserId = 3, Name = "C" }
crew:playerAdded(C)
local seatA = crew.seats[C]
check(seatA ~= nil, "a third player can take a seat")
clock = 0
crew:touch(seatA)

-- 60 seconds of a connected-but-idle client, chattering the whole way
for _ = 1, 60 do
	clock += 1
	remotes.MoveStream:receive(C, idle)
	crew:heartbeat()
end
check(seatA.afk == true, `an idle client that keeps streaming still goes AFK ({clock}s of packets)`)
check(simService.humans[seatA.chefId] == nil, "and a bot takes the chef over")

-- ---- and real input brings them straight back ----------------------------
remotes.MoveStream:receive(C, moving)
check(seatA.afk == false, "a packet with real movement resumes them instantly")
check(simService.humans[seatA.chefId] ~= nil, "and hands the chef back")

-- ---- holding a station is input even though nothing moves ----------------
clock += 1000
crew:touch(seatA)
for _ = 1, 60 do
	clock += 1
	remotes.MoveStream:receive(C, movePacket(0, 0, true))
	crew:heartbeat()
end
check(seatA.afk == false, "standing still with useHeld set is working, not idling")

-- ---- a grab is activity too ---------------------------------------------
clock += 1000
crew:heartbeat()
check(seatA.afk == true, "a seat with no input at all does go AFK")
remotes.GrabEdge:receive(C)
check(seatA.afk == false, "and a grab press wakes it")

-- ---- the seat handshake must be re-sendable ------------------------------
--
-- ChefAssign and Snapshot are one-shot RemoteEvents and Roblox drops them for
-- a listener that connects later. The client now announces itself once its
-- handlers are up (Net.ClientReady) and the server replays the seat, so this
-- has to work a second time and carry the same chefId.
check(Net.REMOTES.ClientReady ~= nil, "there is a ClientReady remote for the client to announce on")
local assign, snap = remotes.ChefAssign, remotes.Snapshot
assign.sent, snap.sent = {}, {}
crew:sendSeat(C, seatA)
check(#assign.sent == 1 and assign.sent[1].player == C, "sendSeat delivers ChefAssign to that player")
check(assign.sent[1].payload.chefId == seatA.chefId, `and it carries their chefId ({seatA.chefId})`)
check(assign.sent[1].payload.skin ~= nil, "and a skin")
check(#snap.sent == 1 and snap.sent[1].player == C, "and a full Snapshot alongside it")
crew:sendSeat(C, seatA)
check(#assign.sent == 2 and #snap.sent == 2, "and it can be replayed, which is what the handshake relies on")

print(if failures > 0 then `{failures} FAILURES` else "PASS: crew")
