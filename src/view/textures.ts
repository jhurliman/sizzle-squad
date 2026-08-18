import * as THREE from 'three';

/**
 * Procedural surfaces for the kitchen set — stone flags, brick courses, stucco
 * mottle, plank grain. Drawn once into a canvas at load and never touched
 * again, so they cost one upload and zero per-frame work, and they replace what
 * would otherwise be thousands of little meshes.
 *
 * Every tile is authored SEAMLESS and in WORLD UNITS: a tile declares how many
 * metres of wall or floor it covers, and callers align `offset`/`repeat` to
 * world coordinates. That way brick courses run straight across a chimney that
 * is built from three separate boxes, and no two adjacent surfaces show a seam.
 *
 * Nothing here uses Math.random — a fixed seed keeps screenshots comparable
 * between runs, which is the only way an art pass can tell a change from noise.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  return g;
}

function finish(g: CanvasRenderingContext2D, wrap: THREE.Wrapping = THREE.RepeatWrapping): THREE.Texture {
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function rgb(hex: number, mul = 1, add = 0): string {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * mul + add));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * mul + add));
  const b = Math.min(255, Math.max(0, (hex & 255) * mul + add));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --------------------------------------------------------------- stone floor

/**
 * The floor is the largest surface in frame and the reference's is made of BIG
 * flags — roughly a table's width each, laid in courses of unequal length with
 * a fat grout joint. A 1×1 checkerboard reads as graph paper; this reads as a
 * floor. Generated at the room's exact size so it never repeats, which is the
 * only way to kill tiling nausea on a surface this big and this raked.
 */
/**
 * ROUND 13 — ART/LIGHTING PASS. Cross-file change, three edits, all inside this
 * one function; nothing else in textures.ts touched.
 *
 * Mean |laplacian| of luma on a bare-floor patch, both frames normalised to
 * 1280 wide: reference 3.43 / 6.09, ours 1.55. The floor is the largest mass in
 * the picture and it was the flattest thing in it. Cropped at 3× ours was a
 * cream wash with hairline joints; the reference is grey stone with a dark
 * gutter at every joint and a visible tone STEP from flag to flag.
 *
 * The shader-side grade in materials.ts can amplify articulation this map
 * already has, and it can add mineral speckle, but it cannot invent a joint —
 * so the joint has to be authored here. 72px per world cell put a flag's whole
 * grout line inside two texels before the mip chain got to it.
 */
/**
 * WAVE 2 — 128 → 256 PER CELL, AND THE DETAIL BUDGET SPENT ON EDGES.
 *
 * Measured on a bare-lane patch of the shipped desktop frame against the same
 * patch of the reference, both at 1440 wide: laplacian RMS 6.1 (ours) against
 * 16.3 (theirs). The floor is the largest mass in the picture and it was
 * carrying a QUARTER of the reference's high-frequency energy while carrying
 * more low-frequency slop than it — soft grey clouds a metre across, a joint
 * so wide and so soft it read as a smudge, and no bevel at all.
 *
 * Every one of those is a resolution problem wearing an art problem's clothes.
 * At 128 px per world cell a 1cm arris is a tenth of a texel, so it cannot be
 * drawn; the previous rounds compensated by drawing the joint FAT (0.038 of a
 * cell ≈ 5px, alpha 0.5) and soft, which is a smudge by construction. At 256
 * the arris is affordable: the joint narrows to a crisp dark gutter and gains
 * the pale lit lip on the opposite two edges that makes a flag read as a slab
 * standing proud of its neighbour rather than as a rectangle drawn on concrete.
 *
 * The clouds go the other way. Five soft ellipses up to a third of a flag wide
 * per flag, at up to 8% each, is the "olive-khaki mush" the critic measured; at
 * a third of that amplitude and half the size they are mineral variation
 * instead. The flag-to-flag VALUE STEP stays exactly where it is — that is a
 * step with a joint at the boundary, which is what the reference has and what
 * no amount of smooth noise can imitate.
 *
 * 224 rather than the full 256: measured laplacian RMS on the same bare lane
 * runs 10.7 at 192, 12.3 at 256, and the reference's own clean flags sit at
 * 9.5–11.7 — so 224 lands us on the reference instead of past it, for 3360²
 * (45 MB) instead of 3840² (59 MB) on a phone whose only other textures are
 * four 512s. One upload at load, no per-frame work.
 */
const FLOOR_TEX_MAX = 4096;

