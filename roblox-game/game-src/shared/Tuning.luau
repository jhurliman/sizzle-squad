--!strict
-- Roblox-side feel overrides on the SHARED sim tuning.
--
-- The domain sim is shared verbatim with the web game, so its TUNING is not
-- ours to edit -- changing it there would silently retune the HTML5 build. But
-- the same speed reads differently through a fixed 22.5-degree camera at this
-- distance than it does in the browser, so the port needs its own dial.
--
-- Applied identically in both VMs (client mirror and server sim) so authority
-- and prediction stay in agreement; the guard makes it idempotent, because
-- double-scaling would be invisible until someone rubber-banded.

local Tuning = {}

function Tuning.apply(shared: any, config: any)
	if shared.__robloxTuned then
		return
	end
	shared.__robloxTuned = true
	local mul = config.MOVE_SPEED_MUL or 1
	if mul ~= 1 then
		shared.TUNING.moveSpeed *= mul
	end
end

return Tuning
