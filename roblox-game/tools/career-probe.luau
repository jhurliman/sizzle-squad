-- CAREER STAT PROBE.
--
-- Reported from a live profile: 22542 shifts worked against 11172 dishes
-- served, climbing every session. Both counters are plain `+= 1` / `+= serves`
-- inside Progression:awardRound, so the arithmetic is not the suspect -- the
-- number of TIMES it runs per round is. This drives the real stack and counts
-- awardRound calls against actual round starts.
local shared = require("../out/shared-bundle")
local SimService = require("../game-src/server/SimService")
local Replicator = require("../game-src/server/Replicator")
local CrewManager = require("../game-src/server/CrewManager")
local RoundDirector = require("../game-src/server/RoundDirector")
local Progression = require("../game-src/server/Progression")
local Net = require("../game-src/shared/Net")
local Config = require("../game-src/shared/Config")
local Catalog = require("../game-src/shared/Catalog")

local function stubRemote(name: string)
	local handlers = {}
	local remote = { name = name, allFired = {}, clientFired = {},
		OnServerEvent = { Connect = function(_, fn) table.insert(handlers, fn) return { Disconnect = function() end } end } }
	function remote:FireAllClients(...) table.insert(self.allFired, { ... }) end
	function remote:FireClient(player, ...) table.insert(self.clientFired, { player = player, args = { ... } }) end
	function remote:_serverFire(player, ...) for _, fn in handlers do fn(player, ...) end end
	return remote
end
local remotes = {}
for name in Net.REMOTES do remotes[name] = stubRemote(name) end

local clock = { t = 0 }
local playerA = { UserId = 1001, Name = "Alice" }

local simService = SimService.new(shared, { seed = 4242, botFill = false })
local replicator = Replicator.new(shared, Net, remotes, function(chef) return simService:chefFlags(chef) end)
local crew = CrewManager.new(simService, Net, remotes, replicator, function() return clock.t end)
local progression = Progression.new(Config, remotes, Catalog)

local starts, ends = 0, 0
local lastStart, durations = 0, {}
local director = RoundDirector.new(shared, Config, simService, crew, replicator, remotes, {
	seedFn = function() return 999 end,
	assistFn = function() return progression:crewQualifiesForAssist(crew) end,
	onRoundStart = function() starts += 1 lastStart = clock.t end,
	onRoundEnd = function(results)
		ends += 1
		table.insert(durations, clock.t - lastStart)
		progression:awardRound(crew, results)
	end,
})

progression:playerAdded(playerA)
crew:playerAdded(playerA)

local DT = 1 / 60
-- Long enough for several full round/results/intermission cycles.
for _ = 1, 60 * 900 do
	clock.t += DT
	crew:heartbeat()
	-- Stay active, or the AFK sweep drops the seat out of readyTally and the
	-- lobby never starts a second round.
	local seat = crew.seats[playerA]
	if seat ~= nil then
		crew:touch(seat)
	end
	director:heartbeat(DT)
	if director.phase == "countdown" or director.phase == "intermission" then
		director:setReady(playerA, true)
	end
end

-- THE LATCH. Force the round-over branch twice on the SAME round index: the
-- first is a legitimate award, the second is the double-charge this guards.
director.simService.sim.over = true
director.phase = "round"
director:heartbeat(1 / 60)
local afterFirst = progression.profiles[playerA].rounds
director.simService.sim.over = true
director.phase = "round"
director:heartbeat(1 / 60)
local afterSecond = progression.profiles[playerA].rounds
print(`re-entry on an already-awarded round: {afterFirst} -> {afterSecond} ({if afterSecond == afterFirst then "LATCHED" else "DOUBLE-CHARGED"})`)

local p = progression.profiles[playerA]
print(`round starts:        {starts}`)
print(`onRoundEnd fires:    {ends}`)
print(`profile.rounds:      {p.rounds}`)
print(`profile.totalDishes: {p.totalDishes}`)
print(`profile.coins:       {p.coins}`)
print(`profile.level:       {p.level}`)
print(`awardRound per round: {if starts > 0 then p.rounds / starts else 0}`)
local tot = 0
for _, d in durations do tot += d end
print(`round durations (s): {table.concat((function() local o = {} for _, d in durations do table.insert(o, string.format("%.1f", d)) end return o end)(), ", ")}`)
print(`mean round length:   {if #durations > 0 then string.format("%.1f", tot / #durations) else "n/a"}s`)
