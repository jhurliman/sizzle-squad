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
local crew = CrewManager.new(simService, Net, remotes, replicator, os.clock)
local progression = Progression.new(Config, remotes, require(gameShared:WaitForChild("Catalog")))

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
		table.insert(list, {
			chefId = seat.chefId,
			hat = profile and profile.equipped and profile.equipped.hat or nil,
			name = player.DisplayName or player.Name,
		})
	end
	remotes.EquipDeltas:FireAllClients(list)
end

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

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(vaultCharacter)
	if player.Character ~= nil then
		vaultCharacter(player.Character)
	end
	progression:playerAdded(player)
	crew:playerAdded(player)
	director:broadcastPhase()
	leaderboards:pushTo(player)
	broadcastEquips()
end)

Players.PlayerRemoving:Connect(function(player)
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
	end
end)

RunService.Heartbeat:Connect(function(dt)
	crew:heartbeat()
	director:heartbeat(dt)
	leaderboards:heartbeat(os.clock())
end)

print("[sizzle] server up — kitchen open")
