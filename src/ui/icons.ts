import { RECIPES } from '../domain/content';
import type { IngredientKind, PrepState } from '../domain/types';

/**
 * Chunky ingredient icons, drawn as inline SVG.
 *
 * These are read at a glance from across the room, at roughly the size of a
 * character's head, so the rules are the reference's rules:
 *
 *  - ONE PALETTE WITH THE PROPS. Every hex below is either a hex out of
 *    INGREDIENT_DEFS or a shade of one, keyed to the exact tones the meshes in
 *    src/view/world.ts use. The ticket used to run pastel — a #f0644a tomato
 *    slice inside a #fff6ec ring, hanging two metres above a bench carrying
 *    #e61c0a whole tomatoes — so the single most important read in the game was
 *    the weakest value on screen. It is now the strongest.
 *  - ONE SILHOUETTE PER INGREDIENT, matching the silhouette of the prop. If the
 *    thing on the table is a cabbage ball, the ticket does not show a spinach
 *    spray; if the thing on the table is a cloud roll, the ticket does not show
 *    a sesame burger bun.
 *  - LIT LIKE THE ROOM. Steep warm key from above-left, so every object gets a
 *    light top-left cheek, a dark bottom, a small white specular, and its own
 *    soft contact shadow on the floor of the balloon. That is what makes an
 *    icon sit IN the scene instead of on it.
 *  - Processing state changes the SILHOUETTE, and a corner chit names the verb
 *    outright — a knife for :prepped, a flame for :cooked. Silhouette alone was
 *    not surviving 45px: a raw bun and a cooked bun are the same dome.
 *
 * Everything lives in a 48x48 viewBox AND FILLS IT. That last word is the whole
 * of round four. The art used to stand on y≈42 with a large empty crown above
 * it and a margin all round, so the drawn food occupied roughly 60% of the tile
 * — which meant the ONE thing the player has to read from across the room
 * shipped 30% smaller than the reference's, on a balloon that was paying full
 * screen area for it. Every composition below now spans x≈1..47, y≈5..46.
 *
 * The other half of that fix: ONE HERO OBJECT PER TILE where the reference
 * shows one. Its balloon says "a tomato" with a single 50px fruit; ours used to
 * say it with two 26px fruit in the same space, which is the same ink spent on
 * half the read. Quantity is expressed by repeating tiles, not by shrinking the
 * object inside one.
 */

const R = (n: number) => n.toFixed(1);

/**
 * Blow a composition up about a pivot so it fills the tile.
 *
 * Used for the arts whose geometry is a fixed path rather than parameters — a
 * cheese wedge, a fried egg, a fish. Cheaper and far less risky than re-authoring
 * every coordinate, and the numbers are chosen per icon so the result lands
 * inside 0..48 on both axes with nothing clipped.
 */
const grow = (k: number, body: string, cx = 24, cy = 27, dx = 0, dy = 0) =>
  `<g transform="translate(${R(dx)} ${R(dy)}) translate(${R(cx)} ${R(cy)}) scale(${R(k)}) translate(${R(-cx)} ${R(-cy)})">${body}</g>`;

// ------------------------------------------------------------------ palette
//
// Left column = the INGREDIENT_DEFS hex. Right columns = the shade and the
// highlight the mesh uses, so a ticket tomato and a bench tomato are the same
// three colours in the same three places.

const P = {
  // THE LOUDEST PIXELS IN THE GAME LIVE HERE.
  //
  // In refs/dash-and-dine-01.jpeg the two tomatoes inside the left balloon are
  // the most saturated thing in the entire frame — the eye lands on them before
  // it lands on the oven fire — and every other colour in the room is a warm
  // mid. Ours shipped the ticket tomato at the same hex as the bench prop, and
  // the bench prop is lit, shaded and half in shadow, so the ROOM held the
  // saturation crown and the ORDER did not. The ticket now runs one step hotter
  // and one step brighter than any mesh in the level, on purpose.
  tomato: { base: '#ee1206', dark: '#8d0b02', deep: '#c00d03', hi: '#ff5f30', flesh: '#f4441f', core: '#ffb392', seed: '#ffe2c8' },
  leaf: { base: '#3f8c10', hi: '#68c31c' },
  lettuce: { base: '#6fd112', dark: '#2f6a0a', hi: '#b0f24e', cut: '#dff5ae', ring: '#b6e86a' },
  bacon: { base: '#ff8496', dark: '#b4384f', fat: '#ffe6dc', hi: '#ffb8c2' },
  baconC: { base: '#c0472a', dark: '#6f2110', fat: '#f0aa72', hi: '#e6784c' },
  // The bun mesh is a #d88f3f dome under a #f2b972 cap. Keying the ICON off
  // that lit value put a 236-value dome on a 250-value balloon: 6% separation,
  // and at phone size the bun simply was not there. It sits two steps deeper
  // and one step warmer than the prop now and carries a hard crust keyline, so
  // it has a silhouette against the balloon fill rather than dissolving into it.
  bun: { base: '#d9821f', dark: '#6d3c0b', rim: '#8f4f10', hi: '#ffd98f', cap: '#eeaa4a', cross: '#fff2d4' },
  cheese: { base: '#ffcb14', dark: '#c99400', hi: '#ffe680' },
  onion: { base: '#a85fd6', dark: '#7a3ba8', hi: '#c98ff0', flesh: '#f0e2fb', ring: '#d3b0ea', sprout: '#b9a271' },
  potato: { base: '#dcae63', dark: '#9a7038', skin: '#a8763a', eye: '#5c4020', hi: '#f0cd96' },
  fries: { base: '#e39a12', dark: '#b06f0a', hi: '#f8c94e' },
  raw: { base: '#e9d7b4', dark: '#bda071', hi: '#f7ecd2' },
  egg: { shell: '#faf2e0', shellD: '#d8c9a8', yolk: '#ffa522', yolkD: '#d97f0a', white: '#fffaf0' },
  rice: { bowl: '#4f9fc0', bowlD: '#2f7796', base: '#f4f8fb', dark: '#cfe2f2' },
  fish: { base: '#4fbdda', dark: '#2b87a6', hi: '#95e0f0', cooked: '#e0a53c', cookedD: '#a86a16' },
};

