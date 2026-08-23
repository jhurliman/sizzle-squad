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

local simService = SimService.new(shared, { seed = os.time() % 2 ^ 31 })
local replicator = Replicator.new(shared, Net, remotes, function(chef)
	return simService:chefFlags(chef)
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

remotes.ShopAction.OnServerEvent:Connect(function(player, action)
	progression:shopAction(player, action)
end)

Players.PlayerAdded:Connect(function(player)
	progression:playerAdded(player)
	crew:playerAdded(player)
	director:broadcastPhase()
	leaderboards:pushTo(player)
end)

Players.PlayerRemoving:Connect(function(player)
	crew:playerRemoving(player)
	progression:playerRemoving(player)
end)

RunService.Heartbeat:Connect(function(dt)
	crew:heartbeat()
	director:heartbeat(dt)
	leaderboards:heartbeat(os.clock())
end)

print("[sizzle] server up — kitchen open")
