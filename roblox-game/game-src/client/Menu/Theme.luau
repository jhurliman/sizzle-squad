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

-- How far a CTA's shadow sits below its face. Named because the layout has to
-- reserve it; see Theme.cta.
Theme.SHADOW_DY = 5

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
--- Repaint a CTA built by `Theme.cta`, keeping its gradient and edge in step
--- with the new fill. `paint` swaps green for grey when a player stands down,
--- and a gradient left on the old hue is worse than no gradient at all.
function Theme.setCtaFill(btn: any, fill: Color3)
	local face = btn.Parent and btn.Parent:FindFirstChild("CtaFace")
	if face == nil then
		return
	end
	face.BackgroundColor3 = fill
	local grad = face:FindFirstChild("CtaGradient")
	if grad ~= nil then
		grad.Color = ColorSequence.new(shade(fill, 0.20), shade(fill, -0.18))
	end
	local edge = face:FindFirstChildWhichIsA("UIStroke")
	if edge ~= nil then
		edge.Color = shade(fill, -0.42)
	end
	-- The label's own outline is keyed to the fill too, or a grey button keeps
	-- a green-black outline on its text.
	local textEdge = btn:FindFirstChildWhichIsA("UIStroke")
	if textEdge ~= nil then
		textEdge.Color = shade(fill, -0.55)
	end
end

--- THE HERO BUTTON. One per screen, and on this screen it is Start Shift.
---
--- Built as three stacked pieces rather than one styled TextButton, and the
--- reason is not tidiness:
---
---   * A UIGradient on a TextButton tints its TEXT as well as its background.
---     The first version put the gradient straight on the button and the label
---     came out washed green instead of white. The fill lives on its own frame
---     so the gradient can never reach the glyphs.
---   * A UIStroke on a text object strokes the TEXT, not the border
---     (ApplyStrokeMode.Contextual). That is wanted here — a heavy dark outline
---     is what makes a chunky display face read at a distance — but it means
---     the button's own edge needs a stroke on the non-text frame instead.
---
--- Returns { root, button }: `root` is the thing to position and size, because
--- the shadow has to sit behind everything and a UIListLayout would otherwise
--- lay it out as another item in the column.
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
	local maxText = props.TextSize or 30
	props.TextSize = nil

	-- THE SHADOW IS PART OF THE BUTTON'S FOOTPRINT.
	--
	-- It hangs SHADOW_DY below the face, and the root used to be exactly the
	-- face's size -- so the shadow bled past the bottom edge of the layout box
	-- and ate that many pixels out of the gap the UIListLayout was leaving
	-- underneath. The button read as crowding whatever sat below it. Reserve
	-- the overhang and the declared gap is the gap you actually see.
	local root = mk("Frame", {
		Size = UDim2.new(size.X.Scale, size.X.Offset, size.Y.Scale, size.Y.Offset + Theme.SHADOW_DY),
		BackgroundTransparency = 1,
		LayoutOrder = props.LayoutOrder or 1,
	}, parent)
	props.LayoutOrder = nil

	-- Offset down, never blurred: Roblox has no blur on a Frame, so a soft
	-- shadow has to be faked with an image. A hard offset shadow at low alpha
	-- reads as deliberate; a fake blur made of stacked frames does not.
	local shadow = mk("Frame", {
		Size = UDim2.new(1, 0, 1, -Theme.SHADOW_DY),
		Position = UDim2.fromOffset(0, Theme.SHADOW_DY),
		BackgroundColor3 = Theme.BROWN_DEEP,
		BackgroundTransparency = 0.45,
		BorderSizePixel = 0,
		ZIndex = z,
	}, root)
	Theme.corner(shadow, 14)

	local face = mk("Frame", {
		Name = "CtaFace",
		Size = UDim2.new(1, 0, 1, -Theme.SHADOW_DY),
		BackgroundColor3 = fill,
		BorderSizePixel = 0,
		ZIndex = z + 1,
	}, root)
	Theme.corner(face, 14)
	mk("UIGradient", {
		Name = "CtaGradient",
		Rotation = 90,
		Color = ColorSequence.new(shade(fill, 0.20), shade(fill, -0.18)),
	}, face)
	Theme.stroke(face, shade(fill, -0.42), 2)

	local btn = mk(
		"TextButton",
		Theme.merge({
			Size = UDim2.new(1, 0, 1, -Theme.SHADOW_DY),
			BackgroundTransparency = 1,
			TextColor3 = Theme.WHITE,
			-- THE LABEL FITS ITSELF.
			--
			-- This button says "START SHIFT" and also "WAITING FOR CREW 2/3",
			-- nearly twice as long, in a face with wide sidebearings, on a
			-- button that is 260px on a phone. Hand-picked TextSize per state
			-- is how that ends up clipped on exactly one device nobody tested.
			TextScaled = true,
			Font = Theme.DISPLAY_FONT,
			AutoButtonColor = false,
			ZIndex = z + 2,
		}, props),
		root
	)
	mk("UITextSizeConstraint", { MaxTextSize = maxText, MinTextSize = 14 }, btn)
	-- OPTICALLY CENTRED, NOT MATHEMATICALLY CENTRED.
	--
	-- All-caps text has no descenders, so its ink sits in the upper part of the
	-- line box and centring the BOX leaves the letters visibly high — which is
	-- exactly how this looked. More padding above than below pushes the box
	-- down until the caps sit on the button's optical centre.
	mk("UIPadding", {
		PaddingLeft = UDim.new(0, 12),
		PaddingRight = UDim.new(0, 12),
		PaddingTop = UDim.new(0, 10),
		PaddingBottom = UDim.new(0, 2),
	}, btn)
	-- Strokes the TEXT, not the border (see the note above). The heavy dark
	-- outline is what lets a display face hold up against a busy kitchen.
	Theme.stroke(btn, shade(fill, -0.55), 3)

	local function press(down: boolean)
		local dy = if down then 3 else 0
		face.Position = UDim2.fromOffset(0, dy)
		btn.Position = UDim2.fromOffset(0, dy)
		shadow.Position = UDim2.fromOffset(0, if down then Theme.SHADOW_DY - 3 else Theme.SHADOW_DY)
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
