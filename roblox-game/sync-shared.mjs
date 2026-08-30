// Copies the shared simulation source (src/domain, src/bots) from the repo
// root into roblox-game/src/shared/ so rbxtsc compiles the exact code the web
// game ships. Run with --check to verify the copies are in sync (CI drift
// guard) without writing.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..');
const PAIRS = [
  [path.join(REPO, 'src/domain'), path.join(HERE, 'src/shared/domain')],
  [path.join(REPO, 'src/bots'), path.join(HERE, 'src/shared/bots')],
];
const check = process.argv.includes('--check');

let drift = 0;
for (const [from, to] of PAIRS) {
  fs.mkdirSync(to, { recursive: true });
  const wanted = new Set();
  for (const f of fs.readdirSync(from).filter((f) => f.endsWith('.ts'))) {
    wanted.add(f);
    const src = fs.readFileSync(path.join(from, f), 'utf8');
    const dstPath = path.join(to, f);
    const dst = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : null;
    if (src !== dst) {
      drift++;
      if (check) console.error(`DRIFT: ${path.relative(REPO, dstPath)} != ${path.relative(REPO, path.join(from, f))}`);
      else fs.writeFileSync(dstPath, src);
    }
  }
  for (const f of fs.readdirSync(to).filter((f) => f.endsWith('.ts'))) {
    if (!wanted.has(f)) {
      drift++;
      if (check) console.error(`DRIFT: stale ${path.relative(REPO, path.join(to, f))}`);
      else fs.rmSync(path.join(to, f));
    }
  }
}

if (check && drift) {
  console.error(`${drift} file(s) out of sync — run: npm run sync`);
  process.exit(1);
}
console.error(check ? 'shared source in sync' : `synced (${drift} file(s) updated)`);
