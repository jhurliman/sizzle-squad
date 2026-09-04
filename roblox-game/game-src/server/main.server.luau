--!strict
-- Composition root: wires the pure-logic services to Roblox.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local shared = require(ReplicatedStorage:WaitForChild("Shared")) :: any
local gameShared = ReplicatedStorage:WaitForChild("Game")
local Net = require(gameShared:WaitForChild("Net")) :: any
local Config = require(gameShared:WaitForChild("Config")) :: any

local SimService = require(script.Parent.SimService) :: any
local Replicator = require(script.Parent.Replicator) :: any
local CrewManager = require(script.Parent.CrewManager) :: any
local Tutorial = require(script.Parent.Tutorial) :: any
local RoundDirector = require(script.Parent.RoundDirector) :: any
local Progression = require(script.Parent.Progression) :: any
local Leaderboards = require(script.Parent.Leaderboards) :: any
local Badges = require(script.Parent.Badges) :: any
local MonetizationServer = require(script.Parent.Monetization) :: any
local Analytics = require(script.Parent.Analytics) :: any

local remotes = Net.server(ReplicatedStorage)

-- Why a player left, when we know. Set before we teleport them out; read by
-- analytics on PlayerRemoving so a hop is not counted as a quit. Declared up
-- here because the round-end handler below tags the teleport home.
local exitReason: { [any]: string } = {}

-- How long to wait before deciding a queued teleport is never going to happen.
-- Long enough not to race a slow one; short enough that a stranded player is
-- rescued while they are still in the room.
local TELEPORT_RESCUE = 15

-- Forward-declared: built below, used by the round-end handler above it.
local analytics

--- Send a finished First Shift player home, with the departure tagged.
---
--- Tag the hop BEFORE it happens, or a completed First Shift's departure is
--- recorded as a quit and the return leg is invisible to the exit-reason
--- analytics. But requested is not gone: the same TeleportInitFailed that can
--- strand the outbound leg can strand this one, and a player still here long
--- after the teleport should have fired is stranded -- with a tag that would
--- turn their eventual quit into a hop and swallow every drop-off metric. So
--- the tag only survives if they actually leave; otherwise it is cleared and
--- the teleport tried once more.
local function sendHomeTagged(p: Player, retry: boolean)
	exitReason[p] = "teleport_home"
	local requested = Tutorial.sendHome(p)
	if not requested then
		-- TeleportAsync threw outright. Same outcome as a stranding, and it
		-- gets the same second attempt: a finished First Shift player left
		-- in the reserved server has no public-server controls and no way
		-- home except quitting.
		exitReason[p] = nil
	end
	task.delay(TELEPORT_RESCUE, function()
		if p.Parent == nil then
			return -- gone: the teleport (or a quit) took them
		end
		if requested and exitReason[p] ~= "teleport_home" then
			return -- somebody else already untagged and dealt with them
		end
		exitReason[p] = nil
		analytics:custom(p, "tutorial_return", 1, { if requested then "stranded" else "failed" })
		if retry then
			sendHomeTagged(p, false)
		end
	end)
end

local Staging = require(gameShared:WaitForChild("Staging")) :: any
local simService =
	SimService.new(shared, { seed = os.time() % 2 ^ 31, botFill = Config.BOT_FILL, staging = Staging })
local replicator = Replicator.new(shared, Net, remotes, function(chef)
	return simService:chefFlags(chef)
end, function(chef)
	return simService:isActive(chef)
end)
local progression
local crew = CrewManager.new(simService, Net, remotes, replicator, os.clock, function(player)
	local profile = progression and progression.profiles[player]
	return profile and profile.species or nil
end)
progression = Progression.new(Config, remotes, require(gameShared:WaitForChild("Catalog")))
-- STUDIO LOOKS LIKE A FIRST-EVER VISIT, FOREVER, AND TWO THINGS KEY OFF THAT.
--
-- Nothing persists from a rojo-built local file (PlaceId 0, so no DataStore),
-- so `rounds` and `sessions` reset every session. needsTutorial is
-- `rounds == 0` and Menu:maybeAutoStart readies a `sessions <= 1` player
-- automatically -- between them, every playtest was either the tutorial again
-- or being dropped straight into a shift with three bots, never the lobby.
--
-- Progression applies this to the profile BEFORE the first push, which is the
-- part that matters: the client acts on that push, so correcting it afterwards
-- is already too late.
progression.studioReturning = Tutorial.isStudio() and Config.STUDIO_RETURNING_PLAYER
if progression.studioReturning then
	print("[sizzle] Studio: profiles shimmed to a returning player (Config.STUDIO_RETURNING_PLAYER)")