export function stoneFloorTexture(cellsX: number, cellsZ: number, px = 224): THREE.Texture {
  // A HARD CEILING, BECAUSE THE ROOM'S SIZE IS NOT THIS FILE'S TO CONTROL.
  //
  // This map is authored at the room's exact size so it never tiles, which
  // means KITCHEN_MAP decides the texture's dimensions. At 224 a 15-cell room
  // is 3360 and an 18-cell one would be 4032; the first map wider than 18 cells
  // would silently exceed MAX_TEXTURE_SIZE on a lot of mobile GPUs and the
  // floor would come back black. Scaling the density down is a soft, invisible
  // failure; a missing floor is not.
  const span = Math.max(cellsX, cellsZ);
  if (span * px > FLOOR_TEX_MAX) px = Math.floor(FLOOR_TEX_MAX / span);
  const W = Math.round(cellsX * px);
  const H = Math.round(cellsZ * px);
  const g = ctx2d(W, H);
  const rand = rng(0x51ee1e);

  // MORTAR, not shadow. This was 0x6d5b36 — darker than the flags — so every
  // joint in the floor read as a black line and the largest surface in the
  // frame came out as a hard dark grid. The reference's joints are pale lime
  // mortar and sample LIGHTER than the stones either side of them.
  // Desaturated with the flags below — mortar that stays warm-tan while the
  // stone goes neutral just redraws the grid in chroma instead of in value.
  // ROUND 9: lifted and pushed yellow. Hue census of the reference's lower 55%
  // spends 12.7% between H 45 and 70; ours spent 0.7%. That band is not a
  // colour anyone painted — it is the lime mortar and the light half of the
  // flags, which run H 45-55 while the darker flags sit at H 38-43. The floor
  // STRADDLING the orange/yellow line is what makes it a separate mass from the
  // H 28 timber standing on it. This joint is the yellow end of that straddle.
  //
  // ROUND 9b — AND THE JOINT IS DARKER THAN THE FLAG AFTER ALL.
  //
  // The note above is wrong and a crop settles it: enlarge the reference's near
  // floor 2× and every joint between two flags is a distinctly DARK line with a
  // narrow pale bloom on the lower-right side of it, which is what a bevelled
  // stone edge does. Ours ran a mortar LIGHTER than the flags, so at any
  // distance the joints vanished into the stone and the largest surface in the
  // frame rendered as one continuous pale wash with a faint grid ghosted into
  // it — the exact "pale concrete" read the last critic scored us down for. The
  // floor's job is to be a quiet plate, not a blank one.
  //
  // WAVE 2 — AND THE FILL FINALLY AGREES WITH THE PARAGRAPH ABOVE IT.
  //
  // ROUND 9b argued the joint is darker than the flag and then left the bed
  // colour at 0x9c8f66, which is LIGHTER than the mean flag. So the two-texel
  // gap between every pair of flags rendered as a pale ribbon, and once the
  // bevel went in at 224px the floor read as slabs set into bright grout —
  // pointing exactly backwards. Enlarge the reference's near floor and the gap
  // is a dark channel with the flags almost touching over it. Down 22% and off
  // the yellow, so the gutter is a shadow rather than a second stone.
  g.fillStyle = rgb(0x7a6d4e);
  g.fillRect(0, 0, W, H);

  // A THIN joint, not a mortar bed. At 0.075 inset per side the gap between two
  // flags was 15% of a flag, so the floor read as pale pads laid on a grey grid
  // rather than as stone butted up against stone. In the reference the flags
  // very nearly touch and the joint is a dark line one or two pixels wide.
  const grout = 0.028 * px;
  let y = -0.4 * px;
  let course = 0;
  while (y < H) {
    // Courses are 0.95–1.3 cells deep. They were 1.35–1.75 deep and 1.5–3.0
    // wide, which made a single flag WIDER than most of the benches standing on
    // it — so three tiles of empty lane read as a plaza. In the reference a
    // flag is comfortably narrower than a bench, which is what lets bare floor
    // read as ground rather than as a hole in the set. Uneven depth is what
    // stops the eye from locking onto a grid; uneven WIDTH does the rest.
    const rowH = (0.95 + rand() * 0.35) * px;
    let x = -(0.3 + rand() * 1.2) * px;
    while (x < W) {
      const flagW = (0.95 + rand() * 0.9) * px;
      const t = rand();
      // Warm grey stone, tight value band. The food has to out-saturate this.
      // Reference bare floor samples Y 62-64 at S 29: a light, almost neutral
      // warm stone. Ours was 0xaf9d72, which rendered at Y 51 S 42 — a full
      // stop dark and half again as saturated, so the floor sat in the same
      // saturation band as the benches and the food had less to beat.
      // ROUND 6: `0.78 + t * 0.28` gave adjacent flags a ±15% albedo jump, and
      // combined with the rectangular multiply patches the contact quads used
      // to stamp, one bare floor lane sampled V 0.47-0.78 at 1440px — a 0.31
      // swing across empty stone with nothing standing on it. That is not
      // lighting, it is blotch, and it is where the frame's p05 darks were
      // going instead of pooling under the furniture. The reference's bare lane
      // holds V 0.63-0.73. Tightened to ±5%; the contact pools own the darks.
      // ROUND 8 — THE HUE BREAK. Everything above is about VALUE, and value was
      // never the problem. Sampled off the real build at 1440px, our bare floor
      // rendered H 37-38 at S 0.40-0.42 and our bench timber H 28-37 at S
      // 0.51-0.65: same family, a quarter of a turn of chroma apart. Twenty
      // benches and the ground they stand on fused into one continuous orange
      // field over half the frame, and no amount of outline or contact shadow
      // separates surfaces that are the same colour.
      //
      // The reference does it with chroma, not with line: its bare flag samples
      // H 37-44 at S 0.30 and its bench timber H 28-30 at S 0.79-0.87. Half a
      // unit of saturation between ground and furniture, with the ground on the
      // low side — that single break is why twelve tables read as twelve tables
      // with no outline at all. So the flags come down ~45% in chroma to a
      // genuinely neutral warm grey and the timber is left exactly where it is.
      // 0xb6a173 was S 0.37 before lighting; this is S 0.20.
      // Hue nudged from 42° to 50° at the same S and V after shooting it: the
      // warm key drags the rendered flag back down to H 34 against the
      // reference's H 42, which is what made the first pass read pink-grey
      // rather than the reference's sandy olive-beige.
      // ROUND 9. Two changes and both are about the second plate.
      //
      // CHROMA BACK UP a little: 0xb6b091 was S 0.20, and once the lighting rig
      // stopped painting the floor orange (main.ts: neutral hemisphere sky,
      // oven spill halved) the flags rendered at S 0.30 against the reference's
      // measured S 0.36. Neutral is the goal; grey is not. The reference's
      // flagstone is a sandy warm grey with real pigment in it.
      //
      // HUE VARIANCE, which is the actual missing ingredient. Every flag we
      // drew was the same hue, so the floor was one flat mass; the reference's
      // flags each sit at a slightly different tone and it straddles H 38-55
      // across a single course. The jitter runs on the BLUE channel alone —
      // blue down is a yellower flag, blue up is a cooler grey one — which
      // moves hue and saturation together the way weathered stone actually
      // varies, and leaves value alone so the floor keeps its tight value band.
      // ROUND 11 — MEASURED, NOT ARGUED. A 7×5 grid across the bare lanes of
      // both captures and of our own 1440px frame:
      //
      //     reference bare flag   H 40-42   S 0.30-0.48   V 0.53-0.69   Y 130-161
      //     ours                  H 43-46   S 0.28-0.34   V 0.66-0.75   Y 153-195
      //
      // The largest surface in the frame was running ~12% hot, a quarter turn
      // green of the reference's sandy warm grey, and flatter than it in both
      // value and chroma. Everything standing on it — benches, white trays, the
      // food in them — was fighting a ground plane that had climbed into their
      // value band. Down to the reference's own luma, and the hue comes back off
      // the green by dropping the blue channel three points.
      // ROUND 12: +6% and a touch warmer. Measured on our own capture the bare
      // flag renders L 54 against the reference's L 60-62, and the floor is the
      // largest single surface in frame — most of the gap between our 12.6% of
      // pixels above luma 180 and the reference's 15.5% is here. It is also the
      // plate the (now much stronger) contact pools have to read against.
      // ROUND 12b — ART PASS, AND THIS IS THE BILL FOR A LIGHTING CHANGE.
      //
      // main.ts gained a near-horizontal frontal wall wash this round, because
      // the room's vertical surfaces — the whole back wall, the chimney breast,
      // both team counters — were collecting only the normal-independent terms
      // and rendering a full 0.12 under the reference. That light is aimed 0.05
      // above the floor plane so a flagstone should barely see it, but the toon
      // ramp's foot is 0.33: every surface collects at least a third of every
      // lamp in the room no matter which way it faces. Measured, the floor took
      // +0.08 of value off a lamp that was never pointed at it.
      //
      // Mass-matched against both captures — every pixel at H 30-50, S 0.20-0.50
      // in the lower 45% of frame, which is bare flagstone and nothing else:
      //
      //     reference   V p25 0.60  p50 0.64  p75 0.68     (both captures agree)
      //     ours        V p25 0.65  p50 0.72  p75 0.77
      //
      // So the ROUND 12 lift is not being reverted on its own merits — it was
      // right against the rig it was measured on. The rig moved under it. Down
      // 15%, which lands the mass median back on 0.64 with the light as it now
      // stands, and keeps the flagstone the quiet neutral plate the food and the
      // (much stronger) contact pools both have to read against.
      // WAVE 2: +5%, which is the bill for darkening the joint bed. A third of
      // the floor's texels are now gutter rather than pale mortar, and measured
      // on the whole floor patch that took the rendered mean from V 0.659 to
      // 0.616 against the reference's 0.686. The flags themselves were never
      // the thing that was too bright.
      const base = 0x9e8b5b;
      // ±9% flag to flag, up from ±5%. The reference's flags step visibly in
      // tone across a single course — measured, a run of four adjacent flags
      // walks Y 134-172 — and a floor whose flags all share one value reads as
      // poured concrete with lines scored in it. The ±15% this once ran WAS
      // blotch; ±5% was nothing at all.
      // ROUND 13: ±9% → ±15% in value, and the hue jitter doubled. Sampled off
      // the reference, a run of four adjacent flags walks luma 134 → 172 and
      // drifts several degrees of hue with it — one flag sandy, the next
      // grey-green. Ours stepped by about six luma, which at any distance is
      // one continuous field with lines scored into it. This is a STEP, with a
      // joint at the boundary; it is the thing the smooth mottle in
      // materials.ts explicitly cannot do.
      const shade = 0.85 + t * 0.3;
      const warm = (rand() - 0.5) * 11;
      const blueJit = (rand() - 0.5) * 34;
      g.fillStyle = `rgb(${Math.round(Math.min(255, ((base >> 16) & 255) * shade + warm))},${Math.round(
        Math.min(255, ((base >> 8) & 255) * shade + warm),
      )},${Math.round(Math.max(0, Math.min(255, (base & 255) * shade + warm + blueJit)))})`;
      roundRect(g, x + grout, y + grout, flagW - grout * 2, rowH - grout * 2, 0.045 * px);
      g.fill();

      // A soft light pool on each flag: gives the surface a hint of polish and
      // breaks the flatness without adding a single triangle.
      const cx = x + flagW * 0.4;
      const cy = y + rowH * 0.38;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(flagW, rowH) * 0.7);
      grad.addColorStop(0, `rgba(255,250,238,0.03)`);
      grad.addColorStop(1, `rgba(255,250,238,0)`);
      g.fillStyle = grad;
      g.fill();

      // Wear. WAVE 2: these were five ellipses up to a third of a flag across at
      // up to 8% each, and stacked with the shader's own coarse fetch they are
      // most of the "each flag is a field of big soft grey clouds" read. A third
      // of the amplitude and half the size turns them from weather into mineral.
      // The count goes UP, because many small tonal variations is stone and few
      // large ones is a stain.
      g.save();
      roundRect(g, x + grout, y + grout, flagW - grout * 2, rowH - grout * 2, 0.045 * px);
      g.clip();
      for (let i = 0; i < 8; i++) {
        g.fillStyle = `rgba(114,107,93,${0.012 + rand() * 0.018})`;
        const sx = x + rand() * flagW;
        const sy = y + rand() * rowH;
        g.beginPath();
        g.ellipse(sx, sy, (0.05 + rand() * 0.16) * px, (0.03 + rand() * 0.1) * px, rand() * 3, 0, 6.284);
        g.fill();
      }
      // MINERAL SPECKLE — the high-frequency half of the missing 10 RMS.
      //
      // The reference's flags are not smooth: at 3× every one carries a fine
      // pitted grit, light and dark, at roughly the scale of a grain of sand.
      // 256px per cell is the first resolution at which it survives the mip
      // chain, and it is the cheapest possible way to put crisp energy on the
      // largest surface in the frame — 40 dots a flag, drawn once at load.
      for (let i = 0; i < 40; i++) {
        const dark = rand() < 0.58;
        g.fillStyle = dark
          ? `rgba(104,94,72,${0.10 + rand() * 0.16})`
          : `rgba(255,251,236,${0.08 + rand() * 0.14})`;
        const sx = x + rand() * flagW;
        const sy = y + rand() * rowH;
        const rr = px * (0.006 + rand() * 0.014);
        g.beginPath();
        g.ellipse(sx, sy, rr, rr * (0.6 + rand() * 0.6), rand() * 3, 0, 6.284);
        g.fill();
      }
      // EDGE WEAR — the one piece of low-frequency variation the reference's
      // flags DO have. Enlarge its near floor and every flag is slightly darker
      // and dirtier for a couple of centimetres in from its rim and cleanest in
      // the middle, because that is where a hundred years of boots and mop
      // water put it. It is bounded by the flag, so unlike a cloud it cannot
      // cross a joint and turn four flags into one field.
      const wear = g.createRadialGradient(
        x + flagW * 0.5,
        y + rowH * 0.5,
        Math.min(flagW, rowH) * 0.16,
        x + flagW * 0.5,
        y + rowH * 0.5,
        Math.max(flagW, rowH) * 0.62,
      );
      wear.addColorStop(0, 'rgba(96,86,64,0)');
      wear.addColorStop(1, 'rgba(96,86,64,0.16)');
      g.fillStyle = wear;
      g.fillRect(x, y, flagW, rowH);
      g.restore();

      // THE JOINT IS A GUTTER, NOT A LINE.
      //
      // Enlarge the reference's near floor 3×: every boundary between two flags
      // is a dark channel two or three pixels wide with a narrow pale bloom on
      // the lower-right side of it, which is what a bevelled stone edge sitting
      // proud of its neighbour actually looks like. At alpha 0.16 over a 3.6px
      // stroke ours was inside the noise, and the largest surface in the frame
      // read as one continuous wash. Trebled, narrowed, and given the bloom.
      //
      // WAVE 2 — AND AT 256 THE GUTTER CAN FINALLY BE NARROW.
      //
      // At 128px a 0.038-cell stroke was 4.9 texels of low-alpha grey: wide
      // enough that the mip chain kept it, soft enough that it never read as an
      // edge, which is exactly the "2–3px of blurred low-contrast grey with no
      // bevel" the critic measured. A joint is not a wide grey line, it is a
      // NARROW DARK one with a bright arris beside it, and the eye reads the
      // pair as a step in height. Half the width, nearly twice the density, and
      // a second inner shadow one texel further in so the gutter has a floor.
      g.save();
      roundRect(g, x + grout, y + grout, flagW - grout * 2, rowH - grout * 2, 0.045 * px);
      g.clip();
      g.strokeStyle = 'rgba(70,62,44,0.72)';
      g.lineWidth = 0.020 * px;
      g.beginPath();
      g.moveTo(x + grout, y + rowH - grout);
      g.lineTo(x + grout, y + grout);
      g.lineTo(x + flagW - grout, y + grout);
      g.stroke();
      // The lit lip on the opposite two edges. Without it the flag is a hole;
      // with it, it is a slab standing a centimetre above its neighbour. Now a
      // real two-tone arris: a hot core against the gutter and a soft shoulder
      // fading back into the flag, which is what a chamfer catching a steep key
      // actually looks like and what carries the read at distance.
      // WAVE 2b: 0.55 → 0.30. The first cut of the arris ran a near-white line
      // all the way round two sides of every flag, and shot at 3× the floor
      // came back as tiled linoleum with lit grout — a wireframe, not a
      // chamfer. The reference's lit lip is a hint you notice only when you
      // look for it; its joint carries the read, and the lip only tells you
      // which way is up.
      g.strokeStyle = 'rgba(255,250,236,0.30)';
      g.lineWidth = 0.013 * px;
      g.beginPath();
      g.moveTo(x + flagW - grout, y + grout);
      g.lineTo(x + flagW - grout, y + rowH - grout);
      g.lineTo(x + grout, y + rowH - grout);
      g.stroke();
      g.restore();

      x += flagW;
    }
    y += rowH;
    course++;
  }

  // Contact darkening along the two side walls and the back wall. Cheap AO that
  // stops the floor from looking like it is floating inside the room.
  const edge = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(74,50,24,0.42)');
    grad.addColorStop(1, 'rgba(74,50,24,0)');
    g.fillStyle = grad;
    g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(w, Math.abs(x1 - x0)), Math.max(w, Math.abs(y1 - y0)));
  };
  edge(0, 0, 0, 1.5 * px, W);
  edge(0, 0, 1.5 * px, 0, H);
  edge(W, 0, W - 1.5 * px, 0, H);

  return finish(g, THREE.ClampToEdgeWrapping);
}

