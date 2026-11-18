// ════════════════════════════════════════════════════════════════════════════
//  One line per run of a scheduled job in automation_runs (audit 18 Nov 2026,
//  AUT-09): the cron's own status only says the HTTP call was queued, and the
//  function's answer is gone after 6 hours, so a failed 03:00 backup was never
//  seen. Owner-only reading: hq_automation_health() (supabase/audit-w4-infra.sql).
//  Before that SQL runs the table does not exist: the job carries on, silently.
// ════════════════════════════════════════════════════════════════════════════
// deno-lint-ignore no-explicit-any
export async function recordRun(db: any, job: string, ok: boolean, summary: string, details: unknown = null): Promise<void> {
  try {
    const { error } = await db.from('automation_runs').insert({ job, ok, summary: String(summary || '').slice(0, 500), details })
    if (error && !/automation_runs|PGRST205|42P01/.test(`${error.code || ''} ${error.message || ''}`)) console.warn(`automation_runs: ${error.message}`)
  } catch (_e) { /* never stops the job */ }
}
