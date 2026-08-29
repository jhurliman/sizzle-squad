--!strict
-- Client composition root: local movement (real movePhase), interpolated
-- remotes, HUD, tickets, focus highlight, emote pings, phase overlays.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local shared = require(ReplicatedStorage:WaitForChild("Shared")) :: any
local gameShared = ReplicatedStorage:WaitForChild("Game")
local Net = require(gameShared:WaitForChild("Net")) :: any
local Catalog = require(gameShared:WaitForChild("Catalog")) :: any
local MonetizationDefs = require(gameShared:WaitForChild("Monetization")) :: any
local ClientState = require(script.Parent.ClientState) :: any
local Input = require(script.Parent.Input) :: any
local ChefVisuals = require(script.Parent.ChefVisuals) :: any
local CameraRig = require(script.Parent.CameraRig) :: any
local Hud = require(script.Parent.Hud) :: any
local FirstShift = require(script.Parent.FirstShift) :: any
local Sfx = require(script.Parent.Sfx) :: any
local StationVisuals = require(script.Parent.StationVisuals) :: any
local Vfx = require(script.Parent.Vfx) :: any
local Music = require(script.Parent.Music) :: any
local Menu = require(script.Parent.Menu) :: any
local ItemViz = require(script.Parent.ItemViz) :: any
local Results = require(script.Parent.Results) :: any
local BinDress = require(script.Parent.BinDress) :: any

local SCALE = 5
local Config = require(gameShared:WaitForChild("Config")) :: any
local remotes = Net.client(ReplicatedStorage)
local state = ClientState.new(shared, Net)
local visualsFolder = Instance.new("Folder")
visualsFolder.Name = "Chefs"
visualsFolder.Parent = Workspace
local visuals = ChefVisuals.new(visualsFolder)
local stationViz = StationVisuals.new(visualsFolder)
local cameraRig = CameraRig.new(Workspace.CurrentCamera :: Camera)
local hud = Hud.new(Catalog)
-- After the HUD: the touch thumbstick lives in its ScreenGui.
local input = Input.new(hud.gui)
local firstShift = FirstShift.new(hud.gui)
local results = Results.new(hud.gui)
local sfx = Sfx.new()
-- A phone has no output window, so a broken sound bank has to announce itself
-- where the player (and the person debugging it) can actually see it.
sfx.onFailure = function(msg: string)
	task.defer(function()
		pcall(function()
			hud:toast(`⚠ Audio: {msg}`)
		end)
	end)
end
-- Beats need a sound or the ceremony reads as a screenshot: each star and the
-- level-up borrow the serve chime's combo tiers.
results.onStar = function(n)
	sfx:handle({ t = "serve", combo = n * 3 })
end
results.onLevelUp = function()
	sfx:handle({ t = "serve", combo = 8 })
end

local vfxFolder = Instance.new("Folder")
vfxFolder.Name = "Vfx"
vfxFolder.Parent = Workspace
local vfx = Vfx.new(vfxFolder, function(n)
	cameraRig:addShake(n)
end)
-- music is non-positional: parent to SoundService so it plays 2D everywhere
local music = Music.new(game:GetService("SoundService"))

-- ---------------------------------------------------------- station lookup

local stationModels: { [number]: Model } = {}
-- Stations with no model of their own get a drawn pad instead of an adornee.
local cellPads: { [number]: BasePart } = {}
local serveAnchors: { Vector3 } = {}

-- THREE STATIONS HAVE NO MODEL OF THEIR OWN, AND A BENCH IS THREE CELLS WIDE.
--
-- The sim builds 23 stations from KITCHEN_MAP; assets/kitchen.rbxm ships 20
-- under Stations. Counter_2_4, Counter_12_4 and Counter_13_7 are real,
-- interactable counters whose geometry lives in the BENCH run instead.
--
-- Adorning the bench worked but said far too much: Bench_2_4 spans x=5.0-20.5,
-- which is cells 1, 2 and 3, so focusing one counter lit up the whole worktop.
-- Reported from the first multiplayer playtest. The 20 stations that DO have
-- their own model are already cell-sized, which is why the serve windows always
-- looked right and these never did.
--
-- So build one box per station, clipped to that station's cell, matching the
-- bench's own height and depth. Measured off the bench at runtime rather than
-- hardcoded, because the benches sit at different heights around the room.
--
-- Transparency is 0.99, NOT 1: Highlight does not render on a part that is
-- fully transparent, and 0.99 is invisible in practice while still being drawn.
-- One part per missing station, three in total.
local proxyFolder: Folder? = nil