// --------------------------------------------------------------------- brick

/** Pale limestone courses for the chimney breast. Tile = 2.4 × 1.6 world units. */
export const BRICK_TILE = { w: 2.4, h: 1.6 };

export function brickTexture(px = 128): THREE.Texture {
  const cols = 4;
  const rows = 4;
  const W = px * cols;
  const H = px * rows;
  const g = ctx2d(W, H);
  const rand = rng(0x2b12c4);

  // NO TWO STONES THE SAME, WHICH IS THE WHOLE READ.
  //
  // Enlarge the reference's chimney 4× and sample a 6×6 grid across it: its
  // blocks walk rgb(130,121,78) → (163,159,122) → (192,184,138) → (194,196,175)
  // → (226,218,195) → (232,225,197). Luma 130 to 225 inside a single course,
  // with cream, sage-green and warm-grey blocks sitting next to each other. Ours
  // ran `0.93 + t * 0.13` off one hue — a ±6% wobble on a single tone — so the
  // largest pale mass in the frame rendered as a smooth card with faint lines
  // scored across it, and every round of geometry added on top of it (proud
  // courses, corbel shadow, weathering blooms) was compensating for a texture
  // that said nothing. Block-to-block VALUE and HUE variety is the cheapest and
  // by far the strongest of the three.
  //
  // The joints go with it: the mortar behind the blocks was 0xb3ab8e against
  // blocks averaging 0xe4dec0, so the gap between two stones was a 12% step and
  // it vanished the moment the breast was more than 300px wide on screen.
  // ...AND THEN A REGULAR GRID OF IDENTICAL BLOCKS IS STILL A TILED WALL.
  //
  // Cropped at 2.3× side by side with the reference's breast, the first pass
  // fixed the value spread and left three things that still said "subway tile":
  // every block was exactly W/4 wide, the mortar was a wide mid-GREY, and the
  // stone faces were smooth. The reference's course is three to five blocks of
  // visibly DIFFERENT widths, its joints are narrow and dark, and every face
  // carries a fine speckled grain. Widths are now a jittered walk per course
  // (wrapped so the tile stays seamless), the joint is 20% narrower and a stop
  // darker, and each face gets grain on top of its blotches.
  //
  // WAVE 2 — THE VALUES WERE RIGHT AND THE SHAPE LANGUAGE WAS STILL A TILE MAP.
  //
  // The last critic credited the joint polarity and the block-to-block spread
  // and then said exactly what was left: "every block is an identical rounded
  // rectangle with the same corner radius on a regular running bond. The
  // reference's blocks are irregular quadrilaterals of visibly varying width,
  // height and corner radius." Widths were already jittered; the other two were
  // not. Courses now have jittered HEIGHTS that still sum to the tile so the
  // breast keeps repeating invisibly, every corner gets its own radius, and
  // every edge is walked through a mid-point that wanders a couple of texels so
  // no two stones share an outline.
  g.fillStyle = rgb(0x7f7760);
  g.fillRect(0, 0, W, H);

  const joint = px * 0.042;

  /** Course edges: `rows` bands of jittered height summing exactly to H. */
  const rowY: number[] = [0];
  {
    const hs: number[] = [];
    let sum = 0;
    for (let i = 0; i < rows; i++) {
      const v = 0.74 + rand() * 0.56;
      hs.push(v);
      sum += v;
    }
    let acc = 0;
    for (let i = 0; i < rows; i++) {
      acc += (hs[i] / sum) * H;
      rowY.push(acc);
    }
  }

  /** Block boundaries for one course: 3-5 stones, jittered, summing to W. */
  const boundaries = (): number[] => {
    const n = 3 + Math.floor(rand() * 2.99);
    const raw: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = 0.65 + rand() * 0.8;
      raw.push(v);
      sum += v;
    }
    const out: number[] = [0];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += (raw[i] / sum) * W;
      out.push(acc);
    }
    return out;
  };

  for (let r = -1; r <= rows; r++) {
    const ri = ((r % rows) + rows) % rows;
    const y = rowY[ri] + (r < 0 ? -H : r >= rows ? H : 0);
    const bh = rowY[ri + 1] - rowY[ri];
    const bs = boundaries();
    const phase = rand() * W;
    for (let c = 0; c < bs.length - 1; c++) {
      // Drawn twice, one tile-width apart, so a stone straddling the seam
      // appears whole on both sides and the tile still repeats invisibly.
      for (const wrap of [-W, 0]) {
        const x = bs[c] + phase + wrap;
        const bw = bs[c + 1] - bs[c];
        if (x > W || x + bw < 0) continue;
        const t = rand();
        // Value first. The SPREAD is what matters — 0.33 of the base across a
        // single course, which is the reference's own — and the mean is set so
        // the field lands back in its Y 180-222 band once the face tint and
        // bounce are applied.
        // ROUND 12 — THE SPREAD WAS STILL HALF THE REFERENCE'S AND THE HUE WAS
        // WARM GREY, WHICH IS CONCRETE.
        //
        // Cropped at 2.6×, our breast reads as poured concrete and the
        // reference's reads as cut limestone. Block averages: ours
        // rgb(196,188,159) H 47, theirs rgb(198,196,159) H 57 and
        // rgb(222,217,184) H 52. Same luma — ten degrees of hue. In the
        // reference GREEN sits level with or above RED on every block; ours had
        // red leading on all of them, and every other warm surface in the room
        // is H 28-40, so those ten degrees are the whole reason its chimney
        // reads as a different MATERIAL rather than as bleached plaster.
        // Base goes onto the sage axis, the block-to-block spread widens from
        // 0.30 to 0.42 of the base (the reference walks luma 130→225 inside one
        // course), and the sage jitter roughly doubles so some blocks come out
        // distinctly green and others distinctly cream.
        const shade = 0.7 + t * 0.42;
        const sage = (rand() - 0.5) * 2;
        // ROUND 12b — five degrees back off the green. The first cut landed the
        // hue split (ours H 47 → the reference's H 51-57) by pushing green up
        // AND red down, and cropped at 2.6× the breast came out a pale sage
        // that read cold beside a mustard wall. The reference's stone is a
        // warm cream that happens to carry a green cast on its damper blocks:
        // red still leads on the mean, green only wins on the weathered ones.
        const base = 0xf0ead0;
        const cr = ((base >> 16) & 255) * shade - sage * 12;
        const cg = ((base >> 8) & 255) * shade + sage * 5;
        const cb = (base & 255) * shade - sage * 15;
        const clip = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
        g.fillStyle = `rgb(${clip(cr)},${clip(cg)},${clip(cb)})`;
        // Two draws of the SAME shape: the rng walk inside stoneShape has to be
        // replayed identically for the clip or the grain leaks past the fill.
        const seed = (rand() * 1e9) >>> 0;
        const shapeAt = (rr: () => number) => {
          const wob = () => (rr() - 0.5) * px * 0.022;
          // The reference's stones are visibly CHAMFERED — its corners run a
          // tenth to a fifth of a block, not the hairline 7.5% we shipped.
          const rad = () => Math.min(px * (0.09 + rr() * 0.11), (bw - joint * 2) * 0.36, (bh - joint * 2) * 0.36);
          const bx = x + joint;
          const by = y + joint;
          const bwi = bw - joint * 2;
          const bhi = bh - joint * 2;
          const a = rad();
          const b2 = rad();
          const c2 = rad();
          const d2 = rad();
          g.beginPath();
          g.moveTo(bx + a, by);
          g.lineTo(bx + bwi * 0.5, by + wob());
          g.lineTo(bx + bwi - b2, by);
          g.quadraticCurveTo(bx + bwi, by, bx + bwi, by + b2);
          g.lineTo(bx + bwi + wob(), by + bhi * 0.5);
          g.lineTo(bx + bwi, by + bhi - c2);
          g.quadraticCurveTo(bx + bwi, by + bhi, bx + bwi - c2, by + bhi);
          g.lineTo(bx + bwi * 0.5, by + bhi + wob());
          g.lineTo(bx + d2, by + bhi);
          g.quadraticCurveTo(bx, by + bhi, bx, by + bhi - d2);
          g.lineTo(bx + wob(), by + bhi * 0.5);
          g.lineTo(bx, by + a);
          g.quadraticCurveTo(bx, by, bx + a, by);
          g.closePath();
        };
        shapeAt(rng(seed));
        g.fill();
        g.save();
        shapeAt(rng(seed));
        g.clip();
        // WEATHERING, AND IT HAS TO BE COARSE OR THE MIP CHAIN EATS IT.
        //
        // The breast is ~3.3 world units across and lands ~370px wide at 1440,
        // i.e. 112 screen px per unit against this map's 213 texels per unit.
        // Everything authored at one or two texels is therefore averaged away
        // before it reaches the frame, which is why the previous round's speck
        // pass measured as "cut stone" in the canvas and rendered as glass. The
        // reference's faces are covered in CHUNKY mottle — clumps a tenth of a
        // block wide, in sage-grey and in cream — so the blotches go up in both
        // size and strength and the specks roughly double.
        for (let i = 0; i < 8; i++) {
          const sagey = rand() < 0.5;
          g.fillStyle = sagey
            ? `rgba(138,140,104,${0.09 + rand() * 0.15})`
            : `rgba(255,250,226,${0.08 + rand() * 0.16})`;
          g.beginPath();
          g.ellipse(x + rand() * bw, y + rand() * bh, px * (0.07 + rand() * 0.26), px * (0.05 + rand() * 0.16), rand() * 3, 0, 6.284);
          g.fill();
        }
        for (let i = 0; i < 40; i++) {
          const dark = rand() < 0.55;
          g.fillStyle = dark ? `rgba(112,106,76,${0.12 + rand() * 0.16})` : `rgba(255,252,232,${0.10 + rand() * 0.16})`;
          const sx = x + rand() * bw;
          const sy = y + rand() * bh;
          g.beginPath();
          g.ellipse(sx, sy, px * (0.016 + rand() * 0.036), px * (0.014 + rand() * 0.03), rand() * 3, 0, 6.284);
          g.fill();
        }
        g.restore();
        // Bedding shadow along the top and left of every stone — the reference's
        // blocks are laid proud and each one throws a line onto its neighbour.
        g.strokeStyle = 'rgba(82,76,54,0.6)';
        g.lineWidth = px * 0.04;
        g.beginPath();
        g.moveTo(x + joint, y + bh - joint);
        g.lineTo(x + joint, y + joint);
        g.lineTo(x + bw - joint, y + joint);
        g.stroke();
      }
    }
  }
  return finish(g);
}

