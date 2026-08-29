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
These cannot be matched by source, because the sentence does not exist until
runtime and the placeholder order differs by language — German and Japanese put
them in different places. They need
`LocalizationService:GetTranslatorForPlayerAsync(player):FormatByKey(key, args)`
at the call site. The keys are already in the table (`fmt.*`); **wiring the
call sites is still to do** — see the table below.

## Shipping it

The CSV is mounted into the place under `LocalizationService` by
`default.project.json`, so **Studio picks it up with no upload**: set the
language in Studio's Localization tools and the UI switches.

For the live game, import the same CSV at
**Creator Dashboard → Sizzle Squad → Localization → Translations → Import**.
The languages must already be enabled there (they are). If the dashboard export
uses different locale column names than `fr-fr` / `pt-br` / …, rename the header
row to match its export and re-import — the rest of the file is unaffected.

## Status

- 133 entries × 7 languages, no blanks, full coverage of every static and
  content string the scanner finds.
- Excluded on purpose: bare glyphs and digits (`★`, `0`, `3:00`), placeholder
  values overwritten before anyone sees them, and `BLT`, which is a sandwich
  name that survives untranslated in all seven.
- **Not yet wired: the 21 `fmt.*` templates.** They are translated and in the
  table, but the call sites still build their strings with interpolation, so
  they render in English until each one is moved to `FormatByKey`.
