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

local leaderboards = Leaderboards.new(progression, remotes)
local badges = Badges.new()

local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	assistFn = function()
		return progression:crewQualifiesForAssist(crew)
	end,
	onRoundEnd = function(results)
		progression:awardRound(crew, results)
		badges:onRoundEnd(crew, progression, results)
	end,
})

remotes.ReadyUp.OnServerEvent:Connect(function(player, on)
	director:setReady(player, on == true)
end)

remotes.Emote.OnServerEvent:Connect(function(player, emote)
	local seat = crew.seats[player]
	if seat ~= nil and typeof(emote) == "string" and #emote <= 24 then
		remotes.Emote:FireAllClients({ chefId = seat.chefId, emote = emote })
	end
end)

-- Everyone sees everyone's hat + name: broadcast the seat -> cosmetics map
-- whenever it could have changed (join, leave, equip, reseat).
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
			name = player.DisplayName or player.Name,
		})
	end
	remotes.EquipDeltas:FireAllClients(list)
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
	broadcastEquips()
end)

remotes.ShopAction.OnServerEvent:Connect(function(player, action)
	progression:shopAction(player, action)
	broadcastEquips()
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
	if director.phase == "round" and roundRemaining() < Config.LATE_JOIN_CUTOFF then
		pendingJoins[player] = true
		remotes.Snapshot:FireClient(player, replicator:snapshotFor(simService.sim))
	else
		crew:playerAdded(player)
	end
	director:broadcastPhase()
	leaderboards:pushTo(player)
	broadcastEquips()
end)

Players.PlayerRemoving:Connect(function(player)
	pendingJoins[player] = nil
	crew:playerRemoving(player)
	progression:playerRemoving(player)
	broadcastEquips()
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
