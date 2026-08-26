--!strict
-- The between-rounds bar: ready toggle, crew ready tally, the phase timer
-- mirror, and the intermission-pause notice.
--
-- THE CAPTION IS A PURE FUNCTION OF THE LAST RoundPhase. The old ready button
-- set its own text to "WAITING…" on click and nothing ever restored it, so it
-- read "WAITING…" for every subsequent intermission. Deriving the caption from
-- the server's readyIds instead means that class of drift cannot recur.

local Players = game:GetService("Players")

local Theme = require(script.Parent.Theme) :: any

local ReadyBar = {}
ReadyBar.__index = ReadyBar

local mk = Theme.mk

function ReadyBar.new(gui: Instance, deps: any)
	local self = setmetatable({}, ReadyBar)
	self.deps = deps
	self.hidden = false
	self.ready = false
	self.phase = { phase = "countdown", timer = 0 }

	self.root = mk("Frame", {
		Name = "ReadyBar",
		-- Sits above the emote row (which ends at y=-8) and clear of the
		-- action button's column on the right.
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -46),
		Size = UDim2.fromOffset(540, 56),
		BackgroundTransparency = 1,
		Visible = false,
	}, gui)
	mk("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
	}, self.root)

	-- Career strip, relocated out of Hud: it is meta, and it belongs next to
	-- the button that takes you to the shop.
	self.progressChip = Theme.chip({
		Size = UDim2.fromOffset(210, 44),
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		LayoutOrder = 1,
		Text = "Lv 1  ·  0 🪙",
	}, self.root)

	self.readyButton = Theme.button({
		Size = UDim2.fromOffset(160, Theme.MIN_TAP),
		TextSize = 22,
		LayoutOrder = 2,
		Text = "READY!",
	}, self.root)
	self.readyButton.Activated:Connect(function()
		-- Toggle, not latch: un-readying is a real action the server accepts.
		self.ready = not self.ready
		self:paint()
		self.deps.onReady(self.ready)
	end)

	self.statusChip = Theme.chip({
		Size = UDim2.fromOffset(150, 44),
		TextSize = 15,
		LayoutOrder = 3,
		Text = "",
	}, self.root)

	-- Pause notice. An unexplained frozen timer reads as a bug, so whenever
	-- the server is holding the clock we say why and show how much hold is
	-- left.
	self.pauseNotice = mk("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -108),
		Size = UDim2.fromOffset(340, 30),
		BackgroundColor3 = Theme.BROWN_MID,
		BackgroundTransparency = 0.15,
		Visible = false,
	}, gui)
	Theme.corner(self.pauseNotice, 10)
	self.pauseLabel = Theme.label({
		Size = UDim2.new(1, -16, 1, 0),
		Position = UDim2.fromOffset(8, 0),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 14,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		Text = "⏸ PAUSED — a chef is in the wardrobe",
	}, self.pauseNotice)
	self.pauseFill = mk("Frame", {
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.fromScale(0, 1),
		Size = UDim2.fromScale(1, 0.12),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
	}, self.pauseNotice)

	return self
end

function ReadyBar:setHidden(on: boolean)
	self.hidden = on
	self:paint()
end

function ReadyBar:setProgress(progress: any)
	self.progress = progress
	local streak = progress.streak or 0
	local suffix = if streak > 1 then `  ·  🔥{streak}` else ""
	self.progressChip.Text = `Lv {progress.level or 1}  ·  {progress.coins or 0} 🪙{suffix}`
end

function ReadyBar:setPhase(phase: any, spectating: boolean)
	self.phase = phase
	self.spectating = spectating
	-- Trust the server's list, never local memory.
	local ids = phase.readyIds
	if ids ~= nil then
		local me = Players.LocalPlayer.UserId
		self.ready = table.find(ids, me) ~= nil
	elseif phase.phase ~= "intermission" then
		self.ready = false
	end
	self:paint()
end

function ReadyBar:paint()
	local p = self.phase.phase
	local intermission = p == "intermission"
	self.root.Visible = not self.hidden and (p == "intermission" or p == "results" or p == "countdown")
	self.readyButton.Visible = intermission and not self.spectating
	self.readyButton.Text = if self.ready then "WAITING…" else "READY!"
	self.readyButton.BackgroundColor3 = if self.ready then Theme.GREY else Theme.GREEN

	local timer = math.max(0, math.ceil(self.phase.timer or 0))
	if intermission then
		local n, total = self.phase.readyCount, self.phase.readyTotal
		if n ~= nil and total ~= nil and total > 0 then
			self.statusChip.Text = `{n}/{total} ready\nnext in {timer}s`
		else
			self.statusChip.Text = `Next shift\nin {timer}s`
		end
	elseif p == "countdown" then
		self.statusChip.Text = if self.phase.waiting then "Waiting for\na chef…" else `Starting\nin {timer}s`
	else
		self.statusChip.Text = `Results\n{timer}s`
	end

	local paused = self.phase.paused == true
	self.pauseNotice.Visible = paused and not self.hidden
	if paused then
		local left = self.phase.pauseLeft or 0
		local cap = self.phase.pauseCap or 15
		self.pauseFill.Size = UDim2.fromScale(math.clamp(left / math.max(1, cap), 0, 1), 0.12)
	end
end

function ReadyBar:step(_dt: number) end

function ReadyBar:relayout(L: any, viewport: Vector2)
	local compact = viewport.X < 720
	self.root.Size = UDim2.fromOffset(if compact then 420 else 540, L.footerH)
	self.progressChip.Size = UDim2.fromOffset(if compact then 150 else 210, 44)
	self.readyButton.Size = UDim2.fromOffset(if compact then 130 else 160, Theme.MIN_TAP)
	self.statusChip.Size = UDim2.fromOffset(if compact then 120 else 150, 44)
end

return ReadyBar