end

-- CrewManager sees the input, Progression owns the profile; connect them once
-- both exist (CrewManager is built before progression, hence the late assign).
crew.onReach = function(player: any, stage: string)
	-- Carrying and working are read off the sim, and both are downstream of a
	-- press the player has to make themselves. A player who has never pressed
	-- cannot have done either, whatever their chef is doing.
	if (stage == "carried" or stage == "worked") and not progression:reached(player, "pressed") then
		return
	end
	progression:noteReach(player, stage)
end

local Catalog = require(gameShared:WaitForChild("Catalog")) :: any
local leaderboards = Leaderboards.new(progression, remotes)
local badges = Badges.new(Config)
analytics = Analytics.new()

local MonetizationDefs = require(gameShared:WaitForChild("Monetization")) :: any
local monetization = MonetizationServer.new(Catalog, MonetizationDefs)


-- THE CALLBACKS BELOW MUST NOT NAME `director`.
--
-- They are closures inside director's own initializer, and a local is not in
-- scope inside its own initializer: `director.round` in there was the GLOBAL
-- director, nil, and the round-end callback threw on its first seated player
-- -- every round, in every server, since the funnel shipped. Everything after
-- the throw was lost: the shift_finished analytics, and the funnel's last
-- stage, which is why no completer's profile ever read reach = "finished".
-- The results carry the round index now, and check-luau refuses a strict
-- file that reads an undeclared global.
local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	assistFn = function()
		return progression:crewQualifiesForAssist(crew)
	end,
	firstShiftFn = function()
		return progression:crewNeedsFirstShift(crew)
	end,
	tutorialFn = Tutorial.isTutorialServer,
	onRoundEnd = function(results)
		progression:awardRound(crew, results, Tutorial.isTutorialServer())
		-- FIRST SHIFT IS OVER, SO THE SERVER IT RAN IN IS OVER TOO.
		--
		-- Held until the results ceremony has been seen: the payout that ranks
		-- them to level 2 is the reward for finishing, and teleporting over the
		-- top of it would throw away the only moment that pays off the lesson.
		if Tutorial.isTutorialServer() then
			task.delay(Config.RESULTS + 1.5, function()
				for _, p in Players:GetPlayers() do
					if Tutorial.isStudio() then
						Tutorial.finish(p) -- only clears a flag; there is no hop to tag
					else
						sendHomeTagged(p, true)
					end
				end
			end)
		end
		badges:onRoundEnd(crew, progression, results)
		-- (awardRound notes the funnel's "finished" itself; see there.)
		for player in crew.seats do
			analytics:roundFinished(player, results.round, results, progression.lastAward[player])
		end
	end,
	onRoundStart = function(roundIndex)
		local crewSize = crew:humanCount()
		for player in crew.seats do
			analytics:roundStarted(player, roundIndex, crewSize)
		end
	end,
})

remotes.ReadyUp.OnServerEvent:Connect(function(player, on)
	director:setReady(player, on == true)
end)


-- Emotes travel as IDS. This used to rebroadcast any client-supplied string
-- (<=24 chars) to every player, which is an unmoderated free-text channel in
-- a game aimed at this audience. Now the id must be a built-in ping or an
-- emote cosmetic the sender actually owns, and the client maps id -> glyph.
remotes.Emote.OnServerEvent:Connect(function(player, id)
	local seat = crew.seats[player]
	if seat == nil or typeof(id) ~= "string" then
		return
	end
	local allowed = Catalog.pingById[id] ~= nil or progression:ownsEmote(player, id)
	if not allowed then
		return
	end
	remotes.Emote:FireAllClients({ chefId = seat.chefId, emote = id })
end)

-- Everyone sees everyone's hat + name: broadcast the seat -> cosmetics map
-- whenever it could have changed (join, leave, equip, reseat).
--- Plates, pans and the serve bell are SHARED props, but every player has
--- their own equip. Elect one item per slot among seated players, lowest
--- UserId winning ties: a deliberately dumb, legible rule that is stable
--- across re-equips rather than flickering with whoever acted last.
local function electKitchen(): { [string]: string }
	local best: { [string]: any } = {}
	for player, _seat in crew.seats do
		local profile = progression.profiles[player]
		local equipped = profile and profile.equipped
		if equipped == nil then
			continue
		end
		-- Plates, pans and the bell are independent slots, so scan them all
		-- rather than a single "kitchen" equip.
		for slot, id in equipped do
			if not string.find(slot, "^kitchen_") then
				continue
			end
			local item = Catalog.byId[id]
			if item == nil or item.slot == nil then
				continue
			end
			local held = best[item.slot]
			if held == nil or player.UserId < held.userId then
				best[item.slot] = { id = id, userId = player.UserId }
			end
		end
	end
	local out: { [string]: string } = {}
	for slot, entry in best do
		out[slot] = entry.id
	end
	return out
