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

-- DATASTORES ARE PER-UNIVERSE, NOT PER-PLACE.
--
-- The only way to get a staging place on Roblox is a second place in the SAME
-- universe -- there is no other kind -- and that means it shares every
-- DataStore with live by default. Not a subtle overlap: the same profiles, the
-- same leaderboards. One playthrough on staging spends a real player's coins
-- and writes the result back over their save.
--
-- So anything that is not live gets its own namespace. Live is matched by id
-- and left exactly as it was, and so is Studio (PlaceId 0, or nil under a
-- Lune harness), which means the names change for precisely one thing: a
-- staging place, which has no data to lose. Getting this wrong in the other
-- direction would rename live's stores and lose everybody's progression, which
-- is why the condition names live rather than trying to detect staging.
--
-- check-luau asserts this id matches the one the publish tooling defaults to,
-- so the two cannot drift apart the way the place id already did once.
local LIVE_PLACE_ID = 113028832194057

local function scoped(name: string): string
	local placeId = tonumber((game :: any).PlaceId) or 0
	if placeId == 0 or placeId == LIVE_PLACE_ID then
		return name
	end
	return `{name}__p{placeId}`
end
local AUTOSAVE_SECONDS = 60

-- DataStore hardening --------------------------------------------------------
-- Every call was a bare pcall: one transient failure silently threw away a
-- round's progress, two servers could write the same profile, and a shutdown
-- lost everything since the last autosave.
local RETRIES = 4
local RETRY_BASE = 0.6 -- seconds; doubles each attempt (0.6/1.2/2.4/4.8)

-- CLAIMING A PROFILE GETS ITS OWN, LONGER BUDGET.
--
-- The contended case this exists for is a TELEPORT: First Shift runs in a
-- reserved server and sends the player home, and the origin server's
-- PlayerRemoving (which releases the lock) can land after the destination has
-- already tried to claim. That gap is a second or two, so a claim that gives
-- up instantly turns a routine handoff into a lost tutorial payout, while one
-- that waits ~5s rides straight over it.
--
-- Bounded on purpose: the player is held on the loading screen for this, so a
-- lock that is genuinely live must lose rather than hang the join.
local CLAIM_RETRIES = 5
local CLAIM_BASE = 0.35 -- 0.35/0.7/1.4/2.8 -> ~5.25s before giving up
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
local function withRetry<T>(what: string, fn: () -> T, attempts: number?, base: number?): (boolean, T?)
	local tries = attempts or RETRIES
	local delay = base or RETRY_BASE
	for attempt = 1, tries do
		local ok, res = pcall(fn)
		if ok then
			return true, res
		end
		if attempt == tries then
			warn(`[progression] {what} failed after {tries} attempts: {res}`)
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

--- HOW FAR A PLAYER GOT, AS AN ORDERED FUNNEL.
---
--- `rounds > 0` answers "did they ever finish a shift" and nothing else, so a
--- player who quit is indistinguishable from one who never got a chef. These
--- are the stages between, every one of them derived from state the SERVER
--- already owns -- no client telemetry, no new remotes, nothing to trust.
---
--- It lives in the profile rather than in AnalyticsService because a profile
--- can be read back through Open Cloud and an analytics event cannot: those
--- are Creator-Dashboard-only, aggregate, never per-player. Writing the funnel
--- into the profile is the only way to ask "where did THIS player stop".
local REACH_ORDER: { [string]: number } = {
	joined = 1, -- PlayerAdded ran; they exist to the server
	seated = 2, -- got a chef; the round can see them
	moved = 3, -- first movement input that actually moved
	pressed = 4, -- first action press
	carried = 5, -- held an item: they understood pick-up
	worked = 6, -- committed to a station: chopping, frying, washing
	finished = 7, -- completed a shift
}

