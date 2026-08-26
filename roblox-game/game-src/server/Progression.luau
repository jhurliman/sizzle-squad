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

-- DataStore hardening --------------------------------------------------------
-- Every call was a bare pcall: one transient failure silently threw away a
-- round's progress, two servers could write the same profile, and a shutdown
-- lost everything since the last autosave.
local RETRIES = 4
local RETRY_BASE = 0.6 -- seconds; doubles each attempt (0.6/1.2/2.4/4.8)
-- How long another server's claim is respected before we assume it died. Must
-- comfortably exceed the autosave interval, which refreshes the claim.
local LOCK_TTL = 150

-- Identifies THIS server. Studio has no JobId, and the headless harnesses have
-- no `game` at all, so fall back to a random id: two sessions must never look
-- like the same owner or they would never lock each other out.
local SERVER_ID = (function(): string
	local ok, id = pcall(function()
		return game.JobId
	end)
	if ok and typeof(id) == "string" and id ~= "" then
		return id
	end
	return `local-{math.random(1, 1000000000)}`
end)()

--- Run a DataStore call with exponential backoff.
---
--- Backoff rather than a tight loop on purpose: DataStore throttling is a
--- BUDGET, so hammering a failing key makes the outage worse for every other
--- request on the server.
local function withRetry<T>(what: string, fn: () -> T): (boolean, T?)
	local delay = RETRY_BASE
	for attempt = 1, RETRIES do
		local ok, res = pcall(fn)
		if ok then
			return true, res
		end
		if attempt == RETRIES then
			warn(`[progression] {what} failed after {RETRIES} attempts: {res}`)
			return false, nil
		end
		task.wait(delay)
		delay *= 2
	end
	return false, nil
end

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
		-- no cosmetic hat by default: the species' built-in hats show until the
		-- player equips one (playtest: paper hat on top of built-in hats = jank)
		equipped = {},
		daily = { day = "", progress = {}, claimed = {} },
		-- Earned badges, mirrored from BadgeService so the game can show a
		-- badge case of its own; Roblox's profile page is otherwise the only
		-- place they ever appear.
		badges = {},
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
	-- player -> what the last round paid them (coins/xp/levels). Consumed by
	-- the results ceremony and by analytics; both need the delta, not the
	-- running total.
	self.lastAward = {} :: { [any]: any }
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
		-- Load AND claim in one UpdateAsync, so the read and the lock write
		-- cannot interleave with another server doing the same thing.
		local key = `p{player.UserId}`
		local ok, loaded = withRetry(`load {key}`, function()
			local out
			self.stores.profiles:UpdateAsync(key, function(old)
				local p = old or {}
				local lock = p.__lock
				if lock ~= nil and lock.server ~= SERVER_ID and (os.time() - (lock.at or 0)) < LOCK_TTL then
					-- Live elsewhere. Abort the write; the retry loop backs off
					-- and the claim expires on its own if that server died.
					return nil
				end
				p.__lock = { server = SERVER_ID, at = os.time() }
				out = p
				return p
			end)
			return out
		end)
		if ok and loaded ~= nil then
			for k, v in loaded do
				if k ~= "__lock" then
					profile[k] = v
				end
			end
		elseif ok then
			-- Someone else holds the profile and would not let go. Play on with
			-- a session-only profile rather than blocking the join, but never
			-- write it back: that is how you overwrite a live session.
			warn(`[progression] {player.Name} profile is locked by another server; session-only`)
			profile.__readOnly = true
		end
	end
	-- roll dailies for today
	if profile.daily.day ~= dayKey() then
		profile.daily = { day = dayKey(), progress = {}, claimed = {} }
	end
	-- Session count drives the Kitchen Card, which must never appear on a
	-- player's first-ever session (FirstShift owns that moment).
	profile.sessions = (profile.sessions or 0) + 1
	-- A brand-new chef arrives bare-headed even though they already own the
	-- Paper Hat, so their first shift looks like the game forgot to dress
	-- them. Put it on; they can take it off in the wardrobe.
	if profile.sessions == 1 and profile.equipped.hat == nil and profile.owned.hat_paper then
		profile.equipped.hat = "hat_paper"
	end
	self.dirty[player] = true
	self.profiles[player] = profile
	self:push(player)
