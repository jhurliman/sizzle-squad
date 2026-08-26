--!strict
-- Chef bodies + the procedural animator.
--
-- Captured rigs are part-groups (Hips/Torso/Head/ArmL/ArmR/LegL/LegR/Hands/
-- Tail/Ears), each carrying a "Joint" attribute — its bind-pose pivot. Every
-- frame the animator computes a model-space transform per group (gait swings,
-- carry/chop poses, lean, secondary tail/ear motion, stun flail), composes
-- them with each part's bind CFrame, and commits the whole cast with one
-- BulkMoveTo. Signals mirror the web ChefView's: speed (from rendered
-- displacement, smoothed), step phase, carry tier, working, stun.
--
-- Three things need finer articulation than one transform per group, and
-- :ensure derives all three from the geometry rather than a per-species table,
-- so a re-captured rig keeps working:
--   * the LEG, which arrives as a single group and is split into thigh / shin
--     / foot around a knee and an ankle recovered from the two longest parts;
--   * the EYES, a mirrored dark lens with a white catchlight on it, which
--     blink by being squashed flat;
--   * the JAW, everything on the head below the eyes and in front of the
--     skull, hinged at the skull's centre line and dropped on effort.
-- Per-species cadence, stride, bounce and bank live in GAIT below.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ItemViz = require(script.Parent.ItemViz) :: any
local Hats = require(script.Parent.Hats) :: any
local Catalog = require(ReplicatedStorage:WaitForChild("Game"):WaitForChild("Catalog")) :: any

local ChefVisuals = {}
ChefVisuals.__index = ChefVisuals

local SCALE = 5
local CHEF_HEIGHT = 0.72 * SCALE

-- How far a carried item sits beyond the torso's own front face, in studs.
-- Enough that it reads as held rather than embedded, small enough that it
-- stays against the chef.
local CARRY_CLEARANCE = 0.45
local MAX_SPEED = 6.2
local HatFits = require(script.Parent.HatFits) :: any

-- ---- gait personality -------------------------------------------------------
-- The rigs already differ in PROPORTION — that is baked into the captured
-- parts. What was missing is the half that only exists in motion: four bodies
-- walking on the same cadence, the same bounce and the same stride read as one
-- rig in four costumes, which is exactly what the cast looked like.
--
-- cadence/cadenceGain — stride rate = cadence + speed * cadenceGain. bramble
--   lumbers under his own mass, mochi is a bird and takes twice as many steps
--   to cover the same ground, nori is not stepping at all (see `skating`).
-- lift/float — AIRTIME, as a fraction of CHEF_HEIGHT, and the shape of it.
--   This is genuine flight, not a bob: the vertical bounce of a walk is a
--   consequence of the leg geometry and :update now derives it (see
--   `footRise`), so anything added here takes the feet off the floor and only
--   pip — who hops — is entitled to any. `float` is the exponent on the arc:
--   below 1 the body hangs near the top.
-- leg/arm — swing amplitudes at full speed.
-- knee — gain on the swing-phase knee lift, on top of the shared curve.
-- kneeRest/ankleRest — the STATIC bend, ported straight from the web rig's
--   BUILDS table: "a cat is digitigrade, a bear is not". The capture froze
--   every rig with its shin in line with its thigh, so the hock nori is
--   supposed to stand on was simply not in the model.
-- bank — roll into a turn, per unit of normalised turn rate.
type Gait = {
	cadence: number,
	cadenceGain: number,
	lift: number,
	float: number,
	leg: number,
	arm: number,
	knee: number,
	kneeRest: number,
	ankleRest: number,
	bank: number,
}
local GAIT: { [string]: Gait } = {
	-- stocky. Slowest cadence and the longest stride of the walkers, which is
	-- also the heaviest drop in the cast (0.41 studs at double support against
	-- mochi's 0.26): mass is sold by how far the body falls, not by how fast.
	bramble = { cadence = 0.95, cadenceGain = 0.42, lift = 0, float = 1, leg = 0.85, arm = 0.5, knee = 0.85, kneeRest = 0.06, ankleRest = 0, bank = 0.16 },
	-- lanky. A frog does not walk, it hops: the only rig in the cast that
	-- actually leaves the floor, hanging at the top of the arc (float 0.55)
	-- with its legs crossed under it and landing on the split.
	-- (0.85 on the leg, not the 0.95 the long shins first got: at 0.95 the
	-- split reaches 109 degrees, which is past the splits and reads as a
	-- hurdle rather than a hop. The web rig caps its own thigh at 0.82.)
	pip = { cadence = 0.95, cadenceGain = 0.4, lift = 0.1, float = 0.55, leg = 0.85, arm = 0.6, knee = 1, kneeRest = 0.14, ankleRest = -0.1, bank = 0.2 },
	-- nimble, and ON ROLLER SKATES. No step, no bounce, wheels never off the
	-- ground — all of nori's motion budget goes into the carve, which is why
	-- his bank is 3x anyone else's.
	nori = { cadence = 0.6, cadenceGain = 0.28, lift = 0, float = 1, leg = 0.22, arm = 0.3, knee = 0.35, kneeRest = 0.42, ankleRest = -0.4, bank = 0.5 },
	-- bird. Nearly twice bramble's cadence at three quarters of his amplitude:
	-- quick, light, and never quite still.
	mochi = { cadence = 1.75, cadenceGain = 0.8, lift = 0, float = 1, leg = 0.65, arm = 0.55, knee = 0.85, kneeRest = 0.2, ankleRest = -0.16, bank = 0.24 },
}
local FALLBACK_GAIT: Gait = GAIT.bramble

-- Knee/ankle chain constants, ported from the web rig with its measurements.
local KNEE_FLOOR = 0.1 -- a walking leg is never dead straight
local KNEE_LIFT = 1.34 -- "a taller lift over a briefer window — a flick, not a shuffle"
local KNEE_FRONT = 0.5 -- the LEADING knee is bent; two straight legs at full split is the splits
local KNEE_CAP = 1.7 -- past this the shin folds through the thigh
local ANKLE_FOLLOW = 0.55 -- ankle counter-rotates 55% of the chain, so the sole stays flat
local TOE_OFF = 0.62 -- the trailing foot is plantar-flexed hard; half of what says "moving"
local HEEL_STRIKE = 0.2 -- the leading foot presents its sole on landing
local BANK_LIMIT = 0.5 -- 29 degrees. A chef leaning further than this is a motorcycle.

--- Vertical half-extent of a part, honouring its rotation. size.Y/2 is wrong
--- the moment a part is tilted — and every captured limb is tilted a few
--- degrees, because the web rig was dumped mid-idle.
local function halfY(part: BasePart): number
	local cf = part.CFrame
	local s = part.Size
	return (math.abs(cf.RightVector.Y) * s.X + math.abs(cf.UpVector.Y) * s.Y + math.abs(cf.LookVector.Y) * s.Z) / 2
end

local SKIN_COLORS: { [string]: Color3 } = {
	bramble = Color3.fromRGB(160, 82, 45),
	pip = Color3.fromRGB(106, 190, 48),
	nori = Color3.fromRGB(99, 105, 209),
	mochi = Color3.fromRGB(235, 165, 50),
}

--- Commit poses straight into the world. This is the only place the module
--- touches a global, which is exactly why it is injectable: `BulkMoveTo` is a
--- Workspace API and silently does NOTHING for parts that are not Workspace
--- descendants — a rig inside a ViewportFrame would sit in bind pose at the
--- wrong origin with no error raised. The wardrobe passes a plain CFrame loop.
local function defaultCommit(parts: { BasePart }, cframes: { CFrame })
	workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)
