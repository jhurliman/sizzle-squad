--!strict
-- Reads the OrderedDataStore boards every 90s and publishes top-25 lists to
-- clients (plan §2.4). Direct reads are fine at launch scale; swap the read
-- for a MemoryStore/MessagingService cache when server counts warrant it.

local Leaderboards = {}
Leaderboards.__index = Leaderboards

local REFRESH = 90

function Leaderboards.new(progression: any, remotes: { [string]: any })
	local self = setmetatable({}, Leaderboards)
	self.progression = progression
	self.remotes = remotes
	self.last = 0
	self.cache = nil :: any
	return self
end

local function readTop(store: any): { any }
	local out = {}
	local ok = pcall(function()
		local pages = store:GetSortedAsync(false, 25)
		local page = pages:GetCurrentPage()
		for rank, entry in page do
			table.insert(out, { rank = rank, key = entry.key, value = entry.value })
		end
	end)
	if not ok then
		return {}
	end
	return out
end

function Leaderboards:heartbeat(now: number)
	if now - self.last < REFRESH then
		return
	end
	self.last = now
	local stores = self.progression.stores
	if stores == nil then
		return
	end
	task.spawn(function()
		self.cache = {
			weekly = readTop(stores.weekly),
			allTime = readTop(stores.allTime),
			dishes = readTop(stores.dishes),
		}
		self.remotes.Leaderboards:FireAllClients(self.cache)
	end)
end

function Leaderboards:pushTo(player: any)
	if self.cache ~= nil then
		self.remotes.Leaderboards:FireClient(player, self.cache)
	end
end

return Leaderboards
