--!strict
-- The wardrobe turntable: a real chef rig, posed by the real animator, inside
-- a ViewportFrame.
--
-- It drives ChefVisuals rather than forking it. That is deliberate: :ensure is
-- where origColors, coatColor, headAttach, hatScale, rigHeight, builtinHatParts
-- and earParts get computed, and applyPalette early-returns unless the entry
-- carries isRig + coatColor. A hand-rolled clone would silently ignore every
-- palette in the catalog -- precisely the bug that makes a wardrobe feel
-- broken. Going through ChefVisuals also means hats use the same fit math as
-- roblox/build-fitlab.luau, so the preview and the hand-tuned FitLab sheets
-- agree by construction.
--
-- Things that do NOT work inside a ViewportFrame, learned the hard way:
--   * BulkMoveTo (hence the commit override) -- fails silently, no error
--   * BillboardGui (so label is always nil), Highlight, ParticleEmitter
--   * Lighting (ambient/light must be set on the frame itself)

local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Theme = require(script.Parent.Theme) :: any
local ChefVisuals = require(script.Parent.Parent.ChefVisuals) :: any

local ChefPreview = {}
ChefPreview.__index = ChefPreview

local mk = Theme.mk

local PREVIEW_ID = 250 -- far outside any sim chef id
local AUTO_SPIN = 0.5 -- rad/s
local IDLE_BEFORE_SPIN = 2
local WALK_SPEED = 3.2 -- fed to speedOverride: a natural mid-walk cadence
local SKIN_DEBOUNCE = 0.15
local IDLE_TEARDOWN = 30

function ChefPreview.new(parent: Instance)
	local self = setmetatable({}, ChefPreview)
	self.skin = "bramble"
	self.pendingSkin = nil :: string?
	self.skinTimer = 0
	self.hat = nil :: string?
	self.palette = nil :: string?
	self.gait = "idle"
	self.spin = math.pi -- start facing the camera
	self.dragging = false
	self.lastX = 0
	self.idleT = IDLE_BEFORE_SPIN
	self.active = false
	self.dist = 20
	self.distTarget = 0 -- 0 = "needs solving"; must start dirty
	self.solveTimer = 0
	self.built = false
	self.deadTime = 0

	self.frame = mk("ViewportFrame", {
		Name = "ChefPreview",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(44, 26, 14),
		BackgroundTransparency = 0,
		BorderSizePixel = 0,
		Active = true,
		ClipsDescendants = true,
		ZIndex = 4,
		-- Viewports ignore Lighting entirely; unset, the rig renders near-black.
		Ambient = Color3.fromRGB(140, 128, 118),
		LightColor = Color3.fromRGB(255, 246, 230),
		LightDirection = Vector3.new(-0.45, -1, -0.55).Unit,
	}, parent)
	Theme.corner(self.frame, 12)

	self.camera = mk("Camera", { FieldOfView = 30 }, self.frame)
	self.frame.CurrentCamera = self.camera
	self.world = mk("WorldModel", {}, self.frame)

	self.visuals = ChefVisuals.new(self.world, {
		commit = function(parts: { BasePart }, cframes: { CFrame })
			for i, part in parts do
				part.CFrame = cframes[i]
			end
		end,
	})

	self.unavailable = Theme.label({
		Size = UDim2.new(1, -20, 0, 40),
		Position = UDim2.new(0, 10, 0.5, -20),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextWrapped = true,
		TextColor3 = Theme.DIM,
		TextSize = 14,
		ZIndex = 6,
		Visible = false,
		Text = "Preview unavailable — chef rigs not loaded.",
	}, parent)

	self:bindDrag()
	self.frame:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
		self:solveCamera(true)
	end)
	return self
end

-- ------------------------------------------------------------------ input

function ChefPreview:bindDrag()
	self.frame.InputBegan:Connect(function(i)
		if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
			self.dragging = true
			self.lastX = i.Position.X
			self.idleT = 0
		end
	end)
	-- Changed/Ended listen GLOBALLY, not on the frame: a thumb that slides off
	-- the viewport mid-drag never fires the frame's InputEnded, and the
	-- rotation would stick forever.
	UserInputService.InputChanged:Connect(function(i)
		if not (self.active and self.dragging) then
			return
		end
		if i.UserInputType == Enum.UserInputType.MouseMovement or i.UserInputType == Enum.UserInputType.Touch then
			self.spin -= (i.Position.X - self.lastX) * 0.012
			self.lastX = i.Position.X
			self.idleT = 0
		end
	end)
	UserInputService.InputEnded:Connect(function(i)
		if i.UserInputType == Enum.UserInputType.MouseButton1 or i.UserInputType == Enum.UserInputType.Touch then
			self.dragging = false
		end
	end)
