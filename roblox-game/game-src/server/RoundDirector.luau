--!strict
-- The round loop: countdown -> round -> results -> intermission -> (ready-up)
-- -> round... Owns difficulty (human-count pacing table + invisible pressure
-- director + assist mode) by writing the sim's DirectorKnobs, and produces
-- the results payload (stars, per-chef stats, positive-only superlatives).
-- Pure logic against injected deps; Lune-tested by tools/round-harness.luau.

local RoundDirector = {}
RoundDirector.__index = RoundDirector

export type Phase = "countdown" | "round" | "results" | "intermission"

function RoundDirector.new(
	shared: any,
	config: any,
	simService: any,
	crew: any,
	replicator: any,
	remotes: { [string]: any },
	opts: {
		seedFn: (() -> number)?,
		assistFn: (() -> boolean)?,
		onRoundEnd: ((any) -> ())?,
		onRoundStart: ((number) -> ())?,
		firstShiftFn: (() -> boolean)?,
		tutorialFn: (() -> boolean)?,
	}
)
	local self = setmetatable({}, RoundDirector)
	self.shared = shared
	self.config = config
	self.simService = simService
	self.crew = crew
	self.replicator = replicator
	self.remotes = remotes
	self.seedFn = opts.seedFn or function()
		return os.time() % 2 ^ 31
	end
	-- assistFn: does the current crew qualify for assist pacing? (Progression
	-- data lives in ProgressionService; injected to keep this module pure.)
	self.assistFn = opts.assistFn or function()
		return false
	end
	self.onRoundEnd = opts.onRoundEnd
	-- Requested bot-fill, applied at the next startRound. Toggling
	-- simService.botFill directly would take effect mid-shift and freeze every
	-- bot on the spot, mid-carry.
	self.pendingBotFill = simService.botFill
	-- Round index the award already fired for; see the latch in heartbeat.
	self.awardedRound = -1
	self.onRoundStart = opts.onRoundStart
	-- tutorialFn: is this a reserved First Shift server? Injected rather than
	-- read from game.PrivateServerId so the Lune harness can drive both modes.
	self.tutorialFn = opts.tutorialFn or function()
		return false
	end
	-- firstShiftFn: is anyone here about to work their first ever shift?
	self.firstShiftFn = opts.firstShiftFn or function()
		return false
	end

	self.phase = "countdown" :: Phase
	self.timer = 0 -- lobbies do not run a clock; only `results` does
	self.round = 0
	self.ready = {} :: { [any]: boolean }
	self.pressure = 0
	self.baseGapMul = 1
	self.stats = {} :: { [number]: { [string]: number } } -- chefId -> counters
	self.lastResults = nil :: any
	self.broadcastAcc = 0
	return self
end

function RoundDirector:setPhase(phase: Phase, timer: number)
	-- The AFK window is longer between rounds: see CrewManager.AFK_LOBBY_SECONDS.
	self.crew:setLobby(phase ~= "round")
	self.phase = phase
	self.timer = timer
	-- A fresh lobby always starts un-readied, so nobody is dragged into the
	-- next shift by a stale click from the last one.
	if phase == "countdown" or phase == "intermission" then
		table.clear(self.ready)
	end
	self:broadcastPhase()
end

