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
