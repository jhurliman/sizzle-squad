--!strict
-- The front-end shell: one ScreenGui holding the centred between-rounds shift
-- panel and the full-screen tabbed panel (Wardrobe / Shop / Career / Ranks).
--
-- WHY THIS EXISTS: the meta was already built — a 30-item catalog, validated
-- buy/equip, dailies, streaks, three leaderboards — but it was reachable only
-- as a flat text list behind a button that lived for 25 seconds. This gives it
-- a home. There is deliberately NO separate lobby place: the intermission
-- already runs a live walkable kitchen (RoundDirector's tickMovementOnly), and
-- a second place would split the player pool and break friend-join.
--
-- THE PHASE GATE IS THE LOAD-BEARING RULE: the menu may open only when the
-- round is not running, or when this player has no chef (spectating). It must
-- never become a way to abandon the team mid-shift. Enforced here by toggling
-- ScreenGui.Enabled -- one flag kills the shift panel and the tabs together,
-- deliberately unlike the scattered per-frame .Visible bookkeeping in
-- Hud:updatePhase that this module exists to replace.

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Theme = require(script.Theme) :: any
local ShiftPanel = require(script.ShiftPanel) :: any
local KitchenCard = require(script.KitchenCard) :: any
local EmoteBar = require(script.EmoteBar) :: any

local Menu = {}
Menu.__index = Menu

local mk = Theme.mk


local TAB_DEFS = {
	{ id = "wardrobe", label = "WARDROBE", icon = "👕", module = "WardrobeTab" },
	{ id = "shop", label = "SHOP", icon = "🛒", module = "ShopTab" },
	{ id = "career", label = "CAREER", icon = "⭐", module = "CareerTab" },
	{ id = "ranks", label = "RANKS", icon = "🏆", module = "RanksTab" },
}

function Menu.new(deps: any)
	local self = setmetatable({}, Menu)
	self.deps = deps
	-- Tabs get a superset of the composition root's deps plus the hooks they
	-- need back into the shell (tab switching, try-on hand-off).
	deps.onTryOn = function(item)
		self:openTab("wardrobe")
		local wardrobe = self.tabs.wardrobe
		if wardrobe ~= nil and wardrobe.tryOn ~= nil then
			wardrobe:tryOn(item)
		end
	end
	self.catalog = deps.catalog
	self.remotes = deps.remotes
	self.input = deps.input
	self.player = Players.LocalPlayer

	self.open = false
	self.activeTab = nil :: string?
	self.allowed = false
	self.phase = { phase = "countdown", timer = 0 }
	self.spectating = false
	self.progress = nil :: any
	self.autoStarted = false

	local gui = mk("ScreenGui", {
		Name = "SizzleMenu",
		ResetOnSpawn = false,
		IgnoreGuiInset = true,
		DisplayOrder = 5,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Enabled = false,
	}, self.player:WaitForChild("PlayerGui"))
	self.gui = gui

	self:buildPanel()

	self.shiftPanel = ShiftPanel.new(gui, {
		onReady = function(on)
			self.remotes.ReadyUp:FireServer(on)
		end,
		onOpenTab = function(tab)
			self:openTab(tab)
		end,
	})
	self.kitchenCard = KitchenCard.new(gui, {
		onOpenTab = function(tab)
			self:openTab(tab)
		end,
		onReady = function()
			self.remotes.ReadyUp:FireServer(true)
		end,
	})

	-- Gameplay, so it lives in the HUD gui and survives the menu's phase gate
	-- (you can still ping mid-round); it only hides behind an open panel.
	self.emoteBar = EmoteBar.new(deps.hudGui, {
		catalog = self.catalog,
		onEmote = function(id)
			self.remotes.Emote:FireServer(id)
		end,
	})

	-- Reflow (never rescale) when the viewport changes: rotation, split view,
	-- or a Studio window drag.
	local cam = workspace.CurrentCamera
	if cam ~= nil then
		cam:GetPropertyChangedSignal("ViewportSize"):Connect(function()
			self:relayout()
		end)
	end
	self:relayout()
	return self
end

-- ------------------------------------------------------------------ panel

function Menu:buildPanel()
	self.scrim = mk("TextButton", {
		Name = "Scrim",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Theme.BROWN_DEEP,
		BackgroundTransparency = 0.35,
		Text = "",
		AutoButtonColor = false,
		Visible = false,
		ZIndex = 2,
	}, self.gui)
	-- ONLY A TAP GENUINELY OUTSIDE THE PANEL DISMISSES.
	--
	-- The panel is Active so it ought to sink taps before they reach this
	-- full-screen button, and that fix was made once already -- but it did not
	-- hold, because `content` (and anything else laid over the panel body) is
	-- a plain Frame drawn ABOVE it. Every non-button surface in the dialog was
	-- a hole again, and the failure is silent and total: tap a label, lose the
	-- whole shop.
	--
	-- Making each child Active is the fragile version of this fix; it has to be
	-- got right again for every container anyone adds later. Comparing against
	-- the panel's own rect cannot rot that way. The ScreenGui sets
	-- IgnoreGuiInset, so AbsolutePosition and InputObject.Position share an
	-- origin and no inset correction is needed.
	self.scrim.Activated:Connect(function(input)
		if self.panel.Visible and input ~= nil then
			local tl = self.panel.AbsolutePosition
			local sz = self.panel.AbsoluteSize
			local x, y = input.Position.X, input.Position.Y
			if x >= tl.X and x <= tl.X + sz.X and y >= tl.Y and y <= tl.Y + sz.Y then
				return
			end
		end
		self:close("scrim")
	end)

	self.panel = Theme.card({
		Name = "Panel",
		Size = UDim2.fromOffset(860, 430),
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 0.02,
		Visible = false,
		ZIndex = 3,
		-- THE PANEL SINKS INPUT.
		--
		-- The scrim behind it is a full-screen TextButton that closes the menu,
		-- and a plain Frame does not consume a tap -- so a tap that landed on
		-- something non-interactive inside the panel fell straight through and
		-- shut it. Dragging the chef in the wardrobe was the worst case: the
		-- viewport is the biggest non-button surface in the menu, so grabbing
		-- the character to spin it closed the dialog instead.
		Active = true,
	}, self.gui)
	Theme.stroke(self.panel, Theme.BROWN_LIGHT, 2)

	self.tabStrip = mk("Frame", {
		Name = "Tabs",
		Size = UDim2.new(1, -60, 0, 44),
		Position = UDim2.fromOffset(10, 8),
		BackgroundTransparency = 1,
		ZIndex = 4,
	}, self.panel)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
		VerticalAlignment = Enum.VerticalAlignment.Center,
	}, self.tabStrip)

	self.closeButton = Theme.button({
		Name = "Close",
		Size = UDim2.fromOffset(40, 40),
		Position = UDim2.new(1, -48, 0, 10),
		Fill = Theme.BROWN_LIGHT,
		Text = "X", -- NOT U+2715: no glyph in the UI font, renders as an empty box
		TextSize = 20,
		ZIndex = 4,
	}, self.panel)
	self.closeButton.Activated:Connect(function()
		self:close("button")
	end)

	self.content = mk("Frame", {
		Name = "Content",
		Position = UDim2.fromOffset(10, 58),
		Size = UDim2.new(1, -20, 1, -68),
		BackgroundTransparency = 1,
		ZIndex = 3,
		-- Belt to the scrim's braces: this frame covers the whole panel body
		-- and is drawn above it, so without this it is the hole taps fell
		-- through. The scrim's rect test is what actually guarantees the fix.
		Active = true,
	}, self.panel)

	-- Tabs are constructed lazily: building four screens (one with a 3D
	-- viewport) on join would cost every player who never opens the menu.
	self.tabs = {}
	self.tabButtons = {}
	for i, def in TAB_DEFS do
		local btn = Theme.button({
			Name = def.id,
			Size = UDim2.fromOffset(150, 38),
			Fill = Theme.BROWN_LIGHT,
			TextSize = 15,
			LayoutOrder = i,
			ZIndex = 4,
			Text = `{def.icon} {def.label}`,
		}, self.tabStrip)
		btn.Activated:Connect(function()
			self:openTab(def.id)
		end)
		self.tabButtons[def.id] = btn
	end