local function benchBounds(bench: Instance): (Vector3?, Vector3?)
	local lo, hi
	for _, part in bench:GetDescendants() do
		if part:IsA("BasePart") then
			local p, sz = part.Position, part.Size
			local a = p - sz / 2
			local b = p + sz / 2
			lo = if lo == nil then a else Vector3.new(math.min(lo.X, a.X), math.min(lo.Y, a.Y), math.min(lo.Z, a.Z))
			hi = if hi == nil then b else Vector3.new(math.max(hi.X, b.X), math.max(hi.Y, b.Y), math.max(hi.Z, b.Z))
		end
	end
	return lo, hi
end

--- The bench standing over this station's cell, if any.
local function benchFor(root: Instance, st: any): Instance?
	local benches = root:FindFirstChild("Benches")
	if benches == nil then
		return nil
	end
	local exact = benches:FindFirstChild(`Bench_{st.cell.x}_{st.cell.y}`)
	if exact ~= nil then
		return exact
	end
	local wx, wz = (st.cell.x + 0.5) * SCALE, (st.cell.y + 0.5) * SCALE
	for _, bench in benches:GetChildren() do
		for _, part in bench:GetDescendants() do
			if part:IsA("BasePart") then
				local p, sz = part.Position, part.Size
				if math.abs(p.X - wx) <= sz.X / 2 + 0.1 and math.abs(p.Z - wz) <= sz.Z / 2 + 0.1 and p.Y > 0.6 then
					return bench
				end
			end
		end
	end
	return nil
end

