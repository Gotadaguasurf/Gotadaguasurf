# Supabase Backup — setup & restore

Automated daily `pg_dump` of the Supabase Postgres → uploaded to the
**Gota d'Água company Google Drive** folder, plus a secondary copy as a
GitHub Actions artifact.

Cost: **$0/month** (GitHub Actions free tier + your existing Drive quota).

Destination Drive folder:
<https://drive.google.com/drive/u/1/folders/1C0qj0rW8ThDt5RSepzJLD5ziwQExLc5J>

---

## One-time setup (do this once, then forget)

You need **two GitHub secrets**: `SUPABASE_DB_URL` and `RCLONE_CONFIG`.

### 1. `SUPABASE_DB_URL` (the Postgres connection string)

1. Open <https://supabase.com/dashboard> → your project
2. **Project Settings** (gear icon) → **Database**
3. Scroll to **Connection string** → choose **URI** mode (NOT pooling)
4. Click **Copy**. Format:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the actual DB password (also on that page)
6. Add as a GitHub secret:
   <https://github.com/Gotadaguasurf/Gotadaguasurf/settings/secrets/actions>
   - **New repository secret**
   - Name: `SUPABASE_DB_URL`
   - Secret: paste the URI

### 2. `RCLONE_CONFIG` (Google Drive auth)

You need to run `rclone config` ONCE on your Mac to authenticate with
Google. Then you copy the resulting config file content into a GitHub
secret. After that the workflow can upload to Drive on its own.

**Step-by-step on your Mac:**

```bash
# Install rclone (if you don't have it)
brew install rclone

# Start the config wizard
rclone config
```

The wizard is interactive. Pick these answers:

```
n     ← new remote
gdrive  ← name (must be exactly "gdrive" to match the workflow)
13    ← Google Drive (the number changes; pick "Google Drive" from the list)
↵     ← client_id (leave blank, press Enter)
↵     ← client_secret (leave blank)
1     ← scope: "Full access all files, excluding Application Data Folder"
↵     ← service_account_file (leave blank)
n     ← Edit advanced config? No
y     ← Use auto config? Yes
                        ← browser opens, sign in with the account that
                          owns the company Drive folder (the /u/1/ one)
                        ← click Allow / Allow
↵     ← Configure this as a Shared Drive? n (unless it's an actual
                          Workspace Shared Drive; for "My Drive" say n)
y     ← Yes this is OK
q     ← quit
```

Now point the remote at the company backups folder by editing the
config to add `root_folder_id`:

```bash
rclone config edit gdrive
```

Or just open the file directly:

```bash
open ~/.config/rclone/rclone.conf
```

Find the `[gdrive]` section. Add a line at the bottom:

```ini
root_folder_id = 1C0qj0rW8ThDt5RSepzJLD5ziwQExLc5J
```

It should look something like:

```ini
[gdrive]
type = drive
scope = drive
token = {"access_token":"...","refresh_token":"...","expiry":"..."}
root_folder_id = 1C0qj0rW8ThDt5RSepzJLD5ziwQExLc5J
```

Test it works:

```bash
rclone lsd gdrive:
```

This should list the contents of the company backups folder (probably
empty for now). If you see an error, the auth didn't take — re-run
`rclone config`.

**Copy the config into the GitHub secret:**

```bash
cat ~/.config/rclone/rclone.conf | pbcopy
```

(`pbcopy` puts the content on your clipboard.)

Then on GitHub:
<https://github.com/Gotadaguasurf/Gotadaguasurf/settings/secrets/actions>
- **New repository secret**
- Name: `RCLONE_CONFIG`
- Secret: paste (Cmd+V) — the entire content of rclone.conf

### 3. Verify it works

1. Open <https://github.com/Gotadaguasurf/Gotadaguasurf/actions/workflows/supabase-backup.yml>
2. Click **Run workflow** → **Run workflow** (green button)
3. Wait ~2 minutes — the run should turn green ✅
4. Open the Drive folder — you should see `daily-2026-XX-XX_HHMM.sql.gz`

If it fails:
- "SUPABASE_DB_URL secret is missing" → step 1 not done
- "RCLONE_CONFIG secret is missing" → step 2 not done
- "Could not list rclone remote 'gdrive:'" → the auth in your rclone.conf
  is wrong, or root_folder_id wasn't added. Re-do step 2.

