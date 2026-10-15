# Package 3 — Photo storage design (for review, nothing built yet)

**Goal:** an inspector can upload 500+ photos, and a reviewer can open them, without either waiting on — or being broken by — Egnyte's request limit, while Egnyte stays the office's filing system.

## 1. The problem, with numbers

Egnyte allows about **2 API requests per second** on this account. The server spaces every Egnyte call 550 ms apart (`egnyteFetch`), and that one budget is shared by **everything**:

| Activity | Egnyte calls | Effect |
|---|---|---|
| Each photo uploaded | 2 (compressed copy + original), plus folder checks | ~1.15 s per photo, measured. 540 photos ≈ 10–11 min. |
| Each photo viewed (review portal, report, PDF) | 1 (first view; then a 100 MB in-memory cache) | 500 photos opened for the first time ≈ 4+ min. |
| Every inspector and reviewer at the same time | all share the same 2/s | 10 inspectors uploading together ≈ 1 photo/s **in total**. |

So the ceiling is roughly **3,000 photos an hour for the whole company**, uploads and viewing combined, and one big review or PDF export slows every inspector's upload. The load test confirmed the ceiling is Egnyte's pacing, not the phone or the server.

## 2. Options

**A. Ask Egnyte for a higher API rate** (no code). Egnyte sets this per account/plan; it may be raised or bought. Fastest and cheapest to try, but it only moves the ceiling, and uploads/reads still wait on a third party. *Worth asking regardless.*

**B. Store photos ourselves first, mirror to Egnyte in the background (recommended).**
Photos are saved in storage we control; the phone gets its "stored" answer from there; a background worker copies each photo into the correct Egnyte job folder at Egnyte's pace. The review portal, reports and PDFs read from our storage. Egnyte still ends up with every file, named and filed exactly as today.

**C. Replace Egnyte for photos entirely.** Simplest architecture, but the office works from Egnyte job folders today (the V26xxxx batch layout, hand-made folders, files renamed there). Not recommended unless the office wants to stop using it.

## 3. Where "our storage" lives (decision needed)

| Choice | Pros | Cons | Rough cost* |
|---|---|---|---|
| **S3-compatible bucket** (Cloudflare R2, AWS S3, Backblaze B2) | Built for this; unlimited; direct uploads from the phone possible; cheap; separate from the app server | A new account and secrets to manage | ≈ $0.015–0.023 per GB-month (R2 has no download fees) |
| **Supabase Storage** (already in the project's history) | Already known to the team; bucket + CDN | Tied to Supabase plan limits | Included allowance, then per GB |
| **Railway volume** | No new vendor | Attached to one server (no scaling out, no CDN), small by default, backups are on us | ≈ $0.25 per GB-month |
| **Postgres (photo bytes in the DB)** | None | Bloats the database; slows everything; do not do this | — |

*Approximate, from memory — confirm current prices before deciding.* Sizing: a photo is about **250 KB compressed + ~3 MB original**, so 1,000 photos ≈ 0.25 GB + 3 GB. 100 inspections of 300 photos ≈ 7.5 GB compressed + 90 GB originals.

**Recommendation:** an S3-compatible bucket (Cloudflare R2 or S3), private, accessed only through our API.

## 4. Proposed design (Option B)

**Upload path**
1. Phone sends the photo to the API exactly as today (same retry, same idempotent `photoId`, same numbering).
2. The API saves **compressed copy + a ~320 px thumbnail + the original** to the bucket, records the photo row (`provider = bucket`, keys), and answers the phone. No Egnyte call on this path → upload speed is limited by the network and the server's image work (~0.3–0.5 s), not by Egnyte.
3. The same step writes an **outbox row** per file: "copy to Egnyte path X".

**Egnyte mirror worker** (runs in the existing scheduler, one instance via the lease)
- Takes outbox rows, resolves the job folder (the existing `egnyteJobFolders` rules, unchanged), uploads at ≤ 2/s, retries with back-off, marks `done` / `failed`.
- If Egnyte is slow or down, nothing the inspector or reviewer does is affected; the backlog drains afterwards.
- The Troubleshoot page shows "waiting to copy to Egnyte: N" and alerts if it grows.
- A job-number change or office rename simply re-targets the pending/finished copies (the existing settle/move logic applies to the Egnyte side only).

**Read path**
- `/api/v1/media/:id` serves from the bucket (or a signed redirect to it) with `immutable` caching; `?size=thumb` serves the thumbnail. The review portal grids and report previews use thumbnails; full size on click. PDFs read from the bucket, so a 500-photo export no longer takes minutes of Egnyte reads.
- Old photos (still only in Egnyte) keep working through the current path until migrated.

**Data model** (additive): on `photos` add `provider`, `bucketKey`, `thumbKey`, `egnyteStatus` (`pending|done|failed`), `egnyteMirroredAt`; new `photo_outbox` table (or use `egnyteStatus` + an index).

## 5. Migration and rollout (each step reversible)

1. **Add** the columns/table and the bucket; deploy with the new path **switched off** (feature flag). No behaviour change.
2. **Dual-write for new uploads** to bucket + outbox while still serving reads from Egnyte; verify counts match (the Troubleshoot page already reconciles uploads vs inspections).
3. **Switch reads** to the bucket for photos that have a bucket copy; Egnyte remains the fallback.
4. **Backfill** the existing ~860 photos (one throttled script; they are already in Egnyte) so everything has a thumbnail and bucket copy.
5. Re-run the 540-photo test and a 500-photo PDF export against the real setup.

**Rollback:** turn the flag off; uploads go back to Egnyte-direct; nothing is deleted at any step.

## 6. Risks and how they are covered

- **Photo exists in the bucket but never reaches Egnyte** → outbox with retries, a visible backlog counter, an admin alert, and a reconcile script (lists bucket photos with no Egnyte file).
- **Two copies drift** (someone edits or deletes in Egnyte) → Egnyte is treated as a mirror; the app's copy is the record. Office edits in Egnyte do not flow back (same as today, where the app never reads edits back).
- **New secret/vendor outage** → reads fall back to Egnyte for mirrored photos; uploads queue on the phone as now.
- **Cost surprise** → originals are the bulk (~90% of bytes); a lifecycle rule can move them to cheaper storage after N days.
- **Privacy** → bucket private, access only via the API (the media route's existing signed-link rules stay).

## 7. Effort (honest estimate)

About **4–6 working days** including the migration script and re-testing: storage layer + outbox/worker (2–3), thumbnails + portal/report changes (1), migration + tests with the load rig (1–2). Option A (ask Egnyte) takes minutes to ask and can run in parallel.

## 8. Decisions needed

1. Go with **Option B**? (or A only, or B after A's answer)
2. Which storage: **Cloudflare R2 / AWS S3 / Supabase / Railway volume**?
3. Who creates the bucket account and secrets (I can't enter credentials)?
4. Keep **originals** for how long, and should they live in the bucket, Egnyte, or both?
5. Is it acceptable for the Egnyte copy to appear a few minutes after upload (not instantly)?
