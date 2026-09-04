--!strict
-- Player <-> chef slot lifecycle: join drop-in (a bot hands over its chef,
-- held item and all), leave (the bot silently takes back over), and AFK
-- coverage (20s of no input -> bot covers; any input -> instant resume).
-- Also the input gateway: routes MoveStream/GrabEdge to SimService.

local CrewManager = {}
CrewManager.__index = CrewManager

local AFK_SECONDS = 20

-- A LOBBY IS NOT A KITCHEN, AND STANDING STILL MEANS SOMETHING DIFFERENT IN IT.
--
-- 20s of no input during a shift means you are not cooking, and the sooner a
-- bot covers for you the better. 20s of no input in the lobby means you are
-- reading the panel -- and since the lobby now deliberately walks you onto a
-- mark and parks you there for the crew shot, being motionless is the NORMAL
-- state rather than evidence of anything. At 20s that combination marked
-- present players away while they stood on their own marks.
local AFK_LOBBY_SECONDS = 90

-- Velocity quantizes to i8 over +/-8 cells/s, so one unit is ~0.063 cells/s and
-- a released stick packs to exactly 0. Anything above half a quantum is real
-- movement rather than rounding.
local MOVE_EPSILON = 0.03

--- Does this packet represent a player actually doing something?
local function isActive(p: any): boolean
	return math.abs(p.vx) > MOVE_EPSILON or math.abs(p.vy) > MOVE_EPSILON or p.useHeld == true
end

export type Seat = {
	player: any, -- Player
	chefId: number,
	lastInputAt: number,
	afk: boolean,
}

function CrewManager.new(
	simService: any,
	net: any,
	remotes: { [string]: any },
	replicator: any,
	now: () -> number,
	skinFor: ((any) -> string?)?
)
	local self = setmetatable({}, CrewManager)
	self.simService = simService
	self.net = net
	self.remotes = remotes
	self.replicator = replicator
	self.now = now
	self.skinFor = skinFor
	self.lobby = false
	self.seats = {} :: { [any]: Seat } -- keyed by Player
	self.byChef = {} :: { [number]: Seat }
	-- Reports how far a player has got (see Progression.noteReach). Assigned
	-- by the composition root once progression exists; a no-op until then so
	-- the harnesses can drive input without wiring persistence.
	self.onReach = function(_player: any, _stage: string) end

	remotes.MoveStream.OnServerEvent:Connect(function(player: any, b: any)
		local seat = self.seats[player]
		if seat == nil or typeof(b) ~= "buffer" then
			return
		end
		local p = net.unpackMove(b)
		if p == nil then
			return
		end
		-- ARRIVING IS NOT ACTIVITY.
		--
		-- The client streams a move packet every 1/30s for as long as it has a
		-- mirror, whether or not anybody is touching the controls. Touching the
		-- seat on every packet reset lastInputAt thirty times a second, so
		-- `t - lastInputAt > AFK_SECONDS` was arithmetically unreachable and
		-- the whole AFK path below was dead code: no bot ever took over, and
		-- because readyTally counts non-AFK seats, one abandoned tab held the
		-- ready lobby open for everyone else indefinitely. A round never starts
		-- on a timer, so there was nothing else to break the deadlock.
		--
		-- Velocity is the honest signal: it is derived from the player's own
		-- input on the client and quantizes to exactly zero when they let go.
		-- `useHeld` covers standing still on purpose -- working a station is
		-- input even though nothing moves.
		if isActive(p) then
			self:touch(seat)
		end
		-- The funnel's "moved" is stricter still: only actual velocity counts,
		-- so a joiner holding the action button on arrival does not read as
		-- having worked out how to move.
		if p.vx * p.vx + p.vy * p.vy > 0.01 then
			self.onReach(player, "moved")
		end
		simService:humanMove(seat.chefId, p)
	end)

	remotes.GrabEdge.OnServerEvent:Connect(function(player: any)
		local seat = self.seats[player]
		if seat == nil then
			return
		end
		self:touch(seat)
		self.onReach(player, "pressed")
		simService:pressGrab(seat.chefId)
	end)

	return self
