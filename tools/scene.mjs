/**
 * PHOTOGRAPH A SPECIFIC SITUATION — you cannot improve what you cannot see.
 *
 *   node tools/scene.mjs                    every scenario
 *   node tools/scene.mjs --only fire        one of them
 *   node tools/scene.mjs --list             what there is
 *   node tools/scene.mjs --out shots/x      somewhere else
 *   node tools/scene.mjs --strip 6          a contact sheet over time, for MOTION
 *
 * THE GAP THIS FILLS. shoot.mjs photographs whatever the game happens to be
 * doing. That is the right instrument for composition and for the HUD, and it
 * is useless for anything rare: the skillet fire shipped unphotographed because
 * food reaches 'burnt' about twice in twelve minutes of bot play and a bot
 * clears it inside two seconds. The only picture ever taken of it came from
 * editing world.ts to force the state and reverting afterwards — which leaves
 * nothing behind, cannot be re-run, and is indistinguishable from a claim.
 *
 * So the state is ASKED FOR (`__game.setScene`, see main.ts) rather than waited
 * for, the bots are parked so they cannot tidy it away before the shutter
 * opens, and the crop FOLLOWS the subject: every frame here is centred by
 * projecting a world point through the live camera (`__game.project`), so a
 * scenario keeps framing the burner after the next camera round moves the lens.
 * Every hand-typed pixel rectangle in this project's history went stale that
 * way; none of these can.
 *
 * ONE FRAME CANNOT JUDGE AN ANIMATION. The skillet fire licks, sways, smokes
 * and throws embers, and a single still says nothing about any of it — it can
 * only show one instant, which is exactly how a fire that merely wobbles passes
 * for a fire that moves. `--strip N` therefore shoots the same crop N times a
 * fifth of a second apart and tiles them left to right, so what changes between
 * frames is visible as a strip rather than having to be remembered.
 *
 * These are pictures for a human to look at, not assertions. `npm test` covers
 * what a machine can judge; this covers the half that needs eyes.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    // A valueless flag is TRUE, including the last one on the line. `?.` made
    // a trailing `--list` evaluate to undefined, so the documented invocation
    // `node tools/scene.mjs --list` skipped the listing branch and photographed
    // all six scenarios instead.
    if (a.startsWith('--')) {
      const next = arr[i + 1];
      acc.push([a.slice(2), next === undefined || next.startsWith('--') ? true : next]);
    }
    return acc;
  }, []),
);

/** The burners, from KITCHEN_MAP row 1: '#DSS#=O=O=#S--#'. */
const BURNER_L = { x: 6, y: 1 };
const BURNER_R = { x: 8, y: 1 };
/**
 * Cells are addressed by their CORNER and drawn about their CENTRE. Aiming a
 * crop at the raw cell coordinate put half of every burner shot outside the
 * frame, which is the sort of thing that only shows up the moment you actually
 * look at the picture — the entire argument for this file.
 */
const mid = (c, z) => ({ x: c.x + 0.5, y: c.y + 0.5, z });

/**
 * A scenario is: what the kitchen should look like, and what to point at.
 *
 * `look` is a world point; the crop is centred on where it projects. `span` is
 * roughly how many world units wide the crop should cover, converted to pixels
 * against the live camera rather than assumed.
 */
