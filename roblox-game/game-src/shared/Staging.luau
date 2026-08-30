--!strict
-- WHERE THE CREW STANDS WHEN NOBODY IS COOKING.
--
-- One definition, read by two things that must agree: the server steers bots
-- to these marks (SimService:walkToMark), the client walks ITSELF to them, and
-- CameraRig solves the lobby and photo framing FROM them. Split them and
-- the shot eventually frames an empty patch of floor -- the same failure mode
-- as two copies of a place id, one screen further away.
--
-- Coordinates are CELLS, the sim's own space, same as everything else shared.
--
-- WHY THESE CELLS, AND NOT A TIDY ROW.
--
-- Row 8 of KITCHEN_MAP is the only row that is unbroken floor across the full
-- width (`#.............#`), and row 7 is floor from x=4 to x=10 between the
-- station clusters at either end. Everything here lives inside those two, with
-- a chef body (TUNING.chefRadius = 0.36) of clearance from any wall or bench.
--
-- The four marks are an ARC, not a line: the outer pair stand a cell closer to
-- camera than the inner pair. Two reasons. A flat row of four needs enough
-- width that a 4:3 iPad has to pull the camera back until everyone is small --
-- the arc buys the same visual separation from depth instead, so the shot can
-- come in tighter. And it is how people actually stand for a photograph; the
-- ends come forward so nobody is hidden behind a shoulder.
--
-- Marks are 1.0-1.6 cells apart against a body radius of 0.36, so bodies never
-- touch and collidePhase has nothing to resolve once everyone has arrived.

local Staging = {}

--- Lobby lineup, in seat order. Index is chefId + 1.
Staging.LINEUP = {
	{ x = 5.9, y = 8.45 }, -- outer left, stepped forward
	{ x = 6.9, y = 7.45 }, -- inner left, back
	{ x = 8.1, y = 7.45 }, -- inner right, back
	{ x = 9.1, y = 8.45 }, -- outer right, stepped forward
}

--- The end-of-shift photo uses the same marks. Standing somewhere different
--- for the celebration than for the lobby would mean two walks, and the second
--- one lands right on top of the results card.
Staging.POSE = Staging.LINEUP

--- How close a chef has to be to its mark to count as arrived. Generous: this
--- gates "stop steering and face front", and hunting for a millimetre reads as
--- a twitch.
Staging.ARRIVE_EPS = 0.06

--- Start easing off this far out, so nobody skids past their mark and then
--- oscillates around it for the rest of the lobby.
Staging.SLOWDOWN = 1.1

--- Fraction of TUNING.moveSpeed (5.7) used to walk to a mark. 0.56 lands on
--- ~3.2 cells/s, which is the same cadence ChefPreview picked for the wardrobe
--- turntable and describes as "a natural mid-walk". Strolling into position and
--- sprinting into position read very differently.
Staging.WALK_FRAC = 0.56

--- Heading that faces the camera. Movement heading is atan2(dy, dx) and the
--- camera sits at high y, so +y is towards the lens. (Chefs spawn at -pi/2,
--- i.e. facing the back wall and their stations, which is the right default
--- for cooking and the wrong one for a photograph.)
Staging.FACE_CAMERA = math.pi / 2

--- The move vector that walks `pos` toward `mark`, in the same shape and scale
--- as a player's own stick input. Returns (mx, my, arrived).
---
--- ONE DEFINITION, TWO CALLERS, ON PURPOSE. The server integrates it directly
--- for bots, which nothing else moves between rounds; the client feeds it into
--- its own mirror as synthetic input for the local player. Going through the
--- normal input path on the client is what keeps this out of the rubber-banding
--- trap in KNOWN-GAPS -- the client is still the thing moving the client, so
--- there is no authority handover to get wrong, and a player who touches the
--- stick simply wins.
function Staging.moveToward(pos: { x: number, y: number }, mark: { x: number, y: number }): (number, number, boolean)
	local dx, dy = mark.x - pos.x, mark.y - pos.y
	local d = math.sqrt(dx * dx + dy * dy)
	if d <= Staging.ARRIVE_EPS then
		return 0, 0, true
	end
	local mag = Staging.WALK_FRAC * math.min(1, d / Staging.SLOWDOWN)
	return (dx / d) * mag, (dy / d) * mag, false
end

--- Centre of the marks, which is what a camera should look at.
function Staging.centre(marks: { { x: number, y: number } }): (number, number)
	local sx, sy = 0, 0
	for _, m in marks do
		sx += m.x
		sy += m.y
	end
	local n = math.max(1, #marks)
	return sx / n, sy / n
end

return Staging
