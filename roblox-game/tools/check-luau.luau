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
if failed > 0 then
	process.exit(1)
end
