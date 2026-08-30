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
-- DO `require(script.Parent...)` PATHS POINT AT A MODULE THAT EXISTS?
--
-- Luau compiles `require(script.Parent.Loc)` happily whether or not `Loc` is
-- there — it is a runtime instance lookup, so every static check in this repo
-- passed while five menu modules pointed one level too shallow. The client
-- script died on the first require, which meant no camera rig and no input
-- handling, so the published game showed an empty blue sky and Roblox's default
-- controls while the SERVER carried on perfectly happily. It cost a live game
-- and an afternoon.
--
-- Rojo maps a directory to a container, so `script.Parent` is the file's own
-- directory and each extra `.Parent` is one level up. That is checkable here.
local pathBad = 0

--- Walk a `script.A.B.C` chain the way Roblox would: `Parent` goes up a level,
--- anything else goes down into a child. Returns the directory the final name
--- should live in, or nil if the chain leaves the tree.
local function resolveDir(base: string, chain: string): string?
	-- `script` is the FILE; `script.Parent` is the container it sits in, which
	-- is its own directory. So the first `.Parent` costs nothing and each one
	-- after it goes up a level. Getting that backwards makes every require in
	-- the project look broken, which is how the first version of this check
	-- reported 54 false failures.
	local dir = base
	local firstParent = true
	for seg in chain:gmatch("[%w_]+") do
		if seg == "Parent" then
			if firstParent then
				firstParent = false
			else
				local up = dir:match("^(.*)/[^/]*$")
				if up == nil then
					return nil
				end
				dir = up
			end
		else
			-- Descending into a module folder: `Menu` is Menu/ on disk.
			dir = `{dir}/{seg}`
		end
	end
	return dir
end

local function checkRequires(dir: string)
	for _, entry in fs.readDir(dir) do
		local path = `{dir}/{entry}`
		if fs.isDir(path) then
			checkRequires(path)
		elseif entry:match("%.luau$") then
			-- `init.luau` IS its directory, so its own parent is one level up.
			local base = if entry == "init.luau" then (dir:match("^(.*)/[^/]*$") or dir) else dir
			local n = 0
			for line in fs.readFile(path):gmatch("[^\n]+") do
				n += 1
				-- Only the fully static `script.<chain>.<Name>` shape is
				-- resolvable here; anything computed is left alone.
				local chain, target = line:match("require%(script%.([%w_%.]-)%.?([%w_]+)%)")
				if target ~= nil and chain ~= nil and chain:match("Parent") then
					local d = resolveDir(base, chain)
					if d ~= nil and not (fs.isFile(`{d}/{target}.luau`) or fs.isDir(`{d}/{target}`)) then
						pathBad += 1
						print(`FAIL {path}:{n}: require points at '{target}', which is not in {d}/`)
					end
				end
			end
		end
	end
end
checkRequires("game-src")
if pathBad == 0 then
	print("every script.Parent require resolves to a module on disk")
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

-- ------------------------------------------------------------------------
-- IS THE AUDIO OURS, AND IS IT ALL THERE?
--
-- Roblox audio is PRIVATE TO ITS UPLOADER. An asset owned by another account
-- does not play in this experience and does not error either -- it is simply
-- silent, on every client, forever. The first multiplayer playtest was
-- completely mute because all 55 sound effects and 4 music stems had been
-- uploaded by a different account (7880886259) to the one that owns the
-- experience (4262376699), and nothing in the build could see it.
--
-- So: every id referenced by Sfx or Music must appear in asset-ids.csv, and
-- every row of that file must be owned by us.
local OWNER = "4262376699"
local CSV = "../roblox/audio-out/asset-ids.csv"
local audioBad = 0
if fs.isFile(CSV) then
	local known: { [string]: boolean } = {}
	local foreign = 0
	local firstForeign = ""
	local n = 0
	for line in fs.readFile(CSV):gmatch("[^\n]+") do
		n += 1
		if n > 1 then
			local name, id, _kind, creator = line:match("^([^,]*),([^,]*),([^,]*),([^,]*)$")
			if id ~= nil then
				known[id] = true
				if creator ~= OWNER then
					foreign += 1
					if firstForeign == "" then
						firstForeign = `{name} (creator {creator})`
					end
				end
			end
		end
	end
	if foreign > 0 then
		audioBad += 1
		print(`FAIL {CSV}: {foreign} asset(s) not owned by {OWNER} — they will be SILENT in this experience. First: {firstForeign}`)
	end
	for _, file in { "game-src/client/Sfx.luau", "game-src/client/Music.luau" } do
		if not fs.isFile(file) then
			continue
		end
		local src = fs.readFile(file)
		-- Only the id tables carry bare 10+ digit literals; volumes and
		-- timings are all short or fractional.
		for id in src:gmatch("(%d%d%d%d%d%d%d%d%d%d+)") do
			if not known[id] then
				audioBad += 1
				print(`FAIL {file}: asset id {id} is not in {CSV} — unknown provenance, may not be ours`)
			end
		end
	end
