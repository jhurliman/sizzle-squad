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
local ClientState = require(script.Parent.ClientState) :: any
local Input = require(script.Parent.Input) :: any
local ChefVisuals = require(script.Parent.ChefVisuals) :: any
local CameraRig = require(script.Parent.CameraRig) :: any
local Hud = require(script.Parent.Hud) :: any
local FirstShift = require(script.Parent.FirstShift) :: any
local Sfx = require(script.Parent.Sfx) :: any

local SCALE = 5
local remotes = Net.client(ReplicatedStorage)
local state = ClientState.new(shared, Net)
local input = Input.new()
local visualsFolder = Instance.new("Folder")
visualsFolder.Name = "Chefs"
visualsFolder.Parent = Workspace
local visuals = ChefVisuals.new(visualsFolder)
local cameraRig = CameraRig.new(Workspace.CurrentCamera :: Camera)
local hud = Hud.new(Catalog)
local firstShift = FirstShift.new(hud.gui)
local sfx = Sfx.new()

-- Invite friends (intermission) — free private servers + party joins are the
-- other two "play together" paths; this is the in-game nudge.
local inviteButton = Instance.new("TextButton")
inviteButton.Size = UDim2.fromOffset(150, 40)
inviteButton.Position = UDim2.new(0.5, 76, 0.82, 0)
inviteButton.BackgroundColor3 = Color3.fromRGB(70, 130, 200)
inviteButton.TextColor3 = Color3.new(1, 1, 1)
inviteButton.TextSize = 18
inviteButton.Font = Enum.Font.FredokaOne
inviteButton.Text = "INVITE FRIENDS"
inviteButton.Visible = false
inviteButton.Parent = hud.gui
do
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = inviteButton
end
inviteButton.Activated:Connect(function()
	pcall(function()
		local SocialService = game:GetService("SocialService")
		SocialService:PromptGameInvite(Players.LocalPlayer)
	end)
end)

-- Leaderboards panel (intermission)
local boardsButton = Instance.new("TextButton")
boardsButton.Size = UDim2.fromOffset(110, 40)
boardsButton.Position = UDim2.new(0.5, -180, 0.82, 0)
boardsButton.BackgroundColor3 = Color3.fromRGB(160, 120, 60)
boardsButton.TextColor3 = Color3.new(1, 1, 1)
boardsButton.TextSize = 18
boardsButton.Font = Enum.Font.FredokaOne
boardsButton.Text = "RANKS"
boardsButton.Visible = false
boardsButton.Parent = hud.gui
do
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = boardsButton
end
local boardsPanel = Instance.new("TextLabel")
boardsPanel.Size = UDim2.fromOffset(340, 360)
boardsPanel.Position = UDim2.new(0.5, -170, 0.5, -200)
boardsPanel.BackgroundColor3 = Color3.fromRGB(40, 24, 12)
boardsPanel.BackgroundTransparency = 0.05
boardsPanel.TextColor3 = Color3.fromRGB(255, 244, 221)
boardsPanel.TextSize = 15
boardsPanel.Font = Enum.Font.Code
boardsPanel.TextYAlignment = Enum.TextYAlignment.Top
boardsPanel.TextXAlignment = Enum.TextXAlignment.Left
boardsPanel.Text = "No rankings yet — cook something!"
boardsPanel.Visible = false
boardsPanel.Parent = hud.gui
do
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = boardsPanel
end
boardsButton.Activated:Connect(function()
	boardsPanel.Visible = not boardsPanel.Visible
end)

-- ---------------------------------------------------------- station lookup

local stationModels: { [number]: Model } = {}
local serveAnchors: { Vector3 } = {}

local function indexStations(stations: { any })
	local kitchen = Workspace:FindFirstChild("Kitchen")
	local root = kitchen and kitchen:FindFirstChild("SizzleSquadKitchen")
	local folder = root and root:FindFirstChild("Stations")
	for _, st in stations do
		local kindCap = st.kind:sub(1, 1):upper() .. st.kind:sub(2)
		if folder ~= nil then
			local m = folder:FindFirstChild(`{kindCap}_{st.cell.x}_{st.cell.y}`)
			if m ~= nil and m:IsA("Model") then
				stationModels[st.id] = m
			end
		end
		if st.kind == "serve" then
			table.insert(serveAnchors, Vector3.new((st.cell.x + 0.5) * SCALE, 5.4 * SCALE, st.cell.y * SCALE))
		end
	end
end

local highlight = Instance.new("Highlight")
highlight.FillTransparency = 0.75
highlight.FillColor = Color3.fromRGB(255, 214, 120)
highlight.OutlineColor = Color3.fromRGB(255, 234, 180)
highlight.Enabled = false
highlight.Parent = Workspace

-- ------------------------------------------------------------- emote pings