end

--- opts.commit: override how posed CFrames reach the parts (see above).
function ChefVisuals.new(parent: Instance, opts: any?)
	local self = setmetatable({}, ChefVisuals)
	self.parent = parent
	self.rigsFolder = ReplicatedStorage:FindFirstChild("Rigs")
	self.chefs = {} :: { [number]: any }
	self.time = 0
	self.commit = (opts ~= nil and opts.commit) or defaultCommit
	return self
end

local function buildPlaceholder(skin: string): Model
	local model = Instance.new("Model")
	local color = SKIN_COLORS[skin] or Color3.fromRGB(200, 200, 200)
	local body = Instance.new("Part")
	body.Name = "Body"
	body.Shape = Enum.PartType.Cylinder
	body.Size = Vector3.new(CHEF_HEIGHT * 0.62, CHEF_HEIGHT * 0.52, CHEF_HEIGHT * 0.52)
	body.Color = color
	body.Material = Enum.Material.SmoothPlastic
	body.Anchored = true
	body.CanCollide = false
	body.Parent = model
	local head = Instance.new("Part")
	head.Name = "Head"
	head.Shape = Enum.PartType.Ball
	head.Size = Vector3.one * CHEF_HEIGHT * 0.5
	head.Color = color:Lerp(Color3.new(1, 1, 1), 0.25)
	head.Material = Enum.Material.SmoothPlastic
	head.Anchored = true
	head.CanCollide = false
	head.Parent = model
	model.PrimaryPart = body
	return model
end

