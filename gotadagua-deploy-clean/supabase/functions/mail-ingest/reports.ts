// ════════════════════════════════════════════════════════════════════════════
//  mail-ingest · Bookinglayer reports (17 Nov 2026, Miguel: «faz isso automático»)
//
//  accounting@ receives three kinds of Bookinglayer report (lib/bl-ingest.js routeEmail):
//    camp        «AUTO Marrocos / Sri Lanka - hourly para a app (so accounting)» → camp_trips + camp_week_guests,
//                with the Week / Transport import's rules (lib/bl-report.js, the same file the camp hub runs)
//    revenue     «App - Revenue & Partners (check-in last 30 days)» → public.bookings (lib/bl-revenue.js)
//    staff_copy  «App - Semana Marrocos / Sri Lanka (Week + Transfers)» → archived only
//  Anything else is «none» and is never touched. A message with a PDF is never a report → INVOICES ARE NEVER
//  ARCHIVED (Miguel downloads and pays them from the inbox).
//
//  Safety: bl_report_settings (supabase/bl-report-ingest.sql) starts in DRY RUN — parse, compute, log the diff in
//  bl_report_runs, import nothing, archive nothing. Each Gmail message is processed once (bl_report_runs.message_id
//  unique, claimed before any work). Oldest first; for each camp only the newest pending report is imported, older
//  ones are «superseded»; bl_report_camp_apply re-checks under a per-camp lock that no newer report was imported.
//  Archiving = remove the INBOX label, only with settings.archive on, outside dry run, and when the mailbox token
//  has gmail.modify (the connection made before 17 Nov is read-only: reconnect with ?start=SECRET&modify=1).
// ════════════════════════════════════════════════════════════════════════════
import '../_shared/lib/camp-config.js'
import '../_shared/lib/guests-trips.js'
import '../_shared/lib/bl-report.js'
import '../_shared/lib/bl-ingest.js'
import '../_shared/lib/bl-revenue.js'

// deno-lint-ignore no-explicit-any
type Any = any
const G = globalThis as Any
const BI = () => G.BlIngest
const BRV = () => G.BlRevenue
const CC = () => G.CampConfig

export const REPORT_ACCOUNT = 'accounting@gotadaguasurf.com'
// Wide on purpose (the exact sender is not pinned): routeEmail decides; anything that is not a report is logged «ignored» once.
export const REPORT_QUERY = 'newer_than:2d -in:spam -in:trash ({subject:hourly subject:semana subject:revenue} OR filename:csv)'
const TRIPS_LOAD_FROM = '2026-10-01'   // = camp-hub/transport.js (the trips the import compares against)
const MAX_MESSAGES = 120

export interface ReportDeps {
  gmail: (token: string, path: string) => Promise<Any>
  mailToken: (db: Any, acct: Record<string, unknown>) => Promise<string>
  header: (msg: Record<string, unknown>, name: string) => string
  b64urlToBytes: (s: string) => Uint8Array
  modify?: (token: string, id: string, body: Record<string, unknown>) => Promise<unknown>   // tests replace it
}
interface Att { filename: string; mime: string; attachmentId: string; data: string; size: number }
function attachmentsOf(part: Record<string, unknown>, out: Att[] = []): Att[] {
  if (!part) return out
  const filename = String(part.filename || '')
  const body = (part.body || {}) as Record<string, unknown>
  if (filename) out.push({ filename, mime: String(part.mimeType || ''), attachmentId: String(body.attachmentId || ''), data: String(body.data || ''), size: Number(body.size || 0) })
  for (const p of (part.parts as Record<string, unknown>[] | undefined) || []) attachmentsOf(p, out)
  return out
}
const canModify = (scopes: string | null | undefined) => /gmail\.modify|mail\.google\.com/.test(String(scopes || ''))