function RoundDirector:broadcastPhase()
	-- THE SEAT ROSTER: WHO IS HERE, NOT JUST HOW MANY.
	--
	-- This used to be `readyIds`, a bare list of UserIds of the players who had
	-- pressed Start. Two problems with that. Names, skins and hats are all
	-- keyed by chefId, so drawing a crew row meant bridging UserId to chefId
	-- through the skin table -- a two-hop join that only worked because skins
	-- happen to be a unique permutation. And there was no way at all to learn
	-- who had NOT pressed Start, because an absent UserId and an absent player
	-- look identical.
	--
	-- Carrying chefId here makes the lobby roster a lookup instead of an
	-- inference, and carrying the not-ready seats is what lets it show four
	-- chairs rather than a count.
	--
	-- AFK seats are excluded, matching readyTally. They used not to be: an
	-- AFK-but-ready player landed in readyIds while readyTally left them out of
	-- both halves of the count, so #readyIds could exceed readyCount and a
	-- roster built from it would render "3/2".
	-- ALL FOUR CHAIRS, ALWAYS, IN THE ORDER THEY STAND IN.
	--
	-- This used to send only the seated humans, which cannot describe a lobby:
	-- the empty chairs and the bot-filled ones are most of what a player is
	-- looking at and deciding about. Now every chef slot reports what is in it.
	--
	-- Ordered by chefId rather than by species, so chair order matches the
	-- lineup left-to-right in the crew shot. Claiming a character SWAPS species
	-- between two chefs (see CrewManager:claimSkin), so ordering by species
	-- would keep the labels still and let the chairs slide around behind them --
	-- the wrong half to hold constant when the whole point of the closeup is
	-- that the panel and the room show the same four people.
	local seats = {}
	for _, chef in self.simService.sim.chefs do
		local seat = self.crew.byChef[chef.id]
		local kind
		if seat ~= nil then
			kind = "player"
		elseif self.simService:isActive(chef) then
			kind = "bot"
		else
			kind = "empty"
		end
		table.insert(seats, {
			chefId = chef.id,
			-- The character in this chair. This is what the label says and what
			-- claiming the chair gets you.
			species = chef.skin,
			kind = kind,
			userId = if seat ~= nil then seat.player.UserId else nil,
			name = if seat ~= nil then (seat.player.DisplayName or seat.player.Name) else nil,
			-- AFK seats STAY on the roster, flagged. Dropping them made the
			-- lobby lie: the panel parks you on a mark, standing still used to
			-- count as idle, and a present player watched their own chair turn
			-- into a bot. The roster answers "who is in this room", which is not
			-- the same question as readyTally's "who can still answer".
			ready = seat ~= nil and self.ready[seat.player] == true,
			afk = seat ~= nil and seat.afk == true,
		})
	end
	-- BY CHARACTER, so the four chairs never move. Ordering by chefId kept the
	-- chairs in step with the bodies, but claiming a character swaps species
	-- between chefs, so the LABELS slid along the row every time anybody picked
	-- somebody -- the chair you were about to tap was somewhere else by the
	-- time you tapped it. The marks are pinned to characters now too, so the
	-- panel and the room agree without either of them shuffling.
	-- Staging comes off SimService because it is injected there; requiring it
	-- here would put a Roblox lookup inside a module the harnesses drive.
	local staging = self.simService.staging
	table.sort(seats, function(a, b)
		if staging ~= nil then
			return staging.indexOf(a.species) < staging.indexOf(b.species)
		end
		return a.chefId < b.chefId
	end)
	local readyCount, readyTotal = self:readyTally()
	self.remotes.RoundPhase:FireAllClients({
		phase = self.phase,
		-- Lets the client hide the things that would strand a learner: bot
		-- fill and NEW SERVER both do nothing useful in a solo tutorial, and
		-- NEW SERVER would teleport them out of it mid-lesson.
		tutorial = self.tutorialFn(),
		timer = self.timer,
		round = self.round,
		botFill = self.simService.botFill,
		botFillPending = self.pendingBotFill,
		seats = seats,
		readyCount = readyCount,
		readyTotal = readyTotal,
		results = if self.phase == "results" or self.phase == "intermission" then self.lastResults else nil,
	})
end

