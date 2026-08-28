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
	local g: any = game
	if g == nil then
		return false
	end
	return g.PrivateServerId ~= "" and g.PrivateServerOwnerId == 0
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
function Tutorial.send(player: Player): boolean
	local ok, code = pcall(function()
		return svc("TeleportService"):ReserveServer(game.PlaceId)
	end)
	if not ok or type(code) ~= "string" then
		warn(`[sizzle] tutorial ReserveServer failed: {code}`)
		return false
	end
	local options = Instance.new("TeleportOptions")
	options.ReservedServerAccessCode = code
	options:SetTeleportData({ tutorial = true })
	local ok2, err = pcall(function()
		svc("TeleportService"):TeleportAsync(game.PlaceId, { player }, options)
	end)
	if not ok2 then
		warn(`[sizzle] tutorial teleport failed: {err}`)
		return false
	end
	return true
end

--- Back to public matchmaking. `TeleportAsync` with no reserved code re-runs
--- matchmaking, which prefers servers that already have people in them -- so
--- the first real kitchen is usually one with somebody else already in it,
--- which is the whole point of doing the tutorial somewhere else first.
function Tutorial.sendHome(player: Player)
	local options = Instance.new("TeleportOptions")
	options:SetTeleportData({ fromTutorial = true })
	local ok, err = pcall(function()
		svc("TeleportService"):TeleportAsync(game.PlaceId, { player }, options)
	end)
	if not ok then
		warn(`[sizzle] tutorial return teleport failed: {err}`)
	end
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
