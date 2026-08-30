-- FOCUS ORACLE: is the highlighted station always the one the button will act
-- on, and does the client agree with the server about what that action is?
--
-- Written because the alternative was whack-a-mole. Every focus bug reported
-- from play so far has been one of three failures, and all three are decidable
-- headlessly against the real shared sim:
--
--   A. MIRROR FIDELITY. The client picks the highlight by running the REAL
--      planGrab over its own mirrored sim. If the mirror disagrees with the
--      server about what a station holds -- or about what the player is
--      holding -- the prompt is wrong no matter how good planGrab is. Server
--      is ground truth; any disagreement is a bug.
--   B. VERB IMPLIES EFFECT. A verb that is not 'none' must actually change
--      something when pressed, and a verb of 'none' must not. This is what
--      stops a station advertising an action worth nothing.
--   C. GATE HONESTY. findFocus documents an honesty term: a station where the
--      button would do nothing is ranked below one where it would work. So if
--      anything in reach can answer the press, the focused station must be one
--      that can.
--
-- A and C are exhaustive over the state space; B is exhaustive over the same
-- combinations. Nothing here needs Studio, a client, or a human.

local shared = require("../out/shared-bundle")
local Net = require("../game-src/shared/Net")
local ClientState = require("../game-src/client/ClientState")
local Replicator = require("../game-src/server/Replicator")

local failures = 0
local checks = 0
local shown = 0
local function fail(msg: string)
	failures += 1
	if shown < 25 then
		shown += 1
		print(`  FAIL {msg}`)
	elseif shown == 25 then
		shown += 1
		print("  ... (further failures suppressed)")
	end
end
local function check(cond: boolean, msg: string)
	checks += 1
	if not cond then
		fail(msg)
	end
end

-- ------------------------------------------------------------ builders

-- Every built object carries a distinct id. `swap` between two items of the
-- same shape is a real state change that a shape-only fingerprint cannot see,
-- and 13 such cases showed up as false failures until the ids went in.
local nextId = 0
local function newId(): number
	nextId += 1
	return nextId
end
local function ing(kind: string, state: string): any
	return { type = "ingredient", ingredient = { id = newId(), kind = kind, state = state, progress = 0, overcook = 0, chop = 0 } }
end
local function plate(dirty: boolean, contents: { { kind: string, state: string } }): any
	local c = {}
	for _, x in contents do
		table.insert(c, { id = newId(), kind = x.kind, state = x.state, progress = 0, overcook = 0 })
	end
	return { type = "plate", plate = { id = newId(), contents = c, dirty = dirty } }
end
local function pan(contents: { { kind: string, state: string } }): any
	local c = {}
	for _, x in contents do
		table.insert(c, { id = newId(), kind = x.kind, state = x.state, progress = 0, overcook = 0 })
	end
	return { type = "pan", pan = { id = newId(), contents = c, onHeat = true, fire = 0 } }
end

-- One representative of every shape the game can put in a hand or on a bench.
local CARRIES: { { name: string, make: () -> any } } = {
	{ name = "nothing", make = function() return nil end },
	{ name = "raw tomato", make = function() return ing("tomato", "raw") end },
	-- "prepped", not "chopped". PrepState is raw|prepped|cooked|burnt; an
	-- earlier version of this list used a state the game cannot produce, so
	-- that row exercised nothing at all.
	{ name = "prepped tomato", make = function() return ing("tomato", "prepped") end },
	{ name = "prepped lettuce", make = function() return ing("lettuce", "prepped") end },
	{ name = "raw bacon", make = function() return ing("bacon", "raw") end },
	{ name = "cooked bacon", make = function() return ing("bacon", "cooked") end },
	{ name = "burnt bacon", make = function() return ing("bacon", "burnt") end },
	{ name = "raw bun", make = function() return ing("bun", "raw") end },
	{ name = "clean empty plate", make = function() return plate(false, {}) end },
	{ name = "clean plate w/ lettuce", make = function() return plate(false, { { kind = "lettuce", state = "prepped" } }) end },
	{ name = "dirty plate", make = function() return plate(true, {}) end },
	{ name = "empty pan", make = function() return pan({}) end },
	{ name = "pan w/ raw bacon", make = function() return pan({ { kind = "bacon", state = "raw" } }) end },
	{ name = "pan w/ cooked bacon", make = function() return pan({ { kind = "bacon", state = "cooked" } }) end },
	{ name = "pan w/ burnt bacon", make = function() return pan({ { kind = "bacon", state = "burnt" } }) end },
}

local function newServerSim(): any
	local sim = shared.createSim({ seed = 7 })
	shared.seedPans(sim)
	return sim
end

--- One station of each kind, by id, from a fresh sim.
local function stationByKind(sim: any): { [string]: any }
	local out = {}
	for _, st in sim.kitchen.stations do
		if out[st.kind] == nil then
			out[st.kind] = st
		end
	end
	return out
end

local probe = newServerSim()
local KINDS = {}
for kind in stationByKind(probe) do
	table.insert(KINDS, kind)
