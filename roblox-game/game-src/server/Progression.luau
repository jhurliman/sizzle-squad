--!strict
-- Persistence + progression (plan §2.4/§2.5): per-player profile (XP, level,
-- career coins, cosmetics, challenges, streaks), round payouts, leaderboard
-- writes, assist qualification. All DataStore traffic is pcall-wrapped and
-- degrades to session-only when APIs are unavailable (Studio without access).

local Progression = {}
Progression.__index = Progression

local PROFILE_STORE = "SizzleProfiles_v1"
local BOARD_ALLTIME = "SizzleBestRound_v1"
local BOARD_DISHES = "SizzleCareerDishes_v1"
local AUTOSAVE_SECONDS = 60

local DAILIES = {
	{ id = "serve10", name = "Serve 10 dishes", stat = "serves", goal = 10, coins = 60, xp = 40 },
	{ id = "chop15", name = "Chop 15 ingredients", stat = "chops", goal = 15, coins = 50, xp = 30 },
	{ id = "wash8", name = "Wash 8 plates", stat = "washes", goal = 8, coins = 50, xp = 30 },
	{ id = "cook12", name = "Cook 12 ingredients", stat = "cooks", goal = 12, coins = 50, xp = 30 },
	{ id = "star3", name = "Finish a 3-star round", stat = "stars3", goal = 1, coins = 80, xp = 60 },
	{ id = "combo8", name = "Reach an 8x combo", stat = "combo8", goal = 1, coins = 70, xp = 50 },
}

local function defaultProfile(): any
	return {
		xp = 0,
		level = 1,
		coins = 0,
		rounds = 0,
		totalDishes = 0,
		bestRound = 0,
		owned = { hat_paper = true },
		equipped = { hat = "hat_paper" },
		daily = { day = "", progress = {}, claimed = {} },
		streak = { lastDay = "", count = 0, graceUsedWeek = "" },
	}
end

local function dayKey(): string
	return os.date("!%Y-%m-%d") :: string
end

local function weekKey(): string
	return os.date("!%Y-W%W") :: string
end

function Progression.new(config: any, remotes: { [string]: any }, catalog: any, dataStores: any?)
	local self = setmetatable({}, Progression)
	self.config = config
	self.remotes = remotes
	self.catalog = catalog
	self.profiles = {} :: { [any]: any }
	self.dirty = {} :: { [any]: boolean }
	self.lastSave = os.clock()

	self.stores = nil
	pcall(function()
		local DataStoreService = dataStores or game:GetService("DataStoreService")
		self.stores = {
			profiles = DataStoreService:GetDataStore(PROFILE_STORE),
			allTime = DataStoreService:GetOrderedDataStore(BOARD_ALLTIME),
			weekly = DataStoreService:GetOrderedDataStore("SizzleWeekly_" .. weekKey()),
			dishes = DataStoreService:GetOrderedDataStore(BOARD_DISHES),
		}
	end)
	return self
end

-- ------------------------------------------------------------- profile I/O

function Progression:playerAdded(player: any)
	local profile = defaultProfile()
	if self.stores ~= nil then
		pcall(function()
			local saved = self.stores.profiles:GetAsync(`p{player.UserId}`)
			if saved ~= nil then
				for k, v in saved do
					profile[k] = v
				end
			end
		end)
	end
	-- roll dailies for today
	if profile.daily.day ~= dayKey() then
		profile.daily = { day = dayKey(), progress = {}, claimed = {} }
	end
	self.profiles[player] = profile
	self:push(player)
end

function Progression:playerRemoving(player: any)
	self:save(player)
	self.profiles[player] = nil
	self.dirty[player] = nil
end

function Progression:save(player: any)
	local profile = self.profiles[player]
	if profile == nil or self.stores == nil then
		return
	end
	pcall(function()
		self.stores.profiles:SetAsync(`p{player.UserId}`, profile)
	end)
end

--- Replicate the player's progression state to their client.
function Progression:push(player: any)
	local profile = self.profiles[player]
	if profile == nil then
		return
	end
	local dailies = {}
	for _, d in self:todaysDailies() do
		table.insert(dailies, {
			id = d.id,
			name = d.name,
			goal = d.goal,
			progress = profile.daily.progress[d.id] or 0,
			claimed = profile.daily.claimed[d.id] == true,
			coins = d.coins,
			xp = d.xp,
		})
	end
	self.remotes.Progress:FireClient(player, {
		xp = profile.xp,
		level = profile.level,
		xpToNext = self.config.LEVEL_CURVE(profile.level),
		coins = profile.coins,
		rounds = profile.rounds,
		totalDishes = profile.totalDishes,
		bestRound = profile.bestRound,
		owned = profile.owned,
		equipped = profile.equipped,
		dailies = dailies,
		streak = profile.streak.count,
	})
end