async function fetchAll(build: () => Any): Promise<Any[]> {
  const out: Any[] = []
  for (let p = 0; p < 50; p++) {
    const { data, error } = await build().range(p * 1000, p * 1000 + 999)
    if (error) throw new Error(error.message || String(error))
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export interface ReportRunOpts { messageIds?: string[] }
export async function runReports(db: Any, deps: ReportDeps, opts: ReportRunOpts = {}) {
  const lines: string[] = []
  const summary: Record<string, Any> = { checked: 0, imported: 0, dry_run: 0, superseded: 0, copy: 0, refused: 0, error: 0, ignored: 0, archived: 0, lines }
  const { data: settings, error: sErr } = await db.from('bl_report_settings').select('*').eq('id', 1).maybeSingle()
  if (sErr || !settings) { lines.push('bl_report_settings is missing — run supabase/bl-report-ingest.sql'); return summary }
  const { data: acct } = await db.from('mail_ingest_account').select('*').eq('email', REPORT_ACCOUNT).eq('active', true).maybeSingle()
  if (!acct) { lines.push(`${REPORT_ACCOUNT} is not connected`); return summary }
  const token = await deps.mailToken(db, acct)
  const { data: fresh } = await db.from('mail_ingest_account').select('scopes').eq('id', acct.id).maybeSingle()
  const scopes = (fresh && fresh.scopes) || acct.scopes || ''

  // 1 · the candidate messages, minus those already logged
  let ids: string[] = opts.messageIds || []
  if (!ids.length) {
    const list = await deps.gmail(token, `messages?q=${encodeURIComponent(REPORT_QUERY)}&maxResults=${MAX_MESSAGES}`)
    ids = (list.messages || []).map((m: { id: string }) => m.id)
  }
  if (!ids.length) { lines.push('no report email'); return summary }
  const { data: seen } = await db.from('bl_report_runs').select('message_id').in('message_id', ids)
  const seenSet = new Set((seen || []).map((r: Any) => r.message_id))
  const msgs: Any[] = []
  for (const id of ids) {
    if (seenSet.has(id)) continue
    const msg = await deps.gmail(token, `messages/${id}?format=full`)
    const atts = attachmentsOf(msg.payload)
    const subject = deps.header(msg, 'Subject')
    msgs.push({ id, msg, atts, subject, from: deps.header(msg, 'From'), internalDate: Number(msg.internalDate || 0), labels: msg.labelIds || [],
      route: BI().routeEmail({ subject, attachments: atts.map(a => ({ filename: a.filename, mime: a.mime })) }) })
  }
  summary.checked = msgs.length
  const { order, superseded } = BI().orderReports(msgs)

  // 2 · one by one, oldest first
  for (const m of order) {
    const route = m.route
    const receivedAt = m.internalDate ? new Date(m.internalDate).toISOString() : null
    const claim = { account_email: REPORT_ACCOUNT, message_id: m.id, received_at: receivedAt, subject: String(m.subject || '').slice(0, 200),
      filename: (route.csv ? route.csv.filename : (m.atts[0] || {}).filename || '').slice(0, 200), report: route.kind, location_slug: route.camp, status: 'processing' }
    const { data: run, error: claimErr } = await db.from('bl_report_runs').insert(claim).select('id').single()
    if (claimErr || !run) { lines.push(`${m.id}: already taken by another run`); continue }
    const dry = route.kind === 'revenue' ? !!settings.dry_run_revenue : !!settings.dry_run_camp
    let status = 'error'
    try {
      if (route.kind === 'none') status = await finish(db, run.id, 'ignored', { error: route.reason })
      else if (route.kind === 'staff_copy') status = await finish(db, run.id, dry ? 'dry_run' : 'copy', { changes: { action: 'staff copy: archive only (the hourly AUTO report is the source)' } })
      else if (superseded.has(m.id)) status = await finish(db, run.id, 'superseded', { error: 'a newer report of the same kind came in the same run' })
      else if (!route.csv) status = await finish(db, run.id, 'refused', { error: route.reason })
      else {
        const text = await csvText(deps, token, m.id, route.csv, m.atts)
        status = route.kind === 'camp' ? await handleCamp(db, run.id, route.camp, text, route.csv.filename, receivedAt!, settings, dry)
          : await handleRevenue(db, run.id, text, receivedAt!, dry)
      }
    } catch (e) {
      status = await finish(db, run.id, 'error', { error: ((e as Error).message || String(e)).slice(0, 800) })
    }
    summary[status] = (summary[status] || 0) + 1
    lines.push(`${route.kind}${route.camp ? ' ' + route.camp : ''} ${receivedAt ? receivedAt.slice(0, 16) : ''}: ${status}`)
    // 3 · archive (reports only — never «none»; never with a PDF; never in dry run)
    if (settings.archive && !dry && route.archivable && ['imported', 'superseded', 'copy'].includes(status) && (m.labels || []).includes('INBOX')) {
      if (!canModify(scopes)) {
        await db.from('bl_report_runs').update({ archive_error: 'the accounting@ connection is read-only (gmail.readonly) — reconnect it with ?start=SECRET&modify=1' }).eq('id', run.id)
      } else {
        try {
          await (deps.modify || gmailModify)(token, m.id, { removeLabelIds: ['INBOX'] })
          await db.from('bl_report_runs').update({ archived_at: new Date().toISOString() }).eq('id', run.id)
          summary.archived++
        } catch (e) {
          await db.from('bl_report_runs').update({ archive_error: ((e as Error).message || String(e)).slice(0, 300) }).eq('id', run.id)
        }
      }
    }
  }
  return summary
}

async function finish(db: Any, id: string, status: string, extra: Record<string, unknown> = {}) {
  await db.from('bl_report_runs').update({ status, finished_at: new Date().toISOString(), ...extra }).eq('id', id)
  return status
}
async function csvText(deps: ReportDeps, token: string, messageId: string, csv: { filename: string }, atts: Att[]) {
  const a = atts.find(x => x.filename === csv.filename)!
  let b64 = a.data
  if (!b64 && a.attachmentId) b64 = String((await deps.gmail(token, `messages/${messageId}/attachments/${a.attachmentId}`)).data || '')
  if (!b64) throw new Error('the CSV attachment is empty')
  return new TextDecoder('utf-8').decode(deps.b64urlToBytes(b64)).replace(/^﻿/, '')
}
async function gmailModify(token: string, id: string, body: Record<string, unknown>) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Gmail modify: ${out?.error?.message || r.status}`)
  return out
}

// ── Camp report ──────────────────────────────────────────────────────────────
async function handleCamp(db: Any, runId: string, slug: string, text: string, fileName: string, receivedAt: string, settings: Any, dry: boolean) {
  const cfg = CC().get(slug)
  if (!cfg) return finish(db, runId, 'refused', { error: `camp ${slug} has no settings` })
  const { data: loc, error: le } = await db.from('locations').select('id, slug').eq('slug', slug).single()
  if (le || !loc) return finish(db, runId, 'error', { error: `location ${slug} not found` })
  await db.from('bl_report_runs').update({ location_id: loc.id }).eq('id', runId)
  // a report older than the last one imported for this camp is never imported
  const { data: last } = await db.from('bl_report_runs').select('received_at').eq('location_id', loc.id).eq('report', 'camp').eq('source', 'mail')
    .eq('status', 'imported').order('received_at', { ascending: false }).limit(1)
  if (last && last[0] && BI().olderThanLast(receivedAt, last[0].received_at)) return finish(db, runId, 'superseded', { error: `older than the report imported (${last[0].received_at})` })
  const [appTrips, appGuests, catalog] = await Promise.all([
    fetchAll(() => db.from('camp_trips').select('*').eq('location_id', loc.id).gte('trip_date', TRIPS_LOAD_FROM).order('trip_date').order('id')),
    fetchAll(() => db.from('camp_week_guests').select('*').eq('location_id', loc.id).order('id')),
    fetchAll(() => db.from('pricing_catalog').select('name, cost_per_guest, picker_tab, sort_order, active, show_in_transport_picker').eq('location_id', loc.id)
      .eq('category', 'Transport').eq('active', true).eq('show_in_transport_picker', true).order('sort_order')),
  ])
  const now = BI().localNow(cfg.tz)
  const receivedYmd = BI().localNow(cfg.tz, receivedAt).slice(0, 10)
  const plan = BI().planCampReport({ text, fileName, slug, appTrips, appGuests, catalog, now, receivedYmd, cancelVanished: settings.cancel_vanished !== false })
  const win = plan.window || BI().reportWindow(receivedYmd)
  await db.from('bl_report_runs').update({ rows: plan.rows ?? null, window_from: win.from, window_to: win.to, changes: plan.changes }).eq('id', runId)
  if (!plan.ok) return finish(db, runId, 'refused', { error: plan.refused })
  if (dry) return finish(db, runId, 'dry_run')
  const { data, error } = await db.rpc('bl_report_camp_apply', {
    p_run: runId, p_location: loc.id, p_received_at: receivedAt, p_merges: plan.merges, p_vanish: plan.vanish.map((a: Any) => a.id),
    p_export_date: plan.rpc.p_export_date, p_refs_present: plan.rpc.p_refs_present, p_trips: plan.rpc.p_trips, p_guests: plan.rpc.p_guests,
  })
  if (error) return finish(db, runId, 'error', { error: 'import failed (nothing saved): ' + (error.message || String(error)) })
  return data && data.superseded ? 'superseded' : 'imported'   // the function wrote the run row
}

// ── Revenue & Partners ───────────────────────────────────────────────────────
async function handleRevenue(db: Any, runId: string, text: string, receivedAt: string, dry: boolean) {
  const { data: last } = await db.from('bl_report_runs').select('received_at').eq('report', 'revenue').eq('status', 'imported').order('received_at', { ascending: false }).limit(1)
  if (last && last[0] && BI().olderThanLast(receivedAt, last[0].received_at)) return finish(db, runId, 'superseded', { error: `older than the report imported (${last[0].received_at})` })
  const parsed = BRV().parse(text)
  if (parsed.missing.length) return finish(db, runId, 'refused', { rows: parsed.rows.length, error: `columns missing (adjust ALIASES in lib/bl-revenue.js): ${parsed.missing.join(', ')}`, changes: { headers: parsed.headers } })
  if (!parsed.rows.length) return finish(db, runId, 'refused', { rows: 0, error: 'no booking in the report' })
  const refs = [...new Set(parsed.rows.map((r: Any) => r.ref))] as string[]
  const existing: Any[] = []
  for (let i = 0; i < refs.length; i += 200) {
    const { data, error } = await db.from('bookings').select('*').in('booking_ref', refs.slice(i, i + 200))
    if (error) throw new Error('reading bookings: ' + error.message)
    existing.push(...(data || []))
  }
  const { data: partners, error: pe } = await db.from('partners').select('name')
  if (pe) throw new Error('reading partners: ' + pe.message)
  const plan = BRV().plan(parsed.rows, existing, (partners || []).map((p: Any) => p.name))
  const changes = BRV().summarize(plan, parsed)
  await db.from('bl_report_runs').update({ rows: parsed.rows.length, changes }).eq('id', runId)
  if (dry) return finish(db, runId, 'dry_run')
  if (!plan.upserts.length) return finish(db, runId, 'imported', { result: { upserted: 0, snapshots: 0, partners_created: 0 } })
  const { data, error } = await db.rpc('bl_report_bookings_apply', { p_run: runId, p_received_at: receivedAt, p_rows: plan.upserts, p_new_partners: plan.newPartners })
  if (error) return finish(db, runId, 'error', { error: 'bookings update failed (nothing saved): ' + (error.message || String(error)) })
  return data && data.superseded ? 'superseded' : 'imported'
}