end

function CrewManager:touch(seat: Seat)
	seat.lastInputAt = self.now()
	if seat.afk then
		seat.afk = false
		self.simService:setHuman(seat.chefId, true)
	end
end

--- Give chef `chefId` the species `want`, WITHOUT ever putting the same
--- character in the kitchen twice.
---
--- sim.ts seeds the four chefs with four distinct skins (`skins[i % 4]`), so
--- uniqueness holds by construction until something assigns a skin directly —
--- which is exactly what this used to do. Two players whose wardrobe
--- preference matched both got it, and the kitchen ran two identical chefs.
---
--- Swapping PRESERVES the invariant rather than repairing it afterwards:
--- whoever held `want` takes this chef's old skin, so the set of four is
--- always a permutation of the four species.
---
--- The one request that cannot be granted is a species another SEATED HUMAN is
--- wearing. They chose it too and were here first, so the caller keeps the
--- distinct skin it already holds — which is "the next available character".
--- Bots are always displaced; they have no preference.
---
--- Returns the skin actually held afterwards, which may not be `want`.
function CrewManager:claimSkin(chefId: number, want: string?): string?
	local chefs = self.simService.sim.chefs
	local mine = chefs[chefId + 1]
	if mine == nil then
		return nil
	end
	if want == nil or mine.skin == want then
		return mine.skin
	end
	for i, other in chefs do
		if other ~= mine and other.skin == want then
			if self.byChef[i - 1] ~= nil then
				return mine.skin -- a human is wearing it; keep ours
			end
			other.skin, mine.skin = mine.skin, want
			-- Dismissal is by species and the bodies just swapped: whichever
			-- chef now wears a dismissed species is parked, and one that
			-- stopped wearing it comes back onto the floor.
			self.simService:placeAll()
			return mine.skin
		end
	end
	-- Nobody holds it (shouldn't happen with a full permutation, but a skin
	-- list that grows past four would land here).
	mine.skin = want
	return mine.skin
end

--- Act on a chair: take it, empty it, or hand it back to a bot.
---
--- LIVES HERE RATHER THAN IN main.server.luau BECAUSE THAT FILE IS UNTESTABLE.
--- The first version of this was a remote handler in the composition root, and
--- server-harness does not load that script -- so a set of checks that fired
--- the remote and asserted on the result passed while doing nothing at all.
--- Two of them only failed because the real behaviour was missing; the rest
--- were green on an empty room. Rule of thumb the hard way: if main.server can
--- hold it, a harness cannot reach it.
---
--- Returns the species the caller ended up wearing when a claim succeeded, so
--- the caller can persist the preference; nil for everything else.
---
--- No host role, deliberately. Any seated player may rearrange a lobby that
--- takes one tap to rearrange back. Spectators and unseated clients are
--- ignored so a passer-by cannot reorganise a shift they are not working.
function CrewManager:seatAction(player: any, msg: any): string?
	local seat = self.seats[player]
	if seat == nil or typeof(msg) ~= "table" then
		return nil
	end
	local chefId = tonumber(msg.chefId)
	if chefId == nil then
		return nil
	end
	local target = nil
	for _, chef in self.simService.sim.chefs do
		if chef.id == chefId then
			target = chef
		end
	end
	if target == nil then
		return nil
	end
	local action = msg.action

	if action == "claim" then
		-- A chair with a person in it is not on offer. The client does not draw
		-- it that way and the server does not honour it either.
		if self.byChef[chefId] ~= nil then
			return nil
		end
		local want = target.skin
		-- Claiming a chair somebody emptied is exactly what emptying it was
		-- for, so a claim always un-dismisses.
		self.simService:setDismissed(want, false)
		return self:claimSkin(seat.chefId, want)
	elseif action == "dismiss" then
		if self.byChef[chefId] ~= nil then
			return nil
		end
		self.simService:setDismissed(target.skin, true)
	elseif action == "fill" then
		self.simService:setDismissed(target.skin, false)
	end
	return nil
