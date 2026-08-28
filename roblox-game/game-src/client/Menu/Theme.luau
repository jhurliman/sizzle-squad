--!strict
-- Menu design system: palette, instance builders and responsive breakpoints
-- shared by every menu surface.
--
-- `mk` was copy-pasted verbatim into Hud.luau and FirstShift.luau. It lives
-- here now and both require it, so a change to how instances get built lands
-- in one place instead of three.

local Theme = {}

-- The kitchen's own palette, lifted from the existing HUD chips so the menu
-- reads as part of the same game rather than a bolted-on storefront.
Theme.BROWN_DEEP = Color3.fromRGB(30, 16, 8)
Theme.BROWN = Color3.fromRGB(40, 24, 12)
Theme.BROWN_MID = Color3.fromRGB(58, 32, 19)
Theme.BROWN_LIGHT = Color3.fromRGB(66, 40, 22)
Theme.CREAM = Color3.fromRGB(255, 244, 221)
Theme.GOLD = Color3.fromRGB(255, 224, 102)
Theme.GREEN = Color3.fromRGB(92, 174, 64)
Theme.RED = Color3.fromRGB(204, 75, 66)
Theme.BLUE = Color3.fromRGB(70, 130, 200)
Theme.GREY = Color3.fromRGB(96, 88, 80)
Theme.DIM = Color3.fromRGB(150, 140, 128)
Theme.WHITE = Color3.new(1, 1, 1)

Theme.TITLE_FONT = Enum.Font.FredokaOne
Theme.BODY_FONT = Enum.Font.GothamMedium
Theme.BOLD_FONT = Enum.Font.GothamBold
-- THE HERO FACE, AND THE REASON THE OLD ONE HAD TO GO.
--
-- FredokaOne sets very tight at display sizes, and Roblox has no
-- letter-spacing property, so the Start button had been spaced BY HAND --
-- literally "S T A R T   S H I F T" with padding characters. That is not
-- kerning, it is a workaround that looks like a workaround: the gaps are
-- uniform where real spacing is optical, and the word stops reading as a word.
--
-- LuckiestGuy is the fix rather than a taste change. It is a display face with
-- thick even strokes and generous built-in sidebearings, so it needs no manual
-- spacing at all, and it stays legible at a phone's viewing distance where a
-- thinner face at the same point size does not. It also matches the world art,
-- which is the same chunky cartoon register.
--
-- The other candidates and why they are not this: BuilderSansExtraBold and
-- ArimoBold are clean but neutral, and a hero button is the one place
-- personality earns its keep; SourceSansBold is the engine default and reads
-- as unstyled; PatrickHand is charming but its thin handwritten strokes lose
-- too much at a distance for the single most important control on screen.
Theme.DISPLAY_FONT = Enum.Font.LuckiestGuy

-- Touch targets never go below this. Roblox's guidance is 44px; we hold 48
-- because the menu competes with the thumbstick zone on a phone.
Theme.MIN_TAP = 48

function Theme.mk(class: string, props: { [string]: any }, parent: Instance?): any
	local inst = Instance.new(class) :: any
	for k, v in props do
		inst[k] = v
	end
	if parent ~= nil then
		inst.Parent = parent
	end
	return inst
end

local mk = Theme.mk

function Theme.corner(inst: Instance, radius: number?)
	return mk("UICorner", { CornerRadius = UDim.new(0, radius or 12) }, inst)
end

function Theme.stroke(inst: Instance, color: Color3, thickness: number?)
	return mk("UIStroke", { Color = color, Thickness = thickness or 2 }, inst)
end

--- A filled action button. `variant` picks the fill; the caller positions it.
function Theme.button(props: { [string]: any }, parent: Instance?): any
	local fill = props.Fill or Theme.GREEN
	props.Fill = nil
	local maxText = props.TextSize or 30
	props.TextSize = nil
	local btn = mk(
		"TextButton",
		Theme.merge({
			BackgroundColor3 = fill,
			TextColor3 = Theme.WHITE,
			TextSize = 18,
			Font = Theme.TITLE_FONT,
			AutoButtonColor = true,
			BorderSizePixel = 0,
		}, props),
		parent
	)
	Theme.corner(btn, 10)
	return btn
end