// ------------------------------------------------------------------- stucco

/** Ochre plaster with a slow mottle. Tile = 4 × 4 world units. */
export const STUCCO_TILE = { w: 4, h: 4 };

/**
 * ROUND 13 — ART/LIGHTING PASS. Cross-file change, four values in this one
 * function; nothing structural.
 *
 * Measured on a plaster patch, both frames normalised to 1280 wide: reference
 * mean |laplacian| 2.41–2.52, ours 1.30–1.33. Round 12 cut the blotch alpha
 * from 0.16 to 0.09 to stop the raked SIDE walls smearing into planking, and
 * that diagnosis was right about the side walls and wrong about the cure — the
 * smearing is a function of blob SIZE under perspective, not of blob strength.
 * A 1m blob seen at 15° off edge-on becomes a 25cm streak; a 25cm blob becomes
 * a 6cm speck, which is stucco tooth and reads correctly from any angle.
 *
 * So: blobs smaller and more numerous at most of their old strength, the speck
 * pass tripled, and the tile doubled to 512 over its 4m so there is somewhere
 * for the extra detail to live (the back wall occupies ~64px per metre at 1440
 * wide, which is exactly the density the old tile carried — i.e. none spare).
 */
export function stuccoTexture(px = 512): THREE.Texture {
  const g = ctx2d(px, px);
  const rand = rng(0x9c3f01);
  // ROUND 12: H 36 → H 42, and up 6% in value. Measured, the reference's
  // plaster is rgb(173,124,34) — H 39 — against timber at H 26-29, and that
  // thirteen-degree split is the entire armature read. Ours was authored at
  // H 36 and the terracotta seek in materials.ts then pulled it down to H 32,
  // two degrees off the beams crossing it. Mustard, not honey: this is the one
  // large warm surface in the room that has to sit on the YELLOW side of the
  // orange line, because everything in front of it sits on the red side.
  g.fillStyle = rgb(0xdcab34);
  g.fillRect(0, 0, px, px);
  // Big soft blotches, then fine grain. Both wrap by drawing every blob nine
  // times on a 3×3 torus so the tile stays seamless.
  for (let i = 0; i < 90; i++) {
    const x = rand() * px;
    const y = rand() * px;
    // ROUND 13: was 0.06–0.26 of the tile, i.e. blobs up to a metre across.
    // 0.03–0.11 lands them at 12–44cm, which survives the rake.
    const r = px * (0.03 + rand() * 0.08);
    const light = rand() > 0.5;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const grad = g.createRadialGradient(x + ox * px, y + oy * px, 0, x + ox * px, y + oy * px, r);
        // ROUND 12: 0.16 → 0.09. Crop the reference's plaster at 4.5× and it is
        // a genuinely FLAT field — one value, with only a fine even sandpaper
        // tooth on it. All of its variation is geometry: beams, their cast
        // shadows, and the corner. Ours carried ±16% soft blotches roughly a
        // metre across, which on the raked side walls smeared into streaks and
        // on the back wall read as damp. The fine speck pass below stays.
        grad.addColorStop(0, light ? 'rgba(255,226,160,0.15)' : 'rgba(120,80,22,0.15)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox * px - r, y + oy * px - r, r * 2, r * 2);
      }
    }
  }
  // The fine tooth. Tripled in count with the tile, and given a second, larger
  // grade of fleck: one speck size is a screen door, two is a sanded surface.
  // WAVE 2 — the tooth is a stop under the reference's. Mean |laplacian| on a
  // plaster patch, both frames at 1440: reference 3.10, ours 2.29-2.70; raw
  // HF-RMS on the same patch, reference 15.0 against our 10.7-12.2. The blob
  // pass is already at the reference's amplitude and the shortfall is all in
  // the fine grade, so the specks go up ~35% in strength and gain a third,
  // coarser grade that survives the mip chain on a wall seen at 64px/metre.
  for (let i = 0; i < 11000; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(255,232,178,0.15)' : 'rgba(112,74,20,0.15)';
    const r = rand();
    const w = r > 0.9 ? 6 : r > 0.72 ? 4 : 2;
    g.fillRect(rand() * px, rand() * px, w, w);
  }
  // AND A MIDDLE GRADE, BECAUSE THE FINE ONE IS BEING MIPPED AWAY.
  //
  // The back wall occupies ~64 screen px per metre at 1440 and this tile carries
  // 128 texels per metre, so it renders at 2× minification: a two-texel fleck is
  // half a screen pixel by the time it lands and contributes nothing to the
  // measured contrast. 10-20 texels is 8-16cm — 5-10 screen px — which is the
  // scale of the pitting on the reference's plaster and the only grade of
  // detail on this surface that survives to the frame.
  for (let i = 0; i < 1500; i++) {
    const light = rand() > 0.5;
    g.fillStyle = light ? 'rgba(255,220,142,0.10)' : 'rgba(118,80,24,0.11)';
    const w = px * (0.018 + rand() * 0.022);
    g.beginPath();
    g.ellipse(rand() * px, rand() * px, w, w * (0.6 + rand() * 0.6), rand() * 3, 0, 6.284);
    g.fill();
  }
  return finish(g);
}