function RoundDirector:applyPacing()
	local sim = self.simService.sim
	local humans = math.clamp(self.crew:humanCount(), 0, 4)
	-- SIZED TO WHO IS ACTUALLY COOKING, not to the bot switch. PACING_BOTFILL
	-- assumes a full four-chef kitchen with `humans` of them human; per-chair
	-- dismissal made that assumption false while leaving botFill true, so a
	-- solo player who sent all three bots away kept the four-chef order rate
	-- and ticket clock. With no bots left this is the human-only table; with
	-- some gone, the human table at the real crew size -- a bot does about a
	-- human's work, and that table is tuned for exactly that many hands.
	local bots = self.simService:activeBotCount()
	local crewSize = math.clamp(humans + bots, 0, 4)
	local row = if bots > 0 and crewSize >= 4
		then self.config.PACING_BOTFILL[humans]
		else self.config.PACING[crewSize]
	local knobs = sim.director
	knobs.orderGapMul = row.orderGapMul
	knobs.maxOrdersBonus = row.maxOrdersBonus
	knobs.patienceMissMul = row.patienceMissMul
	knobs.ticketTimeMul = row.ticketTimeMul or 1
	knobs.burnTimeMul = 1
	knobs.recipeDepthCap = math.huge
	knobs.botServeValueMul = self.config.BOT_SERVE_VALUE_MUL
	if self.assistFn() then
		local a = self.config.ASSIST
		knobs.ticketTimeMul *= a.ticketTimeMul
		knobs.patienceMissMul *= a.patienceMissMul
		knobs.burnTimeMul = a.burnTimeMul
		knobs.recipeDepthCap = a.recipeDepthCap
	end
	-- A TUTORIAL BOARD IS NOT A PACED BOARD.
	--
	-- Applied last so it wins over both the crew-size table and assist: one
	-- ticket at a time, tickets that will not expire while the prompt is being
	-- read, and no clock or patience fail (see DirectorKnobs.endless). The
	-- round ends when the dish target is met and nowhere else.
	if self.tutorialFn() then
		local t = self.config.TUTORIAL
		knobs.maxOrdersBonus = t.MAX_ORDERS_BONUS
		knobs.ticketTimeMul = t.TICKET_TIME_MUL
		knobs.patienceMissMul = 0
		knobs.recipeDepthCap = math.huge
		knobs.endless = true
	end
	self.baseGapMul = knobs.orderGapMul
end

function RoundDirector:startRound()
	self.round += 1
	-- A scripted opening for a brand-new chef: chop -> plate -> serve, then
	-- the pan, then a bigger chop. A random board cannot teach an order of
	-- operations, and at heat 0 only the first two recipes are unlocked, so
	-- roughly half of all first tickets were the same salad and the pan --
	-- the least discoverable station in the kitchen -- might not appear at
	-- all. Passed at CONSTRUCTION because createSim seeds two tickets on the
	-- spot; setting the knob afterwards misses exactly the tickets that
	-- matter most.
	local tutorial = self.tutorialFn()
	local script = if tutorial
		then self.config.TUTORIAL.RECIPES
		elseif self.firstShiftFn() then { "salad", "baconroll", "chopped" }
		else nil
	-- Bots are never in a tutorial, whatever the server's bot switch says.
	self.simService.botFill = not tutorial and self.pendingBotFill
	-- THE TUTORIAL KNOBS HAVE TO BE IN PLACE BEFORE createSim, NOT AFTER.
	--
	-- `applyPacing` runs further down, but `createSim` has already called
	-- seedOrders by then -- so the tickets the player actually opens on were
	-- built with DEFAULT knobs. That gave First Shift two tickets instead of
	-- one, each on a ~45s timer instead of the tutorial's, so the very first
	-- ticket a brand-new player ever saw could expire while they were reading
	-- the prompt telling them what to do with it.
	local overrides = nil
	if script ~= nil then
		overrides = { scriptedRecipes = script, endless = tutorial }
		if tutorial then
			local t = self.config.TUTORIAL
			overrides.maxOrdersBonus = t.MAX_ORDERS_BONUS
			overrides.ticketTimeMul = t.TICKET_TIME_MUL
			overrides.patienceMissMul = 0
		end
	end
	self.simService:reset(self.seedFn(), overrides)
	self.replicator:resetCaches()
	self.crew:reseat()
	self:applyPacing()
	self.pressure = 0
	self.stats = {}
	table.clear(self.ready)
	if self.onRoundStart ~= nil then
		self.onRoundStart(self.round)
	end
	self:setPhase("round", self.shared.TUNING.roundSeconds)
end

--- Invisible pressure director: hold open/max inside the band by nudging the
--- order gap ±PRESSURE_BAND_MUL around the table value. Called ~1 Hz.
function RoundDirector:updatePressure(dt: number)
	local sim = self.simService.sim
	local maxOrders = 3 + math.floor(sim.heat * 2) + sim.director.maxOrdersBonus
	local raw = #sim.orders / math.max(1, maxOrders)
	local k = math.min(1, dt / self.config.PRESSURE_SMOOTH)
	self.pressure += (raw - self.pressure) * k
	local band = self.config.PRESSURE_BAND_MUL
	local mul = 1
	if self.pressure > self.config.PRESSURE_HIGH then
		mul = 1 + band * math.min(1, (self.pressure - self.config.PRESSURE_HIGH) / 0.2)
	elseif self.pressure < self.config.PRESSURE_LOW then
		mul = 1 - band * math.min(1, (self.config.PRESSURE_LOW - self.pressure) / 0.3)
	end
	sim.director.orderGapMul = self.baseGapMul * mul