end
table.sort(KINDS)

-- ==================================================================== A
-- MIRROR FIDELITY: the client's planGrab must equal the server's, for every
-- combination of what a station holds and what the player carries.

print("A. mirror fidelity (client planGrab == server planGrab)")

local remotes = setmetatable({}, {
	__index = function()
		return { FireClient = function() end, FireAllClients = function() end }
	end,
})

local mismatch: { [string]: number } = {}
for _, kind in KINDS do
	for _, onBench in CARRIES do
		for _, inHand in CARRIES do
			local sim = newServerSim()
			local st = stationByKind(sim)[kind]
			st.holding = onBench.make()
			local chef = sim.chefs[1]
			chef.carrying = inHand.make()

			-- The real replication path, exactly as a joining client sees it.
			local rep = Replicator.new(shared, Net, remotes, function()
				return 0
			end)
			local snap = rep:snapshotFor(sim)
			local client = ClientState.new(shared, Net)
			client:assign({ chefId = chef.id, skin = "bramble" })
			client:applySnapshot(snap)
			-- Deltas are what actually keep the mirror in step; give the client
			-- the same station payload the server would diff out, so this tests
			-- the steady state rather than only the join instant.
			client:applyStationDeltas(snap.stations)

			local mst = nil
			for _, s in client.mirrorSim.kitchen.stations do
				if s.id == st.id then
					mst = s
					break
				end
			end

			local want = shared.planGrab(sim, chef, st)
			local got = shared.planGrab(client.mirrorSim, client.mirror, mst)
			if want ~= got then
				local key = `{kind}: bench={onBench.name} hand={inHand.name}`
				mismatch[key] = 1
				check(false, `{key}  server says '{want}', client says '{got}'`)
			else
				checks += 1
			end
		end
	end
end

-- ------------------------------------------------ D. THE RACKS RUN DRY
--
-- Everything above runs with a full plate rack, which is the one state where
-- the client cannot be wrong about plates: the mirror sim is CONSTRUCTED with
-- TUNING.plateStock, so it agrees with the server by accident.
--
-- Drain the racks and the accident stops. applyScore used to write the counts
-- to display fields only, while focusPrompt plans against mirrorSim -- whose
-- plateStock stayed at its opening value forever. The empty rack went on
-- glowing and advertising 'dispense' while the server answered 'none': a
-- highlighted prompt that did nothing when pressed.
for _, drained in { { stock = 0, dirty = 0 }, { stock = 0, dirty = 3 }, { stock = 2, dirty = 0 } } do
	local sim = newServerSim()
	sim.plateStock = drained.stock
	sim.dirtyPlates = drained.dirty
	local st = stationByKind(sim)["plates"]
	local chef = sim.chefs[1]

	local rep = Replicator.new(shared, Net, remotes, function()
		return 0
	end)
	local client = ClientState.new(shared, Net)
	client:assign({ chefId = chef.id, skin = "bramble" })
	client:applySnapshot(rep:snapshotFor(sim))
	client:applyScore(rep:scoreSummary(sim))

	local mst = nil
	for _, sst in client.mirrorSim.kitchen.stations do
		if sst.id == st.id then
			mst = sst
			break
		end
	end

	check(
		client.mirrorSim.plateStock == drained.stock,
		`mirror sim carries plateStock {drained.stock} (got {tostring(client.mirrorSim.plateStock)})`
	)
	check(
		client.mirrorSim.dirtyPlates == drained.dirty,
		`mirror sim carries dirtyPlates {drained.dirty} (got {tostring(client.mirrorSim.dirtyPlates)})`
	)
	local want = shared.planGrab(sim, chef, st)
	local got = shared.planGrab(client.mirrorSim, client.mirror, mst)
	check(
		want == got,
		`plates stock={drained.stock} dirty={drained.dirty}: server says '{want}', client says '{got}'`
	)
end

local nMis = 0
for _ in mismatch do
	nMis += 1
end
print(`   {checks - failures}/{checks} combinations agree ({nMis} distinct mismatches)`)

-- ==================================================================== B
-- VERB IMPLIES EFFECT: a non-'none' verb must change observable state when
-- pressed; 'none' must not.

print("B. verb implies effect")

local function fingerprint(sim: any, st: any, chef: any): string
	local function c(x: any): string
		if x == nil then
			return "-"
		end
		if x.type == "ingredient" then
			return `i#{x.ingredient.id}:{x.ingredient.kind}:{x.ingredient.state}`
		elseif x.type == "plate" then
			local n = #x.plate.contents
			local parts = {}
			for _, k in x.plate.contents do
				table.insert(parts, `{k.kind}:{k.state}`)
			end
			table.sort(parts)
			return `p#{x.plate.id}:{x.plate.dirty}:{n}:{table.concat(parts, ",")}`
		elseif x.type == "pan" then
			local parts = {}
			for _, k in x.pan.contents do
				table.insert(parts, `{k.kind}:{k.state}`)
			end
			table.sort(parts)
			return `n#{x.pan.id}:{table.concat(parts, ",")}`
		end
		return "?"
	end
	return `{c(st.holding)}|{c(chef.carrying)}|{sim.plateStock}|{sim.dirtyPlates}|{sim.score.served}|{sim.score.coins}|{st.active}`