// -------------------------------------------------------------------- planks

/** Honey timber with grain running along U. Tile = 2 × 2 world units. */
export const TIMBER_TILE = { w: 2, h: 2 };

/**
 * WAVE 2 — THREE CLEAN VALUES, WHICH IS WHERE THE ARCHITECTURE COMES FROM.
 *
 * This map dresses the back wall's posts and its header beam — the armature the
 * reference builds its whole upper frame out of — and it was drawing seventy
 * WAVY dark bands, each up to 2% of the tile tall and wandering ±1.2% in y, at
 * alphas up to 0.20. On a post that reads as blotch, not as timber: cropped at
 * 3× ours was dark muddy brown with soft irregular staining and the reference's
 * is a clean mid-honey board with straight grain and a bright top arris. The
 * mottle from materials.ts then landed on top of the same surface, and between
 * the two the posts lost their value separation from the plaster they cross —
 * so the room's three planes (pale mustard wall / mid honey timber / near-white
 * stone) collapsed into two.
 *
 * So: straight grain, no wander, one grade finer and lower in contrast; a
 * per-plank tone step so boards separate from each other rather than from
 * themselves; a dark joint with a LIT ARRIS beneath it, which is the only
 * detail on a post that survives being 40px wide on a phone; and the base up
 * roughly a stop, because the armature has to sit ABOVE the plaster's shadow
 * side to read as timber crossing a wall rather than as a gap in it.
 */