local function defaultProfile(): any
	return {
		xp = 0,
		level = 1,
		coins = 0,
		rounds = 0,
		totalDishes = 0,
		bestRound = 0,
		-- Seconds of real play, accumulated across sessions. Nothing recorded
		-- time before this, so "how long did they last" was unanswerable.
		playSeconds = 0,
		-- Furthest funnel stage ever reached (see REACH_ORDER).
		reach = "",
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
	-- player -> os.clock() at the last accrual, for playSeconds.
	self.joinedAt = {} :: { [any]: number }
	self.lastSave = os.clock()

	self.stores = nil
	pcall(function()
		local DataStoreService = dataStores or game:GetService("DataStoreService")
		self.stores = {
			profiles = DataStoreService:GetDataStore(scoped(PROFILE_STORE)),
			allTime = DataStoreService:GetOrderedDataStore(scoped(BOARD_ALLTIME)),
			weekly = DataStoreService:GetOrderedDataStore(scoped("SizzleWeekly_" .. weekKey())),
			dishes = DataStoreService:GetOrderedDataStore(scoped(BOARD_DISHES)),
		}
	end)
	if self.stores == nil then
		-- SILENCE HERE COSTS AN HOUR. With no DataStore every session starts
		-- from nothing, which in Studio means `rounds` is 0 forever, which
		-- means needsTutorial is true forever, which means First Shift runs on
		-- every single playtest -- and none of that announces itself. The pcall
		-- is right (a DataStore outage must not stop the game) but it should
		-- not be quiet.
		warn("[progression] no DataStore — nothing will persist this session (Studio: PlaceId 0, or API services off)")
	end
	return self
end

-- ------------------------------------------------------------- profile I/O

function Progression:playerAdded(player: any, sameSession: boolean?)
	local profile = defaultProfile()
	if self.stores ~= nil then
		-- Load AND claim in one UpdateAsync, so the read and the lock write
		-- cannot interleave with another server doing the same thing.
		local key = `p{player.UserId}`
		local ok, loaded = withRetry(`claim {key}`, function()
			local out
			local contended = false
			self.stores.profiles:UpdateAsync(key, function(old)
				local p = old or {}
				local lock = p.__lock
				if lock ~= nil and lock.server ~= SERVER_ID and (os.time() - (lock.at or 0)) < LOCK_TTL then
					-- Live elsewhere. Cancel the write and say so LOUDLY --
					-- see the error below.
					contended = true
					return nil
				end
				p.__lock = { server = SERVER_ID, at = os.time() }
				out = p
				return p
			end)
			if contended then
				-- ONLY A THROWN ERROR REACHES THE BACKOFF.
				--
				-- Returning nil from an UpdateAsync transform cancels the write
				-- WITHOUT throwing, so UpdateAsync returns perfectly normally
				-- and withRetry saw a clean success carrying nil. It went
				-- straight to a read-only session on the very first attempt,
				-- with no wait and no second look -- while the comment above it
				-- claimed a backoff that had never once run.
				--
				-- Contention is the retryable case, not the terminal one: the
				-- holder is usually a server that is in the middle of letting
				-- go. Raising it converts "give up instantly" into "wait for
				-- the handoff", which is the whole point of the lock TTL.
				error(`{key} is claimed by another server`, 0)
			end
			return out
		end, self.claimRetries or CLAIM_RETRIES, self.claimBase or CLAIM_BASE)
		if ok and loaded ~= nil then
			for k, v in loaded do
				if k ~= "__lock" then
					profile[k] = v
				end
			end
		else
			-- We do not own this profile: either another server held it for the
			-- whole backoff, or the DataStore itself would not answer. Play on
			-- with a session-only copy rather than blocking the join, and never
			-- write it back -- that is how you overwrite a live session.
			--
			-- The DataStore-failure case used to fall through this branch
			-- entirely and leave __readOnly unset, so a transient outage at join
			-- handed the player a DEFAULT profile that the next autosave then
			-- wrote over the top of their real one.
			warn(`[progression] {player.Name} profile not claimed; session-only`)
			profile.__readOnly = true
		end
	end
	-- roll dailies for today
	if profile.daily.day ~= dayKey() then
		profile.daily = { day = dayKey(), progress = {}, claimed = {} }
	end
	-- Session count drives the Kitchen Card, which must never appear on a
	-- player's first-ever session (FirstShift owns that moment).
	--
	-- A teleport inside this experience is the SAME session continuing. This
	-- used to increment on every server join, so a brand-new player arrived at
	-- their own First Shift server already reading `sessions == 2`: the
	-- auto-start was skipped, the Kitchen Card threw "Welcome back, chef" over
	-- the Start button, and the onboarding funnel recorded nothing for anyone.
	if not sameSession then
		profile.sessions = (profile.sessions or 0) + 1
	end
	-- A brand-new chef arrives bare-headed even though they already own the
	-- Paper Hat, so their first shift looks like the game forgot to dress
	-- them. Put it on; they can take it off in the wardrobe.
	if profile.sessions == 1 and profile.equipped.hat == nil and profile.owned.hat_paper then
		profile.equipped.hat = "hat_paper"
	end
	-- WHEN, not just how often. `os.time` is wall-clock epoch seconds and is
	-- the only thing here that survives a server restart; `os.clock` is server
	-- uptime and is useless across sessions.
	local nowEpoch = os.time()
	profile.firstJoinAt = profile.firstJoinAt or nowEpoch
	profile.lastSeenAt = nowEpoch
	self.joinedAt[player] = os.clock()
	-- STUDIO RETURNING-PLAYER SHIM, APPLIED BEFORE THE FIRST PUSH.
	--
	-- Set by main.server when Config.STUDIO_RETURNING_PLAYER is on. It has to
	-- land here rather than after playerAdded returns, because push() is the
	-- thing the client's maybeAutoStart reacts to: shimming afterwards and
	-- pushing again means the client has already seen sessions = 1, already
	-- decided this is somebody's first ever visit, and already readied them
	-- into a round before the correction arrives.
	if self.studioReturning then
		profile.sessions = math.max(profile.sessions or 1, 2)
		profile.rounds = math.max(profile.rounds or 0, 1)
	end
	self.dirty[player] = true
	self.profiles[player] = profile
	self:push(player)
end

--- Fold the time since the last accrual into `playSeconds`. Called on leave and
--- on every autosave, so a server that dies without a clean PlayerRemoving
--- still loses at most one autosave interval rather than the whole session.
function Progression:accrue(player: any)
	local started = self.joinedAt[player]
	local profile = self.profiles[player]
	if started == nil or profile == nil then
		return
	end
	local now = os.clock()
	profile.playSeconds = (profile.playSeconds or 0) + (now - started)
	profile.lastSeenAt = os.time()
	self.joinedAt[player] = now
	self.dirty[player] = true
end

--- Record the furthest point this player has reached. Monotonic: a later
--- session can push it forward, never back, so the value always answers "the
--- best they ever managed" -- which for anyone who never returns is also
--- exactly where they gave up.
function Progression:noteReach(player: any, stage: string)
	local profile = self.profiles[player]
	local rank = REACH_ORDER[stage]
	if profile == nil or rank == nil then
		return
	end
	if (REACH_ORDER[profile.reach] or 0) >= rank then
		return
	end
	profile.reach = stage
	self.dirty[player] = true
end

--- Has this player got at least as far as `stage`? Lets a caller gate one
--- stage on another (you cannot have carried a plate before you pressed).
function Progression:reached(player: any, stage: string): boolean
	local profile = self.profiles[player]
	if profile == nil then
		return false
	end
	return (REACH_ORDER[profile.reach] or 0) >= (REACH_ORDER[stage] or math.huge)
end

function Progression:playerRemoving(player: any)
	self:accrue(player)
	self.joinedAt[player] = nil
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
		-- FirstShift gates on this, not only on `rounds`: a player teleported
		-- out of the tutorial reaches a live server before the profile lands,
		-- and `rounds` reads 0 for long enough to put the coach back on screen
		-- in a real round.
		tutorialDone = profile.tutorialDone == true,
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

--- `tutorial` marks the First Shift payout: a flat bonus on top of the normal
--- round award, applied BEFORE the level-up loop so it actually ranks the
--- player up, and a permanent flag so the tutorial can never be paid twice.
--- Advance today's goals and pay out any that completed. Returns the coins and
--- XP earned so `awardRound` can fold them into the one figure it reports —
--- this deliberately does NOT touch profile.coins or profile.xp itself.
function Progression:settleDailies(profile: any, results: any, stats: any, today: string): (number, number)
	if profile.daily.day ~= today then
		profile.daily = { day = today, progress = {}, claimed = {} }
	end
	local counters = table.clone(stats)
	counters.stars3 = if results.stars >= 3 then 1 else 0
	counters.combo8 = if results.bestCombo >= 8 then 1 else 0
	local coins, xp = 0, 0
	for _, d in self:todaysDailies() do
		if not profile.daily.claimed[d.id] then
			local p = (profile.daily.progress[d.id] or 0) + (counters[d.stat] or 0)
			profile.daily.progress[d.id] = p
			if p >= d.goal then
				profile.daily.claimed[d.id] = true
				local streakMul = math.min(1.5, 1 + 0.1 * math.max(0, profile.streak.count - 1))
				coins += math.floor(d.coins * streakMul)
				xp += d.xp
			end
		end
	end
	return coins, xp
end

function Progression:awardRound(crew: any, results: any, tutorial: boolean?)
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
		-- Added after the soft cap, not before: the cap exists to stop a huge
		-- round paying out forever, and this is a fixed completion bonus, not
		-- performance. BONUS_XP is exactly LEVEL_CURVE(1), so a player who
		-- finishes First Shift arrives in their first real kitchen at level 2.
		if tutorial then
			local t = config.TUTORIAL
			xp += t.BONUS_XP
			coinsEarned += t.BONUS_COINS
			profile.coins += t.BONUS_COINS
			profile.tutorialDone = true
			-- HOW LONG FIRST SHIFT TOOK, to the second, once. playSeconds keeps
			-- counting through whatever they play next, so "did the tutorial
			-- fit in 80s" cannot be read from it after the fact; this is the
			-- clock at the moment the tutorial paid out. Accrue first so the
			-- seconds since the last autosave are in it, and never overwrite:
			-- a player sent back through First Shift keeps their first time.
			if profile.firstShiftSeconds == nil then
				self:accrue(player)
				profile.firstShiftSeconds = profile.playSeconds
			end
		end
		-- WHERE THE BAR WAS BEFORE THIS SHIFT.
		--
		-- The results screen wants to run the bar UP from where the player left
		-- it and roll through each level they gained on the way. It cannot
		-- reconstruct that from the after-state: `level` and `xp` are post-award
		-- and the curve is not invertible once more than one level went by.
		-- DAILIES ARE PART OF THIS SHIFT'S PAY, SO THEY ARE SETTLED HERE.
		--
		-- They used to be resolved AFTER the level-up loop and after the award
		-- record was written, which broke three things at once: their coins
		-- never appeared in the figure the results screen showed, their XP
		-- could not contribute to a level gained this round (it sat above the
		-- curve until the NEXT round's loop happened to consume it, so the
		-- level-up arrived a round late and unexplained), and analytics logged
		-- an income source it could not see.
		local dailyCoins, dailyXp = self:settleDailies(profile, results, stats, today)
		xp += dailyXp

		local xpBefore, levelBefore = profile.xp, profile.level
		profile.xp += xp
		-- Level-up cash is real income and has to be reported as such: five
		-- levels is 500 coins arriving with nothing on screen accounting for
		-- it, which is most of "how do I have 2,000 coins?".
		local levelCoins = 0
		local levelsGained, granted = 0, {}
		while profile.xp >= config.LEVEL_CURVE(profile.level) do
			profile.xp -= config.LEVEL_CURVE(profile.level)
			profile.level += 1
			levelsGained += 1
			levelCoins += profile.level * 25
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
		-- Everything earned this shift, credited in one place and reported as
		-- one number. Coins used to be added to the profile from three separate
		-- lines and only one of them was ever shown.
		profile.coins += levelCoins + dailyCoins
		self.lastAward[player] = {
			coins = coinsEarned + levelCoins + dailyCoins,
			roundCoins = coinsEarned,
			levelCoins = levelCoins,
			dailyCoins = dailyCoins,
			dailyXp = dailyXp,
			xp = xp,
			xpBefore = xpBefore,
			levelBefore = levelBefore,
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

		-- The funnel's last stage, noted HERE with the round it belongs to,
		-- not by the caller afterwards: the two used to be separated by a
		-- callback tail that threw before it got there, and every completer
		-- persisted as "worked". Whatever happens after awardRound returns,
		-- a paid round is a finished one.
		self:noteReach(player, "finished")
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

	self:heartbeat()
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

--- Is anyone in this crew about to work their very first shift?
---
--- Deliberately "any", not "all": a newcomer dropping into a veteran server
--- still deserves a board that teaches, and a scripted opening costs an
--- experienced player nothing -- it is three ordinary tickets in a sane order.
function Progression:crewNeedsFirstShift(crew: any): boolean
	for player in crew.seats do
		local profile = self.profiles[player]
		if profile ~= nil and (profile.rounds or 0) == 0 then
			return true
		end
	end
	return false
end

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
--- The periodic path: autosave and time accrual. Called every frame from the
--- composition root; cheap unless AUTOSAVE_SECONDS have passed.
---
--- This used to live inside awardRound, which meant "periodic" was really
--- "whenever a round ends" -- so for the majority of players, who never finish
--- one, nothing here ever ran, and the lock refresh it provides never happened
--- during a 180 s round against a 150 s LOCK_TTL.
function Progression:heartbeat()
	if os.clock() - self.lastSave <= AUTOSAVE_SECONDS then
		return
	end
	self.lastSave = os.clock()
	-- Fold elapsed play time in BEFORE snapshotting the dirty set, so a server
	-- that dies between autosaves loses at most one interval of playSeconds
	-- rather than the whole session. accrue() marks dirty, so anyone currently
	-- in the kitchen is included below.
	for player in self.profiles do
		self:accrue(player)
	end
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

function Progression:flushAll()
	local pending = {}
	for player in self.profiles do
		-- Everyone still connected gets their time folded in first, or the
		-- shutdown save persists a playSeconds that stops at the last accrual.
		self:accrue(player)
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
