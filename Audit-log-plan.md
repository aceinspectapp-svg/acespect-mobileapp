# Audit log — plan for approval (nothing has been built)

**Goal:** a complete, trustworthy record of everything that happens to an inspection and to the system — from the moment an inspector works on the phone, through upload and submission, to review, approval and report download in the web portal — viewable and searchable in the web app, with exportable reports.

## 1. What exists today (checked in the code)

| Existing | What it does | Why it is not enough |
|---|---|---|
| `submission_log_entries` (Troubleshoot page) | Mobile→server events: received / saved / photo uploaded / rejected / failed / warnings, plus the new phone step notes | Free-text, no actor details beyond inspector id, no device/app version, not tamper-evident, **pruned after 30/180 days** (it is an ops log, not an audit log) |
| `qc_audit_entries` + `recordAudit()` | Hash-chained, append-only audit trail with before/after, verified by a "Verify" button | Only used by the QC area and sign-in/MFA. **Nothing in the inspection flow writes to it** (web edits, approvals, finalize, downloads, user/template changes) |
| `qc_security_events` | Sign-ins, lockouts, refused requests, file access | Security only; separate page; not linked to inspections |
| Web "Audit and security" page | Browses the two QC tables | QC-scoped; no inspection timeline, no reports |

Gaps: no record of **web actions on inspections** (section edits, approve / revision requested / approve-all, finalize, reassign, Egnyte re-check, PDF/Word downloads), **admin changes** (users, roles, templates, settings), **device context** (app version, platform, device, update id), **offline phone incidents** (queued, retried, photo skipped, dropped connection), or a **single timeline per inspection**.

## 2. Standard practice this follows
Based on ISO 27001 (A.8.15 logging), NIST SP 800-92, OWASP Logging Cheat Sheet and SOC 2 CC7.2:
- Each event answers **who, what, when, where, from where, outcome**.
- **Append-only and tamper-evident** (hash chain, database-level block on edit/delete, periodic anchors).
- **Server-assigned UTC time**; device time is kept separately and marked untrusted.
- **Least data**: no passwords, tokens, photo bytes or secrets; personal data limited to what is needed.
- **Access to the log is controlled and itself logged**; exports are logged.
- **Retention** is explicit and separate from the operational (Troubleshoot) log.
- Events are **correlated** (one id ties a phone attempt to its uploads, submit and server result).

## 3. The record (one row per event)
`id` · `seq` · `occurredAt` (UTC, server) · `clientTime` (device, untrusted) · `category` · `action` (e.g. `inspection.submit`) · `outcome` (success / failure / denied) · `severity` · **actor** (id, name and role *as at that moment*, type user/system/device) · **source** (mobile / web / api / system) · **client** (app + version, OTA update id, platform, OS, device model) · **network** (IP, user agent) · **target** (type, id, label) · `inspectionId` + `jobNo` (indexed for the timeline) · `correlationId` · `requestId` · `before` / `after` (field-level changes, redacted) · `reason` · `metadata` · **integrity** (`prevHash`, `hash`).

## 4. What gets recorded (event catalogue)

**Mobile → server** — draft created; section saved (with photo count); photos uploaded (**one summary entry per batch** with count, number range and a digest, not one chain entry per photo); photo rejected/skipped (unreadable, file lost); submit pressed / queued (and why) / retried / delivered / failed; receipt mismatch; missing-photo resend; sign-in expiry and refresh; app version/update change; offline period (start/end) reported by the phone.

**Web** — sign-in / sign-out / MFA; inspection opened (optional — see decision 3); section edited, approved, revision requested, approve-all; photo excluded/added/removed; inspection status change, finalize, reviewer assignment; **report PDF/Word downloaded or printed**; Egnyte folder re-check; edits by an inspector to their own draft.

**Admin** — user created / role / region / active changed; template published / archived / adopted; mail and alert settings; audit exports and report runs.

**System** — orphan-photo and failed-submission alerts, retention runs, scheduled jobs, Egnyte placement outcomes.