// ------------------------------------------------------------------ helpers

/**
 * A contact shadow. Three stacked ellipses rather than a Gaussian: a filter per
 * icon is a separate render surface each, and eight of them inside a balloon
 * that is already drop-shadowed measurably costs frames on a phone.
 */
function ground(cx: number, rx: number, cy = 45) {
  return `<g fill="#3a2a1e">
    <ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(rx)}" ry="${R(rx * 0.27)}" opacity=".07"/>
    <ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(rx * 0.72)}" ry="${R(rx * 0.2)}" opacity=".09"/>
    <ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(rx * 0.44)}" ry="${R(rx * 0.13)}" opacity=".11"/>
  </g>`;
}

/** A lit sphere: dark body, lifted face, warm cheek, one white specular. */
function orb(cx: number, cy: number, r: number, c: { base: string; dark: string; hi: string }, spec = 1) {
  return `<g>
    <circle cx="${R(cx)}" cy="${R(cy)}" r="${R(r)}" fill="${c.dark}"/>
    <circle cx="${R(cx)}" cy="${R(cy - r * 0.11)}" r="${R(r * 0.9)}" fill="${c.base}"/>
    <ellipse cx="${R(cx - r * 0.3)}" cy="${R(cy - r * 0.4)}" rx="${R(r * 0.52)}" ry="${R(r * 0.4)}"
      fill="${c.hi}" opacity=".62" transform="rotate(-30 ${R(cx - r * 0.3)} ${R(cy - r * 0.4)})"/>
    ${
      spec
        ? `<ellipse cx="${R(cx - r * 0.36)}" cy="${R(cy - r * 0.5)}" rx="${R(r * 0.23)}" ry="${R(r * 0.14)}"
      fill="#fff" opacity="${(0.8 * spec).toFixed(2)}" transform="rotate(-32 ${R(cx - r * 0.36)} ${R(cy - r * 0.5)})"/>`
        : ''
    }
  </g>`;
}

/** A lit dome standing on the ground line — the bun and the cabbage cut face. */
function dome(cx: number, base: number, r: number, h: number, c: { base: string; dark: string; hi: string }) {
  const top = base - h;
  return `<g>
    <path d="M${R(cx - r)} ${R(base)}a${R(r)} ${R(h)} 0 0 1 ${R(r * 2)} 0z" fill="${c.dark}"/>
    <path d="M${R(cx - r * 0.97)} ${R(base - 1.4)}a${R(r * 0.97)} ${R(h - 1.4)} 0 0 1 ${R(r * 1.94)} 0z" fill="${c.base}"/>
    <ellipse cx="${R(cx - r * 0.3)}" cy="${R(top + h * 0.42)}" rx="${R(r * 0.46)}" ry="${R(h * 0.34)}"
      fill="${c.hi}" opacity=".6" transform="rotate(-22 ${R(cx - r * 0.3)} ${R(top + h * 0.42)})"/>
  </g>`;
}

/**
 * A wavy rasher band, laid flat, spanning the FULL tile width. Amplitude and
 * thickness rise when it crisps.
 */
function rasher(y: number, amp: number, c: { base: string; dark: string; fat: string; hi: string }, th = 12.6) {
  const s = 11.6;
  const w = `q${R(s / 2)} ${R(-amp)} ${R(s)} 0 t${R(s)} 0 t${R(s)} 0 t${R(s)} 0`;
  const back = `q${R(-s / 2)} ${R(amp)} ${R(-s)} 0 t${R(-s)} 0 t${R(-s)} 0 t${R(-s)} 0`;
  const body = `M1 ${R(y)} ${w} v${R(th)} ${back} z`;
  return `<g>
    <!-- A HARD RIM FIRST. Bacon is the palest food in the game and the balloon
         it sits on is a 250-value white; without an outline the rasher lost its
         own edge and the pair read as two decorative pink ribbons. -->
    <path d="${body}" fill="${c.dark}"/>
    <path d="M1 ${R(y + 1.5)} ${w} v${R(th - 3)} ${back} z" fill="${c.base}"/>
    <!-- MARBLING: two cream fat seams running the length of the strip, which is
         the one thing that says "bacon" rather than "ribbon". -->
    <path d="M1 ${R(y + th * 0.26)} ${w} v${R(th * 0.2)} ${back} z" fill="${c.fat}" opacity=".95"/>
    <path d="M1 ${R(y + th * 0.62)} ${w} v${R(th * 0.13)} ${back} z" fill="${c.fat}" opacity=".7"/>
    <path d="M1 ${R(y + 2.4)} ${w}" fill="none" stroke="${c.hi}" stroke-width="1.7" stroke-linecap="round" opacity=".9"/>
  </g>`;
}

/** A rounded chip — a fry, a shred, a baton. */
function stick(x: number, y: number, w: number, h: number, rot: number, a: string, b: string) {
  return `<g transform="rotate(${R(rot)} ${R(x + w / 2)} ${R(y + h / 2)})">
    <rect x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}" rx="${R(Math.min(w, h) / 2)}" fill="${a}"/>
    <rect x="${R(x + 1)}" y="${R(y + 1)}" width="${R(w - 2)}" height="${R(h * 0.34)}" rx="${R(h * 0.17)}" fill="${b}"/>
  </g>`;
}

