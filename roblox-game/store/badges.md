# Badges — names, descriptions, icons

Create each at **Creator Dashboard → your experience → Engagement → Badges →
Create Badge** (100 Robux each). Upload the matching icon from
`roblox/badge-art/`, then paste the id from the badge's URL
(`.../badges/<ID>/configure`) into `Badges.IDS` in
`roblox-game/game-src/server/Badges.luau`.

Keys left at `0` are silently skipped, so you can do these one at a time.

**All eight are live** on experience `10761465304` and their ids are wired in
`Badges.luau`. The table below is the record of what was created.

| `Badges.IDS` key | Badge id | Icon | Name | Description | Awarded when |
|---|---|---|---|---|---|
| `firstDish` | `4431857963958852` | `first-dish.png` | **First Dish** | Your first plate over the pass. Everyone starts somewhere. | any shift where you serve at least one dish |
| `perfectRound` | `437880355258821` | `clean-service.png` | **Clean Service** | Work a whole shift without missing a single ticket. Not one. | `missed == 0` and `served > 0` |
| `firstThreeStar` | `4317478992496196` | `three-stars.png` | **Three Stars** | Finish a shift with all three stars on the board. | `stars >= 3` |
| `fullHumanCrewThreeStar` | `814549161360154` | `full-house.png` | **Full House** | Three stars with a full crew of four chefs. Try coordinating that. | `stars >= 3` with 4 humans seated |
| `levelTen` | `2294823863469429` | `head-chef.png` | **Head Chef** | Reach level 10. You know where everything lives now. | `profile.level >= 10` |
| `hundredDishes` | `1810766503952474` | `century.png` | **Century** | Serve 100 dishes. | `totalDishes >= 100` |
| `thousandDishes` | `2460897867893271` | `thousand-plates.png` | **Thousand Plates** | Serve 1,000 dishes. The pass never stops. | `totalDishes >= 1000` |
| `foundingChef` | `2672137851503382` | `founding-chef.png` | **Founding Chef** | Worked the line during the launch window. Never awarded again. | end of any shift, while `Config.FOUNDING_CHEF_UNTIL` has not passed |

## Still to confirm

- **`Config.FOUNDING_CHEF_UNTIL` is `2026-10-31`, which is a placeholder.**
  Set it to the real last day of your launch window. Past that date nobody can
  earn Founding Chef again — which is the only thing that makes it worth
  having. An empty string disables the badge.
- Conditions re-check at the end of every shift. Roblox no-ops a re-award and
  the server also de-dupes per session, so nothing is double-granted.
- Badges are awarded **server-side** and need API access on the published
  place — the same switch DataStores use.

## Icons

512x512 PNG, regenerate with `node roblox/badge-art.mjs`. They are rendered
from the real chef rigs, hat fits and item meshes, so they cannot drift from
what the game looks like. `_sheet.png` is a contact sheet with a thumbnail
strip for checking they still read small.
