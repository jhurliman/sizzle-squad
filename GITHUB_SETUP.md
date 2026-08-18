# Getting this into a new GitHub repo

The bundle is `sizzle-squad.tar.gz`. It contains source, tools, reference
images and docs — no `node_modules/`, no `dist/`, no `shots/`. Everything in it
is meant to be committed.

## 1. Unpack

```bash
tar -xzf sizzle-squad.tar.gz
cd sizzle-squad
```

You should see `src/`, `tools/`, `refs/`, `progress/`, `public/`,
`index.html`, `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `.gitignore`, and the four docs: `README.md`, `HANDOFF.md`,
`AGENTS.md`, `REFERENCE.md` (plus `WAVE1_VERDICTS.md`).

## 2. Confirm it builds before you commit anything

```bash
npm install
npm run check      # tsc --noEmit — must be clean
npm run build      # vite build — must succeed
npm run dev        # open the printed URL and play it
```

Node 20 or newer.

## 3. Create the repo

### With the GitHub CLI (easiest)

```bash
git init -b main
git add -A
git commit -m "Sizzle Squad: initial import"

gh repo create sizzle-squad --private --source=. --remote=origin --push
```

Swap `--private` for `--public` if you want it public. `gh auth login` first if
you have not authenticated on this machine.

### Without the CLI

Create an empty repo at <https://github.com/new> — **no** README, **no**
.gitignore, **no** license, since the bundle already has them — then:

```bash
git init -b main
git add -A
git commit -m "Sizzle Squad: initial import"
git remote add origin git@github.com:<you>/sizzle-squad.git
git push -u origin main
```

## 4. Sanity check what you committed

```bash
git ls-files | wc -l          # expect roughly 100-110 files
du -sh .git                   # expect a couple of MB, not hundreds
git ls-files | grep -c node_modules   # must be 0
```

If `node_modules/` or `shots/` made it in, the `.gitignore` did not apply —
`git rm -r --cached node_modules shots` and recommit.

## 5. Optional: publish the build to GitHub Pages

The game is a static site, so Pages works with no server. Add
`.github/workflows/pages.yml`:

```yaml
name: Deploy to Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

Then in **Settings → Pages**, set Source to **GitHub Actions**.

One gotcha: Pages serves from `/<repo-name>/`, not the domain root. Set the
base path in `vite.config.ts`:

```ts
export default defineConfig({ base: '/sizzle-squad/' })
```

Use the real repo name. Skip this if you deploy anywhere that serves from root
(Netlify, Vercel, Cloudflare Pages, or your own host — all of them just need
`npm run build` and the `dist/` directory).

## 6. A note on the reference images

`refs/dash-and-dine-*.jpeg` are screen captures of *Super Mario Party* used as
the internal quality bar for the critic loop. They are Nintendo's, not ours.
Nothing derived from them ships in the game — the cast, the set and every asset
are original and generated at runtime. If you make the repo public, consider
moving `refs/` out of version control and keeping it local, and pointing
`REFERENCE.md` at wherever you store it.