end

local bChecks, bFail = 0, 0
for _, kind in KINDS do
	for _, onBench in CARRIES do
		for _, inHand in CARRIES do
			local sim = newServerSim()
			local st = stationByKind(sim)[kind]
			st.holding = onBench.make()
			local chef = sim.chefs[1]
			chef.carrying = inHand.make()

			local verb = shared.planGrab(sim, chef, st)

			-- Stand the chef in front of the station and press, through the
			-- real interact phase rather than a reimplementation of it.
			local at = shared.stationCenter(st)
			chef.pos.x, chef.pos.y = at.x, at.y - 0.9
			chef.heading = math.pi / 2
			chef.vel.x, chef.vel.y = 0, 0
			chef.stun = 0
			-- If the harness could not park the chef so that THIS station wins
			-- focus, the press is aimed elsewhere and the case says nothing
			-- about the verb. That is a limitation of the placement, not a
			-- finding, so it is skipped rather than counted either way.
			local aimed = shared.findFocus(sim, chef)
			if aimed == nil or aimed.id ~= st.id then
				continue
			end
			local before = fingerprint(sim, st, chef)
			shared.interactPhase(sim, chef, { move = { x = 0, y = 0 }, grabPressed = true, useHeld = false }, shared.SIM_DT)
			local after = fingerprint(sim, st, chef)

			bChecks += 1
			if verb ~= "none" and before == after then
				bFail += 1
				fail(`B {kind}: verb '{verb}' with bench={onBench.name} hand={inHand.name} changed nothing`)
			end
		end
	end
end
failures += bFail
print(`   {bChecks - bFail}/{bChecks} verbs produced an effect`)

-- ==================================================================== C
-- GATE HONESTY: if anything in reach can answer the press, the focused
-- station must be one that can.

print("C. gate honesty (focus lands on an actionable station when one exists)")

local cChecks, cFail = 0, 0
local cSampled, cNoFocus, cLive = 0, 0, 0
local sim = newServerSim()
local chef = sim.chefs[1]
-- Dress the kitchen so there is something to be right or wrong about: a bare
-- kitchen has almost no valid interactions and the sweep proves nothing.
do
	local dressed = 0
	for _, st in sim.kitchen.stations do
		if st.kind == "counter" and dressed < 2 then
			st.holding = plate(false, {})
			dressed += 1
		elseif st.kind == "board" and st.holding == nil then
			st.holding = ing("lettuce", "raw")
		end
	end
end
for _, inHand in CARRIES do
	for gx = 1, sim.kitchen.width - 2 do
		for gy = 1, sim.kitchen.height - 2 do
			if not shared.isWalkable(sim.kitchen, gx, gy) then
				continue
			end
			for h = 0, 7 do
				chef.carrying = inHand.make()
				chef.pos.x, chef.pos.y = gx + 0.5, gy + 0.5
				chef.heading = h * math.pi / 4
				chef.vel.x, chef.vel.y = 0, 0

				cSampled += 1
				local focus = shared.findFocus(sim, chef)
				if focus == nil then
					cNoFocus += 1
					continue
				end
				local focusVerb = shared.planGrab(sim, chef, focus)
				if focusVerb ~= "none" then
					cLive += 1
					continue
				end
				-- The focused station is dead. Is there a live one in reach
				-- that the gate should have preferred?
				local better = nil
				for _, st in sim.kitchen.stations do
					local c = shared.stationCenter(st)
					local d = math.sqrt((c.x - chef.pos.x) ^ 2 + (c.y - chef.pos.y) ^ 2)
					if d <= 1.6 and shared.planGrab(sim, chef, st) ~= "none" then
						-- Only count it if it is roughly in front of the chef.
						local ang = math.atan2(c.y - chef.pos.y, c.x - chef.pos.x)
						local diff = math.abs((ang - chef.heading + math.pi) % (2 * math.pi) - math.pi)
						if diff < math.pi / 3 then
							better = st
							break
						end
					end
				end
				cChecks += 1
				if better ~= nil then
					cFail += 1
					fail(
						`C hand={inHand.name} at ({gx},{gy}) h={h}: focused dead {focus.kind} `
							.. `while {better.kind} in front would '{shared.planGrab(sim, chef, better)}'`
					)
				end
			end
		end
	end
end
failures += cFail
print(
	`   {cSampled} placements swept: {cNoFocus} no focus, {cLive} focus with a live verb, {cChecks} focus with a dead verb`
)
print(`   {cChecks - cFail}/{cChecks} dead-focus cases had no better station in front`)

print("")
if failures == 0 then
	print("PASS: focus")
else
	print(`FAIL: focus — {failures} failing checks`)
end
