# ACE SPECT — Quick Deploy Runbook

Stack: **Railway** (backend API + Postgres + Redis) · **Vercel** (web) · **EAS** (Android APK).

## ✅ Live deployment (deployed 2026-07-02)
| Piece | URL | Notes |
|---|---|---|
| Backend API | https://acespect-backend-production.up.railway.app | health: `/health`, API base: `/api/v1` |
| Web (reviewer/inspector) | https://acespect-web.vercel.app | Vercel project `anuka1/acespect-web` |
| Railway project | https://railway.com/project/2d8b8083-7911-41cb-a5d1-dec3f1f7dd53 | services: acespect-backend, Postgres, Redis |
| EAS project | https://expo.dev/accounts/anuka02/projects/acespect-mobile | Android preview APK build |

**Seeded logins:** inspector `jane@acespect.app / Inspect123` · reviewer `reviewer@acespect.app / Review123` · admin `admin@acespect.app / Admin123`.

**Known issues found + fixed during deploy** (now committed, so future deploys won't hit these):
1. `Dockerfile` was `node:20-alpine` — `@supabase/supabase-js`'s realtime client needs native `WebSocket`, which requires **Node ≥ 22**. Crashed on boot with a clear stack trace. Fixed: bumped both stages to `node:22-alpine`.
2. `railway.json`'s `startCommand` was a bare `"a && b"` string — Railway does not reliably shell-interpret un-wrapped `&&` chains, so `node dist/server.js` silently never ran after `prisma migrate deploy` finished (no crash, no log, container just sat there until Railway's healthcheck killed it as unresponsive). Fixed: wrapped explicitly as `sh -c "a && exec b"`.
3. `server.ts`'s storage-bucket check ran unguarded outside try/catch with no `.catch()` on `main()` — any thrown error there would die as a silent unhandled rejection. Fixed: full try/catch + `main().catch(...)` that always logs and exits non-zero.
4. `schema.prisma` had `sections`/`damages` tables + several `inspections`/`users` columns that were never captured in a migration (added via `db push` in a parallel session). `prisma migrate deploy` reported "up to date" while the live DB was actually missing them. Fixed: generated the missing migration via `prisma migrate diff` against the live DB, reviewed, applied, and committed it.

---

> This session can't run the logins for you. Run the commands below in a normal terminal.
> **Order matters:** deploy the backend first to get its URL, then plug that URL into the web + mobile.

---