// ------------------------------------------------------------------ tomato
//
// ONE FRUIT, FILLING THE TILE. The reference balloon spends a whole slot on a
// single 50px tomato — green calyx, specular, dark core, contact shadow — and
// that is why it is unmistakably a tomato at 420px wide. Two 26px fruit sharing
// one slot is the same ink for half the read, so the pair is gone.

/**
 * The calyx, off the reference: five sharp leaves swept DOWN over the
 * shoulder of the fruit plus a stubby stem, not a rosette lying flat on top.
 * Pointed tips, because at 40px the tips are the only part of it that survives
 * and rounded lobes read as a flower.
 */
const calyx = (cx: number, cy: number, s: number) => `<g transform="translate(${R(cx)} ${R(cy)}) scale(${R(s)})">
  <g fill="${P.leaf.base}">
    <path d="M0 2 -11.4 5.6 -6 0.4 -11 -3.6 -3.4 -2.2 -1.6 -8.4 0 -2.6z"/>
    <path d="M0 2 11.4 5.6 6 0.4 11 -3.6 3.4 -2.2 1.6 -8.4 0 -2.6z"/>
    <circle cx="0" cy="1" r="3.6"/>
  </g>
  <g fill="${P.leaf.hi}">
    <path d="M0 1.4 -8.4 3.8 -4.4 0.2 -7.6 -2.4 -2.6 -1.4 -1.2 -6 0 -1.8z" opacity=".85"/>
    <circle cx="-0.8" cy="0.2" r="2.1"/>
  </g>
  <path d="M-1.7 -5.6h3.4a1.7 1.7 0 0 1 0 3.4h-3.4z" fill="${P.leaf.hi}"/>
  <path d="M-1.7 -9.4h3.4a1.7 1.7 0 0 1 1.7 1.7v5.4h-3.4v-5.4z" fill="#69a52a"/>
</g>`;

/**
 * ONE WHOLE TOMATO, AND IT IS THE LOUDEST OBJECT ON THE SCREEN.
 *
 * The prepped tile used to be a whole fruit plus a big halved one, and the cut
 * face carried five pale locule darts round a pale core — which at 40px is a
 * blossom, not a tomato. Two critics running independently both read it as a
 * flower or a peach. The cut face is gone entirely: BOTH states draw the
 * reference's single whole fruit, and the corner chit — which is now big enough
 * to see — is the only thing that carries "chop this". That is the trade the
 * reference makes too; its balloon never shows a processed ingredient.
 *
 * Four things make it read at thumbnail, all of them measured off the JPEG:
 * a near-black-red rim under the body, a body one step hotter than any mesh in
 * the room, a broad soft sheen across the upper left, and exactly ONE crisp
 * white specular dot. Not two. One.
 */
/**
 * WAVE 3 — THE TERMINATOR, TWICE ASKED FOR AND TWICE NOT DELIVERED.
 *
 * Sampled inside the balloon, our tomato ran luma 66 at its darkest against the
 * reference's 12. Theirs has a near-black shadow side that makes the red a solid
 * object with mass; ours bottomed out mid-red and read as a flat sticker. The
 * cause was geometric, not chromatic: the dark and deep ellipses were 1.00 and
 * 0.945 of the radius with the lit body at 0.90 offset just 0.05r up and 0.11r
 * across, so the shaded side was a two-pixel rim that antialiasing lifted
 * straight back into mid-red. The body is now 0.855 of the radius and offset
 * twice as far into the light, which opens a real crescent — about 0.15r of
 * near-black maroon and another 0.07r of deep red — and the broad soft specular
 * is tightened so the highlight is a small hot spot rather than a wash.
 */
function wholeTomato(cx: number, cy: number, r: number) {
  return `<g>
    <ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(r)}" ry="${R(r * 0.95)}" fill="#3d0400"/>
    <ellipse cx="${R(cx - r * 0.03)}" cy="${R(cy - r * 0.05)}" rx="${R(r * 0.955)}" ry="${R(r * 0.9)}" fill="${P.tomato.dark}"/>
    <ellipse cx="${R(cx - r * 0.07)}" cy="${R(cy - r * 0.11)}" rx="${R(r * 0.905)}" ry="${R(r * 0.845)}" fill="${P.tomato.deep}"/>
    <ellipse cx="${R(cx - r * 0.11)}" cy="${R(cy - r * 0.19)}" rx="${R(r * 0.855)}" ry="${R(r * 0.775)}" fill="${P.tomato.base}"/>
    <ellipse cx="${R(cx - r * 0.26)}" cy="${R(cy - r * 0.32)}" rx="${R(r * 0.5)}" ry="${R(r * 0.4)}"
      fill="${P.tomato.hi}" opacity=".42" transform="rotate(-28 ${R(cx - r * 0.26)} ${R(cy - r * 0.32)})"/>
    <ellipse cx="${R(cx - r * 0.32)}" cy="${R(cy - r * 0.38)}" rx="${R(r * 0.28)}" ry="${R(r * 0.19)}"
      fill="#fff" opacity=".22" transform="rotate(-30 ${R(cx - r * 0.32)} ${R(cy - r * 0.38)})"/>
    <ellipse cx="${R(cx - r * 0.35)}" cy="${R(cy - r * 0.43)}" rx="${R(r * 0.15)}" ry="${R(r * 0.1)}"
      fill="#fff" opacity=".94" transform="rotate(-30 ${R(cx - r * 0.35)} ${R(cy - r * 0.43)})"/>
    <path d="M${R(cx - r * 0.72)} ${R(cy + r * 0.55)}a${R(r * 0.9)} ${R(r * 0.86)} 0 0 0 ${R(r * 1.45)} ${R(r * 0.03)}"
      fill="none" stroke="${P.tomato.dark}" stroke-width="${R(r * 0.11)}" stroke-linecap="round" opacity=".35"/>
  </g>`;
}