--- Three dailies for today, picked deterministically from the pool by date.
function Progression:todaysDailies(): { any }
	local seedStr = dayKey()
	local h = 0
	for i = 1, #seedStr do
		h = (h * 31 + string.byte(seedStr, i)) % 1e9
	end
	local out = {}
	local pool = table.clone(DAILIES)
	for _ = 1, 3 do
		h = (h * 1103515245 + 12345) % 2 ^ 31
		local i = (h % #pool) + 1
		table.insert(out, pool[i])
		table.remove(pool, i)
	end
	return out
end

-- ------------------------------------------------------------- round awards

function Progression:awardRound(crew: any, results: any)
	local config = self.config
	local humans = math.max(1, crew:humanCount())
	local today = dayKey()

	for player, seat in crew.seats do
		local profile = self.profiles[player]
		if profile == nil then
			continue
		end
		local stats = results.stats[seat.chefId] or {}
		local serves = stats.serves or 0

		-- coins: even team share + star bonus
		local coinShare = math.floor(results.coins / humans) + results.stars * 10
		profile.coins += coinShare
		profile.rounds += 1
		profile.totalDishes += serves
		profile.bestRound = math.max(profile.bestRound, results.coins)

		-- xp
		local xp = math.min(
			config.XP_SOFT_CAP,
			config.XP_BASE + serves * config.XP_PER_DISH + results.stars * config.XP_PER_STAR
		)
		profile.xp += xp
		while profile.xp >= config.LEVEL_CURVE(profile.level) do
			profile.xp -= config.LEVEL_CURVE(profile.level)
			profile.level += 1
			profile.coins += profile.level * 25
			local grant = self.catalog.milestones[profile.level]
			if grant ~= nil then
				profile.owned[grant] = true
			end
		end

		-- streak (grace token: one missed day per week forgiven)
		local streak = profile.streak
		if streak.lastDay ~= today then
			local yesterday = os.date("!%Y-%m-%d", os.time() - 86400) :: string
			if streak.lastDay == yesterday then
				streak.count += 1
			elseif streak.lastDay ~= "" and streak.graceUsedWeek ~= weekKey() then
				streak.graceUsedWeek = weekKey()
				streak.count += 1
			else
				streak.count = 1
			end
			streak.lastDay = today
		end

		-- dailies
		if profile.daily.day ~= today then
			profile.daily = { day = today, progress = {}, claimed = {} }
		end
		local counters = table.clone(stats)
		counters.stars3 = if results.stars >= 3 then 1 else 0
		counters.combo8 = if results.bestCombo >= 8 then 1 else 0
		for _, d in self:todaysDailies() do
			if not profile.daily.claimed[d.id] then
				local p = (profile.daily.progress[d.id] or 0) + (counters[d.stat] or 0)
				profile.daily.progress[d.id] = p
				if p >= d.goal then
					profile.daily.claimed[d.id] = true
					local streakMul = math.min(1.5, 1 + 0.1 * math.max(0, profile.streak.count - 1))
					profile.coins += math.floor(d.coins * streakMul)
					profile.xp += d.xp
				end
			end
		end

		self.dirty[player] = true
		self:push(player)

		-- leaderboards (server-authoritative; clamp against a generous
		-- per-round ceiling before writing, quarantine anything above)
		if self.stores ~= nil and results.coins <= 5000 then
			pcall(function()
				local key = `u{player.UserId}`
				self.stores.allTime:UpdateAsync(key, function(old)
					return math.max(old or 0, results.coins)
				end)
				self.stores.weekly:UpdateAsync(key, function(old)
					return math.max(old or 0, results.coins)
				end)
				if serves > 0 then
					self.stores.dishes:IncrementAsync(key, serves)
				end
			end)
		end
	end

	-- periodic autosave
	if os.clock() - self.lastSave > AUTOSAVE_SECONDS then
		self.lastSave = os.clock()
		for player in self.dirty do
			self:save(player)
		end
		table.clear(self.dirty)
	end
end

-- ------------------------------------------------------------------- shop

function Progression:shopAction(player: any, action: any)
	local profile = self.profiles[player]
	if profile == nil or typeof(action) ~= "table" then
		return
	end
	local item = self.catalog.byId[action.id]
	if item == nil then
		return
	end
	if action.action == "buy" then
		if profile.owned[item.id] then
			return
		end
		if item.level ~= nil and profile.level < item.level then
			return
		end
		if item.cost <= 0 or profile.coins < item.cost then
			return
		end
		profile.coins -= item.cost
		profile.owned[item.id] = true
		self.dirty[player] = true
	elseif action.action == "equip" then
		if not profile.owned[item.id] then
			return
		end
		profile.equipped[item.kind] = item.id
		self.dirty[player] = true
	end
	self:push(player)
end

-- ----------------------------------------------------------------- species

local SPECIES = { bramble = true, pip = true, nori = true, mochi = true }

function Progression:setSpecies(player: any, species: any): boolean
	local profile = self.profiles[player]
	if profile == nil or typeof(species) ~= "string" or not SPECIES[species] then
		return false
	end
	profile.species = species
	self.dirty[player] = true
	return true
end

-- ------------------------------------------------------------------ assist

function Progression:crewQualifiesForAssist(crew: any): boolean
	local total, n = 0, 0
	local rounds = 0
	for player in crew.seats do
		local profile = self.profiles[player]
		if profile ~= nil then
			total += profile.level
			rounds += profile.rounds
			n += 1
		end
	end
	if n == 0 then
		return false
	end
	return (total / n) < self.config.ASSIST_LEVEL or (rounds / n) < self.config.ASSIST_ROUNDS
end

return Progression
