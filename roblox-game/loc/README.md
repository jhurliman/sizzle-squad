# Localization

French, German, Indonesian, Japanese, Korean, Portuguese (Brazil) and Spanish,
plus English as the source.

**The strings are identified by scanning the code, not by Roblox's automatic
capture, and translated deliberately rather than machine-translated.** Both
halves of that matter: auto-capture only ever sees screens somebody happened to
open during a capture session, so coverage is a function of who clicked what;
and machine translation of two-word game UI has no idea that "Serve" is an
imperative on a button and a noun in a stat line, or that Bramble, Pip, Nori
and Mochi are character names and must not be translated at all.

## The files

| File | What it is |
| --- | --- |
| `source.json` | **The source of truth.** One entry per string: key, English source, a context note for translators, and all seven translations. |
| `SizzleSquad-localization.csv` | Generated. The file Roblox imports. |
| `../tools/extract-strings.mjs` | Finds every player-visible string in the code. |
| `../tools/build-loc.mjs` | `source.json` → CSV, **and fails if anything is uncovered or untranslated**. |

```sh
node tools/extract-strings.mjs     # what strings exist
node tools/build-loc.mjs           # rebuild the CSV + check coverage
```

`build-loc.mjs` exits non-zero when a string the scanner found is missing from
the table, or when any locale is blank. That is the guard that matters: an
untranslated string does not error at runtime, it just appears in English in
the middle of a Japanese menu, and nobody who can read the menu is testing it.

## Two ways a string gets translated

**By source text.** Most of the UI. Roblox matches the literal English text of
any `GuiObject` and substitutes — no code change, because `AutoLocalize` is on
by default. This is why the table carries a `Source` column for every row, and
why the English text in the code must stay byte-identical to it.

**By key.** Anything with values interpolated into it (`Level {1} · {2} coins`).
These cannot be matched by source: the finished sentence does not exist until
runtime, and the placeholder order differs by language — "Level 3 · 120 coins"
is `Nivel {1} · {2} monedas` in Spanish but `レベル{1} · {2}コイン` in Japanese,
and German moves them again. Formatting in Lua and hoping the table has the
result cannot work.

`client/Loc.luau` handles these: `Loc.f("fmt.lv_coins", level, coins)` asks the
engine to substitute into the TRANSLATED template. All 21 are wired.

**Every failure path renders English, never a key.** The translator comes from a
yielding web call that can be slow or fail, there is no player in some Studio
contexts, and a key can be missing from a table that has not been re-imported.
All three fall back to `shared/LocFallback.luau` — generated from this same
source of truth, because two hand-maintained copies of a string is how they
drift.

## Shipping it

The CSV is mounted into the place under `LocalizationService` by
`default.project.json`, so **Studio picks it up with no upload**: set the
language in Studio's Localization tools and the UI switches.

### The column layout is Roblox's, taken from its own export

```
Key, Example, Source, Context, Game Locations, then for each locale a PAIR:
"<loc>" and "<loc> translator type"
```

Three things in there are not guessable, and each cost an upload to learn:

- **`Example` comes before `Source`.**
- **Every locale needs a companion `<loc> translator type` column.** `User`
  marks a human translation, which is what these are — and what stops Roblox
  replacing them with machine output.
- **There is no bare `en` column.** English is the source language, so it is
  not a translation target.

That last one produced the confusing failure. An `en` column generated exactly
one `Could not apply changes for "X": : .` per row — 50 errors that looked like
a total rejection, while every other column imported perfectly. The 50 rows were
in the table the whole time. **If you see a wall of those errors, read the row
count in the export before assuming nothing landed.**

Locale codes are bare (`es`, `pt`, `ja`, `ko`, `fr`, `de`, `id`). The export also
carries region columns (`es-mx`, `pt-pt`, `fr-ca`, `en-gb`…) which stay empty;
Roblox falls back from a region locale to the base language, so one column
covers every region.

`node tools/build-loc.mjs --verify` checks the columns against the languages the
experience actually has enabled.

### Import in chunks — the whole table times out

Uploading all 133 rows at once returns **HTTP 504 "upstream request timeout"**:
Roblox's importer takes longer to process the file than its own gateway will
wait, so the upload dies with nothing imported. `build-loc.mjs` therefore also
writes `loc/chunks/`, ~50 rows each with the header repeated:

```
SizzleSquad-loc-01-of-03.csv   50 rows
SizzleSquad-loc-02-of-03.csv   50 rows
SizzleSquad-loc-03-of-03.csv   33 rows
```

Import them in order at **Creator Dashboard → Sizzle Squad → Localization →
Translations → Import**. The importer merges by `Key`, so the chunks add up to
the same table and re-importing one is safe. `LOC_CHUNK=25 node
tools/build-loc.mjs` splits smaller if 50 still times out.

The full CSV is what gets mounted into the place for Studio — that one is read
locally and its size does not matter.
The languages must already be enabled there (they are). If the dashboard export
uses different locale column names than `fr-fr` / `pt-br` / …, rename the header
row to match its export and re-import — the rest of the file is unaffected.

## Status

- 133 entries × 7 languages, no blanks, full coverage of every static and
  content string the scanner finds.
- Excluded on purpose: bare glyphs and digits (`★`, `0`, `3:00`), placeholder
  values overwritten before anyone sees them, and `BLT`, which is a sandwich
  name that survives untranslated in all seven.
- All 21 `fmt.*` templates are wired to `Loc.f`. `build-loc.mjs` fails if a
  template is translated but never called, or if `Loc.f` is called with a key
  the table does not have — both are silent failures otherwise: an uncalled
  template is seven translations nobody sees, and an unknown key renders English
  forever while looking exactly like a missing translation.
