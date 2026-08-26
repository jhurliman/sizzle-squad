--!strict
-- HUD: strictly the IN-ROUND surface -- round timer, coins/combo, patience,
-- the order ticket queue, phase overlays (countdown card / results ceremony),
-- the spectate notice, toasts and floating world labels.
--
-- Everything meta (shop, species picking, daily goals, ready-up, the career
-- strip, leaderboards, invites) moved to client/Menu. This file used to hold
-- half of that and main.client.luau built the other half and reparented it in
-- here, which is why neither was findable.

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local Theme = require(script.Parent.Menu.Theme) :: any

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

-- Shared with every menu surface (this was three copies of the same helper).
local mk = Theme.mk

-- Roblox's topbar is ~36px and always present in a real session; a floor keeps
-- the HUD clear of it even where the inset API reports nothing.
local TOPBAR_MIN = 36

local function topInset(): number
	local ok, rect = pcall(function()
		return GuiService.TopbarInset
	end)
	if ok and rect ~= nil and rect.Height > 0 then
		return rect.Height
	end
	local ok2, inset = pcall(function()
		return GuiService:GetGuiInset()
	end)
	return if ok2 and inset ~= nil then inset.Y else 0
end

function Hud.new(catalog: any)
	local self = setmetatable({}, Hud)
	self.catalog = catalog
	local player = Players.LocalPlayer
	local gui = mk("ScreenGui", { Name = "SizzleHud", ResetOnSpawn = false, IgnoreGuiInset = true })
	gui.Parent = player:WaitForChild("PlayerGui")
	self.gui = gui

	-- The gui ignores the GUI inset on purpose -- the thumbstick places itself
	-- from raw touch coordinates and the emote row wants the whole width -- so
	-- anything pinned to the TOP LEFT has to dodge Roblox's own controls
	-- itself. The patience bar sat at y=25 and showed as a green stripe
	-- running behind the Roblox icon and the chat button.
	--
	-- Read LIVE, not once. GetGuiInset() reports 0 before a session is running
	-- -- which is why the bar still sat under the controls in the Studio
	-- editor after the first attempt at this -- and the inset changes at
	-- runtime as Roblox shows and hides its own chrome. TOPBAR_MIN is a floor
	-- for the cases where it reports nothing at all.
	self.topChips = {}

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
		Position = UDim2.new(0, 12, 0, 21),
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

	-- ONLY the patience bar. It is the sole top-row element on the LEFT, which
	-- is where Roblox parks its own controls -- the timer is centred and the
	-- score chip and ticket rail are right-aligned, so none of them collide,
	-- and pushing them down just spends vertical space that a phone does not
	-- have.
	self.topChips = { { self.patienceFill.Parent, 4 } }
	self:applyTopInset()
	pcall(function()
		GuiService:GetPropertyChangedSignal("TopbarInset"):Connect(function()
			self:applyTopInset()
		end)
	end)

	return self
end

--- Re-pin the top row below Roblox's own controls.
function Hud:applyTopInset()
	local pad = math.max(topInset(), TOPBAR_MIN)
	for _, entry in self.topChips do
		local inst, baseY = entry[1], entry[2]
		local p = inst.Position
		inst.Position = UDim2.new(p.X.Scale, p.X.Offset, p.Y.Scale, pad + baseY)
	end
end

function Hud:setSpectating(on: boolean)
	self.spectateLabel.Visible = on
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

-- ------------------------------------------------------------------ update

function Hud:updatePhase(phase: any, cards: any?)
	local p = phase.phase
	-- The timer and patience bar belong to a SHIFT. Between rounds the timer
	-- chip was being reused to show the results/intermission countdowns, which
	-- read as one clock erratically jumping between unrelated values.
	local inRound = p == "round"
	self.timerLabel.Visible = inRound
	self.patienceFill.Parent.Visible = inRound
	if not inRound then
		-- Tickets are a live-service artefact: clear them outright rather than
		-- leaving the last shift's orders floating over the results screen.
		self:clearOrders()
	end
	if p == "countdown" then
		-- No countdown card any more: countdown is an open-ended lobby waiting
		-- on Start, and the old text ("Shift starts in N…") counted down a
		-- timer that no longer exists. The centred ShiftPanel is the lobby UI.
		self.overlay.Visible = false
	-- `results` is NOT handled here any more: the ceremony is staged over the
	-- whole 12s phase and lives in client/Results.luau.
	elseif p == "intermission" then
		self.overlay.Visible = false
	else
		self.overlay.Visible = false
	end
end

function Hud:updateScore(score: any)
	-- No coin emoji: FredokaOne has no glyph for it and renders a hollow box.
	self.scoreLabel.Text = `{score.coins}c   x{score.combo}`
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

--- Drop every ticket. Called on leaving a round so no orders survive into the
--- results/lobby screens.
function Hud:clearOrders()
	-- A ticket entry is { card, fill }, NOT an Instance. Calling :Destroy() on
	-- the table threw out of updatePhase before the results overlay was built,
	-- which is what left you stuck in the kitchen at round end with the last
	-- shift's orders still on screen.
	for id, ticket in self.tickets do
		ticket.card:Destroy()
		self.tickets[id] = nil
	end
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
