--!strict
-- Career: level and XP, lifetime stats, today's goals, the milestone reward
-- track, and the invite button.
--
-- Absorbs Hud's dailies panel (and its completion toast) plus the INVITE
-- FRIENDS button that main.client.luau was building by hand.

local Theme = require(script.Parent.Theme) :: any
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local BadgeDefs = require(ReplicatedStorage:WaitForChild("Game"):WaitForChild("BadgeDefs")) :: any

local CareerTab = {}
CareerTab.__index = CareerTab

local mk = Theme.mk

function CareerTab.new(parent: Instance, deps: any)
	local self = setmetatable({}, CareerTab)
	self.catalog = deps.catalog
	self.deps = deps
	self.claimed = {} :: { [string]: boolean }

	-- ---- header: level + XP ------------------------------------------
	local header = Theme.card({
		Size = UDim2.new(1, 0, 0, 76),
		BackgroundColor3 = Theme.BROWN_LIGHT,
		BackgroundTransparency = 0.25,
		ZIndex = 4,
	}, parent)

	self.levelLabel = Theme.label({
		Size = UDim2.new(0.5, 0, 0, 30),
		Position = UDim2.fromOffset(14, 8),
		TextSize = 22,
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		ZIndex = 5,
		Text = "Level 1",
	}, header)

	self.statsLabel = Theme.label({
		Size = UDim2.new(0.5, -20, 0, 30),
		Position = UDim2.new(0.5, 0, 0, 8),
		TextXAlignment = Enum.TextXAlignment.Right,
		TextSize = 15,
		Font = Theme.BOLD_FONT,
		ZIndex = 5,
		Text = "",
	}, header)

	local track = mk("Frame", {
		Size = UDim2.new(1, -28, 0, 14),
		Position = UDim2.fromOffset(14, 44),
		BackgroundColor3 = Theme.BROWN,
		BorderSizePixel = 0,
		ZIndex = 5,
	}, header)
	Theme.corner(track, 7)
	self.xpFill = mk("Frame", {
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = Theme.GOLD,
		BorderSizePixel = 0,
		ZIndex = 6,
	}, track)
	Theme.corner(self.xpFill, 7)
	self.xpLabel = Theme.label({
		Size = UDim2.new(1, -28, 0, 16),
		Position = UDim2.fromOffset(14, 58),
		TextSize = 12,
		TextColor3 = Theme.DIM,
		ZIndex = 5,
		Text = "",
	}, header)

	-- ---- body: two columns -------------------------------------------
	self.left = Theme.scrollList({
		Position = UDim2.fromOffset(0, 86),
		Size = UDim2.new(0.5, -6, 1, -140),
		ZIndex = 4,
	}, parent)
	-- The right column is shared: friends on top, milestones beneath. Friends
	-- get the fixed slice because the list is short and never scrolls in
	-- practice -- three friends online is a lot -- while milestones are long.
	self.friends = Theme.scrollList({
		Position = UDim2.new(0.5, 6, 0, 86),
		Size = UDim2.new(0.5, -6, 0, 150),
		BackgroundTransparency = 1,
		ZIndex = 4,
	}, parent)

	self.right = Theme.scrollList({
		Position = UDim2.new(0.5, 6, 0, 244),
		Size = UDim2.new(0.5, -6, 1, -298),
		ZIndex = 4,
	}, parent)

	self.invite = Theme.button({
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -4),
		Size = UDim2.fromOffset(220, Theme.MIN_TAP),
		Fill = Theme.BLUE,
		TextSize = 17,
		ZIndex = 5,
		Text = "＋ INVITE FRIENDS",
	}, parent)
	self.invite.Activated:Connect(function()
		pcall(function()
			local SocialService = game:GetService("SocialService")
			local Players = game:GetService("Players")
			SocialService:PromptGameInvite(Players.LocalPlayer)
		end)
	end)

	return self
end

local function sectionTitle(parent: Instance, order: number, text: string)
	return Theme.label({
		Size = UDim2.new(1, -10, 0, 24),
		Font = Theme.TITLE_FONT,
		TextColor3 = Theme.GOLD,
		TextSize = 15,
		LayoutOrder = order,
		ZIndex = 5,
		Text = text,
	}, parent)
end