const tomatoRaw = `
  ${ground(24, 17.5)}
  ${wholeTomato(24, 28.4, 17.6)}
  ${calyx(24, 15.4, 1.12)}`;

// Prepped is the SAME fruit. See wholeTomato above: the chit carries the verb.
const tomatoCut = tomatoRaw;

// ----------------------------------------------------------------- lettuce
//
// The prop is a cabbage: one fat ball with a pale crown and five leaf lobes
// round the base. So is the icon. It used to be a four-leaf spinach spray,
// which shares no silhouette with anything in the room.

/**
 * ONE HEAD, CRINKLED, AND NOTHING ELSE IN THE TILE.
 *
 * The prepped tile used to be the head plus three shred batons lying in front
 * of it, and at ticket size the three batons merged into a single horizontal
 * green CYLINDER — a critic read the result as "a green blob with a stalk",
 * i.e. a leek. Both states now draw the same head, exactly as tomato does, and
 * the chit carries the verb.
 *
 * What makes it a cabbage rather than a green ball: the wrap. Three overlapping
 * leaf edges sweep round the lower half in a darker green with a lit top edge,
 * a pale-green heart sits off-centre at the top, and the outer leaves poke past
 * the ball's silhouette at the base. That is the reference's lettuce read.
 */
const lettuceHead = (() => {
  const cx = 24;
  const cy = 27.2;
  const r = 17.2;
  // Six leaf lobes wrapped round a heart. The lobes sit PROUD of the base
  // circle by 1.4 units, which is what makes the silhouette lumpy — a perfectly
  // round green ball is a pea, a melon or an apple, and the last two rounds of
  // this icon were all three of those in turn.
  const lobes = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 - 1.05;
    const lx = cx + Math.cos(a) * (r * 0.53);
    const ly = cy + Math.sin(a) * (r * 0.5);
    const deg = (a * 180) / Math.PI + 90;
    return { lx, ly, deg, a };
  });
  return `
  ${ground(24, 18.4)}
  <circle cx="${R(cx)}" cy="${R(cy)}" r="${R(r)}" fill="${P.lettuce.dark}"/>
  ${lobes
    .map(
      ({ lx, ly, deg }) => `<g transform="rotate(${R(deg)} ${R(lx)} ${R(ly)})">
      <ellipse cx="${R(lx)}" cy="${R(ly)}" rx="8.7" ry="9.6" fill="${P.lettuce.dark}"/>
      <ellipse cx="${R(lx)}" cy="${R(ly - 0.4)}" rx="7.9" ry="8.8" fill="${P.lettuce.base}"/>
      <path d="M${R(lx - 6.2)} ${R(ly - 3)}a7.4 7.4 0 0 1 12.4 0" fill="none" stroke="${P.lettuce.hi}"
        stroke-width="1.9" stroke-linecap="round" opacity=".72"/>
    </g>`,
    )
    .join('')}
  <!-- the heart: the pale centre every cabbage has, off-centre toward the key
       light so the whole head still reads as a sphere and not as a flower -->
  <circle cx="${R(cx - 0.6)}" cy="${R(cy - 1.6)}" r="8.4" fill="${P.lettuce.dark}"/>
  <circle cx="${R(cx - 0.8)}" cy="${R(cy - 2.2)}" r="7.6" fill="${P.lettuce.hi}"/>
  <path d="M${R(cx - 5.4)} ${R(cy - 1)}c1.6-3.6 5.4-5.4 9.6-4.4" fill="none" stroke="${P.lettuce.cut}"
    stroke-width="2.1" stroke-linecap="round" opacity=".9"/>
  <path d="M${R(cx - 3.4)} ${R(cy + 3.4)}c2.6-1.4 5.4-1.4 8 0" fill="none" stroke="${P.lettuce.base}"
    stroke-width="1.7" stroke-linecap="round" opacity=".55"/>
  <ellipse cx="${R(cx - 4.4)}" cy="${R(cy - 5.6)}" rx="3.4" ry="2" fill="#fff" opacity=".5"
    transform="rotate(-28 ${R(cx - 4.4)} ${R(cy - 5.6)})"/>`;
})();

const lettuceRaw = lettuceHead;
const lettuceCut = lettuceHead;

// ------------------------------------------------------------------- bacon

const baconRaw = `${ground(24, 18)}${rasher(7.5, 4.6, P.bacon, 14.5)}${rasher(26.5, 4.6, P.bacon, 14.5)}`;
const baconCooked = `${ground(24, 18)}${rasher(7, 7, P.baconC, 14.5)}${rasher(26.5, 7, P.baconC, 14.5)}`;

// --------------------------------------------------------------------- bun
//
// The prop is a cloud roll: a low glazed dome with a pale cross scored across
// the top and a visible base seam. Not a sesame burger bun — the seeded dome
// was the single icon that shared no shape at all with the thing on the table.

/**
 * The prop is a squashed golden ball with a paler cap and a cream cross scored
 * over it (see the `case 'bun'` block in view/world.ts). So is this. The first
 * pass at tile-filling size came out a pale beige lump with two heavy cream
 * lines down it, which at ticket size read as a paper bag — the weakest value
 * and the weakest chroma anywhere in the balloon, on the one card whose job is
 * to make food the loudest thing in the frame. Wider than tall, one step more
 * saturated, a real crust shadow under the belly, and the cross taken down to a
 * scoring mark instead of a fold.
 */
