-- Runs a full bot-only round of the TSTL-compiled shared sim under Lune.
-- Proves the domain + bots execute in Luau; prints the round outcome and a
-- rough perf number. Usage: lune run tools/smoke.luau [seed]
local process = require("@lune/process")

local shared = require("../out/shared-bundle")

local seed = tonumber(process.args[1]) or 12345
local sim = shared.createSim({ seed = seed, botCount = 3 })
shared.seedPans(sim)
local bots = shared.makeBotDirector()

local ticks = 0
local clock0 = os.clock()
while not sim.over do
	local botInputs = bots:update(sim, shared.SIM_DT)
	local inputs = {}
	for _, chef in sim.chefs do
		inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
	end
	shared.step(sim, inputs)
	sim.events = {}
	ticks += 1
	if ticks > 60 * 600 then
		error("round never ended (10 sim-minutes)")
	end
end
local elapsed = os.clock() - clock0

print(
	`seed={seed} ticks={ticks} time={math.floor(sim.time * 10) / 10}s`
		.. ` coins={sim.score.coins} served={sim.score.served} missed={sim.score.missed}`
		.. ` combo={sim.score.bestCombo}`
)
print(`wall={math.floor(elapsed * 1000)}ms ({math.floor(ticks / elapsed)} ticks/s)`)