## 0. Prereqs (one-time)
- Accounts: [Railway](https://railway.app), [Vercel](https://vercel.com), [Expo](https://expo.dev), [Supabase](https://supabase.com) (all free tier).
- CLIs: `npm i -g eas-cli vercel` (Railway is easiest via its web dashboard).
- Push this repo to GitHub (Railway + Vercel deploy from a repo). From the repo root:
  ```bash
  git add -A && git commit -m "Deploy configs" && git push
  ```

**Both Redis and real photo uploads are required for this deploy** — not optional. Redis backs the review queue that submit depends on; Egnyte is where inspection photos actually live (without it, any submit containing a photo fails).

---

## 1. Egnyte — photo storage (do this first)
1. In your Egnyte domain's admin console, register/locate a Public API application and generate a **long-lived API token** for it — this is `EGNYTE_API_TOKEN`. Never commit this value or paste it into chat; set it directly as an environment variable on the backend host.
2. `EGNYTE_DOMAIN` is just the subdomain part of your org's Egnyte URL (e.g. `houspect` for `houspect.egnyte.com`).
3. `EGNYTE_ROOT_FOLDER` is the folder inspection photos are stored under (default `/Shared/Inspection Photos`) — the backend creates it on boot if it doesn't exist.
4. Egnyte's own shareable links open a web viewer page rather than serving a raw image, so the app never hands out Egnyte URLs directly. The backend proxies photos itself at `GET /api/v1/media/:id` (public, no auth — same trust model the old Supabase public bucket had) using the token server-side; `PUBLIC_BASE_URL` must be set to this backend's own public URL so uploaded photos get a working link.

---

## 2. Backend + Postgres + Redis → Railway
1. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
2. On the created service → **Settings**:
   - **Root Directory:** `acespect-backend`  (uses its `Dockerfile` + `railway.json`)
   - Railway auto-runs `npx prisma migrate deploy && node dist/server.js` on start.
3. **+ New → Database → Add PostgreSQL**, then **+ New → Database → Add Redis** (same project) — **required**, the review queue (and therefore mobile submit) depends on it.
4. Backend service → **Variables** → add:
   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   JWT_ACCESS_SECRET=8e4b5792050bbfcca674902100f3414749f4f5c273fd5f9479da84f85d72f2de
   JWT_REFRESH_SECRET=35a0394e433b3653a98a58cc2df4734e85b11dd9e4589e20b8e58bda6c6277fc
   CORS_ORIGIN=*
   EGNYTE_DOMAIN=<subdomain from Egnyte step 1, e.g. houspect>
   EGNYTE_API_TOKEN=<long-lived API token from Egnyte step 1>
   EGNYTE_ROOT_FOLDER=/Shared/Inspection Photos
   PUBLIC_BASE_URL=<this backend's public URL, e.g. https://acespect-backend-production.up.railway.app>
   ```
   (`${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` are Railway reference variables — pick them from the dropdown, don't type them by hand.)
5. **Networking → Generate Domain**. Copy the URL, e.g. `https://acespect-backend-production.up.railway.app`.
   Your API base is that URL **+ `/api/v1`**.
6. **Seed users + one demo inspection** (once). Railway service → **⋯ → Run a command** (or `railway run` locally):
   ```bash
   npx tsx scripts/seedInspection.ts
   ```
   Creates: inspector `jane@acespect.app / Inspect123`, reviewer `reviewer@acespect.app / Review123`, admin `admin@acespect.app / Admin123`.
7. Verify:
   - `https://<backend>/health` → `{"status":"ok"}`
   - Railway → service → **Logs** → on boot you should see `✅ Database connected` and `✅ Photo storage ready (bucket "inspection-photos")`. If you instead see `⚠️ Photo storage disabled`, the Supabase vars are missing/wrong — fix and redeploy.

**Review worker** (processes the AI review queue — needed so submitted inspections get reviewed, not just stored): add a **second service** from the same repo, Root Directory `acespect-backend`, **Start Command** `node dist/worker/index.js`, same Variables. (AI itself is optional: leave `AI_SERVICE_URL` empty → the worker simulates the review instead of calling a real AI service.)

---

## 3. Web → Vercel
1. Vercel → **Add New → Project** → import this repo.
2. **Root Directory:** `acespect-web`  (Framework auto-detects **Vite**; build `npm run build`, output `dist`). `vercel.json` handles SPA routing.
3. **Environment Variables:**
   ```
   VITE_API_URL=https://<your-railway-backend>/api/v1
   ```
4. **Deploy.** Then copy the Vercel URL (e.g. `https://acespect-web.vercel.app`).
5. Back in Railway, set the backend `CORS_ORIGIN` to that Vercel URL (tighten from `*`) and redeploy.
6. Log in at the Vercel URL as `reviewer@acespect.app / Review123` → you should see the seeded inspection.

---

## 4. Mobile → Android APK via EAS
1. Put the backend URL into **`acespect-mobile/eas.json`** — replace both `REPLACE-WITH-RAILWAY-BACKEND` placeholders (in `preview` and `production`) with your real Railway backend, keeping the trailing `/api/v1`.
2. From `acespect-mobile`:
   ```bash
   eas login
   eas init          # creates the EAS project + fills extra.eas.projectId
   eas build -p android --profile preview
   ```
3. When it finishes (~10–20 min in Expo's cloud) you get an **APK download link**. Install it on any Android device (allow "install unknown apps").
4. In the app, log in as `jane@acespect.app / Inspect123`, complete an inspection with at least one photo, submit → it should appear in the Vercel web reviewer with the photo rendering (proves Redis + Supabase are both wired correctly).

> If the Android build fails on the WatermelonDB native step, it's not used at runtime (the app submits online, not via the local DB). Quick fix: remove `"@morrowdigital/watermelondb-expo-plugin"` and `"expo-build-properties"` from `app.json` → `plugins`, then rebuild.

---

## Env var reference (backend)
| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Railway Postgres reference |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✅ | ≥16 chars (generated values above) |
| `REDIS_URL` | ✅ | Railway Redis reference — mobile submit fails without it |
| `EGNYTE_DOMAIN` / `EGNYTE_API_TOKEN` | ✅ | from Egnyte step 1 — photo upload returns 503 without it |
| `EGNYTE_ROOT_FOLDER` | ✅ | `/Shared/Inspection Photos` — auto-created on boot if missing |
| `PUBLIC_BASE_URL` | ✅ | this backend's own public URL — used to build the /api/v1/media proxy links returned for uploaded photos |
| `CORS_ORIGIN` | recommended | set to the Vercel URL |
| `AI_SERVICE_URL` | optional | empty → worker simulates review |
| `PORT` | auto | Railway sets it; app defaults 4000 |

## Deploy order recap
Egnyte (photo storage creds) → backend (Railway, incl. Redis) → get backend URL → web `VITE_API_URL` (Vercel) + mobile `eas.json` URL → build web + APK.
