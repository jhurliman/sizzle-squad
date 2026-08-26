--!strict
-- Tracks who has the front-end menu open, so RoundDirector can hold the
-- intermission clock while someone is shopping.
--
-- Lives outside RoundDirector on purpose: the director is driven headlessly by
-- tools/server-harness.luau, so its pause input arrives as an injected
-- function rather than a read of Roblox services.

local MenuGate = {}
MenuGate.__index = MenuGate

function MenuGate.new(config: any, now: (() -> number)?)
	local self = setmetatable({}, MenuGate)
	self.config = config
	self.now = now or os.clock
	self.open = {} :: { [any]: number } -- player -> last keepalive time
	self.rate = {} :: { [any]: { n: number, t: number } }
	return self
end

--- Rate-limited so a crafted client cannot spam the server with state flips.
function MenuGate:set(player: any, open: boolean)
	local t = self.now()
	local r = self.rate[player]
	if r == nil or t - r.t >= 1 then
		self.rate[player] = { n = 1, t = t }
	else
		r.n += 1
		if r.n > (self.config.MENU_MAX_MSGS_PER_SEC or 4) then
			return
		end
	end
	if open then
		self.open[player] = t
	else
		self.open[player] = nil
	end
end

function MenuGate:clear(player: any)
	self.open[player] = nil
	self.rate[player] = nil
end

function MenuGate:clearAll()
	table.clear(self.open)
end

--- True while at least one player should stop the clock.
---
--- A holder must be SEATED, NOT AFK, NOT READY, and have sent a keepalive
--- recently. Readying up is the release valve ("I'm done, stop stalling"), and
--- the keepalive means a crashed or backgrounded client stops holding on its
--- own rather than freezing the server until the cap runs out.
function MenuGate:anyHolding(crew: any, ready: { [any]: boolean }): boolean
	local timeout = self.config.MENU_KEEPALIVE_TIMEOUT or 12
	local t = self.now()
	for player, at in self.open do
		if t - at > timeout then
			self.open[player] = nil
			continue
		end
		if ready[player] then
			continue
		end
		local seat = crew.seats[player]
		if seat ~= nil and not seat.afk then
			return true
		end
	end
	return false
end

return MenuGate
