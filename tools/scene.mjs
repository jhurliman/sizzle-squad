/**
 * PHOTOGRAPH A SPECIFIC SITUATION — you cannot improve what you cannot see.
 *
 *   node tools/scene.mjs                    every scenario
 *   node tools/scene.mjs --only fire        one of them
 *   node tools/scene.mjs --list             what there is
 *   node tools/scene.mjs --out shots/x      somewhere else
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
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
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
      freezeBots: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 0 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'fire-spreading',
    about: 'the same pan left alone — fire 0.55, half way to catching',
    scene: {
      freezeBots: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'burnt' }], fire: 0.55 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'fire-both-burners',
    about: 'both burners ruined and near catching — the worst the arch can look',
    scene: {
      freezeBots: true,
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
      freezeBots: true,
      stations: [{ cell: BURNER_L, pan: [{ kind: 'bacon', state: 'raw' }], fire: 0 }],
    },
    look: mid(BURNER_L, 1.0),
    span: 3.2,
  },
  {
    name: 'burnt-food-in-hand',
    about: 'the ruined rasher out of the pan — it used to be invisible against the iron',
    scene: {
      freezeBots: true,
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
    name: 'wall-clearance',
    about: 'the chef pressed into the left wall — the door and rubble used to cut through them',
    scene: {
      freezeBots: true,
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
  const box = await page.evaluate(
    ({ look, span }) => {
      const c = window.__game.project(look);
      const edge = window.__game.project({ x: look.x + 1, y: look.y, z: look.z });
      const pxPerUnit = Math.max(8, Math.abs(edge.x - c.x));
      return { cx: c.x, cy: c.y, half: Math.round((span / 2) * pxPerUnit) };
    },
    { look: sc.look, span: sc.span },
  );

  const left = Math.max(0, Math.min(W - 32, box.cx - box.half));
  const top = Math.max(0, Math.min(H - 32, box.cy - Math.round(box.half * 0.78)));
  const width = Math.min(W - left, box.half * 2);
  const height = Math.min(H - top, Math.round(box.half * 1.56));
  const crop = path.join(OUT, `${sc.name}.png`);
  // Nearest-neighbour on the way up: this is for judging shapes and colours,
  // and a smooth resample invents gradients that are not in the render.
  await sharp(full).extract({ left, top, width, height }).resize(width * 2, height * 2, { kernel: 'nearest' }).toFile(crop);

  console.log(
    `  ${sc.name.padEnd(20)} ${errors.length ? `${errors.length} CONSOLE ERROR(S): ${errors[0]}` : 'clean'}` +
      `  crop ${width}x${height} at (${left},${top})`,
  );
  console.log(`  ${''.padEnd(20)} ${sc.about}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\nwrote ${wanted.length * 2} file(s) to ${path.relative(ROOT, OUT)}/  — open the .png crops and LOOK at them.`);
