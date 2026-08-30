--!strict
-- Reads the OrderedDataStore boards every 90s and publishes top-25 lists to
-- clients (plan §2.4). Direct reads are fine at launch scale; swap the read
-- for a MemoryStore/MessagingService cache when server counts warrant it.

local Usernames = require(script.Parent.Usernames) :: any

local Leaderboards = {}
Leaderboards.__index = Leaderboards

local REFRESH = 90

function Leaderboards.new(progression: any, remotes: { [string]: any })
	local self = setmetatable({}, Leaderboards)
	self.progression = progression
	self.remotes = remotes
	self.last = 0
	self.cache = nil :: any
	self.names = Usernames.new()
	return self
end

local function readTop(store: any): { any }
	local out = {}
	local ok = pcall(function()
		local pages = store:GetSortedAsync(false, 25)
		local page = pages:GetCurrentPage()
		for rank, entry in page do
			-- keys are `u{UserId}`; keep the numeric id so the client can pin
			-- the local player's own row.
			local id = tonumber(tostring(entry.key):match("^u(%d+)") or "")
			table.insert(out, { rank = rank, key = entry.key, userId = id, value = entry.value })
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
	-- Already inside task.spawn, so the yielding name lookup is safe here and
	-- costs one batched request per 90s poll rather than one per client.
	task.spawn(function()
		local boards = {
			weekly = readTop(stores.weekly),
			allTime = readTop(stores.allTime),
			dishes = readTop(stores.dishes),
		}
		local ids = {}
		local seen = {}
		for _, rows in boards do
			for _, row in rows do
				if row.userId ~= nil and not seen[row.userId] then
					seen[row.userId] = true
					table.insert(ids, row.userId)
				end
			end
		end
		local names = self.names:resolve(ids)
		for _, rows in boards do
			for _, row in rows do
				row.name = if row.userId ~= nil then names[row.userId] else row.key
			end
		end
		self.cache = boards
		self.remotes.Leaderboards:FireAllClients(self.cache)
	end)
end

function Leaderboards:pushTo(player: any)
	if self.cache ~= nil then
		self.remotes.Leaderboards:FireClient(player, self.cache)
	end
end

return Leaderboards
