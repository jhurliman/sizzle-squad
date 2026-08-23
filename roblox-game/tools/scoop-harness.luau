-- Mechanics repro for the playtest report "cooked bacon can't leave the pan":
-- stand a chef at a stove with cooked bacon in the pan, holding a clean
-- plate, press grab — the plate must scoop the bacon.
local shared = require("../out/shared-bundle")

local sim = shared.createSim({ seed = 5, botCount = 3 })
shared.seedPans(sim)

local stove = nil
for _, st in sim.kitchen.stations do
	if st.kind == "stove" then
		stove = st
		break
	end
end
assert(stove ~= nil, "no stove")
assert(stove.holding ~= nil and stove.holding.type == "pan", "stove has no pan")

-- cooked bacon in the pan
table.insert(stove.holding.pan.contents, { id = 999, kind = "bacon", state = "cooked", progress = 0, overcook = 0 })

local chef = sim.chefs[1]
chef.isPlayer = true
chef.carrying = { type = "plate", plate = { id = 998, contents = {}, dirty = false } }
-- stand at the stove's interaction side, facing it
chef.pos.x = stove.cell.x + 0.5 + stove.facing.x * 1.4
chef.pos.y = stove.cell.y + 0.5 + stove.facing.y * 1.4
chef.vel.x, chef.vel.y = 0, 0
chef.heading = math.atan2(-stove.facing.y * 1, stove.facing.x * -1)
-- heading convention: atan2(y, x) of the direction toward the stove
chef.heading = math.atan2(-(stove.facing.y), -(stove.facing.x))

local inputs = {}
for _, c in sim.chefs do
	inputs[c.id + 1] = shared.NO_INPUT
end

-- settle focus for a few ticks, then press
for _ = 1, 10 do
	shared.step(sim, inputs)
	sim.events = {}
end
print("focus:", chef.focus, "action:", chef.focusAction, "(stove id", stove.id .. ")")

inputs[chef.id + 1] = { move = { x = 0, y = 0 }, grabPressed = true, useHeld = false }
shared.step(sim, inputs)
sim.events = {}

local plate = chef.carrying and chef.carrying.plate
local got = plate ~= nil and #plate.contents == 1 and plate.contents[1].kind == "bacon" and plate.contents[1].state == "cooked"
print("plate contents:", plate and #plate.contents or "?", "pan contents:", #stove.holding.pan.contents)
if not got then
	error("FAIL: plate did not scoop the cooked bacon")
end
print("PASS: plate scoops cooked bacon off the stove pan")