end

--- Attribute a sim event to the nearest chef (all events carry `at`).
function RoundDirector:attribute(ev: any)
	local sim = self.simService.sim
	local key = nil
	if ev.t == "chopDone" then
		key = "chops"
	elseif ev.t == "cookDone" then
		key = "cooks"
	elseif ev.t == "washDone" then
		key = "washes"
	elseif ev.t == "serve" then
		key = "serves"
	elseif ev.t == "burn" then
		key = "burns"
	elseif ev.t == "trash" then
		key = "trashes"
	end
	if key == nil or ev.at == nil then
		return
	end
	local best, bestD = nil, math.huge
	for _, chef in sim.chefs do
		local dx, dy = chef.pos.x - ev.at.x, chef.pos.y - ev.at.y
		local d = dx * dx + dy * dy
		if d < bestD then
			bestD = d
			best = chef
		end
	end
	if best ~= nil then
		local st = self.stats[best.id]
		if st == nil then
			st = {}
			self.stats[best.id] = st
		end
		st[key] = (st[key] or 0) + 1
	end
end

local SUPERLATIVES = {
	{ key = "serves", title = "Closer", line = "most dishes served" },
	{ key = "chops", title = "Speed Chopper", line = "most chopping" },
	{ key = "cooks", title = "Grill Master", line = "most cooking" },
	{ key = "washes", title = "Plate Wizard", line = "most plates washed" },
	{ key = "trashes", title = "Cleanup Crew", line = "kept the kitchen clear" },
}

function RoundDirector:buildResults(): any
	local sim = self.simService.sim
	local score = sim.score
	local stars = 0
	for i, threshold in self.config.STARS do
		if score.coins >= threshold then
			stars = i
		end
	end
	-- FINISHING FIRST SHIFT IS THREE STARS, FULL STOP.
	--
	-- Two scripted dishes will never clear an 80-coin threshold, so a player
	-- who did exactly what they were told would be shown a one-star result --
	-- the game's own way of saying "that was poor" -- as the very first thing
	-- it ever tells them. The tutorial's success condition is completing it,
	-- and the results screen has to agree with that.
	--
	-- The `firstThreeStar` badge is deliberately NOT granted here (see
	-- Badges:onRoundEnd): three stars earned in a real kitchen is a thing worth
	-- having, and handing it out for the tutorial would spend it on the one
	-- shift nobody could fail.
	if self.tutorialFn() then
		stars = 3
	end
	-- One positive card per human, no repeats, never a shame stat.
	local cards = {}
	local used = {}
	for chefId, seat in self.crew.byChef do
		local st = self.stats[chefId] or {}
		local bestCard, bestN = nil, 0
		for _, s in SUPERLATIVES do
			if not used[s.key] and (st[s.key] or 0) > bestN then
				bestCard, bestN = s, st[s.key]
			end
		end
		if bestCard ~= nil then
			used[bestCard.key] = true
			cards[chefId] = { title = bestCard.title, line = bestCard.line, n = bestN }
		else
			cards[chefId] = { title = "Heart of the Kitchen", line = "kept the shift together", n = 0 }
		end
	end
	return {
		-- Which round this was. onRoundEnd is a closure built inside the
		-- director's own constructor call, so it cannot read `director.round`
		-- (see main.server); the results carry it instead.
		round = self.round,
		coins = score.coins,
		served = score.served,
		missed = score.missed,
		bestCombo = score.bestCombo,
		stars = stars,
		tutorial = self.tutorialFn(),
		time = sim.time,
		cards = cards,
		stats = self.stats,
	}
end

--- Ready count over seats that can actually answer.
---
--- AFK seats are EXCLUDED. They used to be counted, so one idle player blocked
--- the all-ready short-circuit for everybody and the crew had to sit out the
--- full intermission timer.
function RoundDirector:readyTally(): (number, number)
	local n, total = 0, 0
	for player, seat in self.crew.seats do
		if not seat.afk then
			total += 1
			if self.ready[player] then
				n += 1
			end
		end
	end
	return n, total
end

function RoundDirector:tryStart()
	local n, total = self:readyTally()
	if total > 0 and n >= total then
		self:startRound()
	end
