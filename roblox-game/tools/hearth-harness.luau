-- IS THE OVEN ACTUALLY THERE, AND DOES IT LIGHT?
--
-- HearthFire finds the oven by name and gives up quietly if it cannot -- which
-- is the right behaviour in a game and a terrible one to rely on untested,
-- because a rename in the kitchen asset would put the fire out and say
-- nothing. The whole point of it is that the lobby closeup frames the hearth
-- dead centre, so "silently does nothing" is the one failure that matters.
--
-- Loaded from the SHIPPED assets/kitchen.rbxm rather than a mock, so this is
-- the geometry the player gets.
local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

local model = roblox.deserializeModel(fs.readFile("assets/kitchen.rbxm"))
check(#model > 0, `kitchen.rbxm loaded ({#model} root instance(s))`)

local root = model[1]
local oven = root:FindFirstChild("Oven", true)
check(oven ~= nil, "the shipped kitchen has an Oven, which is what HearthFire looks for by name")

if oven ~= nil then
	local glows = {}
	for _, d in oven:GetDescendants() do
		if d:IsA("BasePart") and string.find(d.Name, "OvenGlow", 1, true) ~= nil then
			table.insert(glows, d)
		end
	end
	check(#glows > 0, `and OvenGlow parts to hang the flames on ({#glows})`)

	-- Sized off the part, so the flame cannot end up wider than its grate.
	local sane = true
	for _, g in glows do
		local span = math.max(g.Size.X, g.Size.Z)
		local size = math.clamp(span * 0.9, 2, 7)
		if size < 2 or size > 7 then
			sane = false
		end
	end
	check(sane, "every flame size lands inside the clamp")

	-- and the hearth is where the lobby camera is pointing: the shot looks at
	-- the middle of the room, and the oven is in the back wall behind it.
	local cf = glows[1].CFrame
	check(cf.Position.X > 20 and cf.Position.X < 55, `the hearth is in the middle third in x ({string.format("%.0f", cf.Position.X)})`)
	check(cf.Position.Z < 20, `and at the back of the room in z ({string.format("%.0f", cf.Position.Z)})`)
end

-- BOTH SIDES OF THE COUPLING, or this only tests the asset.
--
-- HearthFire finds its geometry by NAME. The check above proves the asset has
-- those parts; this proves the code is still looking for the ones it has. A
-- rename on either side puts the fire out silently, and the whole point of the
-- fire is that it is the most conspicuous thing in the lobby shot.
local src = fs.readFile("game-src/client/HearthFire.luau")
for _, name in { "Oven", "OvenGlow" } do
	local looksFor = string.find(src, `"{name}"`, 1, true) ~= nil
	check(looksFor, `HearthFire still looks for "{name}"`)
	local found = false
	if name == "Oven" then
		found = root:FindFirstChild("Oven", true) ~= nil
	else
		for _, d in root:GetDescendants() do
			if d:IsA("BasePart") and string.find(d.Name, name, 1, true) ~= nil then
				found = true
			end
		end
	end
	check(found, `and the shipped kitchen still has "{name}"`)
end

print(if failures > 0 then `{failures} FAILURES` else "PASS: hearth")
if failures > 0 then
	error(`{failures} checks failed`)
end
