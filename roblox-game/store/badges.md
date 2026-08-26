# Badges — names, descriptions, icons

Create each at **Creator Dashboard → your experience → Engagement → Badges →
Create Badge** (100 Robux each). Upload the matching icon from
`roblox/badge-art/`, then paste the id from the badge's URL
(`.../badges/<ID>/configure`) into `Badges.IDS` in
`roblox-game/game-src/server/Badges.luau`.

Keys left at `0` are silently skipped, so you can do these one at a time.

| `Badges.IDS` key | Icon | Name | Description | Awarded when |
|---|---|---|---|---|
| `firstDish` | `first-dish.png` | **First Dish** | Your first plate over the pass. Everyone starts somewhere. | any shift where you serve at least one dish |
| `perfectRound` | `clean-service.png` | **Clean Service** | Work a whole shift without missing a single ticket. Not one. | `missed == 0` and `served > 0` |
| `firstThreeStar` | `three-stars.png` | **Three Stars** | Finish a shift with all three stars on the board. | `stars >= 3` |
| `fullHumanCrewThreeStar` | `full-house.png` | **Full House** | Three stars with a full crew of four chefs. Try coordinating that. | `stars >= 3` with 4 humans seated |
| `levelTen` | `head-chef.png` | **Head Chef** | Reach level 10. You know where everything lives now. | `profile.level >= 10` |
| `hundredDishes` | `century.png` | **Century** | Serve 100 dishes. | `totalDishes >= 100` |
| `thousandDishes` | `thousand-plates.png` | **Thousand Plates** | Serve 1,000 dishes. The pass never stops. | `totalDishes >= 1000` |
| `foundingChef` | `founding-chef.png` | **Founding Chef** | Worked the line during the launch window. Never awarded again. | end of any shift, while `Config.FOUNDING_CHEF_UNTIL` has not passed |

## Before you spend the Robux

- **Set `Config.FOUNDING_CHEF_UNTIL`** (UTC `YYYY-MM-DD`) to the real last day
  of your launch window. Past it, nobody can earn Founding Chef again — which
  is the only thing that makes it worth having. Empty string disables it.
- Conditions re-check at the end of every shift. Roblox no-ops a re-award and
  the server also de-dupes per session, so nothing is double-granted.
- Badges are awarded **server-side** and need API access on the published
  place — the same switch DataStores use.

## Icons

512x512 PNG, regenerate with `node roblox/badge-art.mjs`. They are rendered
from the real chef rigs, hat fits and item meshes, so they cannot drift from
what the game looks like. `_sheet.png` is a contact sheet with a thumbnail
strip for checking they still read small.