end

-- The list is CrewManager:appearanceList; this only supplies the lookups it
-- cannot have. Keeping it out of here is the point -- server-harness cannot
-- load this file, and the last version of this logic shipped a bug precisely
-- because nothing could reach it.
local function broadcastEquips()
	local list = crew:appearanceList(function(player)
		return progression.profiles[player]
	end, function(player)
		return monetization:flairFor(player) .. (player.DisplayName or player.Name)
	end)
	remotes.EquipDeltas:FireAllClients({ chefs = list, kitchen = electKitchen(), taken = crew:takenSkins() })
end

-- A wardrobe makes equips far more frequent, and this is an O(players x chefs)
-- rebuild fanned out to everyone. Coalesce bursts behind a trailing debounce.
local equipsPending = false
local function queueEquips()
	if equipsPending then
		return
	end
	equipsPending = true
	task.delay(0.25, function()
		equipsPending = false
		broadcastEquips()
	end)
end

-- A CHAIR IS A CHARACTER. The logic is CrewManager:seatAction, not here --
-- server-harness cannot load this file, so anything that lives in it is
-- untestable by construction, which a set of vacuously-passing checks proved.
remotes.SeatAction.OnServerEvent:Connect(function(player, msg)
	local claimed = crew:seatAction(player, msg)
	if claimed ~= nil then
		progression:setSpecies(player, claimed)
	end
	queueEquips()
	director:broadcastPhase()
end)

-- Premium grants land in the profile like any other unlock, so the wardrobe
-- and shop need no special case for them.
monetization.onGrant = function(player, itemIds)
	local profile = progression.profiles[player]
	if profile == nil then
		return
	end
	for _, id in itemIds do
		profile.owned[id] = true
	end
	progression.dirty[player] = true
	progression:push(player)
	queueEquips()
end
badges.onAward = function(player, key)
	progression:markBadge(player, key)
end
progression.onLevelUp = function(player, level)
	analytics:levelUp(player, level)
end
progression.xpMultiplier = function(_self, player)
	return monetization:xpMultiplier(player)
end
progression.coinMultiplier = function(_self, player)
	return monetization:coinMultiplier(player)
end

remotes.PickSpecies.OnServerEvent:Connect(function(player, species)
	-- The wardrobe choice is a PREFERENCE and is always saved, even when this
	-- server cannot grant it: it is what you will be given in the next server
	-- where the character is free. What you actually wear here is decided by
	-- claimSkin, which refuses a species another seated human is wearing.
	if not progression:setSpecies(player, species) then
		return
	end
	local seat = crew.seats[player]
	if seat ~= nil then
		crew:claimSkin(seat.chefId, species)
	end
	queueEquips()
end)

remotes.ShopAction.OnServerEvent:Connect(function(player, action)
	local profile = progression.profiles[player]
	local before = profile and profile.coins or 0
	progression:shopAction(player, action)
	-- Diff the balance rather than trusting the request: shopAction is the
	-- authority on whether a buy actually happened.
	if profile ~= nil and profile.coins < before then
		analytics:economy(player, "sink", before - profile.coins, profile.coins, "Shop", tostring(action.id))
	end
	queueEquips()
end)

-- The Roblox avatar never appears in the kitchen: the chef IS the player's
-- body. The character still spawns (the platform's control scripts need a
-- live humanoid to route thumbstick/WASD input) but it lives anchored,
-- invisible and collisionless in a vault far below the floor.
local function vaultCharacter(character: Model)
	task.defer(function()
		local root = character:WaitForChild("HumanoidRootPart", 5) :: BasePart?
		if root == nil then
			return
		end
		character:PivotTo(CFrame.new(0, -120, 0))
		root.Anchored = true
		for _, d in character:GetDescendants() do
			if d:IsA("BasePart") or d:IsA("Decal") then
				(d :: any).Transparency = 1
				if d:IsA("BasePart") then
					d.CanCollide = false
					d.CastShadow = false
				end
			elseif d:IsA("Humanoid") then
				d.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
				d.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
			end
		end
	end)
end

-- Late-join hold (plan §2.1): with under LATE_JOIN_CUTOFF seconds left in a
-- round, hold the joiner as a spectator (they get the snapshot and watch the
-- kitchen) and seat them at the next phase change instead.
local pendingJoins: { [any]: boolean } = {}