function ChefVisuals:ensure(id: number, skin: string): any
	local entry = self.chefs[id]
	if entry ~= nil then
		return entry
	end

	local model: Model
	local rigTemplate = self.rigsFolder and self.rigsFolder:FindFirstChild(skin)
	local isRig = rigTemplate ~= nil
	if isRig then
		model = (rigTemplate :: Model):Clone()
	else
		model = buildPlaceholder(skin)
	end
	model.Name = `Chef_{id}_{skin}`
	model.Parent = self.parent

	entry = {
		model = model,
		isRig = isRig,
		skin = skin,
		paletteApplied = "-",
		origColors = {} :: { Color3 },
		coatColor = nil :: Color3?,
		phase = 0,
		smSpeed = 0,
		carryBlend = 0,
		turn = 0,
		mouthOpen = 0,
		lastPos = nil :: Vector2?,
		lastHeading = nil :: number?,
		carryKey = "-",
		carryModel = nil :: Model?,
		hatId = nil :: string?,
		hatModel = nil :: Model?,
		hatFit = nil :: any,
		nameGui = nil :: BillboardGui?,
		-- articulation tables (rig only)
		animParts = {} :: { BasePart },
		animBind = {} :: { CFrame },
		animGroup = {} :: { string },
		animCFrames = {} :: { CFrame },
		builtinHatParts = {} :: { BasePart },
		earParts = {} :: { BasePart },
		joints = {} :: { [string]: Vector3 },
		-- articulation below the group level: which chain segment each part
		-- rides (0 thigh / 1 shin / 2 foot; 0 for everything outside the legs)
		-- and whether it is jaw geometry.
		animSeg = {} :: { number },
		animMouth = {} :: { boolean },
		kneeAt = {} :: { [string]: Vector3 },
		ankleAt = {} :: { [string]: Vector3 },
		legSpan = {} :: { [string]: { number } },
		eyeParts = {} :: { BasePart },
		eyeSize = {} :: { Vector3 },
		lid = 1,
		blinkIn = 0,
		blinkFor = 0,
		mouthPivot = nil :: Vector3?,
		mouthAngle = 0,
		headAttach = Vector3.new(0, CHEF_HEIGHT, 0),
		headAnchor = nil :: BasePart?,
	}

	-- Blinks must not land on the same frame across the cast. Four chefs sharing
	-- one 0.11s blink reads as a cutaway, not as four animals. The offset is the
	-- golden-ratio low-discrepancy sequence on the chef id, which spreads any
	-- number of chefs about as evenly as it is possible to spread them and does
	-- it deterministically, so a rig re-created mid-round does not blink twice.
	entry.blinkIn = 0.8 + ((id * 0.6180339887) % 1) * 3.4

	if isRig then
		local headTop = 0
		local rigTop = 0
		local legIdx: { [string]: { number } } = { LegL = {}, LegR = {} }
		local headIdx: { number } = {}
		local earIdx: { number } = {}
		-- The hat anchors to the SKULL — the largest head part — not the mean
		-- of the head group: snouts drag a mean forward, ears drag it up, and
		-- the hat ends up floating in front of the face.
		local skull: BasePart? = nil
		local skullVolume = 0
		-- Where a carried item belongs, measured off THIS rig rather than
		-- guessed from its height. See entry.carryAnchor below.
		local torsoFront, armY, armN = -math.huge, 0, 0
		for _, group in model:GetChildren() do
			if group:IsA("Model") then
				local joint = group:GetAttribute("Joint")
				if typeof(joint) == "Vector3" then
					entry.joints[group.Name] = joint
				end
				for _, p in group:GetChildren() do
					if p:IsA("BasePart") then
						table.insert(entry.animParts, p)
						table.insert(entry.animBind, p.CFrame)
						table.insert(entry.animGroup, group.Name)
						table.insert(entry.animCFrames, p.CFrame)
						table.insert(entry.animSeg, 0)
						table.insert(entry.animMouth, false)
						rigTop = math.max(rigTop, p.CFrame.Y + p.Size.Y / 2)
						local gname = group.Name
						if gname == "Torso" or gname == "Hips" then
							torsoFront = math.max(torsoFront, p.CFrame.Z + math.max(p.Size.X, p.Size.Y, p.Size.Z) / 2)
						elseif gname == "ArmL" or gname == "ArmR" then
							armY += p.CFrame.Y
							armN += 1
						end
						local slot = legIdx[group.Name]
						if slot ~= nil then
							table.insert(slot, #entry.animParts)
						elseif group.Name == "Head" then
							table.insert(headIdx, #entry.animParts)
						elseif group.Name == "Ears" then
							table.insert(earIdx, #entry.animParts)
						end
						if group.Name == "BuiltinHat" then
							table.insert(entry.builtinHatParts, p)
						end
						if group.Name == "Ears" then
							table.insert(entry.earParts, p)
						end
						if group.Name == "Head" then
							headTop = math.max(headTop, p.CFrame.Y + p.Size.Y / 2)
							local vol = p.Size.X * p.Size.Y * p.Size.Z
							if vol > skullVolume then
								skullVolume = vol
								skull = p
							end
						end
					end
				end
			end
		end
		-- Palette support: remember every part's authored colour, then work out
		-- which parts ARE the coat.
		--
		-- This used to pick the single most common exact colour. That is wrong
		-- on a shaded rig: pip's green is authored as two tones (a light
		-- 162,216,117 and a dark 92,186,60, 8 parts each) which each lose to
		-- his 10-part cream belly -- so "Axolotl Pip" faithfully turned his
		-- BELLY pink and left him green. Same story on bramble.
		--
		-- So cluster by HUE weighted by part volume (visual mass, not part
		-- count), ignoring near-greys and near-blacks, which are eyes, teeth,
		-- aprons and outlines rather than coat.
		local HUE_TOLERANCE = 0.09 -- ~32 degrees either side
		local MIN_SAT, MIN_VAL = 0.18, 0.12
		local bins = table.create(24, 0)
		local hsv = {}
		for i, part2 in entry.animParts do
			local c = part2.Color
			table.insert(entry.origColors, c)
			local h, sat, val = c:ToHSV()
			hsv[i] = { h = h, s = sat, v = val }
			if sat >= MIN_SAT and val >= MIN_VAL then
				local size = part2.Size
				local mass = size.X * size.Y * size.Z
				local bin = math.clamp(math.floor(h * 24) + 1, 1, 24)
				bins[bin] += mass
			end
		end
		local bestBin, bestMass = 0, 0
		for i, m in bins do
			if m > bestMass then
				bestBin, bestMass = i, m
			end
		end
		entry.coatMask = {}
		entry.coatHsv = hsv
		if bestMass > 0 then
			-- Weighted circular mean hue over the winning bin and its neighbours.
			local centre = (bestBin - 0.5) / 24
			local sx, sy, sw, sv, wn = 0, 0, 0, 0, 0
			for i, part2 in entry.animParts do
				local q = hsv[i]
				if q.s >= MIN_SAT and q.v >= MIN_VAL then
					local d = math.abs(q.h - centre)
					d = math.min(d, 1 - d) -- hue is a circle
					if d <= HUE_TOLERANCE then
						local size = part2.Size
						local mass = size.X * size.Y * size.Z
						sx += math.cos(q.h * 2 * math.pi) * mass
						sy += math.sin(q.h * 2 * math.pi) * mass
						sw += q.s * mass
						sv += q.v * mass
						wn += mass
					end
				end
			end
			if wn > 0 then
				local meanH = (math.atan2(sy, sx) / (2 * math.pi)) % 1
				entry.coatRef = { h = meanH, s = sw / wn, v = sv / wn }
				entry.coatColor = Color3.fromHSV(meanH, sw / wn, sv / wn)
				for i, q in hsv do
					local d = math.abs(q.h - meanH)
					d = math.min(d, 1 - d)
					entry.coatMask[i] = q.s >= MIN_SAT and q.v >= MIN_VAL and d <= HUE_TOLERANCE
				end
			end
		end

		-- the species' built-in hat rides the head's animation
		if entry.joints.Head ~= nil and entry.joints.BuiltinHat == nil then
			entry.joints.BuiltinHat = entry.joints.Head
		end

		entry.headAnchor = skull
		entry.rigHeight = math.max(rigTop, CHEF_HEIGHT)

		-- WHERE A CARRIED ITEM SITS, MEASURED, NOT SCALED FROM HEIGHT.
		--
		-- It used to be (0, h * 0.52, h * 0.38) off the rig height, which put
		-- the item 3.5-4.0 studs in front of a chef whose torso front face is
		-- only 1.6-2.0 studs out — so a tomato floated a whole body-depth clear
		-- of the bird holding it, and no single constant could fix that,
		-- because height does not predict body depth (pip is the tallest rig
		-- and one of the shallowest).
		--
		-- No per-species table needed: the rig knows. Sit it just proud of the
		-- torso's own front face, at the mean height of the arms, and every
		-- species is right by construction — including any rig captured later.
		local frontOf = if torsoFront > -math.huge then torsoFront else entry.rigHeight * 0.2
		local handsAt = if armN > 0 then armY / armN else entry.rigHeight * 0.55
		entry.carryAnchor = Vector3.new(0, handsAt, frontOf + CARRY_CLEARANCE)
		if skull ~= nil then
			entry.headAttach = Vector3.new(skull.CFrame.X, math.max(headTop - 0.25, skull.CFrame.Y + skull.Size.Y * 0.3), skull.CFrame.Z)
			-- hats fit the SKULL, not the body: pip is tall but small-headed
			entry.hatScale = math.max(skull.Size.X, skull.Size.Z) / 1.55
		end

		-- ---- knee + ankle, derived --------------------------------------
		-- The capture flattened each leg into ONE group, so there is no knee
		-- to rotate about — which is why the legs swung as broomsticks. The
		-- joint is recovered from the geometry instead of hardcoded per
		-- species, so a re-captured rig keeps working:
		--
		-- The two parts with the greatest vertical extent in a leg group are
		-- always the thigh and the shin, by a wide margin (bramble 1.82/1.66
		-- studs against 0.95 for the next; nori 1.71/1.69 against 0.73 — and
		-- nori's group also carries a boot, three wheels and a frame). Two
		-- abutting segments of similar length meet at the MIDPOINT OF THEIR
		-- CENTRES, which lands within 0.05 studs of the measured seam on all
		-- four rigs. The ankle is one more half-segment down the same line.
		for _, name in { "LegL", "LegR" } do
			local idx = legIdx[name]
			if #idx < 2 then
				continue
			end
			local aI, bI, aH, bH = 0, 0, -1, -1
			for _, i in idx do
				local h = halfY(entry.animParts[i])
				if h > aH then
					bI, bH = aI, aH
					aI, aH = i, h
				elseif h > bH then
					bI, bH = i, h
				end
			end
			local pa, pb = entry.animParts[aI].CFrame.Position, entry.animParts[bI].CFrame.Position
			local thighI, shinI = aI, bI
			local thigh, shin = pa, pb
			if pb.Y > pa.Y then
				thighI, shinI = bI, aI
				thigh, shin = pb, pa
			end
			local knee = thigh:Lerp(shin, 0.5)
			local ankle = shin + (shin - knee)
			entry.kneeAt[name] = knee
			entry.ankleAt[name] = ankle
			-- Everything below the knee rides the shin; everything below the
			-- midpoint of shin-centre-to-ankle is foot. That cut keeps
			-- bramble's boot cuff on the shin (it sits at the ankle, not on
			-- it) while taking all four paw spheres with the foot.
			local footCut = (ankle.Y + shin.Y) / 2
			for _, i in idx do
				local y = entry.animParts[i].CFrame.Y
				local seg = if y >= knee.Y then 0 elseif y >= footCut then 1 else 2
				if i == thighI then
					seg = 0
				elseif i == shinI then
					seg = 1
				end
				entry.animSeg[i] = seg
			end
			-- The chain, as offsets, so :update can answer "how far off the
			-- floor is this sole" in six multiplies (see `footRise`). Only Y
			-- and Z matter: every joint here rotates about X.
			--
			-- The sole is the LOWEST point of the foot cluster, not the ankle.
			-- Approximating the leg as three vertical sticks put bramble's
			-- standing pose 0.06 studs into the floor, because his paws reach
			-- most of a stud forward of the ankle and a forward point swings
			-- DOWN when the knee bends.
			local sole, soleY = knee, math.huge
			for _, i in idx do
				if entry.animSeg[i] == 2 then
					local part = entry.animParts[i]
					local y = part.CFrame.Y - halfY(part)
					if y < soleY then
						soleY = y
						sole = Vector3.new(part.CFrame.X, y, part.CFrame.Z)
					end
				end
			end
			local hipJoint = entry.joints[name]
			if hipJoint ~= nil then
				entry.legSpan[name] = {
					knee.Y - hipJoint.Y, knee.Z - hipJoint.Z,
					ankle.Y - knee.Y, ankle.Z - knee.Z,
					sole.Y - ankle.Y, sole.Z - ankle.Z,
				}
			end
		end

		-- ---- eyes + mouth -------------------------------------------------
		-- Neither is a group: they are loose parts inside Head (and, for pip,
		-- inside Ears — the frog's eyes ARE his silhouette, two domes on top
		-- of the skull, and the capture filed them with the ear cluster).
		--
		-- AN EYE IS A DARK LENS WITH A WHITE CATCHLIGHT SITTING ON IT. Both
		-- halves are needed to identify either, and cheaper tests all fail on
		-- this cast:
		--   * colour alone calls bramble's nose and every lip arc an eye (the
		--     arcs are 6-7 identical near-black cylinders);
		--   * "a mirrored pair of near-neutral parts" additionally calls pip's
		--     two pale cheek spots a pair of eyes — they are 0.94 value at
		--     0.317 saturation, and his real lens is 0.125 at 0.3125, so no
		--     saturation threshold separates them;
		--   * bucketing on size as well as colour drops bramble entirely,
		--     because his two eyes were captured 0.01 studs apart in depth.
		-- So: a mirrored pair sharing an exact colour, dark, forward of the
		-- skull and small against it, is a lens; a bright pair sitting inside
		-- a lens's own radius is its catchlights. Nothing else on any of the
		-- four rigs satisfies both halves.
		if skull ~= nil then
			local skullVol = skull.Size.X * skull.Size.Y * skull.Size.Z
			local function pairsByColour(list: { number }): { { BasePart } }
				local buckets: { [string]: { BasePart } } = {}
				for _, i in list do
					local p = entry.animParts[i]
					local c = p.Color
					local key = string.format("%d,%d,%d", math.round(c.R * 255), math.round(c.G * 255), math.round(c.B * 255))
					local b = buckets[key]
					if b == nil then
						b = {}
						buckets[key] = b
					end
					table.insert(b, p)
				end
				local out = {}
				for _, b in buckets do
					-- exactly two, straddling the head's midline, in front of it
					if
						#b == 2
						and math.abs(b[1].CFrame.X - b[2].CFrame.X) >= 0.25
						and b[1].CFrame.Z > skull.CFrame.Z
						and b[2].CFrame.Z > skull.CFrame.Z
					then
						table.insert(out, b)
					end
				end
				return out
			end
			local function addEye(p: BasePart)
				table.insert(entry.eyeParts, p)
				table.insert(entry.eyeSize, p.Size)
			end
			local function findEyes(list: { number })
				local candidates = pairsByColour(list)
				local lenses: { BasePart } = {}
				for _, b in candidates do
					local _, sat, val = b[1].Color:ToHSV()
					local s = b[1].Size
					if sat < 0.45 and val < 0.35 and s.X * s.Y * s.Z * 2 < skullVol * 0.25 then
						table.insert(lenses, b[1])
						table.insert(lenses, b[2])
						addEye(b[1])
						addEye(b[2])
					end
				end
				if #lenses == 0 then
					return
				end
				for _, b in candidates do
					local _, sat, val = b[1].Color:ToHSV()
					if sat >= 0.25 or val <= 0.85 then
						continue
					end
					for _, p in b do
						for _, lens in lenses do
							local reach = math.max(lens.Size.X, lens.Size.Y, lens.Size.Z) * 0.75
							if (p.CFrame.Position - lens.CFrame.Position).Magnitude < reach then
								addEye(p)
								break
							end
						end
					end
				end
			end
			findEyes(headIdx)
			if #entry.eyeParts == 0 then
				-- pip's eyes ARE his silhouette — two domes on top of the
				-- skull — and the capture filed them with the ear cluster.
				findEyes(earIdx)
			end

			-- THE JAW IS THE WHOLE MUZZLE, not the lip line. Hinging the lip
			-- arc on its own — which is what "the lowest cluster of matching
			-- parts" finds — slides seven dark cylinders off the bottom of
			-- bramble's snout, where they read as a collar rather than an open
			-- mouth. Everything on the head that is below the eyes and in
			-- front of the skull moves together instead: muzzle, lip, nose,
			-- whiskers, beak. That is also anatomically where a jaw ends.
			--
			-- The cut is the eyes' CENTRES, not their undersides: bramble's
			-- muzzle clears his lower lids by 0.09 studs and would have fallen
			-- on the wrong side of a tighter line.
			local eyeLine = math.huge
			for _, p in entry.eyeParts do
				eyeLine = math.min(eyeLine, p.CFrame.Y)
			end
			if eyeLine < math.huge then
				local jaw, sz, top = 0, 0, -math.huge
				for _, i in headIdx do
					local p = entry.animParts[i]
					if p ~= skull and p.CFrame.Y < eyeLine and p.CFrame.Z > skull.CFrame.Z then
						entry.animMouth[i] = true
						jaw += 1
						sz += p.CFrame.Z
						top = math.max(top, p.CFrame.Y + halfY(p))
					end
				end
				if jaw >= 2 then
					-- The hinge sits where a jaw hinge sits: back at the
					-- skull's own centre line, level with the top of the
					-- muzzle. A pivot inside the muzzle instead swings it
					-- through the face.
					entry.mouthPivot = Vector3.new(skull.CFrame.X, top, skull.CFrame.Z)
					-- Normalised so every species drops its jaw by a tenth of
					-- its own skull height: mochi's beak reaches a stud
					-- further forward of the hinge than bramble's lip, so one
					-- shared angle would open one of them twice as far.
					local arm = math.max(0.2, sz / jaw - skull.CFrame.Z)
					entry.mouthAngle = math.clamp(math.asin(math.min(1, 0.1 * skull.Size.Y / arm)), 0, 0.5)
				else
					for _, i in headIdx do
						entry.animMouth[i] = false
					end
				end
			end
		end
	else
		entry.rigHeight = CHEF_HEIGHT
	end
	entry.hatScale = entry.hatScale or 1

	self.chefs[id] = entry
	return entry
end

--- Rotation of a group about its bind-pose joint.
local function around(joint: Vector3, rx: number, ry: number, rz: number): CFrame
	return CFrame.new(joint) * CFrame.Angles(rx, ry, rz) * CFrame.new(-joint)
end

--- Retint the coat-colored parts toward an equipped palette (or restore).
--- Recolour the coat, preserving its shading.
---
--- Every coat part keeps its light/dark relationship to the coat average and
--- only takes on the target's hue and saturation, so a two-tone rig stays
--- two-tone. A flat lerp toward one colour flattens the model instead.
function ChefVisuals:applyPalette(entry: any, paletteId: string?)
	local key = paletteId or "-"
	if entry.paletteApplied == key or not entry.isRig or entry.coatRef == nil then
		return
	end
	entry.paletteApplied = key
	local item = paletteId ~= nil and Catalog.byId[paletteId] or nil
	local target: Color3? = nil
	if item ~= nil and item.kind == "palette" and item.species == entry.skin and item.color ~= nil then
		target = Color3.fromRGB(item.color[1], item.color[2], item.color[3])
	end
	if target == nil then
		for i, part in entry.animParts do
			if entry.coatMask[i] then
				part.Color = entry.origColors[i]
			end
		end
		return
	end
	local th, ts, tv = (target :: Color3):ToHSV()
	local ref = entry.coatRef
	for i, part in entry.animParts do
		if entry.coatMask[i] then
			local q = entry.coatHsv[i]
			-- relative shade, so highlights stay highlights
			local satScale = if ref.s > 0.01 then q.s / ref.s else 1
			local valScale = if ref.v > 0.01 then q.v / ref.v else 1
			part.Color = Color3.fromHSV(
				th,
				math.clamp(ts * satScale, 0, 1),
				math.clamp(tv * valScale, 0.02, 1)
			)
		end
	end
end

--- pose: { x, y (kitchen cells), heading, effort, stun }
function ChefVisuals:update(id: number, skin: string, pose: any, flags: number, dt: number, carrying: any, hat: string?, label: string?, palette: string?)
	-- species swap: rebuild the body, keep the slot
	local existing = self.chefs[id]
	if existing ~= nil and existing.skin ~= skin then
		self:remove(id)
	end
	local entry = self:ensure(id, skin)
	self:applyPalette(entry, palette)
	self.time += dt
	dt = math.max(dt, 1e-3)

	-- ---- signals -----------------------------------------------------------
	local p = Vector2.new(pose.x, pose.y)
	local rawSpeed = 0
	if entry.lastPos ~= nil then
		rawSpeed = math.min((p - entry.lastPos).Magnitude / dt, MAX_SPEED * 1.3)
	end
	-- Speed is derived from RENDERED DISPLACEMENT, so a rig posed at a fixed
	-- point (the wardrobe turntable) reads exactly zero and the entire gait --
	-- moveBlend, stepSin, hop, tail sway, ear bounce -- goes dead. This lets a
	-- stationary preview show the real walk cycle. Faking it by walking the
	-- preview in a tiny circle does not work: the radius needed to reach
	-- moveBlend ~= 0.5 is ~0.07 cells, a visible 0.7-stud drift on the rig.
	if pose.speedOverride ~= nil then
		rawSpeed = pose.speedOverride
	end
	entry.lastPos = p
	entry.smSpeed += (rawSpeed - entry.smSpeed) * math.min(1, dt * 8)
	local speed = entry.smSpeed
	local moveBlend = math.clamp((speed - 0.25) / 2.2, 0, 1)
	local gait = GAIT[skin] or FALLBACK_GAIT

	-- nori is ON ROLLER SKATES (the ankle wheels — playtest: "this is
	-- fantastic as long as his animations match"): long glides instead of
	-- steps, no bounce, side-to-side carve instead of walk-rock.
	local skating = skin == "nori"
	if moveBlend > 0.01 then
		entry.phase += dt * (gait.cadence + speed * gait.cadenceGain)
	end
	local phi = entry.phase * math.pi
	local stepSin = math.sin(phi) -- alternates each step/stride
	-- AIRTIME PEAKS WHERE THE LEGS CROSS. The old bob rode |sin| — the same
	-- wave as the stride — which put the top of it at full leg separation, the
	-- one moment in a gait when both feet are down and the hips are at their
	-- LOWEST. A quarter cycle out, so the whole cast bobbed against its own
	-- footfalls. Everything but pip now takes its vertical from the legs
	-- themselves (see `footRise`) and this term is zero for them.
	local hop = math.abs(math.cos(phi)) ^ gait.float * moveBlend * CHEF_HEIGHT * gait.lift

	local carryingNow = bit32.band(flags, 4) ~= 0
	entry.carryBlend += ((if carryingNow then 1 else 0) - entry.carryBlend) * math.min(1, dt * 10)
	local carryBlend = entry.carryBlend
	local working = bit32.band(flags, 2) ~= 0
	local stunned = (pose.stun or 0) > 0
	local wobble = if stunned then math.sin(self.time * 24) * 0.12 else 0
	-- skate carve: a deeper, slower roll; walkers get the usual step rock
	local rock = if skating then stepSin * 0.11 * moveBlend else stepSin * 0.05 * moveBlend

	-- ---- the leg chain: hip -> knee -> ankle --------------------------------
	-- `lw` is the leg's own phase; the two legs are half a cycle apart, and
	-- LegL runs a half cycle ahead so the hip angle comes out identical to the
	-- single-segment swing this replaced — nothing else keyed off stepSin
	-- (arms, tail, ears, rock) has to move.
	--
	-- The knee lift peaks at the PASSING pose (cos lw = 1), the moment the
	-- swinging foot has to clear the floor, and the leading knee picks up a
	-- second bend on top: two straight legs at full split is a gymnast's
	-- splits, not a walk. The ankle then counter-rotates 55% of the whole
	-- chain so the sole stays roughly level, with the trailing foot pushed
	-- over into toe-off — a foot rolling off its toe is most of what sells
	-- weight in a still frame. Amplitudes and shares are the web rig's, which
	-- were measured off the reference.
	local legAmp = gait.leg * moveBlend
	local footRise = math.huge
	local function legChain(name: string, lw: number): (number, number, number)
		local swing = math.sin(lw)
		local hip = -swing * legAmp
		local knee = gait.kneeRest
			+ legAmp * (KNEE_FLOOR + KNEE_LIFT * gait.knee * math.max(0, math.cos(lw)))
			+ legAmp * math.max(0, swing) * KNEE_FRONT
			+ carryBlend * 0.16
			+ (if stunned then 0.35 else 0)
		knee = math.clamp(knee, 0, KNEE_CAP)
		local ankle = gait.ankleRest
			- (hip + knee - gait.kneeRest) * ANKLE_FOLLOW
			- legAmp * math.max(0, -swing) * TOE_OFF
			+ legAmp * math.max(0, swing) * HEEL_STRIKE
		-- KEEP THE PLANTED FOOT PLANTED. Swinging a rigid leg about the hip
		-- lifts its foot by len*(1 - cos), which on bramble's 2.8-stud leg at
		-- a 46-degree split is a third of a stud — the whole cast walked a
		-- third of a stud in the air, and adding a knee only made it worse,
		-- because a bent knee is a shorter leg. So the hips drop by however
		-- far the LOWER of the two soles has been raised: whichever leg is
		-- taking the weight stays on the floor, and the other one swings.
		--
		-- Every joint in the chain turns about X, so the sole's height is
		-- three planar rotations deep and costs six multiplies to solve
		-- exactly. Doing it exactly matters — the error in the stick-figure
		-- approximation is the same order as the correction itself.
		--
		-- It also makes the bob honest for free: the feet are furthest from
		-- under the body at double support, which is exactly when a walking
		-- body is at its lowest. And it is what lets the standing pose carry a
		-- static crouch (nori's hock, a carried crate, a stun) without the rig
		-- floating off its own soles.
		local s = entry.legSpan[name]
		if s ~= nil then
			local t2 = hip + knee
			local t3 = t2 + ankle
			local y = s[1] * math.cos(hip) - s[2] * math.sin(hip)
				+ s[3] * math.cos(t2) - s[4] * math.sin(t2)
				+ s[5] * math.cos(t3) - s[6] * math.sin(t3)
			footRise = math.min(footRise, y - (s[1] + s[3] + s[5]))
		end
		return hip, knee, ankle
	end
	local hipL, kneeL, ankleL = legChain("LegL", phi + math.pi)
	local hipR, kneeR, ankleR = legChain("LegR", phi)
	if footRise < math.huge then
		hop -= footRise
	end

	-- ---- bank into the turn -------------------------------------------------
	-- Turn rate has to be differentiated from the heading we are handed, and a
	-- finite difference over a nearly-zero delta is noise, so it is normalised
	-- against 9 rad/s (a hard corner), clamped, and then smoothed — the raw
	-- value is the input to a body roll and a spike in it is a chef snapping
	-- sideways for one frame.
	--
	-- SIGN. The rig faces model +Z and is yawed by (-heading + pi/2), so a
	-- point on its right is model -X; a positive roll about model Z tips the
	-- head toward -X, i.e. to the chef's right. Differentiating the yaw shows
	-- that rising heading swings the facing toward that same right side. So
	-- leaning INTO the turn — which is the whole point of putting a cat on
	-- skates — is a positive roll on a positive turn rate.
	local rawTurn = 0
	if entry.lastHeading ~= nil then
		local d = (pose.heading - entry.lastHeading + math.pi) % (2 * math.pi) - math.pi
		rawTurn = math.clamp(d / dt / 9, -1, 1)
	end
	entry.lastHeading = pose.heading
	entry.turn += (rawTurn - entry.turn) * math.min(1, dt * 10)
	local bank = if stunned then 0 else math.clamp(entry.turn * gait.bank * moveBlend, -BANK_LIMIT, BANK_LIMIT)

	local base = CFrame.new(pose.x * SCALE, 0, pose.y * SCALE) * CFrame.Angles(0, -pose.heading + math.pi / 2, 0)
	-- the roll is taken about the rig origin, which is the sole plane: a skater
	-- carves about his wheels, not about his hips
	local baseCF = base * CFrame.new(0, hop, 0) * CFrame.Angles(wobble, 0, rock + bank)

	local model = entry.model :: Model
	if entry.isRig and #entry.animParts > 0 then
		-- ---- group poses ---------------------------------------------------
		-- skaters scissor gently and crouch; walkers swing
		local armAmp = gait.arm * moveBlend * (1 - carryBlend)
		local armSwing = -stepSin * armAmp
		local torsoPitch = (if skating then 0.2 else 0.1) * moveBlend
		local torsoYaw = math.sin(entry.phase * math.pi * 2) * 0.045 * moveBlend
		local flail = if stunned then 0.9 else 0

		local armPitchL = armSwing - carryBlend * 1.2
		local armPitchR = -armSwing - carryBlend * 1.2
		if working then
			-- committed chop/wash: right arm hammers, left braces
			armPitchR = -0.85 + math.sin(self.time * 12) * 0.55
			armPitchL = -0.45
		end

		local J = entry.joints
		local pose_: { [string]: CFrame } = {}
		local kneePose: { [string]: CFrame } = {}
		local anklePose: { [string]: CFrame } = {}
		local function set(name: string, rx: number, ry: number, rz: number)
			local j = J[name]
			if j ~= nil then
				pose_[name] = around(j, rx, ry, rz)
			end
		end

		-- the three-segment leg, solved above (the body height depends on it)
		local function setLeg(name: string, hip: number, knee: number, ankle: number)
			set(name, hip, 0, 0)
			local k = entry.kneeAt[name]
			if k ~= nil then
				kneePose[name] = around(k, knee, 0, 0)
			end
			local a = entry.ankleAt[name]
			if a ~= nil then
				anklePose[name] = around(a, ankle, 0, 0)
			end
		end
		setLeg("LegL", hipL, kneeL, ankleL)
		setLeg("LegR", hipR, kneeR, ankleR)
		set("ArmL", armPitchL, 0, -flail)
		set("ArmR", armPitchR, 0, flail)
		set("Torso", torsoPitch, torsoYaw, 0)
		local headPitch = -torsoPitch * 0.6 + (if stunned then math.sin(self.time * 20) * 0.15 else 0)
		set("Head", headPitch, 0, 0)
		set("BuiltinHat", headPitch, 0, 0)
		set("Tail", 0, math.sin(entry.phase * math.pi - 1.1) * 0.45 * moveBlend + math.sin(self.time * 1.7) * 0.08, 0)
		set(
			"Ears",
			math.abs(stepSin) * 0.22 * moveBlend + (if stunned then math.sin(self.time * 28) * 0.3 else 0),
			0,
			0
		)

		-- ---- mouth ---------------------------------------------------------
		-- Two readable states, shut and open-on-effort, because at the size a
		-- chef renders on a phone a mouth is a shape, not an expression.
		-- Effort is chopping, hauling, sprinting or being knocked over — i.e.
		-- everything a chef is visibly doing when anyone is looking at it.
		local mouthWant
		if stunned then
			mouthWant = 1
		elseif working then
			mouthWant = 0.55 + 0.45 * math.sin(self.time * 16)
		elseif carryBlend > 0.5 then
			mouthWant = 0.42 + 0.2 * math.sin(phi * 2) * moveBlend
		elseif moveBlend > 0.45 then
			mouthWant = 0.3 + 0.25 * moveBlend
		else
			mouthWant = math.clamp(pose.effort or 0, 0, 1) * 0.5
		end
		entry.mouthOpen += (mouthWant - entry.mouthOpen) * math.min(1, dt * 11)
		local mouthPose: CFrame? = nil
		local pivot = entry.mouthPivot
		if pivot ~= nil then
			mouthPose = around(pivot, math.clamp(entry.mouthOpen, 0, 1) * entry.mouthAngle, 0, 0)
		end

		-- ---- blink ---------------------------------------------------------
		-- 0.11s shut, 2.6-5.2s apart. Driven by SIZE rather than a pose because
		-- the rigs have no lids — the eye squashes to a slit, which is what a
		-- toon blink is anyway. Writes only cross the property boundary when
		-- the lid actually moves (about 12 frames per chef per blink), not once
		-- per part per frame.
		entry.blinkIn -= dt
		if entry.blinkFor > 0 then
			entry.blinkFor -= dt
		elseif entry.blinkIn <= 0 then
			entry.blinkFor = 0.11
			entry.blinkIn = 2.6 + math.random() * 2.6
		end
		local lid = if entry.blinkFor > 0
			then math.min(1, 0.12 + 0.88 * math.abs(entry.blinkFor - 0.055) / 0.055)
			else 1
		if math.abs(lid - entry.lid) > 0.02 then
			entry.lid = lid
			for i, part in entry.eyeParts do
				local s = entry.eyeSize[i]
				part.Size = Vector3.new(s.X, s.Y * lid, s.Z)
			end
		end

		-- ---- compose + commit ---------------------------------------------
		local cframes = entry.animCFrames
		for i, bind in entry.animBind do
			local group = entry.animGroup[i]
			local cf = baseCF
			local t = pose_[group]
			if t ~= nil then
				cf = cf * t
			end
			-- below the hip: fold in the knee, then the ankle
			local seg = entry.animSeg[i]
			if seg > 0 then
				local k = kneePose[group]
				if k ~= nil then
					cf = cf * k
				end
				if seg > 1 then
					local a = anklePose[group]
					if a ~= nil then
						cf = cf * a
					end
				end
			elseif mouthPose ~= nil and entry.animMouth[i] then
				cf = cf * mouthPose
			end
			cframes[i] = cf * bind
		end
		self.commit(entry.animParts, cframes)
	else
		local body = model:FindFirstChild("Body") :: Part?
		local head = model:FindFirstChild("Head") :: Part?
		if body ~= nil then
			body.CFrame = baseCF * CFrame.new(0, CHEF_HEIGHT * 0.33, 0) * CFrame.Angles(0, 0, math.pi / 2)
		end
		if head ~= nil then
			head.CFrame = baseCF * CFrame.new(0, CHEF_HEIGHT * 0.72, 0)
		end
	end

	-- ---- hat ---------------------------------------------------------------
	if hat ~= entry.hatId then
		entry.hatId = hat
		entry.hatFit = if hat ~= nil then HatFits.resolve(skin, hat) else nil
		-- a cosmetic hat replaces the species' built-in one, and (per fit
		-- policy) can also retire the ears it would intersect
		for _, p in entry.builtinHatParts do
			p.Transparency = if hat ~= nil then 1 else 0
		end
		local hideEars = entry.hatFit ~= nil and entry.hatFit.hideEars
		for _, p in entry.earParts do
			p.Transparency = if hideEars then 1 else 0
		end
		if entry.hatModel ~= nil then
			entry.hatModel:Destroy()
			entry.hatModel = nil
		end
		local hatModel = Hats.build(hat)
		if hatModel ~= nil then
			pcall(function()
				(hatModel :: any):ScaleTo(entry.hatScale * (entry.hatFit and entry.hatFit.scale or 1))
			end)
			hatModel.Parent = model
		end
		entry.hatModel = hatModel
	end
	if entry.hatModel ~= nil and entry.hatFit ~= nil then
		local headPose = CFrame.new()
		if entry.isRig then
			-- ride the head group's transform so the hat bobs with the head
			local j = entry.joints.Head
			if j ~= nil then
				headPose = around(j, -0.1 * moveBlend, 0, 0)
			end
		end
		entry.hatModel:PivotTo(baseCF * headPose * CFrame.new(entry.headAttach + entry.hatFit.offset) * entry.hatFit.tilt)
	end

	-- ---- nametag -----------------------------------------------------------
	if label ~= nil and entry.nameGui == nil then
		local anchor = entry.headAnchor or model.PrimaryPart
		if anchor ~= nil then
			local bb = Instance.new("BillboardGui")
			bb.Size = UDim2.fromOffset(120, 22)
			bb.StudsOffset = Vector3.new(0, 2.6, 0)
			bb.AlwaysOnTop = true
			bb.Parent = anchor
			local text = Instance.new("TextLabel")
			text.Size = UDim2.fromScale(1, 1)
			text.BackgroundTransparency = 1
			text.TextColor3 = Color3.fromRGB(255, 244, 221)
			text.TextStrokeTransparency = 0.4
			text.TextSize = 14
			text.Font = Enum.Font.GothamBold
			text.Text = label
			text.Parent = bb
			entry.nameGui = bb
		end
	elseif label == nil and entry.nameGui ~= nil then
		entry.nameGui:Destroy()
		entry.nameGui = nil
	end

	-- ---- carried item ------------------------------------------------------
	local key = ItemViz.key(carrying)
	if key ~= entry.carryKey then
		entry.carryKey = key
		if entry.carryModel ~= nil then
			entry.carryModel:Destroy()
			entry.carryModel = nil
		end
		local item = ItemViz.build(carrying)
		if item ~= nil then
			item.Parent = entry.model
		end
		entry.carryModel = item
	end
	if entry.carryModel ~= nil then
		local a = entry.carryAnchor or Vector3.new(0, entry.rigHeight * 0.52, entry.rigHeight * 0.28)
		entry.carryModel:PivotTo(baseCF * CFrame.new(a))
	end
end

function ChefVisuals:remove(id: number)
	local entry = self.chefs[id]
	if entry ~= nil then
		entry.model:Destroy()
		self.chefs[id] = nil
	end
end

return ChefVisuals