end

--- Ready-up IS the start button. It works in countdown as well as
--- intermission, because a round no longer starts on a timer at all.
function RoundDirector:setReady(player: any, on: boolean)
	if self.phase ~= "intermission" and self.phase ~= "countdown" then
		return
	end
	-- `nil` rather than `false` so the table does not accumulate dead keys.
	self.ready[player] = if on then true else nil
	self:broadcastPhase() -- echo immediately; the caption is derived from this
	self:tryStart()
end

function RoundDirector:heartbeat(dt: number)
	self.broadcastAcc += dt
	if self.broadcastAcc >= 1 then
		self.broadcastAcc = 0
		if self.phase == "round" then
			self:updatePressure(1)
		elseif self.phase == "intermission" then
			-- Re-check: the last hold-out may have just gone AFK, which makes
			-- the remaining crew all-ready without anyone pressing anything.
			self:tryStart()
		end
		self:broadcastPhase()
	end

	if self.phase == "round" then
		local events, _ticks = self.simService:tick(dt)
		for _, ev in events do
			self:attribute(ev)
		end
		self.replicator:flush(self.simService.sim, events, dt, self.simService:wireClock())
		-- The tutorial board is endless, so nothing inside the sim will ever
		-- set `over`. Two dishes is the whole shift; tripping `over` here means
		-- results, payout and the career counters all run through the ordinary
		-- path rather than a parallel one that could drift from it.
		if self.tutorialFn() and self.simService.sim.score.served >= self.config.TUTORIAL.DISHES then
			self.simService.sim.over = true
		end
		if self.simService.sim.over then
			self.lastResults = self:buildResults()
			-- ONE AWARD PER ROUND, EVER.
			--
			-- onRoundEnd is what pays coins and XP and increments the career
			-- counters, so firing it twice for one round silently doubles a
			-- player's permanent record -- and a profile turned up in testing
			-- with 22542 shifts worked against 11172 dishes served, which no
			-- amount of play can produce (rounds are 180s even when nobody
			-- touches them, so that is 1100 hours). The phase change below is
			-- what is meant to make this unreachable, and measurably does, but
			-- "unreachable by control flow" is exactly what that profile
			-- disproves for some earlier build. Latch it on the round index so
			-- no future re-entry can charge a round twice.
			if self.onRoundEnd ~= nil and self.awardedRound ~= self.round then
				self.awardedRound = self.round
				self.onRoundEnd(self.lastResults)
			end
			self:setPhase("results", self.config.RESULTS)
		end
		return
	end

	-- Between rounds chefs still walk and bump (plan §2.2: the intermission
	-- IS the lobby); only the kitchen itself sleeps.
	-- COUNTDOWN IS A LOBBY TOO, and it is the FIRST one anybody sees.
	--
	-- This ran for results and intermission only, which was fine when the
	-- between-rounds tick just let chefs wander. Now it is also what walks bots
	-- onto their marks -- so on a fresh server, in the one phase a player
	-- actually starts in, nobody walked anywhere and the crew shot framed an
	-- empty floor with one person standing in it. Reported as "only my
	-- character was standing".
	if self.phase ~= "round" then
		self.simService:tickMovementOnly(dt)
		self.replicator:flush(self.simService.sim, {}, dt, self.simService:wireClock())
	end

	-- Without bot fill an empty kitchen has no reason to start a round:
	-- hold the pre-round timers until a human is present.
	if
		not self.simService.botFill
		and self.crew:humanCount() == 0
		and (self.phase == "countdown" or self.phase == "intermission")
	then
		return
	end

	-- A ROUND NEVER STARTS ON A TIMER.
	--
	-- Being dropped into a shift you did not ask for is disorienting, and it
	-- also means the wardrobe/shop can cost you the opening seconds of a
	-- round. countdown and intermission are open-ended lobbies now: the only
	-- way into a shift is every non-AFK chef pressing Start (see setReady).
	-- That is also why there is no intermission-pause any more -- there is no
	-- clock left to pause.
	--
	-- Only `results` still runs a timer, because it is a ceremony, not a lobby.
	if self.phase == "results" then
		self.timer -= dt
		if self.timer <= 0 then
			self:setPhase("intermission", 0)
		end
	end
end

return RoundDirector
