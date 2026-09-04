--!strict
-- FIRST SHIFT AS A QUARANTINED SOLO SERVER.
--
-- A player with no completed shift is teleported into a RESERVED server, works
-- two scripted tickets alone with no clock and no fail state, and is teleported
-- back into normal matchmaking when they are done.
--
-- Why a separate server rather than a mode inside a live one:
--
--   * A tutorial cannot be followed with three bots sprinting through the same
--     kitchen, and bot fill is a SERVER-WIDE switch -- turning it off for the
--     learner turns it off for everyone else in the room.
--   * A public server can matchmake a stranger in halfway through, and no
--     amount of client-side coaching survives that.
--   * MaxPlayers is 4. A learner in a public server is a quarter of the room,
--     held by someone not yet playing the co-op game.
--
-- The cost is one extra load, once per account, and it is paid at the very
-- start of the very first session. That is the worst possible moment for it,
-- which is why the entry check runs before anything else on join and why a
-- failure to reserve degrades to the old in-place coach rather than blocking.

-- Services are fetched lazily, not at load: `needsTutorial` is pure policy and
-- is exercised by tools/tutorial-harness.luau under Lune, where `game` does not
-- exist at all. A module-level GetService would make the whole file unloadable
-- there and take the harness with it.
local Tutorial = {}

--- STUDIO CANNOT TELEPORT, SO STUDIO RUNS THE TUTORIAL IN PLACE.
---
--- TeleportService refuses to move a player in Studio, which means pressing
--- Play could never reach First Shift: the reserve failed, the code fell back
--- to seating normally, and what came up was an ordinary round with three bots
--- and a coach overlay flickering between them. That is not a bug in the
--- tutorial, it is the tutorial being unreachable from the only place it can
--- be iterated on.
---
--- So in Studio an eligible player flips this flag instead of being teleported,
--- and the server it is already in becomes the tutorial server. Cleared on
--- completion so the next round in the same session is an ordinary one — which
--- also makes the hand-off testable without a second client.
Tutorial.forced = false

local function svc(name: string): any
	local g: any = game
	if g == nil then
		return nil
	end
	return g:GetService(name)
end

--- A RESERVED server is one Roblox created for `ReserveServer`. A player-owned
--- private server also has a PrivateServerId, so the OwnerId is what separates
--- the tutorial from the free private servers the experience also offers.
function Tutorial.isTutorialServer(): boolean
	if Tutorial.forced then
		return true
	end
	local g: any = game
	if g == nil then
		return false
	end
	return g.PrivateServerId ~= "" and g.PrivateServerOwnerId == 0
end

function Tutorial.isStudio(): boolean
	local rs = svc("RunService")
	return rs ~= nil and rs:IsStudio()
end

--- Has this player finished a shift? `rounds` is the persisted career counter
--- and is the only thing trusted here: teleport data is not, because arriving
--- with a flag set is not evidence of having earned the payout.
function Tutorial.needsTutorial(profile: any): boolean
	if profile == nil then
		return false
	end
	return (profile.rounds or 0) == 0 and profile.tutorialDone ~= true
end

--- Send a player to their own tutorial instance. Returns false if Roblox would
--- not give us one, in which case the caller must carry on as normal -- a new
--- player who cannot be taught is still a player who can play.
--- The second return value is the outcome, for analytics: "sent",
--- "reserve_failed" or "teleport_failed". Both failures leave the player in
--- this server, which the caller must then seat as normal.
function Tutorial.send(player: Player): (boolean, string)
	local ok, code = pcall(function()
		return svc("TeleportService"):ReserveServer(game.PlaceId)
	end)
	if not ok or type(code) ~= "string" then
		warn(`[sizzle] tutorial ReserveServer failed: {code}`)
		return false, "reserve_failed"
	end
	local options = Instance.new("TeleportOptions")
	options.ReservedServerAccessCode = code
	options:SetTeleportData({ tutorial = true })
	local ok2, err = pcall(function()
		svc("TeleportService"):TeleportAsync(game.PlaceId, { player }, options)
	end)
	if not ok2 then
		warn(`[sizzle] tutorial teleport failed: {err}`)
		return false, "teleport_failed"
	end
	return true, "sent"
end