end

function Menu:ensureTab(id: string): any
	local existing = self.tabs[id]
	if existing ~= nil then
		return existing
	end
	local def
	for _, d in TAB_DEFS do
		if d.id == id then
			def = d
		end
	end
	if def == nil then
		return nil
	end
	local ok, mod = pcall(function()
		return require(script:FindFirstChild(def.module)) :: any
	end)
	if not ok or mod == nil then
		return nil
	end
	local holder = mk("Frame", {
		Name = def.module,
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
		ZIndex = 3,
	}, self.content)
	local tab = mod.new(holder, self.deps)
	tab._holder = holder
	self.tabs[id] = tab
	-- Feed it whatever state has already arrived.
	if self.progress ~= nil and tab.setProgress ~= nil then
		tab:setProgress(self.progress)
	end
	if self.boards ~= nil and tab.setLeaderboards ~= nil then
		tab:setLeaderboards(self.boards)
	end
	if self.equipped ~= nil and tab.setEquipped ~= nil then
		tab:setEquipped(self.equipped)
	end
	-- Tabs are built lazily, so they miss the constructor's relayout and would
	-- otherwise render at their authored (desktop) sizes on a phone.
	if tab.relayout ~= nil and self.layout ~= nil then
		local cam = workspace.CurrentCamera
		tab:relayout(self.layout, if cam ~= nil then cam.ViewportSize else Vector2.new(1280, 720))
	end
	return tab
