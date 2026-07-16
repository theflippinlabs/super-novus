# SUPER NOVUS — Deployment Runbook

This document lists the **exact commands** to take the project from this
repository to a live game on **https://supernovus.fun**.

Every step here requires *your* credentials (GitHub, Vercel, WalletConnect,
Supabase, your domain registrar). None of them can be executed from the
Claude conversation environment — it has no browser, no SSH, and no access
to those dashboards. That is a hard limitation, not a choice.

---

## 0. Prerequisites (one-time)
- Node.js 20+, npm 10+
- Accounts: GitHub, Vercel, WalletConnect Cloud, Supabase
- The domain `supernovus.fun` in a registrar you control
- `npm i -g supabase vercel`  (CLIs)

## 1. Local sanity check
```bash
npm install
npm run typecheck        # currently green for ported core; finish remaining modules first
npm run dev              # http://localhost:5173  → guest mode must launch
```

## 2. GitHub
```bash
git init
git add .
git commit -m "SUPER NOVUS v2 — initial modular project"
git branch -M main
git remote add origin git@github.com:theflippinlabs/super-novus.git
git push -u origin main
```
> Create the empty repo `theflippinlabs/super-novus` on GitHub first.

## 3. WalletConnect Cloud
1. https://cloud.walletconnect.com → New Project → name it "SUPER NOVUS".
2. Copy the **Project ID**.
3. Add `https://supernovus.fun` to the allowed domains.

## 4. Supabase
```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push                                  # applies migrations/0001_scores.sql
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase functions deploy submit-score --no-verify-jwt
```
Grab `Project URL` and `anon key` from Project Settings → API.

## 5. Vercel
```bash
vercel link                     # link to the GitHub repo / new project
# add env vars (Production):
vercel env add VITE_WC_PROJECT_ID production
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod                   # first production deploy
```

## 6. Domain → supernovus.fun
```bash
vercel domains add supernovus.fun
```
Then at your registrar, set the DNS records Vercel shows you, typically:
- `A`     `@`   → `76.76.21.21`
- `CNAME` `www` → `cname.vercel-dns.com`
Wait for propagation; Vercel issues the TLS cert automatically.

## 7. Verify live
- Open https://supernovus.fun → NOVARYS / SUPER NOVUS / Connect Wallet / Continue as Guest
- Guest mode launches instantly (works with zero env vars).
- With env vars set: wallet connect + score submission function.
- Append `?debug=1` to see FPS / draw calls / seed / wallet / network.

---

## What is NOT done yet (honest status)
The validated game core has been ported and typechecks, but the full spec
(9 split entity systems, NovaBlast, WalletManager, Leaderboard client, HUD,
Screens, GameEngine mediator) is **not fully implemented in this snapshot**.
See `STATUS.md` for the exact file-by-file state. Do not treat this as a
finished production build.