function roll(cx: number, base: number, r: number, h: number) {
  const shell = `M${R(cx - r)} ${R(base)}a${R(r)} ${R(h)} 0 0 1 ${R(r * 2)} 0z`;
  return `<g>
    <!-- CRUST KEYLINE. A 236-value dome on a 250-value balloon is 6% separation
         and the bun simply was not on the screen. The outline is what gives it
         a silhouette; the deepened fill is what stops it reading as paper. -->
    <path d="${shell}" fill="${P.bun.dark}"/>
    <path d="M${R(cx - r * 0.945)} ${R(base - 1.9)}a${R(r * 0.945)} ${R(h - 1.9)} 0 0 1 ${R(r * 1.89)} 0z" fill="${P.bun.rim}"/>
    <path d="M${R(cx - r * 0.9)} ${R(base - 3.2)}a${R(r * 0.9)} ${R(h - 3.2)} 0 0 1 ${R(r * 1.8)} 0z" fill="${P.bun.base}"/>
    <path d="M${R(cx - r * 0.76)} ${R(base - h * 0.44)}a${R(r * 0.76)} ${R(h * 0.6)} 0 0 1 ${R(r * 1.52)} 0z" fill="${P.bun.cap}"/>
    <ellipse cx="${R(cx - r * 0.3)}" cy="${R(base - h * 0.68)}" rx="${R(r * 0.4)}" ry="${R(h * 0.28)}"
      fill="${P.bun.hi}" opacity=".75" transform="rotate(-20 ${R(cx - r * 0.3)} ${R(base - h * 0.68)})"/>
    <g fill="none" stroke="${P.bun.cross}" stroke-width="${R(r * 0.14)}" stroke-linecap="round" opacity=".95">
      <path d="M${R(cx - r * 0.54)} ${R(base - h * 0.6)}q${R(r * 0.54)} ${R(-h * 0.26)} ${R(r * 1.08)} 0"/>
      <path d="M${R(cx)} ${R(base - h * 0.87)}q${R(-r * 0.12)} ${R(h * 0.32)} 0 ${R(h * 0.56)}"/>
    </g>
    <!-- the base seam, and a hard contact shade so the roll sits ON something -->
    <path d="M${R(cx - r * 0.97)} ${R(base - 3.4)}a${R(r * 0.97)} ${R(r * 0.26)} 0 0 0 ${R(r * 1.94)} 0v3.4h${R(-r * 1.94)}z"
      fill="${P.bun.rim}" opacity=".75"/>
    <ellipse cx="${R(cx)}" cy="${R(base - 1.4)}" rx="${R(r * 0.96)}" ry="${R(r * 0.19)}" fill="${P.bun.dark}" opacity=".55"/>
  </g>`;
}

// ONE roll, filling the tile. Two of them at 60% scale was the same trade the
// tomato pair made: twice the objects, half the read.
const bun = `
  ${ground(24, 19)}
  ${roll(24, 45.5, 21.5, 30)}`;

// ------------------------------------------------------------------ cheese

const cheeseRaw = `
  ${ground(24, 18)}
  ${grow(1.24, `<path d="M6 40V26.5c0-1.5 1-2.6 2.4-3L38 12.6c2.6-1 5 .7 5 3.3V37c0 1.7-1.3 3-3 3z" fill="${P.cheese.dark}"/>
  <path d="M6 26.5c0-1.5 1-2.6 2.4-3L38 12.6c2.6-1 5 .7 5 3.3v2.4L6 30z" fill="${P.cheese.hi}"/>
  <path d="M6 30 43 18.3V37c0 1.7-1.3 3-3 3H9a3 3 0 0 1-3-3z" fill="${P.cheese.base}"/>
  <g fill="${P.cheese.dark}" opacity=".75">
    <circle cx="16" cy="33" r="3.2"/><circle cx="29" cy="30" r="2.4"/><circle cx="36" cy="35" r="2.6"/>
  </g>`, 24, 26)}`;

const cheeseCut = `
  ${ground(24, 18)}
  ${grow(1.24, `${stick(5, 32, 38, 9, -3, P.cheese.dark, P.cheese.base)}
  ${stick(6, 22, 36, 9, -6, P.cheese.base, P.cheese.hi)}
  ${stick(7, 12, 34, 9, -9, P.cheese.hi, '#fff3bd')}`, 24, 26)}`;

// ------------------------------------------------------------------- onion
//
// The prop is a purple bulb with a pale tan sprout. Chopped, it opens into
// rings whose skin is still purple — the flesh alone would be another cream.

const sprout = (cx: number, cy: number) =>
  `<path d="M${R(cx)} ${R(cy)}c0-4-1.4-7-3-9 3 .6 5 3.4 5.4 8z" fill="${P.onion.sprout}"/>
   <path d="M${R(cx)} ${R(cy)}c.4-4.6 2.4-7.4 5.4-8-1.6 2-3 5-3 9z" fill="#cdb98a"/>`;

const onionRaw = `
  ${ground(24, 18)}
  ${orb(24, 30, 16.4, P.onion)}
  ${grow(1.7, sprout(24, 14), 24, 14)}`;

