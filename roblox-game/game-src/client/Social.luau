--!strict
-- SERVER HOPPING AND FRIEND-JOINING.
--
-- The two affordances a Roblox co-op game is expected to have and this one did
-- not: leave a lobby you don't like, and go to where your friends already are.
-- Roblox's own UI can do the second from a profile page, but making a player
-- leave the experience to rejoin it is exactly the moment they don't come back.
--
-- All teleport failure handling lives here rather than at the call sites,
-- because with four-player servers the failures are not edge cases. A friend's
-- kitchen being full is the NORMAL outcome of tapping "join" on a popular
-- server, and it has to say so in words rather than doing nothing.
local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")

local Social = {}
Social.__index = Social

-- Roblox rate-limits teleport requests per player; a spammed button trips
-- Flooded and locks the player out for longer than the cooldown we impose.
local COOLDOWN = 5

function Social.new(onToast: (string) -> ())
	local self = setmetatable({}, Social)
	self.onToast = onToast
	self.lastAt = -math.huge
	self.pending = false

	-- A teleport that cannot START fires this rather than erroring, so without
	-- a handler the button simply appears to do nothing.
	TeleportService.TeleportInitFailed:Connect(function(_player, result, message)
		self.pending = false
		local why = "Couldn't move you just now — try again in a moment."
		if result == Enum.TeleportResult.GameFull then
			why = "That kitchen is full — four chefs is the limit. Try a new server."
		elseif result == Enum.TeleportResult.GameEnded or result == Enum.TeleportResult.GameNotFound then
			why = "That kitchen has already closed."
		elseif result == Enum.TeleportResult.Flooded then
			why = "Too many attempts — wait a few seconds."
		elseif result == Enum.TeleportResult.Unauthorized then
			why = "You can't join that server."
		end
		self.onToast(why)
		warn(`[social] teleport failed: {result} — {message}`)
	end)
	return self
end

function Social:ready(): boolean
	if self.pending then
		return false
	end
	if os.clock() - self.lastAt < COOLDOWN then
		self.onToast("Hold on a second…")
		return false
	end
	return true
end

--- Rematch into a different server.
---
--- Roblox has no "anywhere but here" API: Teleport re-runs matchmaking, which
--- prefers filling servers that have room, so in practice it moves you — but
--- it can legitimately return you to the same one. Worth knowing before
--- treating this as a guaranteed escape hatch.
function Social:newServer()
	if not self:ready() then
		return
	end
	self.pending = true
	self.lastAt = os.clock()
	self.onToast("Finding another kitchen…")
	local ok, err = pcall(function()
		TeleportService:Teleport(game.PlaceId, Players.LocalPlayer)
	end)
	if not ok then
		self.pending = false
		self.onToast("Couldn't move you just now — try again in a moment.")
		warn(`[social] teleport error: {err}`)
	end
end

--- Drop into a specific running server — the one a friend is already in.
function Social:joinFriend(jobId: string, who: string?)
	if not self:ready() then
		return
	end
	self.pending = true
	self.lastAt = os.clock()
	self.onToast(if who ~= nil then `Joining {who}…` else "Joining…")
	local ok, err = pcall(function()
		TeleportService:TeleportToPlaceInstance(game.PlaceId, jobId, Players.LocalPlayer)
	end)
	if not ok then
		self.pending = false
		self.onToast("Couldn't join them — their kitchen may be full.")
		warn(`[social] join error: {err}`)
	end
end

--- Friends currently playing THIS experience, newest-looking first.
---
--- GetFriendsOnline yields and can throw, so it is always called from a
--- pcall inside a spawned thread. Entries without a GameId are in the app or
--- on the website, not in a server we can reach, and are dropped: offering a
--- "join" that cannot work is worse than not listing them.
function Social:friendsHere(): { { name: string, jobId: string, userId: number } }
	local out = {}
	local ok, list = pcall(function()
		return Players.LocalPlayer:GetFriendsOnline(50)
	end)
	if not ok or type(list) ~= "table" then
		return out
	end
	for _, f in list :: any do
		if f.PlaceId == game.PlaceId and typeof(f.GameId) == "string" and f.GameId ~= "" then
			table.insert(out, {
				name = f.DisplayName or f.UserName or "Friend",
				jobId = f.GameId,
				userId = f.VisitorId or 0,
			})
		end
	end
	return out
end

return Social
