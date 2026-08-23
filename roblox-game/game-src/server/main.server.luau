--!strict
-- P1 smoke shell: run the shared sim with 3 bots on the server so a Studio
-- playtest shows a living kitchen. Replaced by simService/botService/
-- replicator in P2 (see the port plan).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local shared = require(ReplicatedStorage:WaitForChild("Shared")) :: any

local sim = shared.createSim({ seed = os.time() % 2 ^ 31, botCount = 3 })
shared.seedPans(sim)
local bots = shared.makeBotDirector()

local acc = 0
local reported = 0
local conn
conn = RunService.Heartbeat:Connect(function(dt: number)
	acc = math.min(acc + dt, 0.25)
	while acc >= shared.SIM_DT and not sim.over do
		acc -= shared.SIM_DT
		local botInputs = bots:update(sim, shared.SIM_DT)
		local inputs = {}
		for _, chef in sim.chefs do
			inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
		end
		shared.step(sim, inputs)
		sim.events = {}
	end
	if sim.time - reported >= 10 then
		reported = sim.time
		print(`[sizzle] t={math.floor(sim.time)}s coins={sim.score.coins} served={sim.score.served}`)
	end
	if sim.over then
		print(`[sizzle] round over: coins={sim.score.coins} served={sim.score.served} missed={sim.score.missed}`)
		conn:Disconnect()
	end
end)