function onionRing(cx: number, cy: number, r: number) {
  return `<g transform="translate(${R(cx)} ${R(cy)})">
    <circle r="${R(r)}" fill="${P.onion.dark}"/>
    <circle cy="-0.4" r="${R(r - 1.2)}" fill="${P.onion.base}"/>
    <circle cy="-0.4" r="${R(r - 3)}" fill="${P.onion.ring}"/>
    <circle cy="-0.4" r="${R(r - 5)}" fill="${P.onion.flesh}"/>
    <circle cy="-0.4" r="${R(r - 6.8)}" fill="${P.onion.ring}"/>
    <circle cy="-0.4" r="${R(r - 8.2)}" fill="${P.onion.dark}"/>
    <path d="M${R(-r + 2)} -2A${R(r - 2)} ${R(r - 2)} 0 0 1 -2 ${R(-r + 2)}"
      fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>
  </g>`;
}

const onionCut = `
  ${ground(24, 18)}
  ${onionRing(32.5, 17.5, 13.4)}
  ${onionRing(18.5, 30.5, 16.4)}`;

// ------------------------------------------------------------------ potato

const potatoRaw = `
  ${ground(24, 18)}
  ${grow(1.22, `<ellipse cx="24" cy="29" rx="18" ry="13.4" fill="${P.potato.dark}" transform="rotate(-11 24 29)"/>
  <ellipse cx="23" cy="27" rx="16" ry="11.4" fill="${P.potato.skin}" transform="rotate(-11 23 27)"/>
  <ellipse cx="22" cy="25.5" rx="13.6" ry="9.2" fill="${P.potato.base}" transform="rotate(-11 22 25.5)"/>
  <g fill="${P.potato.eye}" opacity=".8">
    <ellipse cx="16" cy="24" rx="2" ry="1.4" transform="rotate(-20 16 24)"/>
    <ellipse cx="27" cy="22" rx="1.7" ry="1.2"/>
    <ellipse cx="30" cy="31" rx="2.1" ry="1.4" transform="rotate(24 30 31)"/>
  </g>
  <ellipse cx="17" cy="21" rx="4.6" ry="2.5" fill="${P.potato.hi}" opacity=".75" transform="rotate(-24 17 21)"/>`, 24, 28)}`;

const friesOf = (c: { base: string; dark: string; hi: string }) => `
  ${ground(24, 18)}
  ${grow(1.26, `${stick(7, 32, 30, 8, -8, c.dark, c.base)}
  ${stick(11, 23, 30, 8, 6, c.base, c.hi)}
  ${stick(8, 14, 30, 8, -14, c.base, c.hi)}`, 24, 27)}`;

const potatoCut = friesOf(P.raw);
const potatoCooked = friesOf(P.fries);

// --------------------------------------------------------------------- egg
//
// White shells, orange yolk — the prop's trick, because three orange ovoids
// were three orange potatoes at thumbnail.

const eggRaw = `
  ${ground(24, 17)}
  ${grow(1.28, `<ellipse cx="16" cy="27" rx="8.6" ry="11" fill="${P.egg.shellD}" transform="rotate(-10 16 27)"/>
  <ellipse cx="16" cy="26" rx="7.8" ry="10.2" fill="${P.egg.shell}" transform="rotate(-10 16 26)"/>
  <ellipse cx="30" cy="29" rx="10" ry="12.6" fill="${P.egg.shellD}" transform="rotate(8 30 29)"/>
  <ellipse cx="30" cy="28" rx="9.1" ry="11.7" fill="${P.egg.shell}" transform="rotate(8 30 28)"/>
  <ellipse cx="26.5" cy="21" rx="3.6" ry="2.2" fill="#fff" opacity=".85" transform="rotate(-24 26.5 21)"/>`, 24, 28)}`;

const eggCooked = `
  ${ground(24, 18)}
  ${grow(1.26, `<path d="M9 29c-4-5-1-12 5-13 1-6 9-9 14-5 5-4 12 0 12 6 5 2 6 9 2 12 2 5-3 10-8 8-3 4-10 4-13 0-6 2-12-3-12-8z"
    fill="${P.egg.shellD}"/>
  <path d="M10 27.6c-3.6-4.6-.9-11 4.6-12 .9-5.6 8.3-8.4 13-4.6 4.6-3.7 11.2 0 11.2 5.6 4.6 1.8 5.6 8.4 1.8 11.2 1.8 4.6-2.8 9.3-7.4 7.4-2.8 3.7-9.3 3.7-12 0-5.6 1.8-11.2-2.8-11.2-7.6z"
    fill="${P.egg.white}"/>
  <circle cx="25" cy="26" r="9" fill="${P.egg.yolkD}"/>
  <circle cx="25" cy="25.4" r="7.6" fill="${P.egg.yolk}"/>
  <ellipse cx="21.6" cy="21.8" rx="3" ry="2" fill="#fff" opacity=".7" transform="rotate(-30 21.6 21.8)"/>`, 24, 24)}`;

// -------------------------------------------------------------------- rice
//
// A BOWL of rice, in the same blue bowl the prop stands in — the only cool
// object in the room, which is the whole reason rice is legible at all.

const grains = (fill: string, hi: string) => {
  const pts: [number, number, number][] = [
    [16, 26, -20],
    [24, 23, 12],
    [32, 26, 26],
    [20, 20, -8],
    [28, 19, 20],
    [13, 22, 34],
    [35, 22, -32],
  ];
  return pts
    .map(
      ([x, y, r]) =>
        `<g transform="rotate(${r} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.8" fill="${fill}"/><ellipse cx="${x - 1}" cy="${y - 0.8}" rx="2.8" ry="1.3" fill="${hi}"/></g>`,
    )
    .join('');
};

