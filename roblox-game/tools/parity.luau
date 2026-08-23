-- Luau-side parity recorder: same digests as tools/parity-ts.mjs, from the
-- TSTL-compiled bundle under Lune. Usage: lune run tools/parity.luau [seeds...]
local fs = require("@lune/fs")
local process = require("@lune/process")

local shared = require("../out/shared-bundle")

local seeds = {}
for _, a in process.args do
	local n = tonumber(a)
	if n then
		table.insert(seeds, n)
	end
end
if #seeds == 0 then
	seeds = { 12345, 777, 424242 }
end

-- %.17g prints the shortest-ish decimal that Node's Number.prototype.toPrecision(17)
-- also produces for the same double, modulo trailing-zero/exponent formatting —
-- the compare tool parses both sides numerically, so formatting differences wash out.
local function f(x: number): string
	return string.format("%.17g", x)
end

for _, seed in seeds do
	local sim = shared.createSim({ seed = seed, botCount = 3 })
	shared.seedPans(sim)
	local bots = shared.makeBotDirector()
	local lines = {}
	local ticks = 0
	while not sim.over do
		local botInputs = bots:update(sim, shared.SIM_DT)
		local inputs = {}
		for _, chef in sim.chefs do
			inputs[chef.id + 1] = botInputs:get(chef.id) or shared.NO_INPUT
		end
		shared.step(sim, inputs)
		sim.events = {}
		ticks += 1
		local chefs = {}
		for _, c in sim.chefs do
			table.insert(chefs, `{f(c.pos.x)},{f(c.pos.y)},{f(c.vel.x)},{f(c.vel.y)}`)
		end
		local stations = {}
		for _, st in sim.kitchen.stations do
			table.insert(stations, `{st.id}:{if st.holding then st.holding.type else "-"}`)
		end
		table.insert(
			lines,
			`{sim.tick}|{table.concat(chefs, ";")}|{sim.score.coins},{sim.score.served},{sim.score.missed},{sim.score.combo}|{#sim.orders}|{table.concat(stations, ",")}`
		)
		if ticks > 60 * 600 then
			error("round never ended")
		end
	end
	fs.writeFile(`out/parity-luau-{seed}.txt`, table.concat(lines, "\n") .. "\n")
	print(`seed {seed}: {ticks} ticks recorded`)
end