local function shade(c: Color3, amount: number): Color3
	if amount >= 0 then
		return c:Lerp(Color3.new(1, 1, 1), amount)
	end
	return c:Lerp(Color3.new(0, 0, 0), -amount)
end

--- Repaint a CTA built by `Theme.cta`, keeping its gradient consistent with the
--- new fill. `paint` swaps green for grey when a player stands down, and a
--- gradient left on the old hue is worse than no gradient at all.
function Theme.setCtaFill(btn: any, fill: Color3)
	btn.BackgroundColor3 = fill
	local grad = btn:FindFirstChild("CtaGradient")
	if grad ~= nil then
		grad.Color = ColorSequence.new(shade(fill, 0.18), shade(fill, -0.16))
	end
end

--- THE HERO BUTTON. One per screen, and on this screen it is Start Shift.
---
--- A flat rectangle of one colour reads as a placeholder no matter how good the
--- type is, so this adds the three things that make a button look pressable:
--- a vertical gradient (light above, dark below, which is where a lit surface
--- puts its values), a dropped shadow so it sits ABOVE the panel rather than
--- being painted on it, and a press that actually moves.
---
--- Returns { root, button }: `root` is the thing to position and size, because
--- the shadow has to live behind the button and a UIListLayout would otherwise
--- treat it as a second item in the column.
function Theme.cta(props: { [string]: any }, parent: Instance?): any
	local fill = props.Fill or Theme.GREEN
	props.Fill = nil
	local size = props.Size or UDim2.fromOffset(320, 72)
	props.Size = nil
	-- Consumed, not merged: `Theme.merge` lets the caller's props win, so a
	-- passed-in ZIndex would land the button on the same layer as its own
	-- shadow and the shadow would draw over it.
	local z = props.ZIndex or 1
	props.ZIndex = nil

	local root = mk("Frame", {
		Size = size,
		BackgroundTransparency = 1,
		LayoutOrder = props.LayoutOrder or 1,
	}, parent)
	props.LayoutOrder = nil

	-- Offset down, never blurred: Roblox has no blur on a Frame, so a soft
	-- shadow has to be faked with an image. A hard offset shadow at low alpha
	-- reads as deliberate; a fake blur made of stacked frames does not.
	local shadow = mk("Frame", {
		Size = UDim2.new(1, 0, 1, 0),
		Position = UDim2.fromOffset(0, 5),
		BackgroundColor3 = Theme.BROWN_DEEP,
		BackgroundTransparency = 0.45,
		BorderSizePixel = 0,
		ZIndex = z,
	}, root)
	Theme.corner(shadow, 14)

	local btn = mk(
		"TextButton",
		Theme.merge({
			Size = UDim2.new(1, 0, 1, 0),
			BackgroundColor3 = fill,
			TextColor3 = Theme.WHITE,
			-- THE LABEL FITS ITSELF.
			--
			-- This button says "START SHIFT" and also "WAITING FOR CREW 2/3",
			-- which is nearly twice as long, in a face with wide sidebearings,
			-- on a button that is 260px on a phone. Hand-picked TextSize per
			-- state is how that ends up clipped on exactly one device nobody
			-- tested. TextScaled with a max constraint gives the short label
			-- the full display size and quietly shrinks the long one.
			TextScaled = true,
			Font = Theme.DISPLAY_FONT,
			-- Our own press response instead: AutoButtonColor tints the
			-- background, which the gradient then multiplies, and the result
			-- is a button that changes hue rather than depth.
			AutoButtonColor = false,
			BorderSizePixel = 0,
			ZIndex = z + 1,
		}, props),
		root
	)
	Theme.corner(btn, 14)
	mk("UITextSizeConstraint", {
		MaxTextSize = maxText,
		MinTextSize = 14,
	}, btn)
	mk("UIPadding", {
		PaddingLeft = UDim.new(0, 14),
		PaddingRight = UDim.new(0, 14),
		PaddingTop = UDim.new(0, 8),
		PaddingBottom = UDim.new(0, 8),
	}, btn)
	mk("UIGradient", {
		Name = "CtaGradient",
		Rotation = 90,
		Color = ColorSequence.new(shade(fill, 0.18), shade(fill, -0.16)),
	}, btn)
	Theme.stroke(btn, shade(fill, -0.35), 2)
	-- A cream inner line just under the top edge: the highlight a rounded,
	-- lit surface actually has, and what stops the fill reading as printed on.
	local gloss = mk("Frame", {
		Size = UDim2.new(1, -16, 0, 2),
		Position = UDim2.new(0, 8, 0, 5),
		BackgroundColor3 = Theme.CREAM,
		BackgroundTransparency = 0.72,
		BorderSizePixel = 0,
		ZIndex = z + 2,
	}, btn)
	Theme.corner(gloss, 1)

	local function press(down: boolean)
		btn.Position = if down then UDim2.fromOffset(0, 3) else UDim2.fromOffset(0, 0)
		shadow.Position = if down then UDim2.fromOffset(0, 2) else UDim2.fromOffset(0, 5)
	end
	btn.MouseButton1Down:Connect(function()
		press(true)
	end)
	btn.MouseButton1Up:Connect(function()
		press(false)
	end)
	btn.MouseLeave:Connect(function()
		press(false)
	end)

	return { root = root, button = btn }