end

-- ------------------------------------------------------------ open / close

function Menu:openTab(id: string)
	if not self.allowed then
		return
	end
	local tab = self:ensureTab(id)
	if tab == nil then
		return
	end
	if self.activeTab ~= nil and self.activeTab ~= id then
		local prev = self.tabs[self.activeTab]
		if prev ~= nil then
			prev._holder.Visible = false
			if prev.onHide ~= nil then
				prev:onHide()
			end
		end
	end
	self.activeTab = id
	tab._holder.Visible = true
	if tab.onShow ~= nil then
		tab:onShow()
	end
	for tabId, btn in self.tabButtons do
		btn.BackgroundColor3 = if tabId == id then Theme.GREEN else Theme.BROWN_LIGHT
	end
	if not self.open then
		self:setOpen(true)
	end
end

function Menu:toggleTab(id: string)
	if self.open and self.activeTab == id then
		self:close("toggle")
	else
		self:openTab(id)
	end
end

function Menu:close(_reason: string?)
	if not self.open then
		return
	end
	self:setOpen(false)
end

function Menu:isOpen(): boolean
	return self.open
end

function Menu:setOpen(on: boolean)
	if self.open == on then
		return
	end
	self.open = on
	self.scrim.Visible = on
	self.panel.Visible = on
	self.shiftPanel:setHidden(on)
	self.emoteBar:setHidden(on)

	-- One switch solves movement-while-blind, drag-vs-thumbstick, and stray
	-- E/Space grabs: ControlModule:Disable() also hides the touch thumbstick,
	-- and unbinding the action removes the touch action button.
	if self.input ~= nil and self.input.setEnabled ~= nil then
		self.input:setEnabled(not on)
	end
	if self.deps.onOpenChanged ~= nil then
		self.deps.onOpenChanged(on)
	end


	if on and self.activeTab == nil then
		self:openTab("wardrobe")
	end
	if not on then
		local active = if self.activeTab ~= nil then self.tabs[self.activeTab] else nil
		if active ~= nil and active.onHide ~= nil then
			active:onHide()
		end
	end
end

-- ------------------------------------------------------------------ state