function CareerTab:setProgress(progress: any)
	self.progress = progress
	-- Cheap and yielding: friendsHere is a pcall'd web call on its own thread,
	-- so refreshing it alongside progress costs nothing on the render path.
	self:renderFriends()
	local level = progress.level or 1
	local xp, toNext = progress.xp or 0, progress.xpToNext or 1
	self.levelLabel.Text = `Level {level}`
	-- "🔥2" told the player nothing -- a flame and a bare number, reported as
	-- literally unreadable. It is the DAILY streak, so say so; and at 0 or 1
	-- days there is no streak to advertise, so the chip drops it entirely
	-- rather than boasting about a streak of one.
	local streak = progress.streak or 0
	self.statsLabel.Text = if streak >= 2
		then `{progress.coins or 0} coins   ·   🔥 {streak} day streak`
		else `{progress.coins or 0} coins`
	self.xpFill.Size = UDim2.fromScale(math.clamp(xp / math.max(1, toNext), 0, 1), 1)
	self.xpLabel.Text = `{xp} / {toNext} XP to level {level + 1}`
	self:renderGoals(progress)
	self:renderMilestones(progress)
	self:renderBadges(progress)
end

function CareerTab:renderGoals(progress: any)
	for _, c in self.left:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	sectionTitle(self.left, 1, "TODAY'S GOALS")
	local dailies = progress.dailies or {}
	for i, d in dailies do
		local done = d.claimed == true
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 44),
			BackgroundColor3 = Theme.BROWN_LIGHT,
			BackgroundTransparency = 0.3,
			BorderSizePixel = 0,
			LayoutOrder = i + 1,
			ZIndex = 4,
		}, self.left)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.new(1, -16, 0, 22),
			Position = UDim2.fromOffset(10, 3),
			TextSize = 14,
			Font = Theme.BOLD_FONT,
			TextColor3 = if done then Theme.GREEN else Theme.CREAM,
			ZIndex = 5,
			Text = if done then `✅ {d.name}` else d.name,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -16, 0, 16),
			Position = UDim2.fromOffset(10, 24),
			TextSize = 12,
			TextColor3 = Theme.DIM,
			ZIndex = 5,
			Text = `{math.min(d.progress, d.goal)}/{d.goal}  ·  +{d.coins}c  +{d.xp} XP`,
		}, row)
		-- Toast on the transition, exactly as the old dailies panel did.
		if done and not self.claimed[d.id] then
			self.claimed[d.id] = true
			if self.deps.onToast ~= nil then
				self.deps.onToast(`Daily complete: {d.name}  +{d.coins}c`)
			end
		end
	end

	sectionTitle(self.left, 50, "CAREER")
	local stats = {
		{ "Shifts worked", progress.rounds or 0 },
		{ "Dishes served", progress.totalDishes or 0 },
		-- bestRound is a COIN figure, like the chip and the shop prices; without
		-- the suffix it read as a count of something.
		{ "Best shift", `{progress.bestRound or 0}c` },
	}
	for i, s in stats do
		Theme.label({
			Size = UDim2.new(1, -10, 0, 22),
			TextSize = 14,
			LayoutOrder = 50 + i,
			ZIndex = 5,
			Text = `{s[1]}:  {s[2]}`,
		}, self.left)
	end
end

--- The milestone track: which levels grant which cosmetic, and whether it is
--- already yours. Real data, unlike a badge grid (badge ids are still 0).
--- FRIENDS ALREADY IN A SIZZLE SQUAD KITCHEN.
---
--- Sits beside INVITE FRIENDS because they answer the two halves of the same
--- question: bring someone here, or go to where they already are. Roblox can
--- do the second from a profile page, but sending a player OUT of the
--- experience to come back into it is the moment they stop coming back.
---
--- Only friends with a reachable server are listed. GetFriendsOnline also
--- returns people on the website and in the app, and a "join" that cannot
--- work is worse than an absence.
function CareerTab:renderFriends()
	for _, c in self.friends:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	local social = self.deps and self.deps.social
	if social == nil then
		return
	end
	sectionTitle(self.friends, 1, "FRIENDS PLAYING NOW")
	task.spawn(function()
		local here = social:friendsHere()
		if self.friends == nil or self.friends.Parent == nil then
			return
		end
		if #here == 0 then
			Theme.label({
				Size = UDim2.new(1, -10, 0, 40),
				TextSize = 14,
				TextWrapped = true,
				TextColor3 = Theme.DIM,
				LayoutOrder = 2,
				ZIndex = 5,
				Text = "None right now — invite someone below.",
			}, self.friends)
			return
		end
		for i, f in here do
			local row = Theme.button({
				Size = UDim2.new(1, -10, 0, Theme.MIN_TAP),
				Fill = Theme.BLUE,
				TextSize = 15,
				LayoutOrder = 1 + i,
				ZIndex = 5,
				Text = `JOIN {f.name}`,
			}, self.friends)
			row.Activated:Connect(function()
				social:joinFriend(f.jobId, f.name)
			end)
		end
	end)
