--!strict
-- Leaderboards. Replaces the monospace TextLabel that printed raw datastore
-- keys ("u123456"), which was effectively unreadable; the server now resolves
-- display names, and this renders real rows with the local player pinned.

local Players = game:GetService("Players")

local Theme = require(script.Parent.Theme) :: any
local Loc = require(script.Parent.Parent.Loc) :: any

local RanksTab = {}
RanksTab.__index = RanksTab

local mk = Theme.mk

local BOARDS = {
	{ id = "weekly", label = "WEEKLY", unit = "coins" },
	{ id = "allTime", label = "ALL-TIME", unit = "coins" },
	{ id = "dishes", label = "CAREER DISHES", unit = "dishes" },
}

function RanksTab.new(parent: Instance, _deps: any)
	local self = setmetatable({}, RanksTab)
	self.active = "weekly"
	self.boards = nil :: any

	self.switcher = mk("Frame", {
		Size = UDim2.new(1, 0, 0, 34),
		BackgroundTransparency = 1,
	}, parent)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, self.switcher)

	self.switchButtons = {}
	for i, b in BOARDS do
		local btn = Theme.button({
			Size = UDim2.fromOffset(150, 32),
			Fill = Theme.BROWN_LIGHT,
			TextSize = 14,
			LayoutOrder = i,
			ZIndex = 4,
			Text = b.label,
		}, self.switcher)
		btn.Activated:Connect(function()
			self.active = b.id
			self:render()
		end)
		self.switchButtons[b.id] = btn
	end

	self.list = Theme.scrollList({
		Position = UDim2.fromOffset(0, 42),
		Size = UDim2.new(1, 0, 1, -42),
		ZIndex = 4,
	}, parent)

	self.empty = Theme.label({
		Size = UDim2.new(1, 0, 0, 60),
		Position = UDim2.fromOffset(0, 100),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 16,
		TextColor3 = Theme.DIM,
		ZIndex = 5,
		Text = "No rankings yet — cook something!",
	}, parent)

	-- "NO RANKINGS YET" AND "NOT LOADED YET" ARE DIFFERENT SENTENCES.
	--
	-- The boards arrive on a ~90s server poll, so opening this tab early meant
	-- staring at "No rankings yet — cook something!" and then watching a full
	-- board appear underneath it. The empty state was telling a confident lie
	-- about data it did not have. `boards == nil` is unknown; an empty table is
	-- knowledge.
	self.loading = mk("Frame", {
		Size = UDim2.new(1, 0, 0, 60),
		Position = UDim2.fromOffset(0, 100),
		BackgroundTransparency = 1,
		ZIndex = 5,
		Visible = true,
	}, parent)
	Theme.label({
		Size = UDim2.new(1, 0, 0, 22),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 16,
		TextColor3 = Theme.DIM,
		ZIndex = 6,
		Text = "Loading rankings…",
	}, self.loading)
	-- An indeterminate bar rather than a spinner glyph: the UI font has holes
	-- (the coin emoji renders as a box), and geometry cannot be missing.
	local track = mk("Frame", {
		Size = UDim2.fromOffset(160, 4),
		Position = UDim2.new(0.5, -80, 0, 30),
		BackgroundColor3 = Theme.BROWN_LIGHT,
		BorderSizePixel = 0,
		ZIndex = 6,
	}, self.loading)
	Theme.corner(track, 2)
	self.spinner = mk("Frame", {
		Size = UDim2.fromOffset(52, 4),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
		ZIndex = 7,
	}, track)
	Theme.corner(self.spinner, 2)
	self.spinT = 0

	return self
end

function RanksTab:step(dt: number)
	if self.loading == nil or not self.loading.Visible then
		return
	end
	self.spinT += dt
	-- Ping-pong across the track; eased so it reads as motion, not a metronome.
	local u = (math.sin(self.spinT * 2.2) + 1) / 2
	self.spinner.Position = UDim2.fromOffset(math.floor(u * (160 - 52)), 0)
end

function RanksTab:setLeaderboards(boards: any)
	self.boards = boards
	self:render()
end

function RanksTab:onShow()
	self:render()
end

function RanksTab:render()
	for id, btn in self.switchButtons do
		btn.BackgroundColor3 = if id == self.active then Theme.GREEN else Theme.BROWN_LIGHT
	end
	for _, child in self.list:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end

	local rows = if self.boards ~= nil then self.boards[self.active] else nil
	local unit = "coins"
	for _, b in BOARDS do
		if b.id == self.active then
			unit = b.unit
		end
	end
	-- nil = the server has not answered yet; {} = it answered, nobody is on it
	if self.boards == nil then
		self.loading.Visible = true
		self.empty.Visible = false
		return
	end
	self.loading.Visible = false
	if rows == nil or #rows == 0 then
		self.empty.Visible = true
		return
	end
	self.empty.Visible = false

	local myId = Players.LocalPlayer.UserId
	for i, e in rows do
		local mine = e.userId == myId
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 34),
			BackgroundColor3 = if mine then Theme.GREEN else Theme.BROWN_LIGHT,
			BackgroundTransparency = if mine then 0.15 else 0.3,
			BorderSizePixel = 0,
			LayoutOrder = i,
			ZIndex = 4,
		}, self.list)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.fromOffset(44, 34),
			Position = UDim2.fromOffset(10, 0),
			TextXAlignment = Enum.TextXAlignment.Center,
			Font = Theme.TITLE_FONT,
			TextColor3 = if mine then Theme.WHITE else Theme.GOLD,
			TextSize = 16,
			ZIndex = 5,
			Text = `#{e.rank}`,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -190, 1, 0),
			Position = UDim2.fromOffset(58, 0),
			Font = Theme.BOLD_FONT,
			TextSize = 15,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			-- `name` is resolved server-side; `key` is the raw datastore key
			-- and only appears if resolution failed.
			Text = e.name or e.key or "?",
		}, row)
		Theme.label({
			Size = UDim2.fromOffset(120, 34),
			Position = UDim2.new(1, -130, 0, 0),
			TextXAlignment = Enum.TextXAlignment.Right,
			Font = Theme.TITLE_FONT,
			TextColor3 = Theme.GOLD,
			TextSize = 15,
			ZIndex = 5,
			Text = Loc.f("fmt.value_unit", e.value, Loc.f(if unit == "coins" then "fmt.coins_unit" else "fmt.dishes_unit")),
		}, row)
	end
end

function RanksTab:relayout(L: any, _viewport: Vector2)
	local w = math.min(150, (L.panelW - 40) / #BOARDS - 6)
	for _, btn in self.switchButtons do
		btn.Size = UDim2.fromOffset(w, 32)
	end
end

return RanksTab