function Menu:setPhase(phase: any, spectating: boolean)
	self.phase = phase
	self.spectating = spectating
	local allowed = phase.phase ~= "round" or spectating
	self.allowed = allowed
	if not allowed and self.open then
		self:setOpen(false)
	end
	self.gui.Enabled = allowed
	self.shiftPanel:setPhase(phase, spectating)
	self.kitchenCard:setPhase(phase)
	self:maybeAutoStart()
end

function Menu:setProgress(progress: any)
	self.progress = progress
	self.shiftPanel:setProgress(progress)
	self.kitchenCard:setProgress(progress)
	self.emoteBar:setProgress(progress)
	self:maybeAutoStart()
	for _, tab in self.tabs do
		if tab.setProgress ~= nil then
			tab:setProgress(progress)
		end
	end
end

function Menu:setLeaderboards(boards: any)
	self.boards = boards
	for _, tab in self.tabs do
		if tab.setLeaderboards ~= nil then
			tab:setLeaderboards(boards)
		end
	end
end

--- Own-chef appearance from EquipDeltas, so the Wardrobe opens on what you
--- are actually wearing rather than on a default.
function Menu:setEquipped(equipped: any)
	self.equipped = equipped
	for _, tab in self.tabs do
		if tab.setEquipped ~= nil then
			tab:setEquipped(equipped)
		end
	end
end

--- A brand-new player is dropped straight into their first shift; everyone
--- else presses Start. This is a placeholder for the unbuilt First Shift
--- onboarding (plan §2.6), which owns that first-round experience -- when it
--- lands, it should take over this trigger.
function Menu:maybeAutoStart()
	if self.autoStarted or self.progress == nil then
		return
	end
	if (self.progress.sessions or 1) > 1 then
		self.autoStarted = true -- returning player: they press the button
		return
	end
	if self.phase.phase ~= "countdown" or self.spectating then
		return
	end
	self.autoStarted = true
	self.remotes.ReadyUp:FireServer(true)
end

function Menu:step(dt: number)
	self.shiftPanel:step(dt)
	self.kitchenCard:step(dt)
	if not self.open then
		return
	end
	local active = if self.activeTab ~= nil then self.tabs[self.activeTab] else nil
	if active ~= nil and active.step ~= nil then
		active:step(dt)
	end
end

-- --------------------------------------------------------------- responsive

function Menu:relayout()
	local cam = workspace.CurrentCamera
	local viewport = if cam ~= nil then cam.ViewportSize else Vector2.new(1280, 720)
	-- Roblox draws its own controls (menu, chat, voice) across the top. The
	-- gui ignores the inset so the ShiftPanel and emote row can use the whole
	-- screen, which means the PANEL has to dodge the top bar itself -- it was
	-- sitting underneath it and eating the tab labels.
	local inset = GuiService:GetGuiInset()
	local safeTop = inset.Y + 8
	local L = Theme.layoutFor(Vector2.new(viewport.X, viewport.Y - safeTop))
	self.layout = L

	-- Top-anchored under the inset rather than centred, so the tab strip is
	-- always reachable no matter how tall the panel gets.
	local panelH = math.min(L.panelH, viewport.Y - safeTop - 12)
	self.panel.AnchorPoint = Vector2.new(0.5, 0)
	self.panel.Position = UDim2.new(0.5, 0, 0, safeTop)
	self.panel.Size = UDim2.fromOffset(L.panelW, panelH)
	self.tabStrip.Size = UDim2.new(1, -60, 0, L.tabH)
	self.content.Position = UDim2.fromOffset(10, L.tabH + 16)
	self.content.Size = UDim2.new(1, -20, 1, -(L.tabH + 26))

	for _, def in TAB_DEFS do
		local tabBtn = self.tabButtons[def.id]
		tabBtn.Size = UDim2.fromOffset(math.min(150, (L.panelW - 80) / #TAB_DEFS - 6), L.tabH - 6)
	end

	self.shiftPanel:relayout(L, viewport)
	self.kitchenCard:relayout(L, viewport)
	self.emoteBar:relayout(L, viewport)
	for _, tab in self.tabs do
		if tab.relayout ~= nil then
			tab:relayout(L, viewport)
		end
	end
end

return Menu
