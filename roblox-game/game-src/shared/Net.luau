--!strict
-- Wire protocol: remote definitions + buffer packing for the hot paths.
--
-- Hot paths (30Hz up / 20Hz down) use packed buffers; everything else
-- (events, station/order deltas, snapshots) rides plain tables — at 4 chefs
-- and 15 stations that is well inside budget, and tables keep the cold paths
-- debuggable.
--
-- Kitchen coordinates go over the wire in CELL units (the sim's space), not
-- studs. Positions quantize to u16 over [-2, 30] cells (the kitchen plus
-- apron), velocities to i8 over [-8, 8] cells/s, headings to u8 over [-pi,pi].

local Net = {}

Net.FOLDER = "SizzleNet"

Net.REMOTES = {
	-- client -> server
	MoveStream = "UnreliableRemoteEvent", -- buffer: seq,pos,vel,heading,useHeld
	GrabEdge = "RemoteEvent", -- seq (reliable: a press must never be lost)
	ClientReady = "RemoteEvent", -- client -> server: my listeners are connected, re-send the join state
	-- server -> client
	Transforms = "UnreliableRemoteEvent", -- buffer: per-chef transform+flags
	SimEvents = "RemoteEvent", -- { SimEvent, ... } batched per heartbeat
	StationDeltas = "RemoteEvent", -- { {id, holding?, active, work, cook, burn}, ... }
	OrdersDelta = "RemoteEvent", -- { orders = {...}, patience = n }
	ScoreDelta = "RemoteEvent", -- { coins, served, missed, combo, bestCombo, patience }
	ChefAssign = "RemoteEvent", -- { chefId, skin, seed } on join / handoff
	Snapshot = "RemoteEvent", -- full state for a new joiner
	Correction = "RemoteEvent", -- { x, y } authoritative own-chef snap
	RoundPhase = "RemoteEvent", -- { phase, timer, round, results? }
	ReadyUp = "RemoteEvent", -- client -> server: ready toggle in intermission
	Emote = "RemoteEvent", -- both ways: { chefId, emote } speech-bubble pings
	Progress = "RemoteEvent", -- server -> client: { xp, level, coins, unlocks, challenges }
	ShopAction = "RemoteEvent", -- client -> server: { action = "buy"|"equip", id }
	Leaderboards = "RemoteEvent", -- server -> client: { weekly, allTime, dishes }
	CarryDeltas = "RemoteEvent", -- server -> client: { {chefId, carrying-summary}, ... }
	EquipDeltas = "RemoteEvent", -- server -> client: { {chefId, hat?, name?, skin?, palette?}, ... }
	PickSpecies = "RemoteEvent", -- client -> server: species name
	BotFill = "RemoteEvent", -- client -> server: bots fill empty seats (bool)
}

local POS_MIN, POS_MAX = -2, 30
local VEL_MAX = 8

local function q16(v: number, lo: number, hi: number): number
	local t = math.clamp((v - lo) / (hi - lo), 0, 1)
	return math.floor(t * 65535 + 0.5)
end

local function uq16(n: number, lo: number, hi: number): number
	return lo + (n / 65535) * (hi - lo)
end

local function qi8(v: number, maxAbs: number): number
	return math.clamp(math.floor((v / maxAbs) * 127 + 0.5), -127, 127)
end

local function uqi8(n: number, maxAbs: number): number
	return (n / 127) * maxAbs
end

-- ---------------------------------------------------------------- move stream

-- seq u16 | px u16 | py u16 | vx i8 | vy i8 | heading u8 | flags u8 (bit0 useHeld)
Net.MOVE_PACKET_SIZE = 10

function Net.packMove(seq: number, px: number, py: number, vx: number, vy: number, heading: number, useHeld: boolean): buffer
	local b = buffer.create(Net.MOVE_PACKET_SIZE)
	buffer.writeu16(b, 0, seq % 65536)
	buffer.writeu16(b, 2, q16(px, POS_MIN, POS_MAX))
	buffer.writeu16(b, 4, q16(py, POS_MIN, POS_MAX))
	buffer.writei8(b, 6, qi8(vx, VEL_MAX))
	buffer.writei8(b, 7, qi8(vy, VEL_MAX))
	buffer.writeu8(b, 8, math.floor(((heading + math.pi) / (2 * math.pi)) * 255 + 0.5) % 256)
	buffer.writeu8(b, 9, if useHeld then 1 else 0)
	return b
end

export type MovePacket = {
	seq: number,
	px: number,
	py: number,
	vx: number,
	vy: number,
	heading: number,
	useHeld: boolean,
}

function Net.unpackMove(b: buffer): MovePacket?
	if buffer.len(b) ~= Net.MOVE_PACKET_SIZE then
		return nil
	end
	return {
		seq = buffer.readu16(b, 0),
		px = uq16(buffer.readu16(b, 2), POS_MIN, POS_MAX),
		py = uq16(buffer.readu16(b, 4), POS_MIN, POS_MAX),
		vx = uqi8(buffer.readi8(b, 6), VEL_MAX),
		vy = uqi8(buffer.readi8(b, 7), VEL_MAX),
		heading = (buffer.readu8(b, 8) / 255) * 2 * math.pi - math.pi,
		useHeld = buffer.readu8(b, 9) ~= 0,
	}
end

-- ---------------------------------------------------------------- transforms

-- Flags bits: 0 stunned, 1 working, 2 carrying, 3-4 carry tier (0 none,
-- 1 produce, 2 plate/pan), 5 isPlayer-controlled (vs bot).
Net.CHEF_STRIDE = 11 -- id u8 | px u16 | py u16 | vx i8 | vy i8 | heading u8 | flags u8 | effort u8 | stun u8(1/30s units)

export type ChefTransform = {
	id: number,
	px: number,
	py: number,
	vx: number,
	vy: number,
	heading: number,
	flags: number,
	effort: number,
	stun: number,
}

function Net.packTransforms(chefs: { ChefTransform }): buffer
	local b = buffer.create(1 + #chefs * Net.CHEF_STRIDE)
	buffer.writeu8(b, 0, #chefs)
	local o = 1
	for _, c in chefs do
		buffer.writeu8(b, o, c.id)
		buffer.writeu16(b, o + 1, q16(c.px, POS_MIN, POS_MAX))
		buffer.writeu16(b, o + 3, q16(c.py, POS_MIN, POS_MAX))
		buffer.writei8(b, o + 5, qi8(c.vx, VEL_MAX))
		buffer.writei8(b, o + 6, qi8(c.vy, VEL_MAX))
		buffer.writeu8(b, o + 7, math.floor(((c.heading + math.pi) / (2 * math.pi)) * 255 + 0.5) % 256)
		buffer.writeu8(b, o + 8, c.flags)
		buffer.writeu8(b, o + 9, math.clamp(math.floor(c.effort * 255 + 0.5), 0, 255))
		buffer.writeu8(b, o + 10, math.clamp(math.floor(c.stun * 30 + 0.5), 0, 255))
		o += Net.CHEF_STRIDE
	end
	return b
end

function Net.unpackTransforms(b: buffer): { ChefTransform }
	local out: { ChefTransform } = {}
	if buffer.len(b) < 1 then
		return out
	end
	local n = buffer.readu8(b, 0)
	if buffer.len(b) < 1 + n * Net.CHEF_STRIDE then
		return out
	end
	local o = 1
	for _ = 1, n do
		table.insert(out, {
			id = buffer.readu8(b, o),
			px = uq16(buffer.readu16(b, o + 1), POS_MIN, POS_MAX),
			py = uq16(buffer.readu16(b, o + 3), POS_MIN, POS_MAX),
			vx = uqi8(buffer.readi8(b, o + 5), VEL_MAX),
			vy = uqi8(buffer.readi8(b, o + 6), VEL_MAX),
			heading = (buffer.readu8(b, o + 7) / 255) * 2 * math.pi - math.pi,
			flags = buffer.readu8(b, o + 8),
			effort = buffer.readu8(b, o + 9) / 255,
			stun = buffer.readu8(b, o + 10) / 30,
		})
		o += Net.CHEF_STRIDE
	end
	return out
end

Net.FLAG_STUN = 1
Net.FLAG_WORKING = 2
Net.FLAG_CARRYING = 4
Net.FLAG_TIER_SHIFT = 3 -- bits 3-4
Net.FLAG_HUMAN = 32

-- ---------------------------------------------------------------- setup

--- Server: create the remotes folder. Client: wait for it.
function Net.server(parent: Instance): { [string]: any }
	local folder = Instance.new("Folder")
	folder.Name = Net.FOLDER
	local out: { [string]: any } = {}
	for name, class in Net.REMOTES do
		local r = Instance.new(class)
		r.Name = name
		r.Parent = folder
		out[name] = r
	end
	folder.Parent = parent
	return out
end

function Net.client(parent: Instance): { [string]: any }
	local folder = parent:WaitForChild(Net.FOLDER)
	local out: { [string]: any } = {}
	for name in Net.REMOTES do
		out[name] = folder:WaitForChild(name)
	end
	return out
end

return Net
