# Supabase Backup — setup & restore

Automated daily `pg_dump` of the Supabase Postgres for this project. Runs at
**03:00 UTC every day** via GitHub Actions, plus weekly/monthly retention.

Cost: **$0/month** (GitHub Actions free tier).

---

## One-time setup (do this once, then forget)

### 1. Get the Supabase connection string

1. Open <https://supabase.com/dashboard> → your project
2. **Project Settings** (gear icon) → **Database**
3. Scroll to **Connection string**
4. Choose mode: **URI** (NOT "Connection pooling" — pg_dump needs the direct
   connection)
5. Click **Copy**. It looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with the actual DB password (also visible on
   that page under "Database password").

### 2. Add it as a GitHub secret

1. Open <https://github.com/Gotadaguasurf/Gotadaguasurf/settings/secrets/actions>
2. Click **New repository secret**
3. Name: `SUPABASE_DB_URL`
4. Secret: paste the full URI you copied above
5. **Add secret**

### 3. Verify it works

1. Open <https://github.com/Gotadaguasurf/Gotadaguasurf/actions/workflows/supabase-backup.yml>
2. Click **Run workflow** → **Run workflow** (green button)
3. Wait ~2 minutes
4. The run should turn green ✅
5. Click into the run, scroll to **Artifacts** at the bottom — there should
   be a `daily-2026-XX-XX_HHMM` artifact you can download

If it fails: check the run logs. The most common error is a bad
connection string (wrong password or missing `[YOUR-PASSWORD]` substitution).

---

## Retention policy

| Frequency | Trigger | GitHub keeps for |
|---|---|---|
| Daily | Every 03:00 UTC | 30 days |
| Weekly | Every Sunday at 03:00 UTC | 120 days (~17 weeks) |
| Monthly | 1st of each month at 03:00 UTC | 365 days |

So at any moment you have:
- The last 30 daily snapshots (point-in-time recovery within last month)
- ~17 weekly snapshots (3-4 months of weekly history)
- 12 monthly snapshots (full year of monthly history)

Total artifact storage stays well under the 500 MB GitHub free tier limit
for a surf-camp-scale Postgres DB (typical compressed dump: 1-10 MB).

---

## How to restore

### Option A — Full restore to the same Supabase project

⚠️ This OVERWRITES the current data. Only do this if you really want to
roll back to that snapshot. Coordinate with anyone using the app.

1. Download the artifact (.zip) from the workflow run → extract the .sql.gz
2. Unzip locally:
   ```bash
   gunzip supabase-backup-2026-XX-XX_HHMM.sql.gz
   ```
3. Restore (replace `<DB_URL>` with the same connection string you used
   for the secret — keep the password in there):
   ```bash
   psql "<DB_URL>" -f supabase-backup-2026-XX-XX_HHMM.sql
   ```

### Option B — Restore to a fresh project (recommended for partial recovery)

If you only want to recover specific tables (e.g. accidentally deleted
`camp_weeks` rows) WITHOUT losing everything else:

1. Create a new Supabase project (the "scratch" project)
2. Restore the backup into the scratch project (Option A but with the
   scratch project's URL)
3. From the Supabase Table Editor on the scratch project, copy the rows
   you need
4. Paste back into the production project

### Option C — Quick query against a backup (no restore needed)

If you just need to **read** old data without restoring:

1. `gunzip` the backup locally
2. Open it in a text editor — it's plain SQL with INSERT statements
3. Search for the rows you need
4. Or load it into a local Postgres (Docker: `docker run -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16`)
   and query it via psql

---

## Why this workflow exists

A Camp Tab race condition once wiped `camp_weeks` + `camp_guests` for
Morocco. There was no automatic backup on the Supabase free tier, and no
way to recover the data short of reconstructing it manually. This
workflow ensures that never happens again — even on the free tier.

When the project grows beyond free tier needs, upgrade Supabase to **Pro**
($25/month) for built-in point-in-time recovery on top of these artifact
backups. The two are complementary: PITR for instant 5-minute granularity,
artifacts for long-term archival.

---

## Troubleshooting

**Workflow fails with "SUPABASE_DB_URL secret is missing"**
→ You haven't added the secret yet. See step 2 above.

**Workflow fails with "connection refused" / "authentication failed"**
→ The connection string is wrong. Make sure you replaced `[YOUR-PASSWORD]`
with the actual password from the Supabase dashboard.

**Backup file is suspiciously small (<5 KB)**
→ The workflow's sanity check caught a likely failed dump. Check the
pg_dump step logs.

**Workflow doesn't run on schedule**
→ GitHub disables scheduled workflows in repos with no activity for 60+
days. To re-enable, just push any commit or trigger manually once.

---

## Manual trigger (when you want a fresh backup right now)

<https://github.com/Gotadaguasurf/Gotadaguasurf/actions/workflows/supabase-backup.yml>
→ **Run workflow** → **Run workflow** (green button).

Useful before:
- Running a risky migration
- Bulk SQL operations
- Schema changes
- Any time you're nervous about something