const riceRaw = `
  ${ground(24, 18)}
  ${grow(1.2, `<path d="M8 27c0-8.4 7-14 16-14s16 5.6 16 14z" fill="${P.rice.dark}"/>
  ${grains(P.rice.base, '#fff')}
  <path d="M5 27h38c0 7-5.4 13-12 13H17c-6.6 0-12-6-12-13z" fill="${P.rice.bowlD}"/>
  <path d="M5 27h38c0 2-.3 3.4-.8 4.6H5.8C5.3 30.4 5 29 5 27z" fill="${P.rice.bowl}"/>`, 24, 28)}`;

const riceCooked = `
  ${ground(24, 18)}
  ${grow(1.2, `
  <g stroke="#cfe6ef" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".9">
    <path d="M17 11c-2-3 2-4 0-7"/><path d="M24 8c-2-3 2-4 0-7"/><path d="M31 11c-2-3 2-4 0-7"/>
  </g>
  <path d="M8 27c0-8.4 7-14 16-14s16 5.6 16 14z" fill="${P.rice.dark}"/>
  ${grains('#fffdf8', '#fff')}
  <path d="M5 27h38c0 7-5.4 13-12 13H17c-6.6 0-12-6-12-13z" fill="${P.rice.bowlD}"/>
  <path d="M5 27h38c0 2-.3 3.4-.8 4.6H5.8C5.3 30.4 5 29 5 27z" fill="${P.rice.bowl}"/>`, 24, 28)}`;

// -------------------------------------------------------------------- fish

const fishRaw = `
  ${ground(24, 18)}
  ${grow(1.22, `<path d="M41 15c-6 1-9 4-11 6-7-4-16-3-21 3-3 3-3 7 0 10 5 6 14 7 21 3 2 2 5 5 11 6-2-5-2-8-2-11s0-6 2-11z"
    fill="${P.fish.dark}"/>
  <path d="M9 24c5-6 14-7 21-3-2 3-3 6-3 8H9z" fill="${P.fish.base}"/>
  <path d="M12 26c4-4 10-5 15-3" fill="none" stroke="${P.fish.hi}" stroke-width="2" stroke-linecap="round" opacity=".9"/>
  <circle cx="15" cy="22" r="2.8" fill="#fff"/><circle cx="15.6" cy="22.2" r="1.5" fill="#2b3d4a"/>`, 24, 26)}`;

const fishCooked = `
  ${ground(24, 18)}
  ${grow(1.24, `<path d="M9 31c-2-8 4-16 13-18 8-2 16 2 18 9 1 6-4 12-12 14-8 2-17-1-19-5z" fill="${P.fish.cookedD}"/>
  <path d="M11 28c-1-7 4-13 12-15 7-2 14 1 16 7 1 5-4 10-11 12-7 2-16-.5-17-4z" fill="${P.fish.cooked}"/>
  <g stroke="${P.fish.cookedD}" stroke-width="2.4" stroke-linecap="round" opacity=".8">
    <path d="M15 31l7-11"/><path d="M23 33l7-11"/><path d="M31 32l5-8"/>
  </g>
  <ellipse cx="17" cy="19" rx="4.4" ry="2.4" fill="#ffdfa0" opacity=".7" transform="rotate(-26 17 19)"/>`, 24, 26)}`;

// ---------------------------------------------------------------- assembly

type Art = Partial<Record<PrepState, string>> & { raw: string };

const ART: Record<IngredientKind, Art> = {
  tomato: { raw: tomatoRaw, prepped: tomatoCut },
  lettuce: { raw: lettuceRaw, prepped: lettuceCut },
  bacon: { raw: baconRaw, cooked: baconCooked },
  bun: { raw: bun },
  cheese: { raw: cheeseRaw, prepped: cheeseCut },
  potato: { raw: potatoRaw, prepped: potatoCut, cooked: potatoCooked },
  onion: { raw: onionRaw, prepped: onionCut },
  egg: { raw: eggRaw, cooked: eggCooked },
  rice: { raw: riceRaw, cooked: riceCooked },
  fish: { raw: fishRaw, cooked: fishCooked },
};

// -------------------------------------------------------------- prep chits
//
// The verb, named outright. Silhouette-only differentiation was the stated rule
// and it does not survive 45px: a raw bun and a cooked bun are the same dome,
// and a ticket that reads `bun:raw, bacon:cooked, lettuce:prepped,
// tomato:prepped` as four undifferentiated groceries is a ticket you cannot
// act on. Each chit is a filled disc with a cream keyline so it reads against
// both the white balloon and the food it overlaps.

// A CHIT IS A DISC WITH A CREAM KEYLINE, and its VALUE and hue carry the verb.
// Two dead ends before this: cream discs with the symbol drawn on them, where
// on a 393px phone the blade was sub-pixel and the chit read as a grey smudge;
// and steel blue for chop, which was the only cool colour in an entirely warm
// room, sat directly on the food, and out-saturated the tomato it was
// annotating. The room is warm, so the chits are warm: dark roast brown means
// chop, ember orange means cook. They separate by value, not by temperature,
// and neither can steal the saturation crown from a tomato.

