--!strict
-- HUD: round timer, coins/combo, patience, order tickets (BillboardGuis over
-- the serve counters), focus highlight + verb chip, phase overlays
-- (countdown card / results ceremony / intermission with ready-up + shop),
-- and the emote wheel. Icons are vector/text placeholders until the icon
-- spritesheet is uploaded (Open Cloud — user-gated).

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local Hud = {}
Hud.__index = Hud

local SCALE = 5
local INGREDIENT_COLORS: { [string]: Color3 } = {
	tomato = Color3.fromRGB(230, 28, 10),
	lettuce = Color3.fromRGB(111, 209, 18),
	bacon = Color3.fromRGB(196, 92, 62),
	bun = Color3.fromRGB(216, 143, 63),
}

-- ticket queue geometry
local TICKET_W = 178
local TICKET_H = 56
local TICKET_PAD = 6
-- vertical space kept clear at the bottom for the action button + margin
local TICKET_RESERVE = 210

local function mk(class: string, props: { [string]: any }, parent: Instance?): any
	local inst = Instance.new(class) :: any
	for k, v in props do
		inst[k] = v
	end
	if parent ~= nil then
		inst.Parent = parent
	end
	return inst
end

function Hud.new(catalog: any)
	local self = setmetatable({}, Hud)
	self.catalog = catalog
	local player = Players.LocalPlayer
	local gui = mk("ScreenGui", { Name = "SizzleHud", ResetOnSpawn = false, IgnoreGuiInset = true })
	gui.Parent = player:WaitForChild("PlayerGui")
	self.gui = gui

	-- timer chip (top center)
	self.timerLabel = mk("TextLabel", {
		Size = UDim2.fromOffset(140, 44),
		Position = UDim2.new(0.5, -70, 0, 12),
		BackgroundColor3 = Color3.fromRGB(58, 32, 19),
		BackgroundTransparency = 0.15,
		TextColor3 = Color3.fromRGB(255, 244, 221),
		TextSize = 28,
		Font = Enum.Font.FredokaOne,
		Text = "3:00",
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 12) }, self.timerLabel)

	-- coins + combo (top right)
	self.scoreLabel = mk("TextLabel", {
		Size = UDim2.fromOffset(170, 44),
		Position = UDim2.new(1, -182, 0, 12),
		BackgroundColor3 = Color3.fromRGB(58, 32, 19),
		BackgroundTransparency = 0.15,
		TextColor3 = Color3.fromRGB(255, 224, 102),
		TextSize = 24,
		Font = Enum.Font.FredokaOne,
		Text = "0",
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 12) }, self.scoreLabel)

	-- patience bar (top left)
	local pat = mk("Frame", {
		Size = UDim2.fromOffset(170, 18),
		Position = UDim2.new(0, 12, 0, 25),
		BackgroundColor3 = Color3.fromRGB(58, 32, 19),
		BackgroundTransparency = 0.15,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 9) }, pat)
	self.patienceFill = mk("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(120, 200, 80),
	}, pat)
	mk("UICorner", { CornerRadius = UDim.new(0, 9) }, self.patienceFill)

	-- phase overlay (countdown / results)
	self.overlay = mk("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(30, 16, 8),
		BackgroundTransparency = 0.35,
		Visible = false,
	}, gui)
	self.overlayTitle = mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 64),
		Position = UDim2.new(0, 0, 0.2, 0),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(255, 244, 221),
		TextSize = 44,
		Font = Enum.Font.FredokaOne,
		Text = "",
	}, self.overlay)
	self.overlayBody = mk("TextLabel", {
		Size = UDim2.new(1, -80, 0, 220),
		Position = UDim2.new(0, 40, 0.32, 0),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(255, 244, 221),
		TextSize = 22,
		Font = Enum.Font.GothamMedium,
		TextWrapped = true,
		Text = "",
	}, self.overlay)

	-- ready button (intermission)
	self.readyButton = mk("TextButton", {
		Size = UDim2.fromOffset(220, 56),
		Position = UDim2.new(0.5, -110, 0.72, 0),
		BackgroundColor3 = Color3.fromRGB(92, 174, 64),
		TextColor3 = Color3.new(1, 1, 1),
		TextSize = 28,
		Font = Enum.Font.FredokaOne,
		Text = "READY!",
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 16) }, self.readyButton)

	-- shop panel (intermission, toggled)
	self.shopButton = mk("TextButton", {
		Size = UDim2.fromOffset(120, 40),
		Position = UDim2.new(0.5, -60, 0.82, 0),
		BackgroundColor3 = Color3.fromRGB(204, 75, 66),
		TextColor3 = Color3.new(1, 1, 1),
		TextSize = 20,
		Font = Enum.Font.FredokaOne,
		Text = "SHOP",
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 12) }, self.shopButton)
	self.shopPanel = self:buildShop(gui)

	-- progression strip (bottom left)
	self.progressLabel = mk("TextLabel", {
		Size = UDim2.fromOffset(260, 30),
		Position = UDim2.new(0, 12, 1, -42),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(255, 244, 221),
		TextXAlignment = Enum.TextXAlignment.Left,
		TextSize = 18,
		Font = Enum.Font.GothamBold,
		Text = "",
	}, gui)

	-- screen-space ticket rail, top center under the timer (world billboards
	-- proved unframeable across aspect ratios — the camera never saw them)
	-- ORDERS LIVE ON THE RIGHT EDGE, NOT ACROSS THE TOP.
	--
	-- A centered top rail sat exactly over the oven and stoves — the one part
	-- of the room you must watch (cook/burn progress bars). Orders are
	-- reference you glance at, so they belong at the periphery, queued like a
	-- real ticket rail: oldest (most urgent) at the top.
	--
	-- The band between the score chip and the action button is short on a
	-- phone (~206px on iPhone landscape) while the board can hold 5 tickets,
	-- so the whole rail auto-scales down to fit (see updateOrders).
	self.ticketRail = mk("Frame", {
		Size = UDim2.new(0, TICKET_W, 1, -TICKET_RESERVE),
		Position = UDim2.new(1, -(TICKET_W + 10), 0, 62),
		BackgroundTransparency = 1,
	}, gui)
	self.ticketScale = mk("UIScale", { Scale = 1 }, self.ticketRail)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		HorizontalAlignment = Enum.HorizontalAlignment.Right,
		VerticalAlignment = Enum.VerticalAlignment.Top,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, TICKET_PAD),
	}, self.ticketRail)
	self.tickets = {} :: { [number]: any }

	-- species picker (countdown + intermission)
	self.speciesRow = mk("Frame", {
		Size = UDim2.fromOffset(4 * 96 + 24, 44),
		Position = UDim2.new(0.5, -(4 * 96 + 24) / 2, 0.62, 0),
		BackgroundTransparency = 1,
		Visible = false,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 8),
	}, self.speciesRow)
	self.speciesButtons = {} :: { [string]: any }
	local SPECIES_LABELS = { { "bramble", "🐻 Bramble" }, { "pip", "🐸 Pip" }, { "nori", "🐱 Nori" }, { "mochi", "🐤 Mochi" } }
	for _, def in SPECIES_LABELS do
		local id, text = def[1], def[2]
		local btn = mk("TextButton", {
			Size = UDim2.fromOffset(96, 40),
			BackgroundColor3 = Color3.fromRGB(58, 32, 19),
			BackgroundTransparency = 0.2,
			TextColor3 = Color3.fromRGB(255, 244, 221),
			TextSize = 16,
			Font = Enum.Font.FredokaOne,
			Text = text,
		}, self.speciesRow)
		mk("UICorner", { CornerRadius = UDim.new(0, 10) }, btn)
		self.speciesButtons[id] = btn
	end

	-- daily goals panel (intermission, left side)
	self.dailiesPanel = mk("Frame", {
		Size = UDim2.fromOffset(230, 150),
		Position = UDim2.new(0, 12, 0, 64),
		BackgroundColor3 = Color3.fromRGB(40, 24, 12),
		BackgroundTransparency = 0.15,
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 12) }, self.dailiesPanel)
	mk("TextLabel", {
		Size = UDim2.new(1, 0, 0, 26),
		BackgroundTransparency = 1,
		TextColor3 = Color3.fromRGB(255, 224, 102),
		TextSize = 16,
		Font = Enum.Font.FredokaOne,
		Text = "TODAY'S GOALS",
	}, self.dailiesPanel)
	self.dailyRows = {}
	for i = 1, 3 do
		local row = mk("TextLabel", {
			Size = UDim2.new(1, -16, 0, 34),
			Position = UDim2.new(0, 10, 0, 26 + (i - 1) * 38),
			BackgroundTransparency = 1,
			TextColor3 = Color3.fromRGB(255, 244, 221),
			TextXAlignment = Enum.TextXAlignment.Left,
			TextSize = 14,
			Font = Enum.Font.GothamMedium,
			TextWrapped = true,
			Text = "",
		}, self.dailiesPanel)
		self.dailyRows[i] = row
	end
	self.claimedDailies = {} :: { [string]: boolean }

	-- spectator notice (late join during a round)
	self.spectateLabel = mk("TextLabel", {
		Size = UDim2.new(0, 320, 0, 30),
		Position = UDim2.new(0.5, -160, 0, 160),
		BackgroundColor3 = Color3.fromRGB(58, 32, 19),
		BackgroundTransparency = 0.2,
		TextColor3 = Color3.fromRGB(255, 244, 221),
		TextSize = 16,
		Font = Enum.Font.FredokaOne,
		Text = "You're up next round — watch the kitchen!",
		Visible = false,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 10) }, self.spectateLabel)

	-- floating labels pool
	self.labelPool = {} :: { any }

	return self