end

function Progression:playerRemoving(player: any)
	self.lastAward[player] = nil
	self:save(player, true)
	self.profiles[player] = nil
	self.dirty[player] = nil
end

--- Persist a profile. `release` drops our claim (used on leave and shutdown).
function Progression:save(player: any, release: boolean?)
	local profile = self.profiles[player]
	if profile == nil or self.stores == nil then
		return
	end
	if profile.__readOnly then
		return -- never write a profile we could not claim
	end
	local key = `p{player.UserId}`
	withRetry(`save {key}`, function()
		self.stores.profiles:UpdateAsync(key, function(old)
			local lock = old ~= nil and old.__lock or nil
			if lock ~= nil and lock.server ~= SERVER_ID and (os.time() - (lock.at or 0)) < LOCK_TTL then
				-- Another server claimed it while we were playing: drop our
				-- write rather than clobbering a live session.
				return nil
			end
			local out = table.clone(profile)
			out.__lock = if release then nil else { server = SERVER_ID, at = os.time() }
			return out
		end)
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
		-- Only present on the push that follows a round award.
		award = self.lastAward[player],
		sessions = profile.sessions or 1,
		badges = profile.badges or {},
		-- The client used to infer species from EquipDeltas.skin; send it.
		species = profile.species,
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
	self.lastAward = {}
	local humans = math.max(1, crew:humanCount())
	local today = dayKey()

	for player, seat in crew.seats do
		local profile = self.profiles[player]
		if profile == nil then
			continue
		end
		local stats = results.stats[seat.chefId] or {}
		local serves = stats.serves or 0

		-- Coins: the FULL team value, not a share of it. Dividing by crew size
		-- meant a fourth player cost everyone 75% of their pay, which punished
		-- exactly the thing a co-op game wants to encourage.
		local mult = self.coinMultiplier ~= nil and self:coinMultiplier(player) or 1
		local crewBonus = (humans - 1) * (config.CREW_BONUS_PER_MATE or 0)
		local coinsEarned = math.floor((results.coins + results.stars * 10 + crewBonus) * mult)
		profile.coins += coinsEarned
		profile.rounds += 1
		profile.totalDishes += serves
		profile.bestRound = math.max(profile.bestRound, results.coins)

		-- xp
		local xp = math.min(
			config.XP_SOFT_CAP,
			config.XP_BASE + serves * config.XP_PER_DISH + results.stars * config.XP_PER_STAR
		)
		-- Supporter Pass XP boost (1.0 when nothing is owned / unconfigured).
		if self.xpMultiplier ~= nil then
			xp = math.floor(xp * self:xpMultiplier(player))
		end
		profile.xp += xp
		local levelsGained, granted = 0, {}
		while profile.xp >= config.LEVEL_CURVE(profile.level) do
			profile.xp -= config.LEVEL_CURVE(profile.level)
			profile.level += 1
			levelsGained += 1
			profile.coins += profile.level * 25
			local grant = self.catalog.milestones[profile.level]
			if grant ~= nil then
				profile.owned[grant] = true
				table.insert(granted, grant)
			end
			if self.onLevelUp ~= nil then
				self.onLevelUp(player, profile.level)
			end
		end

		-- What this shift was worth, per player. The results ceremony counts
		-- these up on screen, and analytics logs them as an economy source --
		-- both need the DELTA, which nothing was recording.
		self.lastAward[player] = {
			coins = coinsEarned,
			xp = xp,
			levels = levelsGained,
			level = profile.level,
			granted = granted,
			balance = profile.coins,
			stars = results.stars,
			served = serves,
		}

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
			withRetry(`boards u{player.UserId}`, function()
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

	-- Periodic autosave. This also REFRESHES the lock, which is why LOCK_TTL
	-- has to be comfortably longer than the autosave interval.
	if os.clock() - self.lastSave > AUTOSAVE_SECONDS then
		self.lastSave = os.clock()
		local pending = {}
		for player in self.dirty do
			table.insert(pending, player)
		end
		table.clear(self.dirty)
		-- save() yields on retry, so snapshot the list first.
		task.spawn(function()
			for _, player in pending do
				self:save(player)
			end
		end)
	end
end

-- ------------------------------------------------------------------- shop

function Progression:shopAction(player: any, action: any)
	local profile = self.profiles[player]
	if profile == nil or typeof(action) ~= "table" then
		return
	end
	-- equipSet carries a whole outfit rather than one id, so it is handled
	-- before the single-item lookup.
	if action.action == "equipSet" then
		self:equipSet(player, profile, action.set)
		return
	end
	local item = self.catalog.byId[action.id]
	if item == nil then
		return
	end
	-- A hidden item is a reserved id whose in-game consumer is not built yet.
	-- Refuse it server-side too: filtering it out of the shop UI alone would
	-- leave a crafted remote able to spend coins on something invisible.
	if item.hidden then
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
		-- equip toggles: equipping the equipped item takes it off
		local slot = self.catalog.slotKey(item)
		if profile.equipped[slot] == item.id then
			profile.equipped[slot] = nil
		else
			profile.equipped[slot] = item.id
		end
		self.dirty[player] = true
	end
	self:push(player)
end

-- ----------------------------------------------------------------- species

local SPECIES = { bramble = true, pip = true, nori = true, mochi = true }

--- Commit several equip slots at once.
---
--- Keys are SLOT keys (hat / palette / emote / kitchen_plate / ...). A string
--- value equips, `false` clears the slot, and an absent key leaves the slot
--- alone -- so a client that only manages hats cannot accidentally strip the
--- player's plates. Every entry is validated independently against ownership
--- and slot, and a bad one is dropped rather than rejecting the whole set.
function Progression:equipSet(player: any, profile: any, set: any)
	if typeof(set) ~= "table" then
		return
	end
	for slot, id in set do
		if typeof(slot) ~= "string" then
			continue
		end
		if id == false then
			profile.equipped[slot] = nil
		elseif typeof(id) == "string" then
			local it = self.catalog.byId[id]
			if it ~= nil and not it.hidden and profile.owned[id] and self.catalog.slotKey(it) == slot then
				profile.equipped[slot] = id
			end
		end
	end
	self.dirty[player] = true
	self:push(player)
end

--- Record a badge the server just granted (or found the player already owns),
--- so the Career tab can show it without asking BadgeService per frame.
function Progression:markBadge(player: any, key: string)
	local profile = self.profiles[player]
	if profile == nil then
		return
	end
	profile.badges = profile.badges or {}
	if profile.badges[key] then
		return
	end
	profile.badges[key] = true
	self.dirty[player] = true
	self:push(player)
end

--- Emote allowlist for the Emote remote: only cosmetics the player owns.
function Progression:ownsEmote(player: any, id: string): boolean
	local profile = self.profiles[player]
	if profile == nil then
		return false
	end
	local item = self.catalog.byId[id]
	return item ~= nil and item.kind == "emote" and profile.owned[id] == true
end

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

--- Flush every profile on shutdown.
---
--- Roblox gives BindToClose roughly 30 seconds and then kills the server, so
--- without this a shutdown ate everything since the last autosave -- up to a
--- full round of coins, XP and unlocks. Saves run in parallel and the whole
--- thing is bounded, because a hung DataStore must not eat the entire budget.
function Progression:flushAll()
	local pending = {}
	for player in self.profiles do
		table.insert(pending, player)
	end
	local left = #pending
	if left == 0 then
		return
	end
	for _, player in pending do
		task.spawn(function()
			self:save(player, true)
			left -= 1
		end)
	end
	local deadline = os.clock() + 20
	while left > 0 and os.clock() < deadline do
		task.wait(0.1)
	end
	if left > 0 then
		warn(`[progression] shutdown flush timed out with {left} profile(s) unsaved`)
	end
end

return Progression
