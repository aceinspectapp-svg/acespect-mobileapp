# Adding and managing people (Admin → Users)

For administrators. Everything here is in the review portal under **Admin → Users**. Every action is recorded in **Admin → Audit log**.

## Who can be added
| Role | What they do | Where they sign in |
|---|---|---|
| **Inspector** | Does inspections | The ACE SPECT phone app |
| **Reviewer** | Reviews and approves submitted inspections | The review portal |
| **Admin** | Everything above, plus adding people and the QC platform | The review portal |

People who work for a client, builder or trade (QC roles) are added on **QC → People**, not here.

## Add a person
1. **Add user**, fill in name, email and role (phone, region and licence number are optional), then **Add and invite**.
2. They receive an email with a one-time link and choose their own password (12 characters or more) and accept the terms.
3. **If email is not set up on the server**, nothing is sent and the link is shown to you once: copy it and send it to them yourself. Nobody, including you, ever sees or sets their password.
4. Inspectors can then sign in on the phone app. They can also open the app, choose **I have an invitation** and paste the link.

The status column shows **Invited** until they activate. An invitation lasts 7 days; **Resend invitation** makes a new link (the old one stops working).
A mistaken invitation can be removed with **Cancel invitation**, as long as the account was never used.

## Forgot password
On an **Active** person choose **Send reset link**. They get an email (or you get the link to pass on) valid for 60 minutes.

## Change a role
**Change role**. It applies on their next action; they stay signed in. When a **reviewer** is changed to another role, their open reviews go back to the unassigned queue or to a reviewer you choose. Finished reviews keep their name.

## Someone leaves, or loses their phone
**Switch off**, with a reason if you like. They are signed out on every device straight away and cannot sign in again. Their history stays. Anything not yet sent on their phone stays on the phone. **Switch on** restores the account (they use the same password). If someone never activated, switch on then **Resend invitation**.

## Rules the system enforces
- You cannot switch off or change the role of your own account, and the last active administrator cannot be removed.
- Emails are unique.
- People who also hold a QC role show **Managed in QC → People** and can only be edited here.

## Settings (server)
| Setting | Meaning |
|---|---|
| `SELF_SIGNUP` | `off` (default): the phone cannot create accounts. `on` only for local testing. |
| `MFA_REQUIRED_PLATFORM_ROLES` | e.g. `ADMIN,REVIEWER`: those roles must set up an authenticator at their next sign-in. Empty by default. Tell people before turning it on. |
| `SMTP_URL`, `MAIL_FROM` | Needed for invitation and reset emails. |
