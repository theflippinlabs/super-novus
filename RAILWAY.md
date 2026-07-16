# Deploying SUPER NOVUS on Railway

This repo is preconfigured for a near one-click Railway deploy. After this PR
is merged to `main`, you only need to connect the repo and click Deploy.

## What's in the repo
- `railway.json` — Railway service config (Nixpacks builder, build command,
  start command, healthcheck on `/`, restart policy).
- `nixpacks.toml` — pins Node 20 and the install → build → start pipeline.
- `.node-version` — Node 20 (belt-and-suspenders with `engines` in package.json).
- `server.js` — zero-dependency static server for the Vite build (`dist/`),
  binds to `$PORT` on `0.0.0.0`, long-cache for hashed assets, no-cache HTML,
  path-traversal guarded. Run via `npm start`.
- `.railwayignore` — keeps the deploy context lean (excludes `reference/`,
  `test/`, `.github/`).

The pipeline Railway runs: `npm ci` → `npm run build` → `npm start`.

## One-click deploy (after merge)
1. https://railway.app → **New Project** → **Deploy from GitHub repo** →
   select `theflippinlabs/super-novus`, branch `main`.
2. Railway detects `railway.json` / `nixpacks.toml` and builds automatically.
   No build/start settings to fill in.
3. When the build finishes, open the generated `*.up.railway.app` URL →
   the menu loads → **CONTINUER EN INVITÉ** → the game runs immediately.
   Guest mode needs **zero** environment variables.
4. (Optional) **Settings → Networking → Generate Domain**, or add a custom
   domain (`supernovus.fun`) and set the DNS record Railway shows.

## Optional environment variables (wallet + leaderboard)
Set these in **Variables** only if you want wallet connect and the online
leaderboard (guest play works without them):
- `VITE_WC_PROJECT_ID` — WalletConnect Cloud project id
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key

These are build-time (`VITE_`-prefixed) — after changing them, trigger a
redeploy so they are baked into the bundle.

## CLI deploy (alternative)
```bash
npm i -g @railway/cli
railway login
railway link          # select the project
railway up            # build + deploy
```

## Local check (identical to what Railway serves)
```bash
npm run build
npm start             # serves dist/ on http://localhost:8080
```
