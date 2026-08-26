-- Runs the SHIPPING client animator headlessly and dumps posed part CFrames.
--
-- A still turnaround cannot show a gait, and a gait written blind is a gait
-- shipped blind. This loads game-src/client/ChefVisuals.luau itself -- not a
-- JS re-implementation of it, which would drift the moment either side was
-- touched -- against the real chef-rigs.rbxm, and writes anim-dump.json for
-- anim-sheet.mjs to render.
--
-- ChefVisuals only reaches for four things outside itself (a Rigs folder, a
-- Catalog, ItemViz/Hats/HatFits, and `workspace:BulkMoveTo`), so it is loaded
-- into an environment where those are stubs and the commit hook -- the same
-- indirection the wardrobe's ViewportFrame uses -- hands us the poses.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local serde = require("@lune/serde")
local roblox = require("@lune/roblox")

local Instance = (roblox :: any).Instance
local CFrame = (roblox :: any).CFrame
local Vector3 = (roblox :: any).Vector3
local Color3 = (roblox :: any).Color3
local Enum = (roblox :: any).Enum

local rigsFolder
for _, inst in roblox.deserializeModel(fs.readFile("../roblox-game/assets/chef-rigs.rbxm")) do
	if inst.Name == "Rigs" then
		rigsFolder = inst
	end
end
assert(rigsFolder ~= nil, "no Rigs folder in chef-rigs.rbxm")

local CATALOG = { byId = {} }
local STUBS: { [string]: any } = {
	ItemViz = { key = function(_) return "-" end, build = function(_) return nil end },
	Hats = { build = function(_) return nil end },
	HatFits = { resolve = function(_, _) return nil end },
	Catalog = CATALOG,
}

local fakeRS = {}
function fakeRS.FindFirstChild(_, name: string): any
	return if name == "Rigs" then rigsFolder else nil
end
function fakeRS.WaitForChild(_, name: string): any
	return if name == "Game" then { WaitForChild = function(_, n) return n end } else name
end

local env = {
	game = { GetService = function(_, _) return fakeRS end },
	script = { Parent = { ItemViz = "ItemViz", Hats = "Hats", HatFits = "HatFits" } },
	require = function(marker: any): any
		return STUBS[marker] or error(`unstubbed require: {tostring(marker)}`)
	end,
	workspace = { BulkMoveTo = function() end },
	Instance = Instance,
	CFrame = CFrame,
	Vector3 = Vector3,
	Vector2 = (roblox :: any).Vector2,
	Color3 = Color3,
	Enum = Enum,
}

local source = fs.readFile("../roblox-game/game-src/client/ChefVisuals.luau")
local ChefVisuals = luau.load(source, { debugName = "ChefVisuals", environment = env })()

-- ---- capture ---------------------------------------------------------------
local SPECIES = { "bramble", "pip", "nori", "mochi" }
local DT = 1 / 60

local function shapeOf(part: any): string
	if part:FindFirstChildOfClass("SpecialMesh") ~= nil then
		return "Ball"
	end
	local s = tostring(part.Shape)
	if s:find("Cylinder") then
		return "Cylinder"
	elseif s:find("Ball") then
		return "Ball"
	end
	return "Block"
end

--- One posed frame: every part's world CFrame, size and colour, in the JSON
--- shape sheet-viewer.js already speaks.
local function snapshot(parts: { any }, cframes: { any }, entry: any): { any }
	local out = {}
	for i, part in parts do
		local seg = if entry ~= nil then entry.animSeg[i] else 0
		local cf = cframes[i]
		local x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 = cf:GetComponents()
		local c = part.Color
		table.insert(out, {
			shape = shapeOf(part),
			size = { part.Size.X, part.Size.Y, part.Size.Z },
			cf = { x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 },
			color = { math.round(c.R * 255), math.round(c.G * 255), math.round(c.B * 255) },
			group = if entry ~= nil then entry.animGroup[i] else "?",
			seg = seg,
		})
	end
	return out
end

--- A rig plus the harness that drives it. `speedOverride` is the wardrobe's
--- own hook: it makes a stationary rig walk, which is exactly what a strip of
--- gait phases needs (a rig that actually translated would leave frame).
local function makeRig(skin: string, id: number)
	local latest: { any }? = nil
	local vis
	vis = ChefVisuals.new(nil, {
		commit = function(parts, cframes)
			latest = snapshot(parts, cframes, vis.chefs[id])
		end,
	})
	return {
		vis = vis,
		entry = function()
			return vis.chefs[id]
		end,
		step = function(opts: any)
			vis:update(
				id,
				skin,
				{
					x = 0,
					y = 0,
					heading = opts.heading or 0,
					effort = opts.effort or 0,
					stun = opts.stun or 0,
					speedOverride = opts.speed,
				},
				opts.flags or 0,
				DT,
				nil,
				nil,
				nil,
				nil
			)
			return latest
		end,
	}
end

local dump: { [string]: any } = {}

for _, skin in SPECIES do
	local rig = makeRig(skin, 1)
	local frames = {}

	-- settle: smSpeed is a lag filter, so the first second is a ramp, not a walk
	for _ = 1, 180 do
		rig.step({ speed = 3.2 })
	end
	-- one full stride = 2 phase units (stepSin is sin(phase * pi)); sample 8
	local e = rig.entry()
	local start = e.phase
	local wanted, got = 0, {}
	while wanted < 8 do
		local snap = rig.step({ speed = 3.2 })
		if rig.entry().phase >= start + wanted * 0.25 then
			table.insert(got, snap)
			wanted += 1
		end
	end
	frames.walk = got

	-- standing rest: the static kneeRest/ankleRest pose everything else is
	-- layered on, and the one a wardrobe turntable spends most of its time in
	local idle = makeRig(skin, 2)
	for _ = 1, 120 do
		idle.step({ speed = 0 })
	end
	frames.idle = idle.step({ speed = 0 })

	-- face: eyes open / mid-blink / mouth open on a working chef
	local face = makeRig(skin, 3)
	for _ = 1, 60 do
		face.step({ speed = 0 })
	end
	frames.open = face.step({ speed = 0 })
	local guard = 0
	while guard < 3600 do
		local snap = face.step({ speed = 0 })
		guard += 1
		if face.entry().lid < 0.25 then
			frames.blink = snap
			break
		end
	end
	local chew = makeRig(skin, 4)
	for _ = 1, 90 do
		chew.step({ speed = 0, flags = 2, effort = 1 })
	end
	-- flags bit 2 = working; hold until the jaw filter has actually opened
	for _ = 1, 60 do
		local snap = chew.step({ speed = 0, flags = 2, effort = 1 })
		if chew.entry().mouthOpen > 0.85 then
			frames.mouth = snap
			break
		end
	end
	frames.mouth = frames.mouth or chew.step({ speed = 0, flags = 2, effort = 1 })

	-- bank: hold a constant turn rate until the smoothed turn signal saturates
	local banks = {}
	for _, rate in { -6, 0, 6 } do
		local turner = makeRig(skin, 5)
		local heading = 0
		local snap
		for _ = 1, 240 do
			heading += rate * DT
			snap = turner.step({ speed = 3.2, heading = heading })
		end
		table.insert(banks, snap)
	end
	frames.bank = banks

	dump[skin] = frames
	print(`{skin}: walk {#frames.walk} frames, blink {if frames.blink then "yes" else "MISSED"}`)
end

fs.writeFile("anim-dump.json", serde.encode("json", dump))
print("wrote anim-dump.json")
