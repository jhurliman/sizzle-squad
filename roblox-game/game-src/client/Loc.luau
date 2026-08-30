--!strict
-- TRANSLATED TEXT THAT IS BUILT AT RUNTIME.
--
-- Most of the UI needs nothing: Roblox matches a GuiObject's literal English
-- text against the localization table and substitutes it, which is why the
-- static strings were localized with no code change at all.
--
-- This is for the rest — anything with a value interpolated into it. Those
-- cannot be source-matched, because the finished sentence does not exist until
-- runtime AND the placeholder order differs by language. "Level 3 · 120 coins"
-- is `Nivel {1} · {2} monedas` in Spanish but `レベル{1} · {2}コイン` in
-- Japanese, and German moves them again. Formatting in Lua and hoping the table
-- has the result is not a thing that can work.
--
-- So the table carries the TEMPLATE under a key (`fmt.*`) and the engine does
-- the substitution: Translator:FormatByKey("fmt.lv_coins", {level, coins}).
--
-- EVERY FAILURE PATH RENDERS ENGLISH, NEVER A KEY.
--
-- GetTranslatorForPlayerAsync is a yielding web call that can be slow or fail,
-- there is no player at all in some Studio contexts, and a key can be missing
-- from a table that has not been re-imported yet. A player seeing
-- "fmt.lv_coins" is worse than a player seeing English, so all three fall back
-- to the generated English template in shared/LocFallback.luau.

local LocalizationService = game:GetService("LocalizationService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local FALLBACK = require(ReplicatedStorage:WaitForChild("Game"):WaitForChild("LocFallback")) :: { [string]: string }

local Loc = {}

local translator: any = nil

-- Fetched once, off the critical path. Until it lands (or if it never does),
-- `f` renders English — which is exactly what happened before this module
-- existed, so a failure here is a return to the old behaviour, not a new bug.
task.spawn(function()
	local ok, result = pcall(function()
		return LocalizationService:GetTranslatorForPlayerAsync(Players.LocalPlayer)
	end)
	if ok and result ~= nil then
		translator = result
	else
		warn("[sizzle] no translator available — interpolated strings will render in English")
	end
end)

--- Substitute {1}, {2}… positionally. Only used when there is no translator;
--- when there is one, the ENGINE does this against the translated template,
--- which is the whole point (it knows the argument order for that language).
local function substitute(template: string, args: { any }): string
	local out = template
	for i, v in args do
		-- Plain concatenation, not an interpolated string: `{` is the escape
		-- character in Luau interpolation and "%{" .. i .. "%}" is the one form
		-- that is unambiguous.
		out = out:gsub("%{" .. tostring(i) .. "%}", tostring(v))
	end
	return out
end

--- Translated, formatted text for a `fmt.*` key.
--- NUMBERS GO IN AS STRINGS.
---
--- Translator:FormatByKey applies locale number formatting to numeric
--- arguments, which turned "WAITING FOR CREW 2/3" into "WAITING FOR CREW
--- 2.00/3.00" — and would have done the same to every level, coin count, price
--- and dish tally the moment a translator was available. These are COUNTS, not
--- measurements; two decimal places is never right for them. Formatting them
--- here keeps the engine from having an opinion.
local function asText(v: any): any
	if type(v) ~= "number" then
		return v
	end
	if v % 1 == 0 then
		return string.format("%d", v)
	end
	-- Non-integers are rare here (nothing in the table asks for one) but must
	-- not silently become "3.00" either.
	return tostring(v)
end

function Loc.f(key: string, ...): string
	local args = table.pack(...)
	local list = {}
	for i = 1, args.n do
		list[i] = asText(args[i])
	end
	if translator ~= nil then
		local ok, text = pcall(function()
			return translator:FormatByKey(key, list)
		end)
		if ok and type(text) == "string" and text ~= "" then
			return text
		end
	end
	local template = FALLBACK[key]
	if template == nil then
		-- A key with no fallback is a bug in the table, not something to show
		-- a player; say so loudly and render the arguments rather than the key.
		warn(`[sizzle] no localization fallback for '{key}'`)
		return table.concat(list, " ")
	end
	return substitute(template, list)
end

return Loc
