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
local RoundDirector = require(script.Parent.RoundDirector) :: any
local Progression = require(script.Parent.Progression) :: any
local Leaderboards = require(script.Parent.Leaderboards) :: any
local Badges = require(script.Parent.Badges) :: any
local MonetizationServer = require(script.Parent.Monetization) :: any
local Analytics = require(script.Parent.Analytics) :: any

local remotes = Net.server(ReplicatedStorage)

local simService = SimService.new(shared, { seed = os.time() % 2 ^ 31, botFill = Config.BOT_FILL })
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

local Catalog = require(gameShared:WaitForChild("Catalog")) :: any
local leaderboards = Leaderboards.new(progression, remotes)
local badges = Badges.new(Config)
local analytics = Analytics.new()

local MonetizationDefs = require(gameShared:WaitForChild("Monetization")) :: any
local monetization = MonetizationServer.new(Catalog, MonetizationDefs)


local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	assistFn = function()
		return progression:crewQualifiesForAssist(crew)
	end,
	firstShiftFn = function()
		return progression:crewNeedsFirstShift(crew)
	end,
	onRoundEnd = function(results)
		progression:awardRound(crew, results)
		badges:onRoundEnd(crew, progression, results)
		for player in crew.seats do
			analytics:roundFinished(player, director.round, results, progression.lastAward[player])
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

local function broadcastEquips()
	local list = {}
	for player, seat in crew.seats do
		local profile = progression.profiles[player]
		local skin = nil
		for _, chef in simService.sim.chefs do
			if chef.id == seat.chefId then
				skin = chef.skin
			end
		end
		table.insert(list, {
			chefId = seat.chefId,
			hat = profile and profile.equipped and profile.equipped.hat or nil,
			palette = profile and profile.equipped and profile.equipped.palette or nil,
			skin = skin,
			name = monetization:flairFor(player) .. (player.DisplayName or player.Name),
		})
	end
	remotes.EquipDeltas:FireAllClients({ chefs = list, kitchen = electKitchen() })
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
	if not progression:setSpecies(player, species) then
		return
	end
	local seat = crew.seats[player]
	if seat ~= nil then
		for _, chef in simService.sim.chefs do
			if chef.id == seat.chefId then
				chef.skin = species
			end
		end
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

local function roundRemaining(): number
	return shared.TUNING.roundSeconds - simService.sim.time
end

local function seatPending()
	for player in pendingJoins do
		pendingJoins[player] = nil
		crew:playerAdded(player)
	end
	broadcastEquips()
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(vaultCharacter)
	if player.Character ~= nil then
		vaultCharacter(player.Character)
	end
	progression:playerAdded(player)
	monetization:playerAdded(player)
	analytics:playerAdded(player, progression.profiles[player])
	badges:backfill(player)
	if director.phase == "round" and roundRemaining() < Config.LATE_JOIN_CUTOFF then
		pendingJoins[player] = true
		remotes.Snapshot:FireClient(player, replicator:snapshotFor(simService.sim))
	else
		crew:playerAdded(player)
		analytics:onboarding(player, "seated")
	end
	director:broadcastPhase()
	leaderboards:pushTo(player)
	broadcastEquips()
end)

-- Roblox gives us ~30s at shutdown; without this, everything since the last
-- 60s autosave is lost -- up to a whole round of coins, XP and unlocks.
game:BindToClose(function()
	progression:flushAll()
end)

Players.PlayerRemoving:Connect(function(player)
	pendingJoins[player] = nil
	crew:playerRemoving(player)
	progression:playerRemoving(player)
	monetization:playerRemoving(player)
	analytics:playerRemoving(player, director.phase)
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
	leaderboards:heartbeat(os.clock())
end)

print("[sizzle] server up — kitchen open")
