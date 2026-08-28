-- Syntax-gates every .luau file under game-src/ with luau.compile.
-- (Full type analysis happens in Studio; this catches breakage headless.)
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")

local failed = 0
local checked = 0

local function walk(dir: string)
	for _, name in fs.readDir(dir) do
		local path = `{dir}/{name}`
		if fs.isDir(path) then
			walk(path)
		elseif name:match("%.luau$") then
			checked += 1
			local src = fs.readFile(path)
			local ok, err = pcall(function()
				luau.compile(src)
			end)
			if not ok then
				failed += 1
				print(`FAIL {path}: {err}`)
			end
		end
	end
end

walk("game-src")
walk("tools")
print(`{checked} files checked, {failed} failed`)

-- ------------------------------------------------------------------------
-- CODEGEN GUARD: `0` IS TRUTHY IN LUA AND FALSY IN TYPESCRIPT.
--
-- TSTL compiles a bare `arr.length` truthiness test to `#arr`, which silently
-- inverts meaning for an EMPTY array: `if (xs.length)` is false in TS and true
-- in Lua, and `if (!xs.length)` is true in TS and false in Lua. Both builds
-- compile, both run, and the parity harness cannot see it whenever the
-- divergence only affects a prompt rather than sim state -- which is exactly
-- how the bin came to advertise 'discard' for an empty plate on Roblox and do
-- nothing when pressed (found by tools/focus-harness.luau).
--
-- The fix at every site is to compare explicitly: `.length > 0` / `.length ==
-- 0`. This guard exists so the next one is caught by a build rather than by a
-- player, because nothing else in the pipeline looks for it.
local BUNDLE = "out/shared-bundle.lua"
local bundleBad = 0
if fs.isFile(BUNDLE) then
	local n = 0
	for line in fs.readFile(BUNDLE):gmatch("[^\n]+") do
		n += 1
		-- `#x` reached as a condition rather than as an operand of a comparison
		-- or arithmetic: `if #x then`, `and #x then`, `not #x`, `or #x)`.
		if
			line:match("[%s%(]not%s+#[%w_%.%[%]]+")
			or line:match("[%s%(](if|and|or)%s+#[%w_%.%[%]]+%s*then")
			or line:match("%sif%s+#[%w_%.%[%]]+%s+then")
			or line:match("%sand%s+#[%w_%.%[%]]+%s+then")
			or line:match("%sor%s+#[%w_%.%[%]]+%s+then")
		then
			bundleBad += 1
			print(`FAIL {BUNDLE}:{n}: array length used as a truthiness test — 0 is truthy in Lua`)
			print(`     {line:match("^%s*(.-)%s*$")}`)
		end
	end
end
if bundleBad == 0 then
	print("shared bundle: no array-length truthiness tests")
end

-- ------------------------------------------------------------------------
-- IS THE PLACE FILE OLDER THAN THE CODE IN IT?
--
-- `npm run build` writes SizzleSquad.rbxl, and that file is what Studio opens.
-- Build it anywhere else -- a scratch path, a temp directory -- and every check
-- in this repo can pass against source that Studio is not running, which is a
-- very expensive way to lose a playtest: the report comes back describing bugs
-- that were fixed hours earlier, and the first instinct is to go looking for
-- them in the code rather than in the build.
local PLACE = "SizzleSquad.rbxl"
local stale = false
if fs.isFile(PLACE) then
	local built = fs.metadata(PLACE).modifiedAt.unixTimestamp
	local newest, newestPath = 0, ""
	local function scan(dir: string)
		for _, name in fs.readDir(dir) do
			local path = `{dir}/{name}`
			if fs.isDir(path) then
				scan(path)
			elseif name:match("%.luau$") or name:match("%.lua$") then
				local t = fs.metadata(path).modifiedAt.unixTimestamp
				if t > newest then
					newest, newestPath = t, path
				end
			end
		end
	end
	scan("game-src")
	if fs.isFile("out/shared-bundle.lua") then
		local t = fs.metadata("out/shared-bundle.lua").modifiedAt.unixTimestamp
		if t > newest then
			newest, newestPath = t, "out/shared-bundle.lua"
		end
	end
	if newest > built then
		stale = true
		print(`FAIL {PLACE} is OLDER than {newestPath} — Studio would run stale code. Run: npm run build`)
	else
		print(`{PLACE} is up to date with game-src`)
	end
else
	print(`NOTE {PLACE} has not been built yet — run: npm run build`)
end

if failed > 0 or bundleBad > 0 or stale then
	process.exit(1)
end
