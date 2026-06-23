# Gmail API setup for CRM auto-sync

The CRM can pull inbound replies directly from Gmail into the
`email_messages` table and surface them as activity-log entries.
This needs a one-time OAuth setup on your Google Cloud account
(~5 minutes). After that the **Sync inbox** button in the CRM
header pulls new replies on demand.

The token lives in your browser's localStorage. It is NOT shared
with any server. You can revoke access any time from your Google
account security settings.

## Steps

### 1. Create / pick a Google Cloud project

1. Open <https://console.cloud.google.com>
2. Top bar → project dropdown → **New project**
3. Name: e.g. `gotadagua-crm`. No organisation needed.

### 2. Enable the Gmail API

1. Left nav → **APIs & Services** → **Library**
2. Search **Gmail API** → **Enable**

### 3. Configure the OAuth consent screen

1. Left nav → **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - App name: `Gota CRM`
   - User support email: your email
   - Developer contact: your email
4. **Save and continue**
5. Scopes: skip (we request scope at runtime) → **Save and continue**
6. Test users: add your own Gmail addresses (the ones whose inbox
   you want the CRM to read — likely
   `groups@gotadaguasurf.com` and any others). Up to 100.
7. **Save and continue** → back to dashboard

The app stays in "Testing" mode forever for personal use — no
need to submit for verification as long as you only add test
users.

### 4. Create the OAuth Client ID

1. Left nav → **APIs & Services** → **Credentials**
2. **+ Create credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Gota CRM web client`
5. **Authorized JavaScript origins** — add the URL(s) you use to
   open the CRM. Both your prod Vercel URL AND any preview /
   custom domain.
   - `https://www.gotadaguasurf.com`  (or whatever your prod URL is)
   - `https://gotadaguasurf.vercel.app` (the Vercel default)
   - `http://localhost:3000` if you ever run it locally
   You can leave Authorized redirect URIs empty — we use the
   token-flow GIS popup, not redirect.
6. **Create**

A dialog pops up showing a **Client ID** ending in
`.apps.googleusercontent.com`. Copy it.

### 5. Paste the Client ID into the CRM

1. Open the CRM
2. Header → ⚙ **Settings**
3. Paste the Client ID → **Save**
4. Click **Connect Gmail** in the header
5. Google's consent popup → pick the Gmail account whose inbox
   you want to read → tick the read-only scope → **Continue**
6. Header now shows **Sync inbox**. Click it to pull the last
   7 days of replies.

## What gets pulled

- Messages with `From:` matching any contact in the CRM
  (`outreach_contacts.email` OR `contacts.email`)
- Last 7 days only
- Stored in `email_messages` with `direction = 'inbound'`,
  `provider_msg_id` = the Gmail message id (deduped on re-runs)
- An `outreach_activity` row tagged `replied_marked` lands on
  the parent company so the timeline shows it

## What does NOT happen

- No outbound emails are read or modified
- No emails are deleted
- No data leaves your browser except to your own Supabase
- Token can be revoked at <https://myaccount.google.com/permissions>

## Troubleshooting

**"This app isn't verified"** — expected. Click **Advanced** →
**Go to Gota CRM (unsafe)**. Only your own test-user Gmail
accounts can authorise.

**Sync returns 0 messages** — check the From: address on a known
recent reply matches a contact's email exactly. Domain-level
matching is a future improvement.

**Token expired toast** — Gmail tokens last ~1 hour. Click
**Connect Gmail** again; a silent re-consent usually skips the
popup if you've authorised recently.