const SCENES = [
  {
    name: 'fire-new',
    about: 'a rasher has just burned — the fire is at its smallest, which is the moment it has to read',
    scene: {
      freeze: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 0 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'fire-spreading',
    about: 'the same pan left alone — fire 0.55, half way to catching',
    scene: {
      freeze: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 0.55 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'fire-both-burners',
    about: 'both burners ruined and near catching — the worst the arch can look',
    scene: {
      freeze: true,
      stations: [
        { cell: BURNER_L, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 1 },
        { cell: BURNER_R, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 1 },
      ],
    },
    look: { x: 7.5, y: 1.5, z: 1.2 },
    span: 6.5,
  },
  {
    name: 'pan-cooking',
    about: 'a working burner for comparison — no fire, food part-cooked, cook dial up',
    scene: {
      freeze: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'raw' }], fire: 0 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'burnt-food-in-hand',
    about: 'the ruined rasher out of the pan — it used to be invisible against the iron',
    scene: {
      freeze: true,
      // FACING THE CAMERA. The first cut faced -y, away from the lens, and a
      // carried item rides on the chest — so the picture showed a chef's back
      // and proved nothing about the thing it was staged to examine. +y is
      // toward the front of the room, where the camera is.
      player: { at: { x: 7.5, y: 5.5 }, facing: { x: 0, y: 1 }, carrying: { kind: 'bacon', state: 'burnt' } },
    },
    look: { x: 7.5, y: 5.5, z: 0.95 },
    span: 2.4,
  },
  {
    name: 'plate-in-hand',
    about: 'ONE plate, not the comedy tower — a plate pickup used to hand over an armful of up to eight',
    scene: {
      freeze: true,
      player: { at: { x: 7.5, y: 5.5 }, facing: { x: 0, y: 1 }, carrying: null, plate: true },
    },
    look: { x: 7.5, y: 5.5, z: 1.05 },
    span: 3.0,
  },
  {
    name: 'wall-clearance',
    about: 'the chef pressed into the left wall — the door and rubble used to cut through them',
    scene: {
      freeze: true,
      player: { at: { x: 1.68, y: 5.9 }, facing: { x: -1, y: 0 }, carrying: null },
    },
    look: { x: 1.68, y: 5.9, z: 1.1 },
    span: 4.0,
  },
];

if (argv.list) {
  for (const s of SCENES) console.log(`  ${s.name.padEnd(20)} ${s.about}`);
  process.exit(0);
}

const OUT = path.join(ROOT, String(argv.out ?? 'shots/scenes'));
const only = argv.only && argv.only !== true ? String(argv.only) : null;
/** How many frames per scenario. 1 = a still; more = a contact sheet over time. */
const STRIP = argv.strip && argv.strip !== true ? Math.max(1, Number(argv.strip)) : 1;
/** Milliseconds between strip frames. Long enough to move, short enough to relate. */
const STRIP_GAP = 200;
const wanted = only ? SCENES.filter((s) => s.name.includes(only)) : SCENES;
if (!wanted.length) {
  console.error(`no scenario matches '${only}'. --list to see them.`);
  process.exit(1);
}

function serve(dir) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npx vite build` first.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const { server, port } = await serve(DIST);
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
});

const W = 1440;
const H = 900;
console.log(`\nstaging ${wanted.length} scenario(s) at ${W}x${H}\n`);

for (const sc of wanted) {
  // A fresh page per scenario: a staged scene is a mutation of a running game,
  // and letting one leak into the next is how a picture ends up showing
  // something nobody asked for.
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.start());
  // Let the room settle and the camera reach its pose before staging.
  await page.evaluate(() => window.__game.warp(3));
  await page.waitForTimeout(400);

  await page.evaluate((spec) => window.__game.setScene(spec), sc.scene);
  // A couple of rendered frames so the view picks the scene up — the flames and
  // dials are driven from the sim each frame, not at build time.
  await page.waitForTimeout(500);

  // Hide the DOM layers. They are photographed by shoot.mjs; here they only
  // cover the thing being examined.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.overlay, .bubbles, .hud, #hud, .topbar')) el.style.display = 'none';
  });
  await page.waitForTimeout(150);

  /**
   * DID THE GAME ACTUALLY ACCEPT THE SCENE?
   *
   * A staged position is a REQUEST, and the sim is entitled to refuse it: ask
   * for a chef inside a station cell and the collision push-out slides them
   * somewhere legal over the next few frames. The first `burnt-food-in-hand`
   * did exactly that — asked for (7.5, 4.6), which is inside the sink, and
   * photographed a chef at (7.94, 5.37) instead. The picture looked fine and
   * was of the wrong thing, which is the failure mode this whole file exists
   * to stop. So the request is checked against what the game settled on.
   */
  /**
   * AND DID THE STAGED NUMBERS SURVIVE TO THE SHUTTER?
   *
   * Parking the bots was not enough. The simulation kept stepping between
   * `setScene` and the screenshot, and a burnt pan's `fire` climbs by dt/9
   * every step — so `fire-new`, whose entire subject is the fire at zero,
   * photographed whatever zero had drifted to during the settle, and a contact
   * sheet spanning a second or more drifted further. The caption and the
   * subject had quietly parted company. `freeze` stops the sim; this checks
   * that it did, on the one number each scenario is actually about.
   */
  for (const want of sc.scene.stations ?? []) {
    if (want.fire === undefined) continue;
    const got = await page.evaluate(
      (cell) => window.__game.snapshot().stations.find((s) => s.cell.x === cell.x && s.cell.y === cell.y) ?? null,
      want.cell,
    );
    if (!got) {
      console.log(`  ${sc.name.padEnd(20)} SCENE REFUSED: no station at (${want.cell.x}, ${want.cell.y}).`);
    } else if (Math.abs(got.fire - want.fire) > 0.01) {
      console.log(
        `  ${sc.name.padEnd(20)} SCENE DRIFTED: asked for fire ${want.fire}, ` +
          `photographed ${got.fire} — is the sim still stepping?`,
      );
    }
  }

  if (sc.scene.player?.at) {
    const got = await page.evaluate(() => {
      const p = window.__game.snapshot().chefs.find((c) => c.isPlayer);
      return { x: p.x, y: p.y, carrying: p.carrying };
    });
    const drift = Math.hypot(got.x - sc.scene.player.at.x, got.y - sc.scene.player.at.y);
    if (drift > 0.15) {
      console.log(
        `  ${sc.name.padEnd(20)} SCENE REFUSED: asked for the chef at ` +
          `(${sc.scene.player.at.x}, ${sc.scene.player.at.y}), game settled at ` +
          `(${got.x}, ${got.y}) — ${drift.toFixed(2)} away. Standing inside geometry?`,
      );
    }
    if (sc.scene.player.carrying && !got.carrying) {
      console.log(`  ${sc.name.padEnd(20)} SCENE REFUSED: asked for a carried item, chef is empty-handed.`);
    }
  }

  const full = path.join(OUT, `${sc.name}-full.jpg`);
  await page.screenshot({ path: full, type: 'jpeg', quality: 94 });

  /**
   * FRAME BY PROJECTION, NOT BY MEMORY. Two points a known distance apart in
   * world space give the pixels-per-unit of the live lens, so `span` means the
   * same thing whatever the camera is currently doing.
   */
  const project = () =>
    page.evaluate(
      ({ look, span }) => {
        const c = window.__game.project(look);
        const edge = window.__game.project({ x: look.x + 1, y: look.y, z: look.z });
        const pxPerUnit = Math.max(8, Math.abs(edge.x - c.x));
        return { cx: c.x, cy: c.y, half: Math.round((span / 2) * pxPerUnit) };
      },
      { look: sc.look, span: sc.span },
    );

  const box = await project();
  // The frame SIZE is fixed by the first projection so every tile in a strip is
  // the same shape (sharp will not composite ragged tiles), but the OFFSET is
  // re-projected per frame below. The camera damper is still converging during
  // a strip, and the first cut let the subject slide across the contact sheet —
  // which reads as the fire moving when it is the lens that moved, exactly the
  // confusion the sheet was added to remove.
  const width = Math.min(W, box.half * 2);
  const height = Math.min(H, Math.round(box.half * 1.56));
  const corner = (b) => ({
    left: Math.max(0, Math.min(W - width, Math.round(b.cx - width / 2))),
    top: Math.max(0, Math.min(H - height, Math.round(b.cy - height * 0.5))),
  });
  const crop = path.join(OUT, `${sc.name}.png`);
  const scale = STRIP > 1 ? 1 : 2;

  // Nearest-neighbour on the way up: this is for judging shapes and colours,
  // and a smooth resample invents gradients that are not in the render.
  const shot = async (src, at) =>
    sharp(src).extract({ ...at, width, height }).resize(width * scale, height * scale, { kernel: 'nearest' }).toBuffer();

  const first = corner(box);
  if (STRIP === 1) {
    await sharp(await shot(full, first)).toFile(crop);
  } else {
    /**
     * A CONTACT SHEET, BECAUSE THE SUBJECT MOVES.
     *
     * The first frame is the one already on disk; the rest are taken live at
     * STRIP_GAP apart. Tiled left to right with a hairline between them, so a
     * flame that licks shows a tall frame among short ones and a flame that
     * merely breathes shows six of the same picture — which is precisely the
     * distinction a single still cannot make and the reason this exists.
     */
    // Every tile shot live, including the first. Reusing the `-full` frame for
    // tile one saved a screenshot and cost alignment: it was taken before the
    // scene guards ran, by which time the camera damper had moved on, so the
    // opening tile of every sheet sat a few pixels off from the rest.
    const tiles = [];
    for (let i = 0; i < STRIP; i++) {
      if (i) await page.waitForTimeout(STRIP_GAP);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
      tiles.push(await shot(buf, corner(await project())));
    }
    const tw = width * scale;
    const th = height * scale;
    const GAP = 4;
    await sharp({
      create: {
        width: tw * STRIP + GAP * (STRIP - 1),
        height: th,
        channels: 3,
        background: { r: 20, g: 20, b: 22 },
      },
    })
      .composite(tiles.map((input, i) => ({ input, left: i * (tw + GAP), top: 0 })))
      .png()
      .toFile(crop);
  }

  console.log(
    `  ${sc.name.padEnd(20)} ${errors.length ? `${errors.length} CONSOLE ERROR(S): ${errors[0]}` : 'clean'}` +
      `  crop ${width}x${height}${STRIP > 1 ? ` x${STRIP} frames` : ''}`,
  );
  console.log(`  ${''.padEnd(20)} ${sc.about}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\nwrote ${wanted.length * 2} file(s) to ${path.relative(ROOT, OUT)}/  — open the .png crops and LOOK at them.`);
