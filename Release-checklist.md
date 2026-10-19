# Release checklist — client deployment

Everything below was run against the final code (commit `46bd35f` and later). "Verified" = I ran it; "Not verified" = could not be tested from here.

## 1. What was verified

| Area | Check | Result |
|---|---|---|
| Phone → server | 540 photos, 13 sections, forced sign-in expiry, dropped connections, Egnyte errors injected | all stored once, receipt matched, every file (compressed + original) present |
| Phone → server | App killed mid-upload then reopened | only the remaining photos were sent |
| Phone → server | Server missing photos at submit | refused (409), phone re-sent them, accepted |
| Phone → server | Unreadable / corrupt photo | skipped and reported, the rest submitted |
| Phone → server | Section with > 200 photos | accepted (limit raised to 1,500) |
| Full chain | 8 Construction inspections (2 stages × house/apartment × good/issues): every field filled → submit → portal approval → PDF | 452 typed values checked in the PDFs, 0 missing |
| Portal | 1,565 inspections: list load / refocus / open one / PDF export with the new light list | 0.6 s / 19 ms / 12 ms / works |
| Security | An inspector asking for another inspector's inspection | 404 |
| Tests | Web suite 573 pass (1 known Windows-path failure, unrelated); backend + mobile + web type-checks clean | |

## 2. Not verified (needs a real device / real services)
- A real phone doing 500+ photos on mobile data, and the new section autosave and progress bar on screen (checked with the type-checker and the real upload/submit code, not by tapping).
- Reading a real iPhone HEIC photo (the reader loads and rejects bad input cleanly; no HEIC sample was available).
- The real Egnyte under load (a stand-in with the same 2-requests/second limit was used).
- Email alerts (SMTP not configured on the server yet).

## 3. Before the client uses it
1. **Phones:** close and fully reopen the app twice so it picks up the latest update. Check the version by taking one photo: a "Photos backed up: 1 / 1" bar should appear on the section screen.
2. **Job numbers:** must be `V` + 5–7 digits (e.g. `V267612`). Anything else (e.g. `VIC-22`) is parked in `_Unassigned` and the inspection is flagged in the portal.
3. **Egnyte:** confirm the batch folders (e.g. `V267601-V267700`) exist or can be created by the integration user.
4. **Set** `ALERT_EMAILS`, `MAIL_FROM`, `SMTP_URL` on the server (see the Troubleshoot page → "Send test email").
5. **Real-phone acceptance test (30 min):** one inspector, one real inspection with 100+ photos over mobile data. Afterwards open the portal → Troubleshoot: it should show no flagged inspections and no photos without an inspection.

## 4. Day-of monitoring
- **Portal → Troubleshoot**: flagged inspections, photos with no inspection, phone-reported problems (each submit now leaves "submit pressed / submit finished" notes).
- Server health pages: `/health` and `/health/ready` (database response time).
- If an inspector sees "NOT SENT YET": do nothing; it retries by itself (30 s, 1 min, 2 min, then every 5 min while the app is open) and "Retry now" is on the first screen. Do not submit it twice.

## 5. Rollback
- **Server/web:** redeploy the previous commit in Railway (the new database indexes are additive and harmless to leave in place).
- **Phones:** publish the previous update to the `preview` branch (`eas update --branch preview` from an earlier commit).

## 6. Known limits (not defects)
- Photo throughput for the whole company is capped by Egnyte at roughly 3,000 photos an hour until Package 3 (own photo storage) is built; a 540-photo upload takes ~11 minutes.
- The phone must stay open while photos are uploading (the screen is kept awake); closing the app pauses and resumes later.

## 7. Added on Oct 15 (after the real-phone tests)
- **Real-phone test passed (Android):** 104 photos in one section submitted in 3 s, all present on the server in the right Egnyte folders; sections now appear on the server while the inspector is still on the screen.
- **Bug found and fixed:** finishing one inspection used to wipe the uploaded-photo list and delete the photo files of any other inspection still being filled in (the draft re-uploaded everything, storing each photo twice — seen on V267612 — or could lose them). Cleanup now only touches the inspection that was sent. Reproduced and fixed with the phone-code test rig (`test_two.mjs`).
- **iOS app (`acespect-ios`, added by a teammate) is a copy of the Android app and did not have these fixes.** They were ported in commit `ac6c360` (type-checks clean; not run on a device). Check before building it for the client.
- **Warning — shared update channel:** `acespect-ios` and `acespect-mobile` have the same Expo project id and `preview` branch. Publishing an update from one folder replaces what the other app's phones receive. Agree one source of truth (or separate branches) before publishing from either.
- **Data note:** V267612 holds each of its 109 photos twice (subfolder copy + flat copy; the portal lists both). V269999 is a test draft.

## 8. Audit log (added Oct 19) — see `Audit-log-guide.md`
- **Deploy order:** backend first (runs migration `20261019090000_audit_events`: two new tables + triggers, nothing existing changes), then web, then phone update (Android + iOS).
- **After deploy, once:** run `npm run audit:backfill` on the server, then Admin → Audit log → **Verify integrity** (must say "passed").
- **Checks run before release:** core 10 checks (`npm run check:audit`: chaining, edit/delete blocked, tamper and deletion detected, 50 concurrent writers, redaction, duplicate phone events, photo batches, seals, retention, alert monitor); API 8 checks (roles, scope, paging, phone upload); reports 5 checks; phone queue 4 checks (offline → arrives later with original times and one story id); 540-photo run with auditing on: 614 s (no measurable cost; recorded as 2 photo summaries + 1 submit entry).
- **Watch on day one:** Audit log page "Write failures" must stay 0; "Last seal" must advance hourly; the "Problems" preset shows anything refused or failed.
- **Retention:** `AUDIT_RETENTION_DAYS` (default 2557 = 7 years).
- **Rollback:** redeploy the previous commit; the new tables can stay (nothing reads them but the audit pages). The triggers only protect those two tables.
- **Not verified on a real device:** the phone event queue on a physical Android/iOS phone (tested with the real code against the real server, not by tapping).