end
if audioBad == 0 then
	print(`audio: every referenced id is present and owned by {OWNER}`)
end

-- ------------------------------------------------------------------------
-- BOTH ENDS OF EVERY CLIENT->SERVER REMOTE, OR IT IS A DEAD LETTER.
--
-- A client that fires into a remote nobody listens to fails silently and
-- totally -- the same shape as the wrong require path above, and just as
-- invisible to a syntax check. ClientReady is the one that matters most: it is
-- the handshake that re-sends a joiner's seat, so if it ever stops being
-- answered the failure is an ordinary player quietly becoming a spectator,
-- which is exactly the bug it was added to fix.
local wiringBad = 0
local netSrc = fs.readFile("game-src/shared/Net.luau")
local serverSrc = fs.readFile("game-src/server/main.server.luau")
local clientSrc = fs.readFile("game-src/client/main.client.luau")
for _, name in { "ClientReady" } do
	if not string.find(netSrc, `{name} = "RemoteEvent"`, 1, true) then
		wiringBad += 1
		print(`FAIL Net.REMOTES has no '{name}' entry`)
	end
	if not string.find(serverSrc, `remotes.{name}.OnServerEvent`, 1, true) then
		wiringBad += 1
		print(`FAIL nothing on the server listens to '{name}' -- the client fires into a dead letter`)
	end
	if not string.find(clientSrc, `remotes.{name}:FireServer`, 1, true) then
		wiringBad += 1
		print(`FAIL the client never fires '{name}' -- the server handler can never run`)
	end
end
if wiringBad == 0 then
	print("client->server handshake remotes are wired at both ends")
end

-- ------------------------------------------------------------------------
-- THE GAME AND THE TOOLING MUST AGREE ON WHICH PLACE IS LIVE.
--
-- Progression scopes its DataStores by place id so a staging place cannot read
-- and write live's profiles. That check names LIVE explicitly, on purpose: if
-- the id it compares against were ever wrong, live would stop matching, take
-- the staging branch, and open a set of empty stores -- every profile in the
-- game apparently gone at once.
--
-- The publish tooling already carries the same number. There is no shared
-- runtime between a .mjs and a .luau to put it in, so the next best thing is
-- refusing to let the two copies drift.
local idBad = 0
local progSrc = fs.readFile("game-src/server/Progression.luau")
local credsSrc = fs.readFile("tools/opencloud-creds.mjs")
local luauId = string.match(progSrc, "LIVE_PLACE_ID = (%d+)")
local nodeId = string.match(credsSrc, 'DEFAULT_PLACE_ID = "(%d+)"')
if luauId == nil then
	idBad += 1
	print("FAIL Progression.luau has no LIVE_PLACE_ID to check")
elseif nodeId == nil then
	idBad += 1
	print("FAIL opencloud-creds.mjs has no DEFAULT_PLACE_ID to check")
elseif luauId ~= nodeId then
	idBad += 1
	print(`FAIL live place id disagrees: Progression says {luauId}, the publisher says {nodeId}`)
	print("     If the publisher is right, live would take the STAGING DataStore branch.")
else
	print(`the game and the publisher agree that live is place {luauId}`)
end

if failed > 0 or bundleBad > 0 or stale or audioBad > 0 or pathBad > 0 or wiringBad > 0 or idBad > 0 then
	process.exit(1)
end
