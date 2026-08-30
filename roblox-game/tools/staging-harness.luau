-- DOES THE CREW ACTUALLY END UP ON ITS MARKS?
--
-- The lobby camera frames Staging.LINEUP and nothing else. If a mark is inside
-- a bench, or two marks are close enough that collidePhase shoves people off
-- them, or a bot never walks over at all, the shot frames an empty floor and
-- the only symptom is "the lobby looks wrong" -- which is exactly the class of
-- thing the Studio MCP cannot answer here, since screen_capture returns a flat
-- magenta frame in this setup.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local shared = require("../out/shared-bundle")
local SimService = require("../game-src/server/SimService")

local Staging = luau.load(luau.compile(fs.readFile("game-src/shared/Staging.luau")), {
	environment = { math = math, table = table, ipairs = ipairs, pairs = pairs },
})()

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

-- ---------------------------------------------------------------- 1. the marks

print("A. every mark is somewhere a chef can actually stand")
local kitchen = shared.buildKitchen()
for i, m in Staging.LINEUP do
	-- safeSpawn returns the point unchanged only when a body of chefRadius
	-- fits there; anything else means it had to search for clear floor.
	local safe = shared.safeSpawn(kitchen, { x = m.x, y = m.y })
	local moved = math.abs(safe.x - m.x) > 1e-6 or math.abs(safe.y - m.y) > 1e-6
	check(not moved, `mark {i} ({m.x}, {m.y}) is clear floor, not inside a bench`)
end

print("B. nobody is standing on anybody")
local r = shared.TUNING.chefRadius
for i, a in Staging.LINEUP do
	for j, b in Staging.LINEUP do
		if j > i then
			local d = math.sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2)
			check(d > r * 2, `marks {i} and {j} are {string.format("%.2f", d)} apart (bodies are {r * 2} wide)`)
		end
	end
end

-- ---------------------------------------------------------------- 2. bots walk there

print("C. a bot walks to its mark between rounds and stops facing the lens")
local svc = SimService.new(shared, { seed = 7, botFill = true, staging = Staging })
-- Scatter everyone somewhere unhelpful first, the way a final whistle would.
for _, chef in svc.sim.chefs do
	chef.pos.x, chef.pos.y = 2.5, 2.5
	chef.vel.x, chef.vel.y = 0, 0
	chef.heading = -math.pi / 2
end
for _ = 1, 60 * 8 do -- eight seconds of lobby
	svc:tickMovementOnly(1 / 60)
end
for _, chef in svc.sim.chefs do
	local mark = Staging.LINEUP[(chef.id % #Staging.LINEUP) + 1]
	local d = math.sqrt((chef.pos.x - mark.x) ^ 2 + (chef.pos.y - mark.y) ^ 2)
	check(d <= Staging.ARRIVE_EPS + 0.05, `chef {chef.id} reached its mark ({string.format("%.2f", d)} away)`)
	check(
		math.abs(chef.heading - Staging.FACE_CAMERA) < 1e-6,
		`chef {chef.id} is facing the camera (heading {string.format("%.2f", chef.heading)})`
	)
	check(math.abs(chef.vel.x) < 1e-6 and math.abs(chef.vel.y) < 1e-6, `chef {chef.id} has come to a stop`)
end

print("D. and it stays put rather than hunting around the mark")
local before = {}
for _, chef in svc.sim.chefs do
	before[chef.id] = { x = chef.pos.x, y = chef.pos.y }
end
for _ = 1, 60 * 3 do
	svc:tickMovementOnly(1 / 60)
end
local drift = 0
for _, chef in svc.sim.chefs do
	drift = math.max(drift, math.abs(chef.pos.x - before[chef.id].x), math.abs(chef.pos.y - before[chef.id].y))
end
check(drift < 0.01, `three more seconds moved nobody more than {string.format("%.4f", drift)} cells`)

-- ---------------------------------------------------------------- 3. humans are left alone

print("E. the server never walks a human -- their client owns that")
local svc2 = SimService.new(shared, { seed = 7, botFill = true, staging = Staging })
local human = svc2.sim.chefs[1]
svc2.humans[human.id] = {
	pos = { x = 2.5, y = 2.5 },
	vel = { x = 0, y = 0 },
	heading = 0,
	seq = 0,
	lastAt = 0,
	corrected = false,
}
human.pos.x, human.pos.y = 2.5, 2.5
for _ = 1, 60 * 4 do
	svc2:tickMovementOnly(1 / 60)
end
local mark = Staging.LINEUP[(human.id % #Staging.LINEUP) + 1]
local moved = math.sqrt((human.pos.x - mark.x) ^ 2 + (human.pos.y - mark.y) ^ 2)
check(moved > 1.0, `a seated human was NOT dragged to the mark by the server ({string.format("%.1f", moved)} cells away)`)

print("F. with bots off, nobody is staged into an empty kitchen")
local svc3 = SimService.new(shared, { seed = 7, botFill = false, staging = Staging })
for _, chef in svc3.sim.chefs do
	chef.pos.x, chef.pos.y = 2.5, 2.5
end
for _ = 1, 60 * 4 do
	svc3:tickMovementOnly(1 / 60)
end
local stayed = true
for _, chef in svc3.sim.chefs do
	if not svc3:isActive(chef) and (math.abs(chef.pos.x - 2.5) > 0.01 or math.abs(chef.pos.y - 2.5) > 0.01) then
		stayed = false
	end
end
check(stayed, "inactive chefs are left where they are rather than walked into shot")

print(if failures > 0 then `{failures} FAILURES` else "PASS: staging")
if failures > 0 then
	error(`{failures} checks failed`)
end