## 5. How it is built
1. **New table `audit_events`** (additive migration) with indexes on time, inspection, actor, action, correlation. A database trigger **rejects UPDATE and DELETE** so rows cannot be altered even by a bug.
2. **One function `audit()`** used everywhere, plus a request-context layer (actor, IP, request id, app headers) so call sites stay one line. Business events record before/after diffs; secrets are redacted (reusing the existing redaction list).
3. **Tamper evidence:** a hash chain **per stream** (one stream per inspection, one for system/admin) instead of one global chain, so busy uploads never queue behind each other; a **daily anchor** entry stores the head hash of every stream, and **"Verify integrity"** recomputes chains and anchors.
4. **Phone events:** the phone keeps an offline event queue (client event id, client time) and uploads it in batches to a new endpoint; the server de-duplicates, stamps server time, marks them `source = device` and links them by `correlationId`. This captures incidents the server can never see (no connection, retries, skipped photos). The Android and iOS apps both get it (shared code, one update each).
5. **Existing logs stay:** Troubleshoot keeps its operational role; its events are linked by correlation id. Existing `SubmissionLogEntry` history is **backfilled** into the audit table once (marked `legacy`).
6. **Throughput:** photo events are summarised; the 540-photo load test is re-run with auditing on to prove no measurable slow-down.

## 6. Web app (admin; reviewers see their own inspections' history)
- **Audit log page**: filters (date range, actor, role, source, category, action, outcome, severity, job number / inspection id, app version, IP), search, saved filters, expandable row with a before/after diff, "Verify integrity" with the result shown, live refresh.
- **"History" tab inside each inspection** (reviewer/admin view): a single timeline — captured → photos uploaded → submitted → reviewed → approved → report downloaded — including phone-side incidents.
- **Deep links** from the Troubleshoot page and flagged inspections.

## 7. Reports (PDF + CSV/JSON, branded like the existing reports)
1. **Inspection audit report** — job details; chronological timeline; photo summary (count, numbering, Egnyte path); who reviewed/approved each section and when; downloads; incidents and their resolution; **integrity statement** (chain verified, head hash, generated by/at).
2. **Activity report (date range)** — events by category/user/source, mobile-vs-web, submit success rate and time, retries, failures, top errors, app versions in use.
3. **Security & access report** — sign-ins, denied requests, exports, admin changes.
4. **Incident report** — every failure/warning with outcome, affected job, and whether it was resolved.
Every export is itself an audit entry and carries a SHA-256 of the file.

## 8. Security, privacy, retention
- **Access:** admin = everything; reviewer = the history of inspections assigned to them; inspectors/clients = none. Viewing and exporting the log is logged.
- **Privacy:** no credentials/tokens/photo content; store IP and device model (needed to trace incidents) — configurable; names stored as snapshots plus ids; masking option for exports.
- **Retention (proposal):** audit events 7 years, never pruned by the operational job; archive older months to bucket/Egnyte as signed monthly files (ties in with Package 3's storage).
- **Clock:** server UTC only; device time kept and flagged if it differs by more than a threshold.

## 9. Delivery in phases (about 6–8 working days in total)
| Phase | Content | Verified by |
|---|---|---|
| 1 Foundation (≈2 d) | table + trigger, `audit()`, request context, chains, anchors, verify, instrument server + web + admin events, backfill | unit tests for hashing/redaction; one test per instrumented action; tamper test (edit a row → verify fails; trigger blocks changes); migration on a scratch copy |
| 2 Phone events (≈1.5 d) | offline event queue, upload endpoint, headers (version/device), Android + iOS | phone-code test rig incl. offline/kill/retry; 540-photo run with auditing on |
| 3 Web UI (≈2 d) | Audit log page, inspection History tab, integrity button | browser walkthrough with the seeded 1,500-inspection database |
| 4 Reports (≈1.5 d) | the four reports, PDF + CSV, export logging | report content checked against known events |
| 5 Hardening (≈1 d) | alerts on anomalies, retention/archive job, docs, release checklist update | full regression + production smoke test |

Each phase is deployed separately and is reversible (additive tables; the feature is read-only for the rest of the app).

## 10. Risks
- **Volume and speed** — controlled by per-stream chains and photo summaries; re-measured with the load rig.
- **Spoofed phone events** — device events are labelled `device` and never override server-recorded facts.
- **Over-logging personal data** — minimised, reviewed with you in decision 3 and 4.
- **Two apps (Android + iOS) share one update channel** — phone events ship together or not at all.

## 11. Decisions needed from you
1. **Table:** new `audit_events` (recommended) — or extend the QC table so everything is one trail?
2. **Retention:** 7 years OK? Different for different categories?
3. **"Viewed" events:** log every time someone opens an inspection/report (strongest audit, much more data), only downloads/exports (recommended), or neither?
4. **Personal data:** store IP address and device model? Mask them in exports?
5. **Who sees what:** admin all; reviewers only their inspections — OK? Should inspectors see their own submission history?
6. **Report format:** PDF in the Houspect style + CSV — anything the client's auditors specifically require (e.g. a standard such as ISO 27001 / SOC 2 mapping page)?
7. **Phase order / deadline:** all five phases, or start with 1 + 3 (server + web) and add phone events after the client deployment?
