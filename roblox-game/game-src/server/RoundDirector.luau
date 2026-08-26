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
	-- readyIds is what lets the client render its own ready caption as a pure
	-- function of server state instead of remembering that it clicked.
	local readyIds = {}
	for player in self.crew.seats do
		if self.ready[player] then
			table.insert(readyIds, player.UserId)
		end
	end
	local readyCount, readyTotal = self:readyTally()
	self.remotes.RoundPhase:FireAllClients({
		phase = self.phase,
		timer = self.timer,
		round = self.round,
		waiting = not self.simService.botFill and self.crew:humanCount() == 0,
		readyIds = readyIds,
		readyCount = readyCount,
		readyTotal = readyTotal,
		-- countdown/intermission are lobbies waiting on Start, not countdowns
		awaitingStart = self.phase == "countdown" or self.phase == "intermission",
		results = if self.phase == "results" or self.phase == "intermission" then self.lastResults else nil,
	})
end

function RoundDirector:applyPacing()
	local sim = self.simService.sim
	local humans = math.clamp(self.crew:humanCount(), 0, 4)
	local pacing = if self.simService.botFill then self.config.PACING_BOTFILL else self.config.PACING
	local row = pacing[humans]
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
	self.baseGapMul = knobs.orderGapMul
end

function RoundDirector:startRound()
	self.round += 1
	self.simService:reset(self.seedFn())
	self.replicator:resetCaches()
	self.crew:reseat()
	self:applyPacing()
	self.pressure = 0
	self.stats = {}
	table.clear(self.ready)
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
		coins = score.coins,
		served = score.served,
		missed = score.missed,
		bestCombo = score.bestCombo,
		stars = stars,
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
		self.replicator:flush(self.simService.sim, events, dt)
		if self.simService.sim.over then
			self.lastResults = self:buildResults()
			if self.onRoundEnd ~= nil then
				self.onRoundEnd(self.lastResults)
			end
			self:setPhase("results", self.config.RESULTS)
		end
		return
	end

	-- Between rounds chefs still walk and bump (plan §2.2: the intermission
	-- IS the lobby); only the kitchen itself sleeps.
	if self.phase == "results" or self.phase == "intermission" then
		self.simService:tickMovementOnly(dt)
		self.replicator:flush(self.simService.sim, {}, dt)
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
