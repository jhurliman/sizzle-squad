--!strict
-- Player <-> chef slot lifecycle: join drop-in (a bot hands over its chef,
-- held item and all), leave (the bot silently takes back over), and AFK
-- coverage (20s of no input -> bot covers; any input -> instant resume).
-- Also the input gateway: routes MoveStream/GrabEdge to SimService.

local CrewManager = {}
CrewManager.__index = CrewManager

local AFK_SECONDS = 20

export type Seat = {
	player: any, -- Player
	chefId: number,
	lastInputAt: number,
	afk: boolean,
}

function CrewManager.new(
	simService: any,
	net: any,
	remotes: { [string]: any },
	replicator: any,
	now: () -> number,
	skinFor: ((any) -> string?)?
)
	local self = setmetatable({}, CrewManager)
	self.simService = simService
	self.net = net
	self.remotes = remotes
	self.replicator = replicator
	self.now = now
	self.skinFor = skinFor
	self.seats = {} :: { [any]: Seat } -- keyed by Player
	self.byChef = {} :: { [number]: Seat }
	-- Reports how far a player has got (see Progression.noteReach). Assigned
	-- by the composition root once progression exists; a no-op until then so
	-- the harnesses can drive input without wiring persistence.
	self.onReach = function(_player: any, _stage: string) end

	remotes.MoveStream.OnServerEvent:Connect(function(player: any, b: any)
		local seat = self.seats[player]
		if seat == nil or typeof(b) ~= "buffer" then
			return
		end
		local p = net.unpackMove(b)
		if p == nil then
			return
		end
		self:touch(seat)
		-- A move packet arrives every frame whether or not the stick is being
		-- held, so only a non-zero velocity counts as "this player moved".
		-- Without that test every joiner would look like they had moved.
		if p.vx * p.vx + p.vy * p.vy > 0.01 then
			self.onReach(player, "moved")
		end
		simService:humanMove(seat.chefId, p)
	end)

	remotes.GrabEdge.OnServerEvent:Connect(function(player: any)
		local seat = self.seats[player]
		if seat == nil then
			return
		end
		self:touch(seat)
		self.onReach(player, "pressed")
		simService:pressGrab(seat.chefId)
	end)

	return self
end

function CrewManager:touch(seat: Seat)
	seat.lastInputAt = self.now()
	if seat.afk then
		seat.afk = false
		self.simService:setHuman(seat.chefId, true)
	end
end

--- Give chef `chefId` the species `want`, WITHOUT ever putting the same
--- character in the kitchen twice.
---
--- sim.ts seeds the four chefs with four distinct skins (`skins[i % 4]`), so
--- uniqueness holds by construction until something assigns a skin directly —
--- which is exactly what this used to do. Two players whose wardrobe
--- preference matched both got it, and the kitchen ran two identical chefs.
---
--- Swapping PRESERVES the invariant rather than repairing it afterwards:
--- whoever held `want` takes this chef's old skin, so the set of four is
--- always a permutation of the four species.
---
--- The one request that cannot be granted is a species another SEATED HUMAN is
--- wearing. They chose it too and were here first, so the caller keeps the
--- distinct skin it already holds — which is "the next available character".
--- Bots are always displaced; they have no preference.
---
--- Returns the skin actually held afterwards, which may not be `want`.
function CrewManager:claimSkin(chefId: number, want: string?): string?
	local chefs = self.simService.sim.chefs
	local mine = chefs[chefId + 1]
	if mine == nil then
		return nil
	end
	if want == nil or mine.skin == want then
		return mine.skin
	end
	for i, other in chefs do
		if other ~= mine and other.skin == want then
			if self.byChef[i - 1] ~= nil then
				return mine.skin -- a human is wearing it; keep ours
			end
			other.skin, mine.skin = mine.skin, want
			return mine.skin
		end
	end
	-- Nobody holds it (shouldn't happen with a full permutation, but a skin
	-- list that grows past four would land here).
	mine.skin = want
	return mine.skin
end

--- Species currently worn by a SEATED HUMAN, mapped to that human's UserId.
---
--- The value is the owner rather than `true` because this is broadcast to
--- everyone: a client has to be able to tell "someone else has this" from
--- "this is the one I am wearing", and comparing UserIds is the only way that
--- does not need a second lookup. Bot-held species are absent — picking one
--- just displaces the bot.
function CrewManager:takenSkins(): { [string]: number }
	local taken = {}
	local chefs = self.simService.sim.chefs
	for i, chef in chefs do
		local seat = self.byChef[i - 1]
		if seat ~= nil and chef.skin ~= nil then
			taken[chef.skin] = seat.player.UserId
		end
	end
	return taken
end

function CrewManager:playerAdded(player: any)
	local chefId = self.simService:freeChef()
	if chefId == nil then
		-- 4 humans already seated; server is full (MaxPlayers should prevent
		-- this, but never crash on the race).
		return nil
	end
	local chef = self.simService:setHuman(chefId, true)
	local seat: Seat = { player = player, chefId = chefId, lastInputAt = self.now(), afk = false }
	self.seats[player] = seat
	self.byChef[chefId] = seat
	-- Seat FIRST, then claim: claimSkin consults byChef to decide which
	-- species are spoken for, and this seat has to be in it.
	self:claimSkin(chefId, self.skinFor and self.skinFor(player))
	self.remotes.ChefAssign:FireClient(player, {
		chefId = chefId,
		skin = chef and chef.skin or "bramble",
	})
	self.remotes.Snapshot:FireClient(player, self.replicator:snapshotFor(self.simService.sim))
	return seat
end

function CrewManager:playerRemoving(player: any)
	local seat = self.seats[player]
	if seat == nil then
		return
	end
	self.seats[player] = nil
	self.byChef[seat.chefId] = nil
	-- The bot takes the chef back, inheriting position and held item.
	self.simService:setHuman(seat.chefId, false)
end

--- Called each heartbeat: AFK chefs fall back to bot control (silently;
--- resuming is instant on any input via touch()), and any chef the server
--- had to overrule this tick gets snapped back authoritatively.
function CrewManager:heartbeat()
	local t = self.now()
	for _, seat in self.seats do
		if not seat.afk and t - seat.lastInputAt > AFK_SECONDS then
			seat.afk = true
			self.simService:setHuman(seat.chefId, false)
		end
		local slot = self.simService.humans[seat.chefId]
		if slot ~= nil and slot.corrected then
			slot.corrected = false
			for _, chef in self.simService.sim.chefs do
				if chef.id == seat.chefId then
					self.remotes.Correction:FireClient(seat.player, { x = chef.pos.x, y = chef.pos.y })
				end
			end
		end
	end
end

function CrewManager:humanCount(): number
	local n = 0
	for _, seat in self.seats do
		if not seat.afk then
			n += 1
		end
	end
	return n
end

--- Re-seat every connected player after a sim reset (new round).
function CrewManager:reseat()
	-- Drop the old chef->seat map first. Reseating moves everyone, and a stale
	-- entry would make claimSkin think a chef nobody occupies is spoken for.
	table.clear(self.byChef)
	for player, seat in self.seats do
		local chefId = self.simService:freeChef()
		if chefId ~= nil then
			local chef = self.simService:setHuman(chefId, true)
			seat.chefId = chefId
			self.byChef[chefId] = seat
			self:claimSkin(chefId, self.skinFor and self.skinFor(player))
			self.remotes.ChefAssign:FireClient(player, {
				chefId = chefId,
				skin = chef and chef.skin or "bramble",
			})
			self.remotes.Snapshot:FireClient(player, self.replicator:snapshotFor(self.simService.sim))
		end
	end
end

return CrewManager