local function cellPad(root: Instance, st: any): BasePart?
	local bench = benchFor(root, st)
	if bench == nil then
		return nil
	end
	local lo, hi = benchBounds(bench)
	if lo == nil or hi == nil then
		return nil
	end
	-- Clip the bench's own extent to this cell, on both floor axes.
	local x0 = math.max(lo.X, st.cell.x * SCALE)
	local x1 = math.min(hi.X, (st.cell.x + 1) * SCALE)
	local z0 = math.max(lo.Z, st.cell.y * SCALE)
	local z1 = math.min(hi.Z, (st.cell.y + 1) * SCALE)
	if x1 - x0 < 0.5 or z1 - z0 < 0.5 then
		return nil
	end
	if proxyFolder == nil then
		local f = Instance.new("Folder")
		f.Name = "SizzleCellPads"
		f.Parent = Workspace
		proxyFolder = f
	end
	-- A PAD YOU CAN SEE, NOT A BOX YOU HOPE HIGHLIGHT WILL FIND.
	--
	-- Two attempts at this adorned an invisible proxy with a Highlight and both
	-- were reported as still not highlighting. The evidence is now conclusive:
	-- a plate sitting on the same counter DOES highlight (that adorns the
	-- plate's real model), while the empty counter next to it does not. So
	-- Highlight will not draw on a part nobody can see, at 0.99 any more than
	-- at 1.
	--
	-- Draw the thing instead. A thin warm quad laid on the countertop at that
	-- cell is what the player asked for in the first place -- "a square on the
	-- countertop" -- and it cannot fail to render, because it is just geometry.
	local pad = Instance.new("Part")
	pad.Name = `Pad_{st.cell.x}_{st.cell.y}`
	pad.Anchored = true
	pad.CanCollide = false
	pad.CanQuery = false
	pad.CanTouch = false
	pad.CastShadow = false
	pad.Material = Enum.Material.Neon
	pad.Color = Color3.fromRGB(255, 214, 120)
	pad.Transparency = 1 -- hidden until focused
	pad.Size = Vector3.new(x1 - x0 - 0.3, 0.12, z1 - z0 - 0.3)
	pad.CFrame = CFrame.new((x0 + x1) / 2, hi.Y + 0.07, (z0 + z1) / 2)
	pad.Parent = proxyFolder
	return pad
end

local function indexStations(stations: { any })
	-- THE STATIONS FOLDER IS ONE LEVEL UP FROM WHERE THIS LOOKED.
	--
	-- The capture pipeline writes a model named "SizzleSquadKitchen", and in
	-- the standalone roblox/sizzle-squad.rbxl that is a real level in the tree.
	-- But default.project.json mounts assets/kitchen.rbxm AT the "Kitchen" key,
	-- and Rojo RENAMES a single-root rbxm to its key -- so in the built place
	-- the path is Workspace.Kitchen.Stations and the SizzleSquadKitchen level
	-- does not exist at all.
	--
	-- The old lookup therefore always resolved to nil, stationModels stayed
	-- empty, and both Highlights silently never found an adornee: no focus
	-- highlight on the targeted station, and no glow on the crate the First
	-- Shift coach was telling players to look at. Nothing errored, because
	-- every consumer treats a missing model as "not highlighted".
	--
	-- Accept both shapes, and say so loudly if neither resolves.
	local kitchen = Workspace:FindFirstChild("Kitchen")
	local root = kitchen
	if kitchen ~= nil then
		local nested = kitchen:FindFirstChild("SizzleSquadKitchen")
		if nested ~= nil then
			root = nested
		end
	end
	local folder = root and root:FindFirstChild("Stations")
	if folder ~= nil then
		local bin = folder:FindFirstChild("Bin_13_4")
		if bin ~= nil then
			BinDress.apply(bin)
		end
	end
	for _, st in stations do
		local kindCap = st.kind:sub(1, 1):upper() .. st.kind:sub(2)
		if folder ~= nil then
			local m = folder:FindFirstChild(`{kindCap}_{st.cell.x}_{st.cell.y}`)
			if m ~= nil and m:IsA("Model") then
				stationModels[st.id] = m
			else
				local pad = cellPad(root, st)
				if pad ~= nil then
					cellPads[st.id] = pad
				else
					warn(`[sizzle] station {kindCap}_{st.cell.x}_{st.cell.y} has no model and no bench under it — it cannot highlight`)
				end
			end
		end
		if st.kind == "serve" then
			table.insert(serveAnchors, Vector3.new((st.cell.x + 0.5) * SCALE, 5.4 * SCALE, st.cell.y * SCALE))
		end
	end
end

-- THE KITCHEN MAY NOT HAVE REPLICATED YET WHEN THE SNAPSHOT ARRIVES.
--
-- Snapshot is sent on join and on reseat -- it is not periodic -- so the
-- original "index once, on the first snapshot" was a race the client loses
-- whenever Workspace.Kitchen is still streaming in. It loses it far more often
-- on a phone, which is exactly where the focus highlight was reported missing.
-- Losing it left stationModels empty for the whole session with nothing
-- erroring, because every consumer treats a missing model as "not
-- highlighted": no focus glow, no coach glow, no station progress bars.
--
-- So keep the last snapshot's station list and retry until it takes.
local pendingStations: { any }? = nil
local nextIndexTry = 0
local indexWarned = false

local function ensureStations(clock: number)
	if next(stationModels) ~= nil or pendingStations == nil or clock < nextIndexTry then
		return
	end
	nextIndexTry = clock + 0.5
	indexStations(pendingStations)
	if next(stationModels) == nil and not indexWarned and clock > 15 then
		indexWarned = true
		warn("[sizzle] no station models after 15s — focus highlight, coach glow and station progress are dead")
	end
end

-- The front-end. It owns every meta surface (wardrobe/shop/career/ranks), the
-- ready bar, the join card and the emote row; this file just forwards state.
local menu = Menu.new({
	catalog = Catalog,
	monetization = MonetizationDefs,
	remotes = remotes,
	input = input,
	hudGui = hud.gui,
	onToast = function(text)
		hud:toast(text)
	end,
	onShopAction = function(action)
		remotes.ShopAction:FireServer(action)
	end,
	onPickSpecies = function(species)
		remotes.PickSpecies:FireServer(species)
	end,
})

-- The coach's target, distinct from the focus glow: focus is "this is what
-- the button will act on right now", coach is "this is where you should be
-- going next". Two different questions, so two different colours.
local coachGlow = Instance.new("Highlight")
coachGlow.FillTransparency = 0.62
coachGlow.FillColor = Color3.fromRGB(120, 220, 255)
coachGlow.OutlineColor = Color3.fromRGB(210, 245, 255)
coachGlow.Enabled = false
coachGlow.Parent = Workspace

local highlight = Instance.new("Highlight")
highlight.FillTransparency = 0.75
highlight.FillColor = Color3.fromRGB(255, 214, 120)
highlight.OutlineColor = Color3.fromRGB(255, 234, 180)
highlight.Enabled = false
highlight.Parent = Workspace

local function speechBubble(chefId: number, text: string)
	local entry = visuals.chefs[chefId]
	if entry == nil then
		return
	end
	local head: any = entry.model:FindFirstChild("Head") or entry.model.PrimaryPart
	if head ~= nil and head:IsA("Model") then
		head = head:FindFirstChildWhichIsA("BasePart")
	end
	if head == nil then
		return
	end
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(110, 34)
	bb.StudsOffset = Vector3.new(0, 3, 0)
	bb.AlwaysOnTop = true
	bb.Parent = head
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = Color3.fromRGB(255, 248, 235)
	label.TextColor3 = Color3.fromRGB(58, 32, 19)
	label.TextSize = 18
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.Parent = bb
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = label
	task.delay(2, function()
		bb:Destroy()
	end)
end

-- ---------------------------------------------------------------- remotes

remotes.ChefAssign.OnClientEvent:Connect(function(msg)
	state:assign(msg)
end)

remotes.Snapshot.OnClientEvent:Connect(function(snap)
	state:applySnapshot(snap)
	pendingStations = snap.stations
	if next(stationModels) == nil then
		indexStations(snap.stations)
	end
end)

remotes.Transforms.OnClientEvent:Connect(function(b)
	if typeof(b) == "buffer" then
		state:applyTransforms(b)
	end
end)

remotes.StationDeltas.OnClientEvent:Connect(function(deltas)
	state:applyStationDeltas(deltas)
end)

remotes.CarryDeltas.OnClientEvent:Connect(function(carries)
	for _, c in carries do
		state:setCarrying(c.chefId, c.carrying)
	end
end)

remotes.EquipDeltas.OnClientEvent:Connect(function(msg)
	local list = msg.chefs or msg
	-- Which species are spoken for by other seated players, so the wardrobe
	-- can say so rather than letting a pick silently not take effect.
	if msg.taken ~= nil then
		menu:setTaken(msg.taken)
	end
	table.clear(state.hats)
	table.clear(state.names)
	table.clear(state.palettes)
	for _, e in list do
		state.hats[e.chefId] = e.hat
		state.names[e.chefId] = e.name
		state.palettes[e.chefId] = e.palette
		if e.skin ~= nil then
			state.skins[e.chefId] = e.skin
		end
	end
	-- Team-visible crockery: one elected item per slot for the whole kitchen.
	ItemViz.setKitchen(Catalog, msg.kitchen)
	-- and the racks the plates come off, or the tint reads as a bug
	stationViz:setPlateTint(Catalog, msg.kitchen)
	if state.myChefId ~= nil then
		menu:setEquipped({
			skin = state.skins[state.myChefId],
			hat = state.hats[state.myChefId],
			palette = state.palettes[state.myChefId],
		})
	end
end)

remotes.OrdersDelta.OnClientEvent:Connect(function(msg)
	state.orders = msg.orders
end)

remotes.ScoreDelta.OnClientEvent:Connect(function(score)
	state:applyScore(score)
	hud:updateScore(score)
end)

local lastPhase = ""
remotes.RoundPhase.OnClientEvent:Connect(function(phase)
	menu:setBots(phase.botFill == true, phase.botFillPending ~= false, phase.phase)
	if phase.phase == "round" and lastPhase ~= "round" then
		state.simTime = 0 -- fresh round: restart the local clock
	end
	state.phase = phase
	hud:updatePhase(phase, phase.results and phase.results.cards)
	if phase.phase == "results" and lastPhase ~= "results" and phase.results ~= nil then
		results:show(phase.results, phase.results.cards)
	elseif phase.phase ~= "results" then
		results:hide()
	end
	-- The one call site for the phase gate.
	menu:setPhase(phase, state.myChefId == nil)
	-- Photo moment: a 3-star finish gets a celebratory push-in on the pass.
	if phase.phase == "results" and lastPhase ~= "results" and phase.results ~= nil and phase.results.stars >= 3 then
		local camera = Workspace.CurrentCamera :: Camera
		local focus = Vector3.new(7.5 * SCALE, 1.2 * SCALE, 1.5 * SCALE)
		local from = camera.CFrame
		local to = CFrame.lookAt(focus + Vector3.new(0, 4 * SCALE, 7 * SCALE), focus)
		local t0 = os.clock()
		local conn
		conn = RunService.RenderStepped:Connect(function()
			local f = math.clamp((os.clock() - t0) / 1.2, 0, 1)
			camera.CFrame = from:Lerp(to, 1 - (1 - f) ^ 3)
			if os.clock() - t0 > 4 then
				conn:Disconnect()
			end
		end)
	end
	lastPhase = phase.phase
end)

remotes.Leaderboards.OnClientEvent:Connect(function(boards)
	menu:setLeaderboards(boards)
end)

remotes.Progress.OnClientEvent:Connect(function(progress)
	firstShift:setEligible(progress)
	menu:setProgress(progress)
	results:setProgress(progress)
	if progress.award ~= nil then
		results:setAward(progress.award)
	end
	-- Serve-bell cosmetic is local audio, so it reads the owner's own equip
	-- rather than the elected kitchen set.
	sfx:setKitchen(Catalog, progress.equipped)
end)

remotes.Correction.OnClientEvent:Connect(function(msg)
	state:applyCorrection(msg)
end)

remotes.Emote.OnClientEvent:Connect(function(msg)
	-- The wire carries an id; the glyph is resolved locally so the server
	-- never rebroadcasts player-authored text.
	local glyph = Catalog.glyphFor(msg.emote)
	if glyph ~= nil then
		speechBubble(msg.chefId, glyph)
	end
end)

remotes.SimEvents.OnClientEvent:Connect(function(events)
	for _, ev in events do
		sfx:handle(ev)
		vfx:handle(ev)
		-- music steps aside for the events that decide the run
		if ev.t == "serve" then
			music:sidechain(0.55)
		elseif ev.t == "fireStart" or ev.t == "orderExpired" then
			music:sidechain(0.45)
		elseif ev.t == "serveWrong" then
			music:sidechain(0.35)
		end
		if ev.t == "bump" then
			state:applyBump(ev)
		elseif ev.t == "serve" then
			hud:worldLabel(
				Vector3.new(ev.at.x * SCALE, 1.2 * SCALE, ev.at.y * SCALE),
				`+{ev.value}`,
				Color3.fromRGB(255, 224, 102)
			)
			if (ev.combo or 1) > 1 then
				hud:worldLabel(
					Vector3.new(ev.at.x * SCALE, 1.6 * SCALE, ev.at.y * SCALE),
					`{ev.combo}x`,
					Color3.fromRGB(255, 170, 90)
				)
			end
		elseif ev.t == "serveWrong" then
			hud:worldLabel(Vector3.new(ev.at.x * SCALE, 1.2 * SCALE, ev.at.y * SCALE), "X", Color3.fromRGB(230, 80, 60))
		elseif ev.t == "burn" then
			hud:worldLabel(Vector3.new(ev.at.x * SCALE, 1.5 * SCALE, ev.at.y * SCALE), "Burnt!", Color3.fromRGB(230, 120, 70))
		elseif ev.t == "fireStart" then
			-- find the nearest station model and set it alight briefly
			local bestModel, bestD = nil, math.huge
			for id, m in stationModels do
				local p = m:GetPivot().Position
				local d = (p - Vector3.new(ev.at.x * SCALE, p.Y, ev.at.y * SCALE)).Magnitude
				if d < bestD then
					bestD, bestModel = d, m
				end
			end
			if bestModel ~= nil then
				local anyPart = bestModel:FindFirstChildWhichIsA("BasePart", true)
				if anyPart ~= nil then
					local fire = Instance.new("Fire")
					fire.Size = 6
					fire.Parent = anyPart
					task.delay(4, function()
						fire:Destroy()
					end)
				end
			end
		elseif ev.t == "grabMiss" and ev.chef == state.myChefId then
			hud:worldLabel(Vector3.new(ev.at.x * SCALE, 1 * SCALE, ev.at.y * SCALE), "…", Color3.fromRGB(200, 190, 170))
		end
	end
end)

-- --------------------------------------------------------------- main loop

local acc = 0
local sendAcc = 0
local seq = 0

RunService.RenderStepped:Connect(function(dt)
	state.clock += dt
	menu:step(dt)
	results:step(dt)
	cameraRig:update(dt)
	vfx:tick(dt)
	state:advanceClock(dt, state.phase.phase == "round")
	-- heat mirrors the sim's ramp (min(1, time/240)); tension is 1 - patience
	music:update(
		dt,
		math.min(1, state.simTime / 240),
		state.score.patience or 1,
		state.phase.phase == "round"
	)

	-- fixed-step the own-chef mirror
	acc = math.min(acc + dt, 0.25)
	local snapshot = { move = input:move(), grabPressed = false, useHeld = input.useHeld }
	while acc >= shared.SIM_DT do
		acc -= shared.SIM_DT
		state:stepOwn(snapshot, shared.SIM_DT)
	end

	-- action edge goes to the server immediately (reliable)
	if input:takeGrab() then
		remotes.GrabEdge:FireServer()
	end

	-- 30Hz move stream
	sendAcc += dt
	if state.mirror ~= nil and sendAcc >= 1 / 30 then
		sendAcc = 0
		seq += 1
		remotes.MoveStream:FireServer(
			Net.packMove(
				seq,
				state.mirror.pos.x,
				state.mirror.pos.y,
				state.mirror.vel.x,
				state.mirror.vel.y,
				state.mirror.heading,
				input.useHeld
			)
		)
	end

	-- visuals: own chef from the mirror, remotes interpolated
	if state.mirror ~= nil and state.myChefId ~= nil then
		local m = state.mirror
		local speed = math.sqrt(m.vel.x ^ 2 + m.vel.y ^ 2)
		visuals:update(state.myChefId, state.skins[state.myChefId] or "bramble", {
			x = m.pos.x + state.visOffset.x,
			y = m.pos.y + state.visOffset.y,
			heading = m.heading,
			effort = math.clamp(speed / 6.2, 0, 1),
			stun = m.stun,
		}, state.flags[state.myChefId] or 0, dt, state.carrying[state.myChefId], state.hats[state.myChefId], nil, state.palettes[state.myChefId])
	end
	hud:setSpectating(state.myChefId == nil and state.phase.phase == "round")
	for id, skin in state.skins do
		if id ~= state.myChefId then
			local pose = state:remotePose(id)
			if pose ~= nil and state.clock - (state.lastSeen[id] or -10) < 2 then
				visuals:update(id, skin, pose, state.flags[id] or 0, dt, state.carrying[id], state.hats[id], state.names[id], state.palettes[id])
			elseif visuals.chefs[id] ~= nil then
				-- parked / departed chefs stop streaming: clear their body
				visuals:remove(id)
			end
		end
	end

	-- station contents + progress bars
	ensureStations(state.clock)
	stationViz:update(state.stations, stationModels)
	stationViz:updateDishPile(state.stations, state.dirtyPlates)

	-- focus highlight + verb chip (local planGrab over mirrored state)
	local focusId, action = state:focusPrompt()
	input:setVerb(action)
	-- HIGHLIGHT WHAT THE BUTTON WILL ACT ON, NOT WHAT THE GATE PICKED.
	--
	-- findFocus deliberately still returns a station when the press would do
	-- nothing -- its honesty term ranks dead stations DOWN, it does not drop
	-- them -- because the prompt needs something to describe. Adorning on
	-- `focusId ~= nil` therefore lit up stations that would refuse the press:
	-- reported from play as a plate rack glowing while holding bacon, which it
	-- will not accept. The verb is the thing that knows.
	-- WHAT IS ON THE BENCH BEATS THE BENCH. A plate sitting on a counter is
	-- what the press acts on, so outline the plate; the furniture underneath is
	-- not the subject, and on a shared worktop it is not even specific.
	local model = nil
	local pad = nil
	if action ~= "none" and focusId ~= nil then
		-- What is ON the bench beats the bench, and a real model beats a pad:
		-- a plate has geometry worth outlining, an empty counter cell does not.
		model = stationViz:itemModel(focusId)
		if model == nil then
			model = stationModels[focusId]
			if model == nil then
				pad = cellPads[focusId]
			end
		end
	end
	if model ~= nil then
		highlight.Adornee = model
		highlight.Enabled = true
	else
		highlight.Enabled = false
	end
	for id, p in cellPads do
		p.Transparency = if p == pad then 0.45 else 1
	end

	-- HUD. Orders exist only during a shift.
	if state.phase.phase == "round" then
		hud:updateOrders(state.orders)
	end
	local coachId = firstShift:update(state, (state.myChefId ~= nil and state.flags[state.myChefId]) or 0)
	local coachModel = coachId ~= nil and stationModels[coachId] or nil
	-- Never double-glow: if the coach is pointing at what you are already
	-- focused on, the focus highlight says it better.
	if coachModel ~= nil and coachId ~= focusId then
		coachGlow.Adornee = coachModel
		coachGlow.Enabled = true
		-- A slow pulse reads as "go here" where a steady glow reads as scenery.
		coachGlow.FillTransparency = 0.52 + math.sin(state.clock * 4) * 0.16
	else
		coachGlow.Enabled = false
	end
	-- The timer chip is hidden outside a round (Hud:updatePhase), so there is
	-- nothing to show between shifts.
	if state.phase.phase == "round" then
		hud:updateTimer(shared.TUNING.roundSeconds - state.simTime)
	end
end)

print("[sizzle] client up")
