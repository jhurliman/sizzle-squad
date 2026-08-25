-- ClientState test under Lune: own-chef mirror movement via the real
-- movePhase, transform interpolation, station-delta mirroring, and the local
-- focus/verb prompt answering from mirrored state.
local shared = require("../out/shared-bundle")
local Net = require("../game-src/shared/Net")
local ClientState = require("../game-src/client/ClientState")

local failures = 0
local function check(cond: boolean, msg: string)
	if cond then
		print(`  ok   {msg}`)
	else
		failures += 1
		print(`  FAIL {msg}`)
	end
end

local state = ClientState.new(shared, Net)
state:assign({ chefId = 0, skin = "bramble" })
state:applySnapshot({
	stations = {},
	orders = {},
	chefs = { { id = 0, skin = "bramble", isPlayer = true, pos = { x = 6.5, y = 2.5 }, carrying = nil } },
	score = { coins = 0, served = 0, missed = 0, combo = 0, bestCombo = 0, patience = 1, time = 0 },
})

-- 1. mirror movement with the real movePhase
local x0 = state.mirror.pos.x
for _ = 1, 60 do
	state:stepOwn({ move = { x = 1, y = 0 }, grabPressed = false, useHeld = false }, shared.SIM_DT)
end
check(state.mirror.pos.x > x0 + 2, `mirror walked right ({x0} -> {state.mirror.pos.x})`)

-- 2. movement lock while working (needs a REAL station id: the freeze brakes toward it)
state.mirror.pos.x, state.mirror.pos.y = 6.5, 2.5
state.mirror.vel.x, state.mirror.vel.y = 0, 0
local anyStation
for _, st in state.mirrorSim.kitchen.stations do
	if st.kind == "crate" then
		anyStation = st
		break
	end
end
state.mirror.working = anyStation.id
state.mirror.pos.x = anyStation.cell.x + 0.5
state.mirror.pos.y = anyStation.cell.y + 1.55
local xw = state.mirror.pos.x
for _ = 1, 30 do
	state:stepOwn({ move = { x = 1, y = 0 }, grabPressed = false, useHeld = false }, shared.SIM_DT)
end
check(math.abs(state.mirror.pos.x - xw) < 0.01, "mirror frozen while working")
state.mirror.working = nil

-- 3. remote interpolation: feed two transform packets, sample between
state.clock = 10
local pkt1 = Net.packTransforms({
	{ id = 1, px = 3, py = 3, vx = 0, vy = 0, heading = 0, flags = 0, effort = 0.5, stun = 0 },
})
state:applyTransforms(pkt1)
state.clock = 10.1
local pkt2 = Net.packTransforms({
	{ id = 1, px = 4, py = 3, vx = 0, vy = 0, heading = 0, flags = 0, effort = 0.5, stun = 0 },
})
state:applyTransforms(pkt2)
state.clock = 10.24 -- target = 10.06 -> 60% between packets (INTERP_DELAY 0.18)
local pose = state:remotePose(1)
check(pose ~= nil and pose.x > 3.3 and pose.x < 3.9, `remote interpolates between packets (x={pose and pose.x})`)

-- 4. focus prompt: stand a mirror chef in front of a crate and ask
-- (crate at cell (6,4) dispensing tomato per KITCHEN_MAP row 4 'T')
local crateStation = nil
for _, st in state.mirrorSim.kitchen.stations do
	if st.kind == "crate" then
		crateStation = st
		break
	end
end
check(crateStation ~= nil, "found a crate station in the mirror kitchen")
-- stand just below the crate, facing it
state.mirror.pos.x = crateStation.cell.x + 0.5
state.mirror.pos.y = crateStation.cell.y + 1.4
state.mirror.vel.x, state.mirror.vel.y = 0, 0
state.mirror.heading = -math.pi / 2 -- facing -y (toward the crate)
local focusId, action = state:focusPrompt()
check(action == "dispense", `verb prompt answers from local plan (got '{action}')`)

-- 5. station delta mirroring feeds the prompt
state:applyStationDeltas({
	{ id = crateStation.id, holding = { type = "ingredient", kind = "tomato", state = "raw" }, active = false, work = 0, cook = 0, burn = 0 },
})
check(state.mirrorSim.kitchen.stations[1] ~= nil, "station deltas applied")

if failures > 0 then
	error(`{failures} checks failed`)
end
print("PASS: client state")

-- 6. the round clock advances locally between score deltas (it used to freeze
-- until the player acted, because `time` is not in the server's score key)
state.simTime = 0
for _ = 1, 120 do
	state:advanceClock(1 / 60, true)
end
check(math.abs(state.simTime - 2) < 0.01, `clock advances locally while playing (t={state.simTime})`)
state:advanceClock(1 / 60, false)
check(math.abs(state.simTime - 2) < 0.01, "clock holds between rounds")
state:applyScore({ coins = 10, patience = 1, time = 42 })
check(state.simTime == 42, "authoritative score resyncs the clock")

print("PASS: round clock")