end

--- Appearance for EVERY chef, for EquipDeltas.
---
--- LIVES HERE BECAUSE main.server.luau IS UNREACHABLE FROM A HARNESS. This was
--- a local function in the composition root, and it iterated crew.seats -- so
--- only humans were ever described. Claiming a character SWAPS species between
--- two chefs, and the bot on the other end of the swap was never mentioned to
--- anybody: the client went on rendering it as the character it used to be.
--- Take Mochi from a bot and you get two Mochis and no Bramble, which is
--- exactly what the lobby looked like. Nothing could have caught it there.
---
--- Hats, palettes and names belong to the PERSON, so a bot chair has none of
--- them. The skin belongs to the chair and always ships.
function CrewManager:appearanceList(profileFor: (any) -> any, nameFor: (any) -> string): { any }
	local seatByChef = {}
	for player, seat in self.seats do
		seatByChef[seat.chefId] = player
	end
	local list = {}
	for _, chef in self.simService.sim.chefs do
		local player = seatByChef[chef.id]
		local profile = if player ~= nil then profileFor(player) else nil
		table.insert(list, {
			chefId = chef.id,
			skin = chef.skin,
			hat = profile and profile.equipped and profile.equipped.hat or nil,
			palette = profile and profile.equipped and profile.equipped.palette or nil,
			name = if player ~= nil then nameFor(player) else nil,
		})
	end
	return list
end

--- Species currently worn by a SEATED HUMAN, mapped to that human's UserId.
---
--- The value is the owner rather than `true` because this is broadcast to
--- everyone: a client has to be able to tell "someone else has this" from
--- "this is the one I am wearing", and comparing UserIds is the only way that
--- does not need a second lookup. Bot-held species are absent — picking one
--- just displaces the bot.
function CrewManager:takenSkins(): { [string]: number }
	local taken = {}
	local chefs = self.simService.sim.chefs
	for i, chef in chefs do
		local seat = self.byChef[i - 1]
		if seat ~= nil and chef.skin ~= nil then
			taken[chef.skin] = seat.player.UserId
		end
	end
	return taken
end

--- Everything a client needs to take its seat, in one place.
---
--- These are one-shot RemoteEvents: Roblox does not hold them for a listener
--- that connects later, so a client still wiring itself up when this fires
--- simply never learns its chefId, never builds a mirror, and never sends a
--- move packet again. It looks exactly like a player who joined as a
--- spectator. main.server.luau re-sends this when the client announces itself,
--- which is what makes the send above best-effort rather than the only chance.
function CrewManager:sendSeat(player: any, seat: Seat)
	local chef = self.simService.sim.chefs[seat.chefId + 1]
	self.remotes.ChefAssign:FireClient(player, {
		chefId = seat.chefId,
		skin = chef and chef.skin or "bramble",
	})
	self.remotes.Snapshot:FireClient(player, self.replicator:snapshotFor(self.simService.sim))
end

function CrewManager:playerAdded(player: any)
	-- byChef is the reservation list: an AFK seat's chef is bot-driven but
	-- still that player's, and must not be dealt to the next arrival.
	local chefId = self.simService:freeChef(self.byChef)
	if chefId == nil then
		-- 4 humans already seated; server is full (MaxPlayers should prevent
		-- this, but never crash on the race).
		return nil
	end
	self.simService:setHuman(chefId, true)
	local seat: Seat = { player = player, chefId = chefId, lastInputAt = self.now(), afk = false }
	self.seats[player] = seat
	self.byChef[chefId] = seat
	-- Seat FIRST, then claim: claimSkin consults byChef to decide which
	-- species are spoken for, and this seat has to be in it.
	self:claimSkin(chefId, self.skinFor and self.skinFor(player))
	self:sendSeat(player, seat)
	return seat
end

function CrewManager:playerRemoving(player: any)
	local seat = self.seats[player]
	if seat == nil then
		return
	end
	self.seats[player] = nil
	self.byChef[seat.chefId] = nil
	-- The bot takes the chef back, inheriting position and held item.
	self.simService:setHuman(seat.chefId, false)