---

## Retention policy

| Frequency | Trigger | Kept on Drive | Kept on GitHub |
|---|---|---|---|
| Daily | Every 03:00 UTC | 30 days | 30 days |
| Weekly | Every Sunday at 03:00 UTC | 120 days | 30 days |
| Monthly | 1st of each month at 03:00 UTC | 365 days | 30 days |

So at any moment you have on the company Drive:
- 30 daily snapshots (point-in-time recovery within last month)
- ~17 weekly snapshots (3-4 months of weekly history)
- 12 monthly snapshots (full year of monthly history)

Filenames follow `<kind>-YYYY-MM-DD_HHMM.sql.gz`, e.g.
`daily-2026-05-22_0300.sql.gz`. The rotation script deletes by prefix
matching, so manually-added files with different names are never touched.

---

## How to restore

### Option A — Full restore to the same Supabase project

⚠️ This OVERWRITES the current data. Coordinate with anyone using the app.

1. Download the backup file from the Drive folder
2. Unzip locally:
   ```bash
   gunzip daily-2026-05-22_0300.sql.gz
   ```
3. Get the same `SUPABASE_DB_URL` you used for the secret
4. Restore:
   ```bash
   psql "<DB_URL>" -f daily-2026-05-22_0300.sql
   ```

### Option B — Restore to a fresh project (partial recovery)

If you only want to recover specific tables (e.g. accidentally deleted
`camp_weeks` rows) WITHOUT losing everything else:

1. Create a new Supabase project ("scratch")
2. Restore the backup into the scratch project (Option A but with the
   scratch URL)
3. From Supabase Table Editor, copy the rows you need
4. Paste back into the production project

### Option C — Read-only query against a backup

1. `gunzip` the backup locally
2. Open in a text editor — it's plain SQL with INSERT statements
3. Search/grep for the rows you need

Or load it into a local Postgres for proper querying:

```bash
docker run -e POSTGRES_PASSWORD=x -p 5432:5432 -d postgres:16
gunzip -c daily-2026-05-22_0300.sql.gz | docker exec -i $(docker ps -lq) psql -U postgres
docker exec -it $(docker ps -lq) psql -U postgres
```

---

## Manual trigger (force a backup right now)

Before risky migrations / schema changes / bulk SQL operations:

<https://github.com/Gotadaguasurf/Gotadaguasurf/actions/workflows/supabase-backup.yml>
→ **Run workflow** → **Run workflow** (green button)

Done in ~2 minutes. The file shows up in the Drive folder immediately
after.

---

## Troubleshooting

**Workflow fails with "SUPABASE_DB_URL secret is missing"**
→ Add the secret per step 1 above.

**Workflow fails with "RCLONE_CONFIG secret is missing"**
→ Add the secret per step 2 above.

**Workflow fails with "Could not list rclone remote 'gdrive:'"**
→ The rclone config in the secret is broken or expired. The Google
OAuth refresh token may have expired (rare, but happens after long
inactivity). Re-run `rclone config` on your Mac (`rclone config
reconnect gdrive:` is faster — it only refreshes the token). Then
re-paste the new contents into the `RCLONE_CONFIG` secret.

**Workflow fails with pg_dump errors**
→ The Supabase URL or password is wrong. Re-copy from Supabase
dashboard.

**Backup file is suspiciously small (<5 KB)**
→ The workflow's sanity check caught a likely failed dump. Check the
pg_dump step logs in the workflow run.

**Scheduled workflow stops running after months of inactivity**
→ GitHub disables schedule on dormant repos. To re-enable, push any
commit or trigger manually once. The schedule resumes automatically.

---

## Why this workflow exists

A Camp Tab race condition once wiped `camp_weeks` + `camp_guests` for
Morocco. There was no automatic backup on the Supabase free tier and no
way to recover the data short of reconstructing it manually. This
workflow ensures that never happens again — even on the free tier, and
even if GitHub goes down (the Drive folder is independent of GitHub).

When the project grows beyond free-tier needs, upgrade Supabase to
**Pro** ($25/month) for built-in point-in-time recovery on top of
these backups. The two are complementary: PITR for 5-minute
granularity, this workflow for long-term archival on the company
Drive.