end

--- Wire the species buttons and highlight the current pick.
function Hud:bindSpecies(onPick: (string) -> ())
	for id, btn in self.speciesButtons do
		btn.Activated:Connect(function()
			onPick(id)
		end)
	end
end

function Hud:setSpecies(current: string?)
	for id, btn in self.speciesButtons do
		btn.BackgroundColor3 = if id == current then Color3.fromRGB(92, 174, 64) else Color3.fromRGB(58, 32, 19)
	end
end

function Hud:setSpectating(on: boolean)
	self.spectateLabel.Visible = on
end

--- Daily goals rows + a toast when one completes.
function Hud:updateDailies(dailies: { any }?)
	if dailies == nil then
		return
	end
	for i = 1, 3 do
		local d = dailies[i]
		local row = self.dailyRows[i]
		if d == nil then
			row.Text = ""
		elseif d.claimed then
			row.Text = `✅ {d.name}  (+{d.coins}c)`
			row.TextColor3 = Color3.fromRGB(150, 210, 120)
			if not self.claimedDailies[d.id] then
				self.claimedDailies[d.id] = true
				self:toast(`Daily complete: {d.name}  +{d.coins}c`)
			end
		else
			row.Text = `▫️ {d.name}  ({math.min(d.progress, d.goal)}/{d.goal})`
			row.TextColor3 = Color3.fromRGB(255, 244, 221)
		end
	end