end

--- Called each heartbeat: AFK chefs fall back to bot control (silently;
--- resuming is instant on any input via touch()), and any chef the server
--- had to overrule this tick gets snapped back authoritatively.
--- Between rounds the AFK window is longer; see AFK_LOBBY_SECONDS.
function CrewManager:setLobby(on: boolean)
	self.lobby = on == true
end

function CrewManager:heartbeat()
	local t = self.now()
	local limit = if self.lobby then AFK_LOBBY_SECONDS else AFK_SECONDS
	for _, seat in self.seats do
		if not seat.afk and t - seat.lastInputAt > limit then
			seat.afk = true
			self.simService:setHuman(seat.chefId, false)
		end
		local slot = self.simService.humans[seat.chefId]
		if slot ~= nil and slot.corrected then
			slot.corrected = false
			for _, chef in self.simService.sim.chefs do
				if chef.id == seat.chefId then
					self.remotes.Correction:FireClient(seat.player, { x = chef.pos.x, y = chef.pos.y })
				end
			end
		end
	end
end

--- WHAT THE PLAYER ACTUALLY MANAGED, read off the sim rather than reported by
--- the client. A chef that starts carrying means they worked out pick-up; one
--- that starts working means they committed to a station. Neither needs a
--- remote or any client trust.
---
--- TRANSITIONS UNDER THEIR OWN CONTROL, NOT STATE. The first version asked
--- "is this human's chef carrying?", and with bot fill on the answer is often
--- yes for reasons that have nothing to do with the human: an AFK seat's chef
--- is being driven by the bot, a joiner is dealt a chef the bot was already
--- using, and a player waking from AFK inherits whatever the bot was holding.
--- Each of those permanently advanced a funnel whose whole job is to say what
--- a NEW PLAYER worked out on their own.
---
--- So SimService records, PER SIM STEP and only for chefs with a human slot,
--- the step in which carrying/working went from nil to set (see
--- SimService.reach for why per step). A bot's chef and an AFK seat's chef
--- have no slot and are never examined; a slot begins with whatever the chef
--- already had, so inherited state is the baseline, never the event. This
--- drains those records and hands them to onReach by seat. (main.server adds
--- a second lock on the other end: nothing past `pressed` counts for a player
--- who has not pressed, because nothing past it is possible without the
--- press that does it.)
---
--- Lives here rather than in main.server.luau so the crew harness can drive
--- every handoff path against it; see seatAction for why that matters.
function CrewManager:noteSimReach()
	for chefId, r in self.simService:drainReach() do
		local seat = self.byChef[chefId]
		if seat == nil or seat.afk then
			continue -- nobody's, or the bot's for now
		end
		if r.carried then
			self.onReach(seat.player, "carried")
		end
		if r.worked then
			self.onReach(seat.player, "worked")
		end
	end
end

function CrewManager:humanCount(): number
	local n = 0
	for _, seat in self.seats do
		if not seat.afk then
			n += 1
		end
	end
	return n
end

--- Re-seat every connected player after a sim reset (new round).
function CrewManager:reseat()
	-- Drop the old chef->seat map first. Reseating moves everyone, and a stale
	-- entry would make claimSkin think a chef nobody occupies is spoken for.
	table.clear(self.byChef)
	-- Release every old chef first. startRound resets the sim before this, so
	-- there they are already free; a reseat on a LIVE sim (the harnesses do
	-- it) would otherwise leave the old chefs flagged human with nobody in
	-- them, and freeChef would run out of chefs while chairs stood empty.
	for _, seat in self.seats do
		self.simService:setHuman(seat.chefId, false)
	end
	for player, seat in self.seats do
		local chefId = self.simService:freeChef(self.byChef)
		if chefId ~= nil then
			self.simService:setHuman(chefId, true)
			seat.chefId = chefId
			self.byChef[chefId] = seat
			self:claimSkin(chefId, self.skinFor and self.skinFor(player))
			self:sendSeat(player, seat)
		end
	end
end

return CrewManager
