# The bar

Two references. Every critic judges against both. **The images in `refs/` are
authoritative.** Open them with the Read tool. Do not judge from this text alone —
this text exists to tell you what to look for in the images.

- `refs/dash-and-dine-01.jpeg`
- `refs/dash-and-dine-02.jpeg`

Both are real captures of **"Dash and Dine"** from *Super Mario Party* (Nintendo,
2018): a 60-second 2-vs-2 minigame where teams fetch bacon, lettuce and tomatoes
and deliver them to Toads to complete an order. In-game prompts: *"Fetch
ingredients to complete the order!"* and *"If you grab the wrong ingredient by
accident, just put it back where you found it!"*

---

## What the reference images actually show

Read this while looking at the JPEGs. Every claim below is checkable in them.

### Camera — the single most important thing we got wrong

It is **not** a steep top-down or isometric view into a walled box. It is a
**low, near-frontal, slightly elevated camera** — maybe 20–25° above the floor
plane — looking straight at the **back wall of a room**. Consequences:

- You see a real back wall: ochre stucco, vertical and horizontal honey-brown
  timber beams, a pale stone-brick chimney breast, and a **stone pizza oven with
  fire glowing inside it** dead centre.
- The floor is large warm-grey stone flags in strong perspective, receding from
  the very bottom edge of the frame to the wall.
- Side walls appear as angled planes at the extreme left and right edges: stone
  wainscot, a wooden door with a round window on the left, a rack of hanging
  copper pans on the right.
- **The room fills the entire frame, edge to edge.** There is no letterboxing,
  no dead margin, no void. Not one pixel is wasted.
- Perspective is generous but not fisheye — tables at the bottom of frame are
  noticeably larger than tables at the back.

### Level layout — also structurally different from ours

The furniture is **not** counters around the perimeter. It is a scatter of
**low, knee-height wooden bench-tables placed out in the open floor**, arranged
in a loose staggered grid with wide lanes between them. This is deliberate:

- Because the tables are low, **they never occlude a character.** You can always
  see everybody's whole body. That is what lets the camera sit low and frontal.
- The lanes between tables are wide enough for two characters to pass, which is
  where all the bumping-and-dodging play comes from.
- Tables carry white ceramic trays of ingredients: a tray of pink bacon rashers,
  a tray of red tomatoes, a tray of green lettuce heads. Plus set-dressing props:
  a stockpot with a lid, a ladle, salt and pepper shakers, a pie in a dish, a
  small blue bowl, tall stacks of white plates, a wide sink basin.
- Two team stations flank the back: a **red/pink** counter on the left, a
  **green** counter on the right, each with Toads standing behind them and stacks
  of golden pancakes/buns at either end.

### Orders — big, diegetic, wordless

Orders are shown as **large white speech bubbles** with a soft coloured awning
canopy behind them (pink on the left, green on the right), floating above each
team's Toad. Inside: **big, chunky, near-photoreal ingredient icons** — a head
of lettuce and two tomatoes; two tomatoes and a rasher of bacon.

There is **no text, no recipe name, no countdown bar per order.** The icons are
huge — each one is roughly the size of a character's head. You read the order in
a single glance from across the room.

### HUD — astonishingly minimal

Only three elements, all in the top strip, all in **dark translucent brown
rounded pills with heavy white numerals**:

- top-left: two circular character portraits + team score
- top-centre: a small clock glyph + remaining seconds
- top-right: mirrored portraits + score

That is the entire HUD. No meters, no combo counters, no tutorial text, nothing
along the bottom or sides. The bottom two thirds of the screen are **pure game**.

### Characters

- Roughly **15% of screen height** — big enough to read expression and pose, small
  enough that eight of them fit without crowding.
- Seen mostly from **behind and three-quarter-behind**. They are still instantly
  identifiable because of hat/head silhouette and a single dominant colour block
  (Mario red cap + blue overalls, Wario purple + yellow, Shy Guy red robe + white
  mask, Toad white cap with coloured spots, Daisy yellow dress).
- **Real legs, real run cycles**, arms swinging, body leaning into the run.
- Carrying poses are explicit and readable from behind: both arms extended
  forward holding a plate flat; a comedy tower of plates taller than the
  character itself.
- Soft contact shadows under everyone. No hard cast shadows anywhere.

### Colour and light

- Warm ochre/mustard walls, honey wood, warm neutral stone floor.
- Food is the most saturated thing on screen: tomato red, lettuce green, bacon
  pink all pop hard against the muted warm room.
- Lighting reads as **baked and soft** — gentle ambient occlusion in corners and
  under furniture, a warm glow from the oven, no harsh directional key, no
  specular hotspots. Everything is matte.
- Values sit in a fairly narrow warm mid-range, which is exactly why the
  saturated food reads so strongly.
- Detail density is **high**. Every surface has something on it. The room feels
  like a place someone works in, not a level.

---

## Reference B — Overcooked! (Ghost Town Games, 2016)

The feel bar for moment-to-moment play:

- Running feels fast and slightly slippery, never out of control.
- Carrying changes how you move enough that you feel it.
- Bumping a teammate is a real, funny, survivable event.
- The order queue is the drumbeat; a new ticket is a sound you learn to fear.
- Chopping is a rhythm, not a wait.
- Fire is a disaster you can see coming and could have prevented.

We ship against **bots**, so the bots must be the co-op partner Overcooked! makes
you wish you had: useful, legible, occasionally in your way, never idle, never
psychic.

---

## What "Nintendo quality" means concretely here

**Framing.** Play space fills the frame. Nothing important is ever occluded.
Dead space is a defect, not a style.

**Read.** Every object identifiable in under 200ms at thumbnail size. Food is the
most saturated thing on screen because food is the point.

**Silhouette.** A character you cannot identify from behind at 90px tall is a
failed character.

**Motion.** Nothing moves linearly. Acceleration curves, squash and stretch,
overshoot on stops, anticipation, follow-through. Idles breathe.

**Feedback.** Every input produces a visible response within one frame and an
audible one within two. Success is loud and warm; failure is short and never
ugly to look at.

**Forgiveness.** Targeting is generous. Roughly near and roughly facing is enough.
The player is never punished by the camera, the controls, or an ambiguous hitbox.

**UI.** Chunky, rounded, thick, drop-shadowed, animated in and out. Diegetic where
possible. Never a hairline, never a 10px font, never a flat rectangle. And
**less of it than you think** — see how little HUD the reference uses.

---

## How to judge

1. Open `refs/dash-and-dine-01.jpeg` and `refs/dash-and-dine-02.jpeg` with the
   Read tool and look at them.
2. Run `node tools/shoot.mjs --out shots/<name>` and open **our** PNGs. All four
   device profiles. Skipping iPhone portrait means you did not do the job.
3. Describe what you actually see in ours, without charity.
4. Put the two side by side and say **which is better and why**, in pixels —
   colour, contrast, silhouette, spacing, occlusion, density, motion evidence.
5. If ours loses, name **the single biggest gap** in one sentence.
6. Score 0–100. 90+ means you would believe this shipped on a Nintendo platform.

Be harsh. A generous critic wastes everyone's time.