end

function Hud:toast(text: string)
	local label = mk("TextLabel", {
		Size = UDim2.new(0, 360, 0, 40),
		Position = UDim2.new(0.5, -180, 0, 170),
		BackgroundColor3 = Color3.fromRGB(92, 174, 64),
		TextColor3 = Color3.new(1, 1, 1),
		TextSize = 18,
		Font = Enum.Font.FredokaOne,
		Text = text,
	}, self.gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 12) }, label)
	task.delay(2.5, function()
		label:Destroy()
	end)
end

-- ------------------------------------------------------------------ tickets

--- Rebuild the ticket rail from the replicated order list.
function Hud:updateOrders(orders: { any })
	local IconViz = require(script.Parent.IconViz) :: any
	local live = {}
	for i, o in orders do
		live[o.id] = true
		local t = self.tickets[o.id]
		if t == nil then
			local card = mk("Frame", {
				Size = UDim2.fromOffset(TICKET_W, TICKET_H),
				BackgroundColor3 = Color3.fromRGB(255, 248, 235),
				LayoutOrder = o.id,
			}, self.ticketRail)
			mk("UICorner", { CornerRadius = UDim.new(0, 12) }, card)
			mk("TextLabel", {
				Size = UDim2.new(1, -12, 0, 16),
				Position = UDim2.new(0, 8, 0, 3),
				BackgroundTransparency = 1,
				TextColor3 = Color3.fromRGB(58, 32, 19),
				TextXAlignment = Enum.TextXAlignment.Left,
				TextSize = 14,
				Font = Enum.Font.FredokaOne,
				Text = o.name,
			}, card)
			local row = mk("Frame", {
				Size = UDim2.new(1, -14, 0, 26),
				Position = UDim2.new(0, 8, 0, 20),
				BackgroundTransparency = 1,
			}, card)
			mk("UIListLayout", {
				FillDirection = Enum.FillDirection.Horizontal,
				HorizontalAlignment = Enum.HorizontalAlignment.Left,
				VerticalAlignment = Enum.VerticalAlignment.Center,
				Padding = UDim.new(0, 3),
			}, row)
			for _, c in o.components do
				local content = IconViz.content(c.kind, c.state)
				if content ~= nil then
					mk("ImageLabel", {
						Size = UDim2.fromOffset(24, 24),
						BackgroundTransparency = 1,
						ImageContent = content,
					}, row)
				else
					-- fallback: colored chip + state glyph
					local chip = mk("Frame", {
						Size = UDim2.fromOffset(22, 22),
						BackgroundColor3 = INGREDIENT_COLORS[c.kind] or Color3.fromRGB(150, 150, 150),
					}, row)
					mk("UICorner", { CornerRadius = UDim.new(1, 0) }, chip)
					if c.state ~= "raw" then
						mk("TextLabel", {
							Size = UDim2.fromScale(1, 1),
							BackgroundTransparency = 1,
							TextColor3 = Color3.new(1, 1, 1),
							TextSize = 12,
							Font = Enum.Font.GothamBold,
							Text = if c.state == "cooked" then "🔥" else "🔪",
						}, chip)
					end
				end
			end
			local bar = mk("Frame", {
				Size = UDim2.new(1, -16, 0, 6),
				Position = UDim2.new(0, 8, 1, -10),
				BackgroundColor3 = Color3.fromRGB(58, 32, 19),
			}, card)
			mk("UICorner", { CornerRadius = UDim.new(0, 4) }, bar)
			local fill = mk("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(120, 200, 80) }, bar)
			mk("UICorner", { CornerRadius = UDim.new(0, 4) }, fill)
			t = { card = card, fill = fill }
			self.tickets[o.id] = t
		end
		local f = math.clamp(o.remaining / math.max(1, o.total), 0, 1)
		t.fill.Size = UDim2.fromScale(f, 1)
		-- colorblind-safe: hue + width encode urgency together
		t.fill.BackgroundColor3 = if f > 0.5
			then Color3.fromRGB(120, 200, 80)
			elseif f > 0.25 then Color3.fromRGB(240, 180, 60)
			else Color3.fromRGB(230, 80, 60)
	end
	for id, t in self.tickets do
		if not live[id] then
			t.card:Destroy()
			self.tickets[id] = nil
		end
	end

	-- Fit the queue into the band between the score chip and the action
	-- button. A phone in landscape has ~206px there while the board can hold
	-- five tickets, so scale the rail down rather than letting it run under
	-- the controls.
	local n = #orders
	if n > 0 and self.ticketScale ~= nil then
		local available = self.ticketRail.AbsoluteSize.Y
		if available > 1 then
			local needed = n * TICKET_H + (n - 1) * TICKET_PAD
			self.ticketScale.Scale = math.clamp(available / needed, 0.6, 1)
		end
	end
end

-- ------------------------------------------------------------------- shop

function Hud:buildShop(gui: any): any
	local panel = mk("ScrollingFrame", {
		Size = UDim2.fromOffset(360, 380),
		Position = UDim2.new(0.5, -180, 0.5, -210),
		BackgroundColor3 = Color3.fromRGB(40, 24, 12),
		BackgroundTransparency = 0.05,
		Visible = false,
		CanvasSize = UDim2.fromOffset(0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
	}, gui)
	mk("UICorner", { CornerRadius = UDim.new(0, 14) }, panel)
	mk("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, panel)
	self.shopRows = {}
	for i, item in self.catalog.items do
		local row = mk("Frame", {
			Size = UDim2.new(1, -12, 0, 44),
			BackgroundColor3 = Color3.fromRGB(66, 40, 22),
			LayoutOrder = i,
		}, panel)
		mk("UICorner", { CornerRadius = UDim.new(0, 8) }, row)
		mk("TextLabel", {
			Size = UDim2.new(0.55, 0, 1, 0),
			Position = UDim2.new(0, 10, 0, 0),
			BackgroundTransparency = 1,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextColor3 = Color3.fromRGB(255, 244, 221),
			TextSize = 16,
			Font = Enum.Font.GothamBold,
			Text = `{item.name}  ·  {item.kind}`,
		}, row)
		local btn = mk("TextButton", {
			Size = UDim2.fromOffset(110, 32),
			Position = UDim2.new(1, -120, 0.5, -16),
			BackgroundColor3 = Color3.fromRGB(92, 174, 64),
			TextColor3 = Color3.new(1, 1, 1),
			TextSize = 16,
			Font = Enum.Font.FredokaOne,
			Text = `{item.cost}c`,
		}, row)
		mk("UICorner", { CornerRadius = UDim.new(0, 8) }, btn)
		self.shopRows[item.id] = btn
	end
	return panel
end

--- Refresh shop buttons against the replicated profile.
function Hud:updateShop(progress: any, onAction: (string, string) -> ())
	for id, btn in self.shopRows do
		local item = self.catalog.byId[id]
		local owned = progress.owned ~= nil and progress.owned[id] == true
		local equipped = progress.equipped ~= nil and progress.equipped[item.kind] == id
		if equipped then
			btn.Text = "EQUIPPED"
			btn.BackgroundColor3 = Color3.fromRGB(120, 120, 120)
		elseif owned then
			btn.Text = "EQUIP"
			btn.BackgroundColor3 = Color3.fromRGB(70, 130, 200)
		elseif item.level ~= nil and (progress.level or 1) < item.level then
			btn.Text = `Lv {item.level}`
			btn.BackgroundColor3 = Color3.fromRGB(90, 90, 90)
		else
			btn.Text = `{item.cost}c`
			btn.BackgroundColor3 = Color3.fromRGB(92, 174, 64)
		end
		if btn:GetAttribute("wired") ~= true then
			btn:SetAttribute("wired", true)
			btn.Activated:Connect(function()
				local o = progress.owned ~= nil and progress.owned[id] == true
				onAction(if o then "equip" else "buy", id)
			end)
		end
	end
end

-- ------------------------------------------------------------------ update

function Hud:updatePhase(phase: any, cards: any?)
	local p = phase.phase
	self.readyButton.Visible = p == "intermission"
	self.shopButton.Visible = p == "intermission"
	self.shopPanel.Visible = self.shopPanel.Visible and p == "intermission"
	self.speciesRow.Visible = p == "intermission" or p == "countdown"
	self.dailiesPanel.Visible = p == "intermission"
	if p == "countdown" then
		self.overlay.Visible = true
		if phase.waiting then
			self.overlayTitle.Text = "Kitchen's open!"
			self.overlayBody.Text = "The shift starts as soon as a chef arrives."
		else
			self.overlayTitle.Text = `Shift starts in {math.max(0, math.ceil(phase.timer))}…`
			self.overlayBody.Text = "One button does everything: walk up to a glowing station and press it."
		end
	elseif p == "results" and phase.results ~= nil then
		local r = phase.results
		self.overlay.Visible = true
		local stars = string.rep("★", r.stars) .. string.rep("☆", 3 - r.stars)
		self.overlayTitle.Text = `{stars}   {r.coins} coins`
		local lines = { `{r.served} dishes served · best combo x{r.bestCombo}` }
		if cards ~= nil then
			for _, card in cards do
				table.insert(lines, `🏅 {card.title} — {card.line}`)
			end
		end
		self.overlayBody.Text = table.concat(lines, "\n")
	elseif p == "intermission" then
		self.overlay.Visible = false
	else
		self.overlay.Visible = false
	end
end

function Hud:updateScore(score: any)
	self.scoreLabel.Text = `🪙 {score.coins}   x{score.combo}`
	local f = math.clamp(score.patience, 0, 1)
	self.patienceFill.Size = UDim2.fromScale(f, 1)
	self.patienceFill.BackgroundColor3 = if f > 0.5
		then Color3.fromRGB(120, 200, 80)
		elseif f > 0.25 then Color3.fromRGB(240, 180, 60)
		else Color3.fromRGB(230, 80, 60)
end

function Hud:updateTimer(remaining: number)
	local m = math.floor(math.max(0, remaining) / 60)
	local s = math.floor(math.max(0, remaining) % 60)
	self.timerLabel.Text = string.format("%d:%02d", m, s)
end

function Hud:updateProgress(progress: any)
	self.progressLabel.Text = `Lv {progress.level}  ·  {progress.coins} coins  ·  🔥{progress.streak}`
	self:updateDailies(progress.dailies)
end

--- Floating world-space label (serve values, "+12", grab misses).
function Hud:worldLabel(worldPos: Vector3, text: string, color: Color3)
	local part = mk("Part", {
		Anchored = true,
		CanCollide = false,
		Transparency = 1,
		Size = Vector3.one,
		CFrame = CFrame.new(worldPos),
	}, workspace)
	local bb = mk("BillboardGui", { Size = UDim2.fromOffset(90, 30), AlwaysOnTop = true }, part)
	local label = mk("TextLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		TextColor3 = color,
		TextSize = 22,
		Font = Enum.Font.FredokaOne,
		Text = text,
	}, bb)
	local tween = TweenService:Create(part, TweenInfo.new(0.9, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		CFrame = CFrame.new(worldPos + Vector3.new(0, 6, 0)),
	})
	tween:Play()
	task.delay(0.9, function()
		part:Destroy()
	end)
end

return Hud
