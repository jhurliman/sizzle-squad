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

function CrewManager.new(simService: any, net: any, remotes: { [string]: any }, replicator: any, now: () -> number)
	local self = setmetatable({}, CrewManager)
	self.simService = simService
	self.net = net
	self.remotes = remotes
	self.replicator = replicator
	self.now = now
	self.seats = {} :: { [any]: Seat } -- keyed by Player
	self.byChef = {} :: { [number]: Seat }

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
		simService:humanMove(seat.chefId, p)
	end)

	remotes.GrabEdge.OnServerEvent:Connect(function(player: any)
		local seat = self.seats[player]
		if seat == nil then
			return
		end
		self:touch(seat)
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
	for player, seat in self.seats do
		local chefId = self.simService:freeChef()
		if chefId ~= nil then
			local chef = self.simService:setHuman(chefId, true)
			seat.chefId = chefId
			self.byChef[chefId] = seat
			self.remotes.ChefAssign:FireClient(player, {
				chefId = chefId,
				skin = chef and chef.skin or "bramble",
			})
			self.remotes.Snapshot:FireClient(player, self.replicator:snapshotFor(self.simService.sim))
		end
	end
end

return CrewManager
