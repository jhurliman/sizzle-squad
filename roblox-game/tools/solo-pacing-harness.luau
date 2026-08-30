-- Validates the human-only pacing table: a single bot driving the "player"
-- chair (capped 15% slower than a human, methodical) must comfortably
-- survive a solo round under Config.PACING[1]. If a careful bot survives,
-- a learning human under the additional assist multipliers will too.
local shared = require("../out/shared-bundle")
local Config = require("../game-src/shared/Config")

local failures = 0
for _, seed in { 11, 222, 3333 } do
	local sim = shared.createSim({ seed = seed, botCount = 0 })
	shared.seedPans(sim)
	local row = Config.PACING[1]
	sim.director.orderGapMul = row.orderGapMul
	sim.director.maxOrdersBonus = row.maxOrdersBonus
	sim.director.ticketTimeMul = row.ticketTimeMul
	sim.director.patienceMissMul = row.patienceMissMul

	local bots = shared.makeBotDirector()
	bots:setDrivePlayer(true)

	local ticks = 0
	while not sim.over and ticks < 60 * 200 do
		local botInputs = bots:update(sim, shared.SIM_DT)
		local inputs = {}
		for _, chef in sim.chefs do
			inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
		end
		shared.step(sim, inputs)
		sim.events = {}
		ticks += 1
	end
	local s = sim.score
	local survived = sim.time >= shared.TUNING.roundSeconds - 0.5
	local line = `seed {seed}: time={math.floor(sim.time)}s served={s.served} missed={s.missed} patience={math.floor(s.patience * 100)}%`
	if survived and s.served >= 5 then
		print(`  ok   {line}`)
	else
		failures += 1
		print(`  FAIL {line} (died early or served < 5)`)
	end
end

if failures > 0 then
	error(`{failures} solo pacing runs failed — retune Config.PACING[1]`)
end
print("PASS: solo pacing survivable")