--- Is the person they came here FOR actually in this server?
---
--- "Somebody is online" is a different, much weaker question. An invite to a
--- FULL kitchen routes the guest to a different server, where they arrive with
--- `ReferredByPlayerId` still set — and skipping First Shift on that basis
--- would drop a brand-new player into a live round among strangers, which is
--- the exact opposite of the point. Resolve the actual user or teach them.
local function friendIsHere(userId: number?): boolean
	if userId == nil or userId == 0 then
		return false
	end
	local ok, found = pcall(function()
		return Players:GetPlayerByUserId(userId)
	end)
	return ok and found ~= nil
end

local function roundRemaining(): number
	return shared.TUNING.roundSeconds - simService.sim.time
end

local function seatPending()
	for player in pendingJoins do
		pendingJoins[player] = nil
		crew:playerAdded(player)
		-- The same accounting an immediate arrival gets in seatArrival; without
		-- it a late joiner who quit before moving read as never having a chef.
		analytics:onboarding(player, "seated")
		progression:noteReach(player, "seated")
	end
	broadcastEquips()
end

--- Everything that makes an arrival part of the room. Factored out so the
--- teleport-failure rescue below can run it late.
local function seatArrival(player: Player)
	if player.Parent == nil then
		return -- they left while we were getting here
	end
	monetization:playerAdded(player)
	badges:backfill(player)
	if director.phase == "round" and roundRemaining() < Config.LATE_JOIN_CUTOFF then
		pendingJoins[player] = true
		remotes.Snapshot:FireClient(player, replicator:snapshotFor(simService.sim))
	else
		crew:playerAdded(player)
		analytics:onboarding(player, "seated")
		progression:noteReach(player, "seated")
	end
	director:broadcastPhase()
	leaderboards:pushTo(player)
	broadcastEquips()
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(vaultCharacter)
	if player.Character ~= nil then
		vaultCharacter(player.Character)
	end
	-- A teleport inside this experience continues the SAME session, so the hop
	-- must not be counted as a new one (see Progression:playerAdded).
	local source, friendUserId = Tutorial.joinSource(player)
	local hopped = Tutorial.isHop(source)
	progression:playerAdded(player, hopped)
	-- Analytics BEFORE the First Shift gate. This used to sit below the
	-- `return` on the teleport path, so a brand-new player's first server --
	-- the one the ad actually paid for -- recorded nothing at all.
	analytics:playerAdded(player, progression.profiles[player], hopped)
	analytics:joinStart(player, Tutorial.isTutorialServer(), source)
	progression:noteReach(player, "joined")
	-- FIRST SHIFT HAPPENS SOMEWHERE ELSE (see Tutorial.luau).
	--
	-- Before seating, before anything that would make this player part of the
	-- room: a learner never takes one of four slots in a
	-- live kitchen. `arrivedFromTutorial` is the loop guard -- a tutorial that
	-- failed to pay out must not bounce the player straight back into another.
	if
		not Tutorial.isTutorialServer()
		and not Tutorial.arrivedFromTutorial(player)
		and Tutorial.needsTutorial(progression.profiles[player])
	then
		if Tutorial.isFriendJoin(source) and friendIsHere(friendUserId) then
			-- THEY CAME HERE FOR A PERSON. Sending them to a private tutorial
			-- server would put a load screen between them and the only thing
			-- that reliably retains a new player, while the friend who invited
			-- them waits alone in another kitchen. They learn standing next to
			-- them instead.
			--
			-- `rounds` stays 0, so if this never becomes a finished round a
			-- later solo join still gets First Shift properly.
			analytics:custom(player, "first_shift_skipped", 1, { source })
		elseif Tutorial.isStudio() then
			-- No teleport available; run First Shift right here (Tutorial.luau).
			Tutorial.forced = true
			print("[sizzle] First Shift: Studio, running the tutorial in this server")
		else
			local sent, outcome = Tutorial.send(player)
			analytics:custom(player, "tutorial_teleport", 1, { outcome })
			if sent then
				exitReason[player] = "teleport_tutorial"
				-- TeleportAsync returning only means the request was ACCEPTED.
				-- A later TeleportInitFailed (GameFull, Flooded, Unauthorized)
				-- leaves them right here having skipped everything below: no
				-- chef, no Start button, and their eventual quit mislabelled as
				-- a hop. If they are still in this server long after the
				-- teleport should have happened, take them back.
				task.delay(TELEPORT_RESCUE, function()
					if player.Parent == nil or crew.seats[player] ~= nil or pendingJoins[player] then
						return
					end
					exitReason[player] = nil
					analytics:custom(player, "tutorial_teleport", 1, { "stranded" })
					seatArrival(player)
				end)
				return
			end
			-- Both failure paths leave the player right here, so they fall
			-- through and are seated as an ordinary joiner.
		end
	end
	seatArrival(player)