local PINGS = { "Nice!", "Help!", "Fire!", "Order up!" }
do
	local gui = hud.gui
	for i, ping in PINGS do
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.fromOffset(84, 32)
		btn.Position = UDim2.new(0.5, -180 + (i - 1) * 92, 1, -46)
		btn.BackgroundColor3 = Color3.fromRGB(58, 32, 19)
		btn.BackgroundTransparency = 0.25
		btn.TextColor3 = Color3.fromRGB(255, 244, 221)
		btn.TextSize = 16
		btn.Font = Enum.Font.FredokaOne
		btn.Text = ping
		btn.Parent = gui
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 10)
		corner.Parent = btn
		btn.Activated:Connect(function()
			remotes.Emote:FireServer(ping)
		end)
	end
end

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

remotes.OrdersDelta.OnClientEvent:Connect(function(msg)
	state.orders = msg.orders
end)

remotes.ScoreDelta.OnClientEvent:Connect(function(score)
	state.score = score
	hud:updateScore(score)
end)

local lastPhase = ""
remotes.RoundPhase.OnClientEvent:Connect(function(phase)
	state.phase = phase
	hud:updatePhase(phase, phase.results and phase.results.cards)
	inviteButton.Visible = phase.phase == "intermission"
	boardsButton.Visible = phase.phase == "intermission"
	if phase.phase ~= "intermission" then
		boardsPanel.Visible = false
	end
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
	local lines = { "═══ WEEKLY BEST ═══" }
	for _, e in boards.weekly or {} do
		table.insert(lines, string.format("%2d. %-18s %6d", e.rank, e.key, e.value))
	end
	table.insert(lines, "")
	table.insert(lines, "═══ ALL-TIME ═══")
	for _, e in boards.allTime or {} do
		table.insert(lines, string.format("%2d. %-18s %6d", e.rank, e.key, e.value))
	end
	table.insert(lines, "")
	table.insert(lines, "═══ CAREER DISHES ═══")
	for _, e in boards.dishes or {} do
		table.insert(lines, string.format("%2d. %-18s %6d", e.rank, e.key, e.value))
	end
	boardsPanel.Text = table.concat(lines, "\n")
end)

remotes.Progress.OnClientEvent:Connect(function(progress)
	hud:updateProgress(progress)
	firstShift:setEligible(progress)
	hud:updateShop(progress, function(action, id)
		remotes.ShopAction:FireServer({ action = action, id = id })
	end)
end)

remotes.Correction.OnClientEvent:Connect(function(msg)
	if state.mirror ~= nil then
		state.mirror.pos.x, state.mirror.pos.y = msg.x, msg.y
		state.mirror.vel.x, state.mirror.vel.y = 0, 0
	end
end)

remotes.Emote.OnClientEvent:Connect(function(msg)
	speechBubble(msg.chefId, msg.emote)
end)

remotes.SimEvents.OnClientEvent:Connect(function(events)
	for _, ev in events do
		sfx:handle(ev)
		if ev.t == "serve" then
			hud:worldLabel(
				Vector3.new(ev.at.x * SCALE, 1.2 * SCALE, ev.at.y * SCALE),
				`+{ev.value}`,
				Color3.fromRGB(255, 224, 102)
			)
		elseif ev.t == "serveWrong" then
			hud:worldLabel(Vector3.new(ev.at.x * SCALE, 1.2 * SCALE, ev.at.y * SCALE), "✗", Color3.fromRGB(230, 80, 60))
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

hud.readyButton.Activated:Connect(function()
	remotes.ReadyUp:FireServer(true)
	hud.readyButton.Text = "WAITING…"
end)
hud.shopButton.Activated:Connect(function()
	hud.shopPanel.Visible = not hud.shopPanel.Visible
end)

-- --------------------------------------------------------------- main loop

local acc = 0
local sendAcc = 0
local seq = 0

RunService.RenderStepped:Connect(function(dt)
	state.clock += dt
	cameraRig:update()

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
			x = m.pos.x,
			y = m.pos.y,
			heading = m.heading,
			effort = math.clamp(speed / 6.2, 0, 1),
			stun = m.stun,
			speed = speed,
		}, state.flags[state.myChefId] or 0, dt)
	end
	for id, skin in state.skins do
		if id ~= state.myChefId then
			local pose = state:remotePose(id)
			if pose ~= nil then
				pose.speed = math.sqrt((pose.effort or 0)) * 6.2
				visuals:update(id, skin, pose, state.flags[id] or 0, dt)
			end
		end
	end

	-- focus highlight + verb chip (local planGrab over mirrored state)
	local focusId, action = state:focusPrompt()
	input:setVerb(action)
	local model = focusId ~= nil and stationModels[focusId] or nil
	if model ~= nil then
		highlight.Adornee = model
		highlight.Enabled = true
	else
		highlight.Enabled = false
	end

	-- HUD
	hud:updateOrders(state.orders, serveAnchors)
	firstShift:update(state, (state.myChefId ~= nil and state.flags[state.myChefId]) or 0)
	if state.phase.phase == "round" then
		hud:updateTimer(shared.TUNING.roundSeconds - (state.score.time or 0))
	else
		hud:updateTimer(state.phase.timer or 0)
	end
end)

print("[sizzle] client up")