end

function CareerTab:renderMilestones(progress: any)
	for _, c in self.right:GetChildren() do
		if not c:IsA("UIListLayout") then
			c:Destroy()
		end
	end
	sectionTitle(self.right, 1, "LEVEL REWARDS")
	local levels = {}
	for lvl in self.catalog.milestones do
		table.insert(levels, lvl)
	end
	table.sort(levels)
	local myLevel = progress.level or 1
	for i, lvl in levels do
		local id = self.catalog.milestones[lvl]
		local item = self.catalog.byId[id]
		local owned = progress.owned ~= nil and progress.owned[id] == true
		local reached = myLevel >= lvl
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 40),
			BackgroundColor3 = if owned then Theme.GREEN else Theme.BROWN_LIGHT,
			BackgroundTransparency = if owned then 0.45 else 0.3,
			BorderSizePixel = 0,
			LayoutOrder = i + 1,
			ZIndex = 4,
		}, self.right)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.fromOffset(52, 40),
			Position = UDim2.fromOffset(10, 0),
			Font = Theme.TITLE_FONT,
			TextColor3 = if reached then Theme.GOLD else Theme.DIM,
			TextSize = 15,
			ZIndex = 5,
			Text = `Lv {lvl}`,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -80, 1, 0),
			Position = UDim2.fromOffset(66, 0),
			TextSize = 14,
			Font = Theme.BOLD_FONT,
			TextColor3 = if reached then Theme.CREAM else Theme.DIM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			Text = if item ~= nil then item.name else id,
		}, row)
	end
end

--- The badge case.
---
--- Badges are awarded by BadgeService and shown on Roblox's own profile page,
--- which is somewhere nobody looks mid-session. The server mirrors each award
--- into the profile so they can live here too, next to the thing that earned
--- them. Locked ones stay visible on purpose: an achievement you cannot see is
--- not a goal.
function CareerTab:renderBadges(progress: any)
	local earned = progress.badges or {}
	local total = 0
	for _, d in BadgeDefs.list do
		if earned[d.key] then
			total += 1
		end
	end
	sectionTitle(self.right, 100, `BADGES  ({total}/{#BadgeDefs.list})`)
	for i, d in BadgeDefs.list do
		local got = earned[d.key] == true
		local row = mk("Frame", {
			Size = UDim2.new(1, -10, 0, 42),
			BackgroundColor3 = if got then Theme.GOLD else Theme.BROWN_LIGHT,
			BackgroundTransparency = if got then 0.55 else 0.45,
			BorderSizePixel = 0,
			LayoutOrder = 100 + i,
			ZIndex = 4,
		}, self.right)
		Theme.corner(row, 8)
		Theme.label({
			Size = UDim2.fromOffset(40, 42),
			Position = UDim2.fromOffset(8, 0),
			TextXAlignment = Enum.TextXAlignment.Center,
			TextSize = 20,
			-- Locked badges keep their icon but lose their colour, so the case
			-- reads as "these exist and you have not got them yet".
			TextTransparency = if got then 0 else 0.55,
			ZIndex = 5,
			Text = d.icon,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -60, 0, 20),
			Position = UDim2.fromOffset(52, 2),
			TextSize = 14,
			Font = Theme.BOLD_FONT,
			TextColor3 = if got then Theme.CREAM else Theme.DIM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			Text = d.name,
		}, row)
		Theme.label({
			Size = UDim2.new(1, -60, 0, 18),
			Position = UDim2.fromOffset(52, 21),
			TextSize = 11,
			TextColor3 = Theme.DIM,
			TextTruncate = Enum.TextTruncate.AtEnd,
			ZIndex = 5,
			Text = d.blurb,
		}, row)
	end
end

function CareerTab:relayout(L: any, _viewport: Vector2)
	-- One column when there is not enough width for two readable ones.
	if L.twoColumn then
		self.left.Size = UDim2.new(0.5, -6, 1, -140)
		self.right.Size = UDim2.new(0.5, -6, 1, -140)
		self.right.Position = UDim2.new(0.5, 6, 0, 86)
		self.right.Visible = true
	else
		self.left.Size = UDim2.new(1, 0, 1, -140)
		self.right.Visible = false
	end
end

return CareerTab