end)

-- THE JOIN SEND IS BEST-EFFORT; THIS IS THE ONE THAT COUNTS.
--
-- Everything PlayerAdded hands a new client -- ChefAssign, Snapshot,
-- RoundPhase, Leaderboards, EquipDeltas, Progress -- is a one-shot
-- RemoteEvent, and Roblox does not hold those for a listener that connects
-- later. PlayerAdded runs behind a yielding DataStore claim, while the client
-- is still requiring modules and loading 55 sounds before it reaches its
-- OnClientEvent lines, so which side wins is a coin toss on a cold phone.
--
-- Losing it was silent and total: no chefId means no mirror, no mirror means
-- the client never sends a move packet, and the player sits as a spectator
-- until the next reseat happens to re-send everything. So the client now says
-- when it is actually listening, and we send the lot again.
local lastReadyAt: { [any]: number } = {}
remotes.ClientReady.OnServerEvent:Connect(function(player)
	-- Cheap guard: snapshotFor walks the whole sim, so this must not be a free
	-- amplifier for a client that fires it in a loop.
	local now = os.clock()
	if now - (lastReadyAt[player] or -math.huge) < 1 then
		return
	end
	lastReadyAt[player] = now

	local seat = crew.seats[player]
	if seat ~= nil then
		crew:sendSeat(player, seat)
	elseif pendingJoins[player] then
		remotes.Snapshot:FireClient(player, replicator:snapshotFor(simService.sim))
	end
	director:broadcastPhase()
	leaderboards:pushTo(player)
	broadcastEquips()
	progression:push(player)
end)

-- Roblox gives us ~30s at shutdown; without this, everything since the last
-- 60s autosave is lost -- up to a whole round of coins, XP and unlocks.
game:BindToClose(function()
	progression:flushAll()
end)

Players.PlayerRemoving:Connect(function(player)
	pendingJoins[player] = nil
	-- Read the funnel stage BEFORE progression drops the profile. The same
	-- value is persisted for Open Cloud; this copy is for the dashboard, which
	-- is the only place a distribution across all players can be eyeballed.
	-- Once per player, at the TERMINAL end of their FIRST session: a teleport
	-- leg is the same session continuing, and a later session would count
	-- returners twice and skew the distribution toward completers.
	local profile = progression.profiles[player]
	local reached = profile and profile.reach or ""
	if reached ~= "" and exitReason[player] == nil and (profile.sessions or 1) <= 1 then
		analytics:custom(player, "first_shift_reach", 1, { reached, "quit" })
	end
	lastReadyAt[player] = nil
	crew:playerRemoving(player)
	progression:playerRemoving(player)
	monetization:playerRemoving(player)
	analytics:playerRemoving(player, director.phase, exitReason[player])
	exitReason[player] = nil
	badges:playerRemoving(player)
	-- director.ready is keyed by Player and had no cleanup: it leaked a key
	-- per departure and could strand a stale ready that nothing could clear.
	director.ready[player] = nil
	broadcastEquips()
	-- Their departure may have made the remaining crew all-ready.
	if director.phase == "intermission" then
		director:tryStart()
	end
end)

-- Reseats (new round) reshuffle chef ids; refresh the cosmetics map when the
-- round counter moves.
task.spawn(function()
	local last = -1
	while true do
		task.wait(2)
		if director.round ~= last then
			last = director.round
			broadcastEquips()
		end
		if next(pendingJoins) ~= nil and director.phase ~= "round" then
			seatPending()
		end
	end
end)

RunService.Heartbeat:Connect(function(dt)
	crew:heartbeat()
	director:heartbeat(dt)
	-- Funnel stages read off the sim (CrewManager:noteSimReach -> onReach).
	crew:noteSimReach()
	progression:heartbeat()
	leaderboards:heartbeat(os.clock())
end)

-- WHICH BUILD IS THIS? Studio holds the .rbxl it was opened with for the whole
-- session, so a rebuilt place on disk changes nothing in an open window. Say
-- it out loud rather than leaving people to infer it from whether a feature
-- they expected is present.
local BuildInfo = require(gameShared:WaitForChild("BuildInfo")) :: any
print(`[sizzle] build {BuildInfo.summary}`)
print("[sizzle] server up — kitchen open")
