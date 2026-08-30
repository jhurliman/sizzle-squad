--!strict
-- THE BIN HAS TO LOOK LIKE A BIN.
--
-- Asked for in the first multiplayer playtest: "sometimes you put the wrong
-- ingredients on a plate... you need to get that plate out of your kitchen
-- stat." The mechanic was already there and had been all along -- the bin at
-- cell (13,4) takes an ingredient, or the top item off a plate, one press at a
-- time -- but nobody could find it, because it is modelled as a closed copper
-- barrel identical in silhouette to the decorative barrels around the room.
-- An affordance nobody recognises is not an affordance.
--
-- So open the lid and show the void. This runs on the client against the
-- shipped kitchen rather than in the capture pipeline, because the pipeline
-- needs a browser and this is five parts; if the kitchen is ever re-exported,
-- the barrel should be authored open at source and this can go.
--
-- Everything is placed off the barrel's OWN CFrame, so it stays correct if the
-- bin ever moves, and along its local X, because a Roblox cylinder's axis is X
-- and these barrels are rotated upright.

local BinDress = {}

local VOID = Color3.fromRGB(18, 14, 11)
local RIM = Color3.fromRGB(96, 88, 80)
local SCRAPS = {
	Color3.fromRGB(126, 174, 74), -- cabbage leaf
	Color3.fromRGB(198, 78, 62), -- tomato skin
	Color3.fromRGB(226, 200, 148), -- crust
}

local function cylinder(name: string, parent: Instance, cf: CFrame, len: number, dia: number, color: Color3)
	local p = Instance.new("Part")
	p.Name = name
	p.Shape = Enum.PartType.Cylinder
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.Color = color
	p.Size = Vector3.new(len, dia, dia)
	p.CFrame = cf
	p.Parent = parent
	return p
end

--- Dress the bin model into an open trash can. Safe to call more than once.
function BinDress.apply(binModel: Instance)
	if binModel:FindFirstChild("TrashVoid") ~= nil then
		return
	end
	local body = binModel:FindFirstChild("Copper_01")
	if body == nil or not body:IsA("BasePart") then
		return
	end
	local half = body.Size.X / 2
	local dia = body.Size.Y
	-- Local X is up for these barrels; +half reaches the lid.
	local topCF = body.CFrame * CFrame.new(half, 0, 0)

	-- The closed cap has to go, or the can still reads as sealed. It is the
	-- small part sitting above the rail; anything up there is lid.
	for _, d in binModel:GetChildren() do
		if d:IsA("BasePart") and d ~= body then
			local up = body.CFrame:PointToObjectSpace(d.Position).X
			if up > half and d.Size.Y < dia * 0.4 then
				d:Destroy()
			end
		end
	end

	-- A dark well set just below the rim: the whole point is that you can see
	-- there is somewhere for rubbish to GO.
	cylinder("TrashVoid", binModel, topCF * CFrame.new(-0.18, 0, 0), 0.12, dia * 0.84, VOID)
	-- A steel rim so the opening reads as an edge rather than a painted disc.
	cylinder("TrashRim", binModel, topCF * CFrame.new(-0.04, 0, 0), 0.22, dia * 1.04, RIM)

	-- Three scraps poking out. Without them an open barrel is just a barrel
	-- with a dark lid; rubbish is what names the object.
	for i, color in SCRAPS do
		local a = (i / #SCRAPS) * math.pi * 2
		local r = dia * 0.22
		local scrap = Instance.new("Part")
		scrap.Name = `TrashScrap{i}`
		scrap.Anchored = true
		scrap.CanCollide = false
		scrap.CanQuery = false
		scrap.CanTouch = false
		scrap.CastShadow = false
		scrap.Material = Enum.Material.SmoothPlastic
		scrap.Color = color
		scrap.Size = Vector3.new(0.5, 0.7, 0.16)
		scrap.CFrame = topCF
			* CFrame.new(0.06, math.cos(a) * r, math.sin(a) * r)
			* CFrame.Angles(a * 1.7, 0.5 + i * 0.35, 0.35)
		scrap.Parent = binModel
	end
end

return BinDress