end

--- A panel/card surface.
function Theme.card(props: { [string]: any }, parent: Instance?): any
	local card = mk(
		"Frame",
		Theme.merge({
			BackgroundColor3 = Theme.BROWN,
			BackgroundTransparency = 0.05,
			BorderSizePixel = 0,
		}, props),
		parent
	)
	Theme.corner(card, 14)
	return card
end

--- A small rounded status chip (read-only).
function Theme.chip(props: { [string]: any }, parent: Instance?): any
	local chip = mk(
		"TextLabel",
		Theme.merge({
			BackgroundColor3 = Theme.BROWN_MID,
			BackgroundTransparency = 0.15,
			TextColor3 = Theme.CREAM,
			TextSize = 16,
			Font = Theme.TITLE_FONT,
			BorderSizePixel = 0,
		}, props),
		parent
	)
	Theme.corner(chip, 10)
	return chip
end

function Theme.label(props: { [string]: any }, parent: Instance?): any
	return mk(
		"TextLabel",
		Theme.merge({
			BackgroundTransparency = 1,
			TextColor3 = Theme.CREAM,
			TextSize = 15,
			Font = Theme.BODY_FONT,
			TextXAlignment = Enum.TextXAlignment.Left,
		}, props),
		parent
	)
end

function Theme.scrollList(props: { [string]: any }, parent: Instance?): (any, any)
	local sf = mk(
		"ScrollingFrame",
		Theme.merge({
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			CanvasSize = UDim2.fromOffset(0, 0),
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
			ScrollBarThickness = 5,
			ScrollBarImageColor3 = Theme.CREAM,
			ScrollBarImageTransparency = 0.5,
			ScrollingDirection = Enum.ScrollingDirection.Y,
			ElasticBehavior = Enum.ElasticBehavior.WhenScrollable,
		}, props),
		parent
	)
	local layout = mk("UIListLayout", {
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
	}, sf)
	return sf, layout
end

--- Shallow merge: `over` wins. Used so callers can override any default.
function Theme.merge(base: { [string]: any }, over: { [string]: any }): { [string]: any }
	local out: { [string]: any } = {}
	for k, v in base do
		out[k] = v
	end
	for k, v in over do
		out[k] = v
	end
	return out
end

export type Layout = {
	name: string,
	pad: number,
	tabH: number,
	headerH: number,
	footerH: number,
	twoColumn: boolean,
	previewW: number,
	panelW: number,
	panelH: number,
}

--- Responsive breakpoints.
---
--- Reflow, do NOT scale down. A 0.8 UIScale on a phone turns 14px text
--- illegible and 48px tap targets into 38px; the fix for a small screen is
--- fewer columns, not smaller everything.
function Theme.layoutFor(viewport: Vector2): Layout
	local w, h = viewport.X, viewport.Y
	local short = h < 500
	local name = if h < 420 then "phone" elseif h < 620 then "tablet" else "desktop"
	local panelW = math.min(880, w - 32)
	local panelH = math.min(560, h - (if short then 24 else 96))
	return {
		name = name,
		pad = if short then 8 else 12,
		tabH = if short then 38 else 44,
		headerH = if short then 34 else 42,
		footerH = if short then 46 else 56,
		twoColumn = w >= 620,
		previewW = math.clamp(panelW * 0.36, 200, 320),
		panelW = panelW,
		panelH = panelH,
	}
end

return Theme