export function timberTexture(px = 256): THREE.Texture {
  const g = ctx2d(px, px);
  const rand = rng(0x77a13d);
  // WAVE 2 — THE MAP CARRIES GRAIN, THE TINT CARRIES THE HUE.
  //
  // This base was 0xd6a75f, a mid honey, and world.ts then multiplied it by a
  // dark saturated TIMBER_FACE to get the posts. Two saturated warm values
  // multiplied together is how the armature ended up at luma 80-86 against a
  // wall at 113-148 — the beams dissolved into the back wall and the room lost
  // its three-plane read. Measured on the reference, its posts sit at luma
  // 119-123 against plaster at 130-141 and separate on CHROMA (S 0.84 vs 0.74),
  // so the value has to come back up ~45% while the hue stays put.
  //
  // Going pale and near-neutral here is what buys that headroom: the map is now
  // a value/grain carrier and TIMBER_FACE alone decides what colour timber is.
  // Every tone in this function is scaled to match, so the plank steps and the
  // arris keep their authored relationship to the field.
  const BASE: [number, number, number] = [228, 208, 178];
  g.fillStyle = `rgb(${BASE[0]},${BASE[1]},${BASE[2]})`;
  g.fillRect(0, 0, px, px);

  const planks = 4;
  const ph = px / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    // Board-to-board tone step. Four boards, four slightly different tones —
    // this is the variation the wavy blotches were standing in for, and unlike
    // them it has a hard edge at the joint, so it reads as separate boards.
    const step = 0.93 + rand() * 0.14;
    g.fillStyle = `rgba(${Math.round(BASE[0] * step)},${Math.round(BASE[1] * step)},${Math.round(BASE[2] * step)},0.5)`;
    g.fillRect(0, y0, px, ph);

    // STRAIGHT GRAIN. Dead horizontal, hairline, low alpha, many of them: the
    // reference's timber is a fine ruled stripe you read as a material, not as
    // a set of marks. Occasional pairs run tight together the way real grain
    // does around a growth ring.
    const lines = 26;
    for (let i = 0; i < lines; i++) {
      const gy = y0 + ph * (0.06 + rand() * 0.88);
      const dark = rand() > 0.38;
      const a = dark ? 0.05 + rand() * 0.09 : 0.04 + rand() * 0.07;
      g.fillStyle = dark ? `rgba(126,80,26,${a})` : `rgba(255,224,166,${a})`;
      g.fillRect(0, gy, px, px * (0.003 + rand() * 0.007));
      if (rand() > 0.7) {
        g.fillRect(0, gy + px * 0.012, px, px * 0.003);
      }
    }
  }

  // Plank joints every quarter tile = every half world unit, each one a dark
  // seam with a lit arris on the board below it. Two texels of value contrast
  // at a known place beats any amount of noise for making a post read as a
  // stack of boards at thumbnail size.
  for (let i = 0; i < planks; i++) {
    const y = (i / planks) * px;
    g.fillStyle = 'rgba(88,52,12,0.55)';
    g.fillRect(0, y - px * 0.006, px, px * 0.013);
    g.fillStyle = 'rgba(255,228,172,0.42)';
    g.fillRect(0, y + px * 0.008, px, px * 0.009);
  }
  return finish(g);
}

/**
 * Align a tiling texture to world coordinates so neighbouring pieces of
 * geometry share one continuous surface. `u0`/`v0` are the world coordinates of
 * the plane's lower-left corner; `w`/`h` its world size.
 */
export function alignTile(
  tex: THREE.Texture,
  tile: { w: number; h: number },
  u0: number,
  v0: number,
  w: number,
  h: number,
): THREE.Texture {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / tile.w, h / tile.h);
  t.offset.set(u0 / tile.w, v0 / tile.h);
  return t;
}