end

-- ------------------------------------------------------------------ setters

function ChefPreview:setSkin(id: string)
	if id == self.skin or id == self.pendingSkin then
		return
	end
	-- A species change is a full destroy + clone + remeasure, so a fast scroll
	-- through the rail would rebuild four rigs. Settle first.
	self.pendingSkin = id
	self.skinTimer = SKIN_DEBOUNCE
end

function ChefPreview:setHat(id: string?)
	self.hat = id
	self.distTarget = 0 -- force a re-solve: hats change the extents
end

function ChefPreview:setPalette(id: string?)
	self.palette = id
end

function ChefPreview:setGait(gait: string)
	self.gait = gait
end

function ChefPreview:current(): (string, string?, string?)
	return self.pendingSkin or self.skin, self.hat, self.palette
end

--- Gate rendering with the panel: a viewport left running during a round is
--- pure waste on a low-end phone.
function ChefPreview:setActive(on: boolean)
	self.active = on
	self.frame.Visible = on
	if on then
		self.deadTime = 0
	end
end

-- ------------------------------------------------------------------- frame

function ChefPreview:solveCamera(force: boolean)
	local entry = self.visuals.chefs[PREVIEW_ID]
	if entry == nil or entry.model == nil then
		return
	end
	local ok, _cf, size = pcall(function()
		return (entry.model :: Model):GetBoundingBox()
	end)
	if not ok or size == nil then
		return
	end
	local h = math.max(1, size.Y)
	local vp = self.frame.AbsoluteSize
	-- The FRAME's aspect, never the screen's: a menu panel on a phone is close
	-- to square, and a distance solved for 896x414 crops the head off.
	local aspect = math.max(0.35, vp.X / math.max(1, vp.Y))
	local vfov = math.rad(self.camera.FieldOfView)
	local hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
	local d = math.max(h * 0.62 / math.tan(vfov / 2), math.max(size.X, size.Z) * 0.62 / math.tan(hfov / 2)) * 1.12
	self.distTarget = d
	self.centerY = h * 0.55
	if force then
		self.dist = d
	end
end

function ChefPreview:step(dt: number)
	if not self.active then
		self.deadTime += dt
		if self.deadTime > IDLE_TEARDOWN and self.built then
			self.visuals:remove(PREVIEW_ID)
			self.built = false
		end
		return
	end

	if self.pendingSkin ~= nil then
		self.skinTimer -= dt
		if self.skinTimer <= 0 then
			self.skin = self.pendingSkin
			self.pendingSkin = nil
			self.distTarget = 0
		end
	end

	if not self.dragging then
		self.idleT += dt
		if self.idleT >= IDLE_BEFORE_SPIN then
			self.spin += dt * AUTO_SPIN
		end
	end

	-- label is ALWAYS nil: a label builds a BillboardGui, which never renders
	-- in a viewport, so it would be an invisible instance paid for forever.
	self.visuals:update(PREVIEW_ID, self.skin, {
		x = 0,
		y = 0,
		heading = self.spin,
		effort = 0,
		stun = 0,
		speedOverride = if self.gait == "walk" then WALK_SPEED else 0,
	}, 0, dt, nil, self.hat, nil, self.palette)
	self.built = true

	local entry = self.visuals.chefs[PREVIEW_ID]
	if entry ~= nil and entry.isRig == false then
		self.unavailable.Visible = true
	else
		self.unavailable.Visible = false
	end

	self.solveTimer -= dt
	if self.distTarget <= 0.01 or self.solveTimer <= 0 then
		self.solveTimer = 0.5
		self:solveCamera(self.distTarget <= 0.01)
	end
	-- Damp, so swapping to a top hat glides instead of snapping the camera.
	self.dist += (self.distTarget - self.dist) * (1 - math.exp(-8 * dt))
	local center = Vector3.new(0, self.centerY or 4, 0)
	self.camera.CFrame = CFrame.lookAt(center + Vector3.new(0, (self.centerY or 4) * 0.10, self.dist), center)
end

function ChefPreview:destroy()
	self.visuals:remove(PREVIEW_ID)
	self.frame:Destroy()
end

return ChefPreview
