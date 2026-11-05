# Houspect user management: implementation plan

Status: **proposed, waiting for approval**. Nothing in this plan has been built yet.
Closes readiness items **B1** (admins cannot create, change or remove users) and **B2** (anyone can sign up as an inspector), and covers the sign-in part of **B9**.

## 1. What exists today (verified in the code)

| Area | Today |
|---|---|
| Admin → Users page | Lists users, edits name / phone / region / licence number. **Add User** and **Remove** buttons have no action. |
| Backend | `GET /web/users`, `PATCH /web/users/:id` (profile fields only). No create, role change, deactivate or password help. |
| Accounts that exist | Reviewers and admins only exist because a setup script created them. |
| Phone sign-up | `POST /auth/register` is open: anyone gets a signed-in INSPECTOR account. |
| Reusable pieces | One-time invitation links (`qc_invitations`, 7 days, password of 12+ characters, terms accepted), password reset links, `tokenVersion` (signs a user out everywhere at once), refresh-token revocation, the audit log, the phone's "I have an invitation" screen (Android and iOS), the web `/accept/:token` page. |
| Not working today | No email is configured in production, so links are shown to the admin instead of emailed. |

Roles in the Houspect app: **INSPECTOR**, **REVIEWER**, **ADMIN**. (QC accounts use the other roles, CLIENT and FIELD_USER, and are managed on the QC → People page. Private inspectors in QC are also stored as INSPECTOR. The Houspect page must not break them.)

## 2. What will be built

### 2.1 Backend (`acespect-backend`)

**New endpoints** (all admin only, all written to the audit log with before/after):

| Endpoint | What it does |
|---|---|
| `POST /web/users` | Add a user: name, email, role (inspector / reviewer / admin), optional phone, region, licence number. Creates the account with no usable password and a one-time invitation link. |
| `PATCH /web/users/:id` | Existing profile edit, plus **role change**. |
| `POST /web/users/:id/deactivate` | Switch an account off. Signs the person out on every device immediately. Optional reason. For a reviewer: their open inspections go back to the unassigned queue, or to a reviewer you choose. |
| `POST /web/users/:id/reactivate` | Switch it back on. |
| `POST /web/users/:id/invitation` | Resend the invitation (the earlier link stops working). |
| `POST /web/users/:id/password-reset` | "Send reset link" for someone who forgot their password. |
| `DELETE /web/users/:id/invitation` | Cancel an invitation and delete an account that was never used (nothing else holds on to it). |
| `GET /web/users` (extended) | Adds status (invited / active / deactivated), last sign-in, two-step sign-in on/off, and "managed in QC" flag. |

**Email or link:** if the server can send email, the person is emailed and the admin is **not** shown the link. If email is not set up (today), the admin is shown the link once to pass on. Admins never see or set anyone's password.

**Safety rules the server enforces:**
- You cannot deactivate or demote yourself.
- The last active admin cannot be demoted or deactivated.
- A person who also belongs to a QC client (QC role) cannot have their role changed or be deactivated from this page; it says "Managed in QC → People".
- Email addresses are unique (a duplicate is refused with a clear message).
- A role change takes effect on the person's very next request (no sign-out needed). Moving a reviewer to inspector first hands back their open reviews, as for deactivation.
- Every action is audited (who, what, when, before and after).

**Close self-sign-up (B2):** new setting `SELF_SIGNUP` (default **off**). When off, `POST /auth/register` answers `SIGNUP_DISABLED`. `GET /auth/sso/config` also reports `selfSignup` so the phone knows whether to show "Create account". Existing phone-registered inspectors keep working untouched.

**Database:** one small additive migration (nothing is removed or changed): `users.deactivated_at`, `deactivated_by_id`, `deactivation_reason`, `created_by_id`. Safe to deploy before or after the code.

### 2.2 Web (`acespect-web`): Admin → Users

- **Add user** dialog (name, email, role, phone, region, licence number).
- Table gets **status badge** (Invited / Active / Deactivated), **last sign-in**, **two-step sign-in** and a **Managed in QC** tag.
- Search plus filters by role and by status.
- Row actions: **Edit**, **Change role**, **Resend invitation**, **Send reset link**, **Deactivate / Reactivate**, **Cancel invitation**. The dead "Remove" button becomes "Deactivate".
- Deactivating a reviewer asks who takes over their open inspections (a list, using the in-page dialogs added on 2 November).
- Invitation link dialog (the QC one is reused) shown only when email cannot be sent.

### 2.3 Phone (Android `acespect-mobile` and iOS `acespect-ios`, identical changes)

- **Create account** shows only when the server says sign-up is on; otherwise Login shows "Invited by your company? I have an invitation" as the main route (this screen already exists).
- A signed-out message for a switched-off account: "Your account has been switched off. Contact your administrator." **Drafts and photos waiting to send stay on the phone** (nothing is wiped).
- Needs one update (OTA) per platform after the server change is deployed.

### 2.4 Checks and documentation

- New automated check `check:user-management` (added to the GitHub checks): add each role, invitation and activation, role change takes effect, deactivation kills access immediately (access token and refresh token), reactivate, last-admin and self-protection, QC-managed protection, duplicate email, non-admins refused, sign-up closed, link not shown when email is sent, audit entries present, reviewer hand-over.
- Updates to the release checklist and a short admin guide ("how to add an inspector").
- The existing QC checks that use phone sign-up will run with `SELF_SIGNUP=on`.

## 3. Out of scope (separate items in the readiness review)

Email set-up (B3), Azure deployment pipeline (B13), store releases (B11), photo links (B7), clearing phone data on a lost device (H10), recovering a lost authenticator for two-step sign-in (M9).

## 4. Decisions needed from you

1. **Can admins create other admins?** Recommended: **yes**, because an admin is also the QC Super Admin; every such action is audited and the last admin is protected. Alternative: new admins only by a database change.
2. **Two-step sign-in for admins and reviewers (B9).** The code already supports it. Recommended: add a switch `MFA_REQUIRED_PLATFORM_ROLES=ADMIN,REVIEWER`, shipped **off**, and turn it on once everyone has been told. Turning it on forces each admin and reviewer to set up an authenticator at their next sign-in. Do you want it included now (off) or left out?
3. **Self-sign-up default:** off in production (recommended). If you ever want public sign-up, new accounts would need admin approval first (not built now).
4. **A deactivated inspector's unsent work:** kept on the phone, nothing wiped (recommended, to avoid losing inspections). Drafts already on the server stay with the inspector and an admin can still open them.

## 5. Order of work and effort

| Step | What | Effort |
|---|---|---|
| 1 | Backend: migration, endpoints, safety rules, sign-up switch, audit | 1.5 days |
| 2 | Automated check `check:user-management` + CI | 1 day |
| 3 | Web: Admin → Users page | 1.5 days |
| 4 | Phone (both platforms) + type-checks | 0.5–1 day |
| 5 | Docs, review of the full diff, final run of all checks | 0.5 day |
| | **Total** | **about 5 days** |

I will work on a branch (`feature/user-management`), run every existing check plus the new one, and **not push to `main` or publish a phone update without your say-so**. Deploying the backend needs your Azure deploy step; the phone update goes out only after that.
