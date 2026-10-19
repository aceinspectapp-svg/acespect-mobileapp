# Audit log — how it works and how to use it

## What it is
A permanent, tamper-evident record of what happens to every inspection and to the system: on the phone, in the web portal and on the server. Open it in the portal at **Admin → Audit log**, and per inspection with the **History** button (reviewer, admin and inspector views).

## What is recorded

| Where | Recorded |
|---|---|
| **Phone** (Android and iOS) | App opened / moved to background; photos taken (count, camera or library); the phone losing and regaining its connection (with how long it was offline); photo backup waiting or complete; photos that could not be sent or were left out; background saving failing and recovering; submit pressed, kept on the phone to retry, failed, delivered; queued inspections retried / delivered / dropped; an unfinished inspection reopened. These are kept on the phone while it is offline and uploaded later, with the phone's own clock noted beside the server's. |
| **Server (from the phone)** | Inspection started; job number set; each section saved (folded to one entry a minute while it is being edited); photos stored (**one summary per batch**, with count, number range, size and a fingerprint of the ids); submit received / repeated / refused (and why); sent for review; template updates accepted. |
| **Portal** | Inspection opened; section approved / revision requested / review reset; **Approve all**; section and defect edits (**before and after values**); status, notes, reviewer assignment; Egnyte folder re-check; report PDF/Word **downloads** (with a SHA-256 of the exact file); photo zip downloads; the inspection list opened. |
| **Admin** | User profile changes; template created / edited / published; test email; Troubleshoot page opened; audit log opened, integrity checks, exports and reports. |
| **Security** | Sign-ins, failed sign-ins, lockouts, password changes and resets, ended sessions, refused requests, file access. |
| **Server errors** | Any request from a signed-in person that was refused or failed (`request.rejected`, `request.failed`), except routine expired sign-ins. |
| **System** | Retention runs. The QC area's own audit trail is mirrored in too (category QC). |
| **Earlier history** | The old submission log is imported once (`legacy.*` entries, original times). |

Never stored: passwords, tokens, secrets, photo contents. Long values are cut down; photo lists are summarised.

## Every entry answers
**Who** (name and role at that moment) · **What** (action, record, before/after) · **When** (server UTC; the phone's clock kept separately) · **From where** (phone app / portal, app version, update id, platform, device, IP) · **How it ended** (OK / failed / refused, severity) · **Link** (one "story" id ties a submit attempt on the phone to its requests and server entries).

## Proof it has not been altered
- The database **refuses to edit or delete** an audit row (a trigger).
- Each entry carries the fingerprint of the one before it in its chain (one chain per inspection, one for the rest). Changing or removing an entry breaks every later one.
- **Hourly seals** cover all entries in order, so removing a whole chain is detectable.
- **Verify integrity** (Audit log page or an inspection's History) recomputes everything. It also runs **every night**, and administrators are emailed if it fails.
- Every PDF/CSV carries an **integrity statement**, a SHA-256 of the file (also stored in the log), and itself becomes a log entry.

## Who can see what
| Role | Sees |
|---|---|
| Admin | Everything (including addresses, browsers and device details), exports, reports, integrity checks |
| Reviewer | The history of inspections assigned to them (no addresses / browsers) |
| Inspector | The history of their own inspections |
Reading or exporting the log is itself logged.

## Reports (Admin → Audit log, and the History panel)
1. **Inspection audit report** — PDF / CSV / JSON: the inspection, summary, people, phones and app versions used, problems, review decisions, complete timeline, integrity statement, standards page.
2. **Activity report** — entries per day, sources, top events and people, submissions, photos, offline time, app versions, common problems.
3. **Security & access report** — sign-ins per day, failing addresses, refused requests, administrator changes, downloads, who looked at the log.
4. **Incident report** — every failure/refusal/warning grouped by inspection, with Resolved / Open.
5. **CSV export** of any filtered view. A "mask" option hides IP addresses and device details. Cells that look like spreadsheet formulas are neutralised.

## Alerts
Administrators are emailed (once an hour per cause) when: the log could not record entries, sealing has stopped, one address fails to sign in repeatedly, one person is refused repeatedly, or the nightly integrity check fails. Email must be configured (see the release checklist).

## Retention
Seven years (`AUDIT_RETENTION_DAYS`, default 2557; anything under 365 is ignored). A daily job removes older entries — the only deletion the database permits — and writes an `audit.purge` entry saying what was removed.

## Running it for the first time (production)
1. Deploy (the migration `20261019090000_audit_events` runs automatically).
2. Once, on the server: `npm run audit:backfill` — imports the old submission log (safe to repeat).
3. Open **Admin → Audit log** → **Verify integrity**.

## Known limits
- Whoever controls the database server can disable the protection trigger; the hash chain and hourly seals would then expose the change at the next check, but an exported monthly copy outside the database (planned with the photo-storage work) is the stronger answer.
- A failure to write an audit entry never blocks an inspector; it is counted, logged to the hosting log as `[audit:FAILED]`, shown on the Audit log page and emailed to administrators.
- Individual photo views are not logged (a report page loads hundreds); downloads and exports are.
- The phone's events depend on the phone reaching the server eventually; events from a phone that is lost before it reconnects are lost with it.
- Android and iOS apps share one update channel; both carry the phone events.
