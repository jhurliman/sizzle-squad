--!strict
-- Ticket icons without any asset upload: IconData.luau embeds the web game's
-- rasterized SVG glyphs as base64 RGBA; this module rebuilds them at runtime
-- with EditableImage. Returns nil (caller falls back to colored chips) when
-- the EditableImage API is unavailable.

local AssetService = game:GetService("AssetService")

local IconData = require(script.Parent.IconData) :: any

local IconViz = {}
local cache: { [string]: any } = {}

local B64: { [number]: number } = {}
do
	local chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	for i = 1, 64 do
		B64[string.byte(chars, i)] = i - 1
	end
end

local function decodeBase64(b64: string): buffer
	local n = #b64
	local pad = 0
	if n > 0 and string.byte(b64, n) == 61 then
		pad += 1
	end
	if n > 1 and string.byte(b64, n - 1) == 61 then
		pad += 1
	end
	local outLen = math.floor(n / 4) * 3 - pad
	local out = buffer.create(outLen)
	local o = 0
	for i = 1, n, 4 do
		local a = B64[string.byte(b64, i)] or 0
		local b = B64[string.byte(b64, i + 1)] or 0
		local c = B64[string.byte(b64, i + 2)] or 0
		local d = B64[string.byte(b64, i + 3)] or 0
		local v = a * 262144 + b * 4096 + c * 64 + d
		if o < outLen then
			buffer.writeu8(out, o, bit32.rshift(v, 16))
			o += 1
		end
		if o < outLen then
			buffer.writeu8(out, o, bit32.band(bit32.rshift(v, 8), 255))
			o += 1
		end
		if o < outLen then
			buffer.writeu8(out, o, bit32.band(v, 255))
			o += 1
		end
	end
	return out
end

--- Content for an ingredient icon, or nil when unavailable.
function IconViz.content(kind: string, state: string): any?
	local key = `{kind}:{state}`
	local hit = cache[key]
	if hit ~= nil then
		return if hit == false then nil else hit
	end
	local icon = IconData[key]
	if icon == nil then
		cache[key] = false
		return nil
	end
	local ok, content = pcall(function()
		local img = (AssetService :: any):CreateEditableImage({ Size = Vector2.new(icon.w, icon.h) })
		img:WritePixelsBuffer(Vector2.zero, Vector2.new(icon.w, icon.h), decodeBase64(icon.rgba))
		return (Content :: any).fromObject(img)
	end)
	cache[key] = if ok and content ~= nil then content else false
	return if ok then content else nil
end

return IconViz
