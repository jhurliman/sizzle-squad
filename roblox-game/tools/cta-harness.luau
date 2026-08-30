-- THE HERO BUTTON'S STRUCTURE, ASSERTED.
--
-- Written after shipping a Start button whose UIGradient was parented to the
-- TextButton itself. A UIGradient tints the TEXT of a text object as well as
-- its background, so the white label came out washed green — and nothing in
-- the repo could see it, because every check here is headless and a colour on
-- a glyph is not something a Lune harness watches. What IS checkable is the
-- shape of the tree, and the shape is what was wrong.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local failures = 0
local function check(c: boolean, m: string)
	if c then
		print(`  ok   {m}`)
	else
		failures += 1
		print(`  FAIL {m}`)
	end
end

-- A FAKE Instance, not Lune's. Lune's is real enough to build a tree but has
-- no events, and Theme.cta binds three of them for the press animation; the
-- alternative was a pcall in shipping UI code to make a test pass, which is
-- the wrong way round. This supports exactly what Theme touches.
local function newInstance(class: string): any
	local inst
	local children = {}
	local props: { [string]: any } = { ClassName = class, Name = class }
	local signal = { Connect = function() return { Disconnect = function() end } end }
	inst = setmetatable({}, {
		__index = function(_, k)
			if k == "GetChildren" then
				return function()
					return children
				end
			elseif k == "IsA" then
				return function(_, want: string)
					return props.ClassName == want
				end
			elseif k == "FindFirstChild" then
				return function(_, name: string)
					for _, c in children do
						if c.Name == name then
							return c
						end
					end
					return nil
				end
			elseif k == "FindFirstChildWhichIsA" then
				return function(_, want: string)
					for _, c in children do
						if c.ClassName == want then
							return c
						end
					end
					return nil
				end
			elseif k:match("^Mouse") or k:match("^Input") or k == "Activated" then
				return signal
			end
			return props[k]
		end,
		__newindex = function(_, k, v)
			if k == "Parent" and v ~= nil then
				table.insert(v.__children, inst)
			end
			props[k] = v
		end,
	})
	rawset(inst, "__children", children)
	return inst
end

local env = {
	math = math, table = table, string = string, pairs = pairs, ipairs = ipairs,
	setmetatable = setmetatable, rawset = rawset, warn = function() end, print = print,
	Instance = { new = newInstance },
	Color3 = roblox.Color3,
	UDim = roblox.UDim,
	UDim2 = roblox.UDim2,
	Vector2 = roblox.Vector2,
	ColorSequence = roblox.ColorSequence,
	Enum = roblox.Enum,
}
-- The harness needs the datatypes too, not just the module's environment.
local UDim2 = roblox.UDim2
local Color3 = roblox.Color3

local Theme = luau.load(luau.compile(fs.readFile("game-src/client/Menu/Theme.luau")), { environment = env })()

local cta = Theme.cta({ Size = UDim2.fromOffset(340, 72), TextSize = 44, Text = "START SHIFT" })
local root, btn = cta.root, cta.button

check(root ~= nil and btn ~= nil, "cta returns a root and a button")
check(btn.ClassName == "TextButton", "the button is a TextButton")

-- THE BUG: a gradient anywhere on the text object tints the glyphs.
check(btn:FindFirstChildWhichIsA("UIGradient") == nil, "no UIGradient on the text object (it would tint the label)")
local face = root:FindFirstChild("CtaFace")
check(face ~= nil, "the fill lives on its own face frame")
check(face ~= nil and face:FindFirstChildWhichIsA("UIGradient") ~= nil, "and the gradient is on the face")
check(face ~= nil and face.ClassName == "Frame", "the face is a plain Frame, not a text object")

-- the label must be able to fill the button
check(btn.TextScaled == true, "the label scales to fit")
local cap = btn:FindFirstChildWhichIsA("UITextSizeConstraint")
check(cap ~= nil and cap.MaxTextSize >= 40, `the size ceiling suits the button ({cap and cap.MaxTextSize})`)

-- optical centring: all-caps ink sits high, so the box is pushed down
local pad = btn:FindFirstChildWhichIsA("UIPadding")
check(pad ~= nil and pad.PaddingTop.Offset > pad.PaddingBottom.Offset,
	`more padding above than below, so caps sit on the optical centre ({pad and pad.PaddingTop.Offset}/{pad and pad.PaddingBottom.Offset})`)

-- THE SHADOW MUST BE INSIDE THE LAYOUT BOX.
--
-- It hangs below the face, so if the root is only as tall as the face the
-- shadow bleeds into whatever the column puts underneath and eats the gap.
-- Reported as the Start button sitting too close to the info chip.
check(root.Size.Y.Offset == 72 + Theme.SHADOW_DY,
	`the root reserves the shadow's overhang ({root.Size.Y.Offset} = 72 + {Theme.SHADOW_DY})`)
check(face.Size.Y.Offset == -Theme.SHADOW_DY, "and the face stops short of it")

-- depth
check(#root:GetChildren() >= 3, "shadow, face and button are all present")
check(btn.ZIndex > face.ZIndex, "the label draws over the fill")

-- and the whole thing repaints without stranding the old hue
Theme.setCtaFill(btn, Color3.fromRGB(96, 88, 80))
local grad = face:FindFirstChildWhichIsA("UIGradient")
check(face.BackgroundColor3 == Color3.fromRGB(96, 88, 80), "setCtaFill repaints the face")
check(grad ~= nil, "and keeps a gradient on it")

print("")
print(if failures > 0 then `{failures} FAILURES` else "PASS: cta")
