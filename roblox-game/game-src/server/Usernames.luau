--!strict
-- Resolves leaderboard datastore keys (u123456) to display names.
--
-- Without this the boards render as "u123456", which is unreadable. Resolution
-- happens once per 90s poll on the server rather than per client, and degrades
-- to "Chef {id}" if the API is unavailable -- matching how Progression already
-- degrades to session-only when DataStores are off.

local Usernames = {}
Usernames.__index = Usernames

function Usernames.new()
	local self = setmetatable({}, Usernames)
	self.cache = {} :: { [number]: string }
	self.userService = nil
	self.players = nil
	pcall(function()
		self.userService = game:GetService("UserService")
		self.players = game:GetService("Players")
	end)
	return self
end

--- Yields. Batched: GetUserInfosByUserIdsAsync takes up to 200 ids per call,
--- so a 75-entry board is one request instead of 75.
function Usernames:resolve(userIds: { number }): { [number]: string }
	local missing = {}
	for _, id in userIds do
		if self.cache[id] == nil then
			table.insert(missing, id)
		end
	end
	if #missing > 0 and self.userService ~= nil then
		local ok, infos = pcall(function()
			return self.userService:GetUserInfosByUserIdsAsync(missing)
		end)
		if ok and infos ~= nil then
			for _, info in infos do
				self.cache[info.Id] = info.DisplayName or info.Username
			end
		end
	end
	-- Per-id fallback for anything the batch call did not cover.
	for _, id in missing do
		if self.cache[id] == nil and self.players ~= nil then
			local ok, name = pcall(function()
				return self.players:GetNameFromUserIdAsync(id)
			end)
			self.cache[id] = if ok and name ~= nil then name else `Chef {id}`
		elseif self.cache[id] == nil then
			self.cache[id] = `Chef {id}`
		end
	end
	local out = {}
	for _, id in userIds do
		out[id] = self.cache[id]
	end
	return out
end

return Usernames