--- Back to public matchmaking. `TeleportAsync` with no reserved code re-runs
--- matchmaking, which prefers servers that already have people in them -- so
--- the first real kitchen is usually one with somebody else already in it,
--- which is the whole point of doing the tutorial somewhere else first.
--- Where a finished tutorial goes. In Studio there is nowhere to go, so the
--- flag simply clears and play continues in the same server.
--- Returns whether a teleport was actually REQUESTED, so the caller can tag
--- the departure only when there is going to be one.
function Tutorial.finish(player: Player): boolean
	if Tutorial.isStudio() then
		Tutorial.forced = false
		print("[sizzle] First Shift complete — Studio, so staying put instead of teleporting")
		return false
	end
	return Tutorial.sendHome(player)
end

function Tutorial.sendHome(player: Player): boolean
	local options = Instance.new("TeleportOptions")
	options:SetTeleportData({ fromTutorial = true })
	local ok, err = pcall(function()
		svc("TeleportService"):TeleportAsync(game.PlaceId, { player }, options)
	end)
	if not ok then
		warn(`[sizzle] tutorial return teleport failed: {err}`)
		return false
	end
	return true
end

--- WHERE THIS PLAYER CAME FROM.
---
--- Roblox exposes no "search vs discovery vs ad" signal to a running server --
--- that breakdown lives only in the Creator Dashboard's acquisition report,
--- and the analytics query API has no dimension for it either. What a server
--- CAN see is the two arrivals that should change what happens next:
---
---   "teleport_in"   -- another server in this experience sent them. Both legs
---                      of the First Shift round trip look like this, which is
---                      how a same-session hop is told apart from a new
---                      session. Counting the hop as a session is what made a
---                      brand-new player read as a returning one.
---   "friend_invite" -- accepted an invite (GetJoinData().ReferredByPlayerId)
---   "friend_follow" -- followed a friend in (Player.FollowUserId)
---   "direct"        -- everything else: search, discovery, an ad, a link.
---                      Indistinguishable from each other from in here.
--- Returns the source and, when there is one, the user they came here FOR --
--- which is the only way to tell "my friend is in this kitchen" from "somebody
--- is in this kitchen".
function Tutorial.joinSource(player: Player): (string, number?)
	local ok, data = pcall(function()
		return player:GetJoinData()
	end)
	local d: any = if ok and type(data) == "table" then data else {}
	local td: any = d.TeleportData
	if type(td) == "table" then
		-- Social:joinFriend sets this. Without it, tapping JOIN A FRIEND looked
		-- like an ordinary arrival, so a player who had never finished a round
		-- was teleported straight back out to a solo tutorial -- away from the
		-- friend they had just asked to join.
		if td.joinedFriend == true then
			return "friend_hop", tonumber(td.friendUserId)
		end
		return "teleport_in", nil
	end
	local referred = tonumber(d.ReferredByPlayerId) or 0
	if referred ~= 0 then
		return "friend_invite", referred
	end
	-- FollowUserId is a property, not join data, and is 0 when unused.
	local okFollow, follow = pcall(function()
		return player.FollowUserId
	end)
	local followId = if okFollow then tonumber(follow) or 0 else 0
	if followId ~= 0 then
		return "friend_follow", followId
	end
	return "direct", nil
end

--- A hop inside this experience: the same player session continuing. Both legs
--- of the First Shift round trip and every Social teleport are hops.
function Tutorial.isHop(source: string): boolean
	return source == "teleport_in" or source == "friend_hop"
end

--- Did they come here to play with somebody specific? These are the arrivals
--- worth interrupting First Shift for: sending someone to a private tutorial
--- server while the friend who invited them sits waiting in another kitchen
--- trades the one thing that actually retains players -- another person -- for
--- two scripted tickets they could just as easily learn standing next to them.
function Tutorial.isFriendJoin(source: string): boolean
	return source == "friend_invite" or source == "friend_follow" or source == "friend_hop"
end

--- Did this player arrive here straight out of a tutorial? Used only to make
--- sure a failed or repeated tutorial can never bounce someone in a loop.
function Tutorial.arrivedFromTutorial(player: Player): boolean
	local ok, data = pcall(function()
		return player:GetJoinData().TeleportData
	end)
	return ok and type(data) == "table" and (data :: any).fromTutorial == true
end

return Tutorial