// SIZE FIRST, DETAIL SECOND.
//
// The last round shipped this at `width: calc(var(--icon) * 0.27)` with no
// floor, which solves to 10px on iPhone landscape and 14px on portrait, and a
// dark-roast-brown disc at 10px on top of a red tomato is a rivet, not a badge.
// styles.css now floors both chits at 20 CSS px and the glyphs below were
// re-drawn to survive that floor: a cleaver silhouette that spans 80% of the
// disc instead of a 11x8 blade with a separate handle rect, and a flame with
// two masses instead of three. Anything that needed more than two shapes to
// read has been thrown away.
// ONE CONSTRUCTION FOR ALL THREE BADGES.
//
// The three chits used to be three different design languages sharing one
// corner slot: a dark-roast-brown disc with a three-colour rotated knife, an
// ember disc with a three-mass flame, and a green disc with one fat cream tick.
// Only the tick ever read, and the reason is obvious once they are side by
// side — the tick is ONE cream shape filling most of a saturated disc, and the
// other two were fiddly. So all three are now that: a cream keyline, a
// saturated warm disc, and exactly one chunky cream glyph spanning ~80% of it.
// They separate by HUE (amber / ember / green) and by glyph, never by detail.
const chit = (cls: string, fill: string, glyph: string) =>
  `<svg class="chit ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="11.4" fill="#fff8ec"/>
  <circle cx="12" cy="12" r="9.7" fill="${fill}"/>
  ${glyph}
</svg>`;

const CHIT_KNIFE = chit(
  'chit-prep',
  '#a86a22',
  // Inset well clear of the disc rim. The first cut of this ran the blade out
  // to x=2.4 on a 24-unit box, which is OUTSIDE the r=9.7 disc — so the cream
  // blade fused with the cream keyline and the whole chit came out as a swirl.
  `<g transform="rotate(-18 12 12)" fill="#fffdf4">
    <path d="M4.9 7.9h8.3v5.9a2.4 2.4 0 0 1-2.4 2.4H4.9z"/>
    <rect x="12.6" y="9.1" width="6.9" height="3.5" rx="1.75"/>
  </g>`,
);

const CHIT_FLAME = chit(
  'chit-cook',
  '#d2450b',
  `<path d="M12 2.2c4.8 4 7.3 7.8 7.3 11.5A7.3 7.3 0 0 1 4.7 13.9c0-2.5 1.3-5 3.9-7.4.3 2 1.1 3.2 2.4 3.7-.3-3 .2-5.7 1-8z" fill="#fff3d2"/>
  <path d="M12 10.2c2 2 3 3.6 3 5.1a3 3 0 0 1-6 0c0-1.4 1-3 3-5.1z" fill="#d2450b"/>`,
);

const CHIT: Partial<Record<PrepState, string>> = {
  prepped: CHIT_KNIFE,
  cooked: CHIT_FLAME,
  burnt: CHIT_FLAME,
};

/**
 * AND IT ONLY APPEARS WHEN IT SAYS SOMETHING.
 *
 * This is the fix the header comment at the top of this file has been circling
 * for three rounds. The chit exists because "a raw bun and a cooked bun are the
 * same dome" — true in general, and false for the menu we actually ship. Walk
 * RECIPES: tomato is asked for `prepped` and never anything else, lettuce the
 * same, bacon is always `cooked`, bun is always `raw`. Not one ticket in the
 * game is ambiguous, so every chit on every balloon was carrying exactly zero
 * bits — and paying for it with a 20px disc stuck on top of the one thing the
 * player has to read. At 393px portrait that disc is 42% of the icon it is
 * annotating. The reference's balloons carry food and nothing else, and with
 * this menu so do ours.
 *
 * It is computed, not hardcoded, so the moment content.ts adds a recipe that
 * wants a raw tomato next to a prepped one, both tomatoes get their chit back.
 */
const AMBIGUOUS: Set<IngredientKind> = (() => {
  const seen = new Map<IngredientKind, Set<PrepState>>();
  for (const r of RECIPES) {
    for (const c of r.components) {
      const set = seen.get(c.kind) ?? new Set<PrepState>();
      set.add(c.state);
      seen.set(c.kind, set);
    }
  }
  const out = new Set<IngredientKind>();
  for (const [kind, states] of seen) if (states.size > 1) out.add(kind);
  return out;
})();

/**
 * The tick that replaces the verb chit once the plate carries the component.
 * It takes the chit's own slot rather than a second corner, and its green is
 * pulled down and warmed from #4a9a24: on a finished ticket the old one was the
 * most saturated pixel on a card whose entire job is to make food the most
 * saturated thing in the frame.
 */
const CHECK = `<span class="done" aria-hidden="true">
  <svg viewBox="0 0 24 24" focusable="false">
    <circle cx="12" cy="12" r="11.4" fill="#fff8ec"/>
    <circle cx="12" cy="12" r="9.7" fill="#4c7a29"/>
    <path d="M6.4 12.4 10.4 16.2 17.6 7.6" fill="none" stroke="#fdf6e4" stroke-width="3.4"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</span>`;

/**
 * One ticket item: the ingredient at the state the order asks for, the verb
 * chit that names how to get there, and a tick slot the HUD flips on once the
 * plate already carries it.
 */
export function ingredientItem(
  kind: IngredientKind,
  state: PrepState,
  label: string,
  ix = 0,
  iy = 0,
): string {
  const art = ART[kind];
  const body = art[state] ?? art.raw;
  // WHICH CORNER THE VERB BADGE HANGS IN.
  //
  // The cluster puts one icon up-left and the next down-right, so a badge pinned
  // to the bottom-right of every tile lands in the DEAD CENTRE of the balloon,
  // between the two foods — the second-loudest event on a card that is supposed
  // to be food and nothing else. Left-hand tiles hang theirs on the left instead,
  // so both badges sit on the balloon's outer edge and the middle stays clear.
  const side = ix < 0.4 ? ' badge-l' : '';
  const verb = AMBIGUOUS.has(kind) ? (CHIT[state] ?? '') : '';
  return `<span class="item${side}" role="img" aria-label="${label}" style="--ix:${ix};--iy:${iy}">
    <svg class="ico" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>
    ${verb}
    ${CHECK}
  </span>`;
}
