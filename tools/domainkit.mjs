/**
 * COMPILE src/domain (AND THE BOTS) STANDALONE, ONCE, FOR ANY TEST THAT WANTS THEM.
 *
 * Both test entry points need the same thing: the pure game, running in Node,
 * with no browser and no bundler. `src/domain/**` is pure by policy — no
 * three.js, no DOM, no wall clock, no unseeded Math.random — and `src/bots`
 * imports nothing but `src/domain`, so the whole simulation including its AI
 * compiles and runs here. That policy was written for determinism; this is the
 * file that spends it on testing.
 *
 * tsc is invoked with `--ignoreConfig` because tsconfig.json targets the app
 * (DOM libs, three.js paths) and would drag the renderer in.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} entries repo-relative .ts entry points
 * @returns {{ dir: string, load: (m: string) => Promise<any>, cleanup: () => void }}
 */
export function compileDomain(entries = ['src/domain/sim.ts']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domainkit-'));
  execFileSync(
    'npx',
    [
      'tsc',
      ...entries.map((e) => path.join(ROOT, e)),
      '--ignoreConfig',
      '--outDir',
      dir,
      '--module',
      'esnext',
      '--target',
      'es2022',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  // tsc emits extensionless relative imports; Node's ESM loader requires them.
  // The emitted tree mirrors the source tree, so walk it rather than assuming
  // everything landed in one flat directory (it does not once bots are in).
  const fix = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) fix(p);
      else if (e.name.endsWith('.js')) {
        fs.writeFileSync(
          p,
          fs.readFileSync(p, 'utf8').replace(/(from '(?:\.\.?\/)+[A-Za-z0-9_/]+)'/g, "$1.js'"),
        );
      }
    }
  };
  fix(dir);

  // Entries compile to a tree rooted at the common ancestor of the inputs, so
  // 'src/domain/sim.ts' lands at either 'domain/sim.js' or 'sim.js' depending
  // on whether the bots came along. Resolve by looking.
  const load = async (mod) => {
    const candidates = [
      path.join(dir, `${mod}.js`),
      path.join(dir, 'domain', `${path.basename(mod)}.js`),
      path.join(dir, `${path.basename(mod)}.js`),
    ];
    const hit = candidates.find((c) => fs.existsSync(c));
    if (!hit) throw new Error(`compiled module not found for '${mod}' under ${dir}`);
    return import(hit);
  };

  return { dir, load, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** An input snapshot that asks for nothing. */
export const NO_INPUT = {
  move: { x: 0, y: 0 },
  grabPressed: false,
  useHeld: false,
  dashPressed: false,
};

/** Small assertion recorder so every probe reports the same way. */
export function makeReport() {
  let failed = 0;
  return {
    get failed() {
      return failed;
    },
    section(title) {
      console.log(`\n=== ${title}`);
    },
    check(label, ok, extra = '') {
      if (!ok) failed++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra}`);
      return ok;
    },
    finish(what) {
      console.log(failed ? `\nFAIL: ${failed} ${what}` : `\nPASS: ${what}`);
      return failed ? 1 : 0;
    },
  };
}
