// ════════════════════════════════════════════════════════════════════════════
//  mail-ingest · Bookinglayer reports (17 Nov 2026, Miguel: «faz isso automático»)
//
//  accounting@ receives three kinds of Bookinglayer report (lib/bl-ingest.js routeEmail):
//    camp        «AUTO Marrocos / Sri Lanka - hourly para a app (so accounting)» → camp_trips + camp_week_guests,
//                with the Week / Transport import's rules (lib/bl-report.js, the same file the camp hub runs)
//    revenue     «App - Revenue & Partners (check-in last 30 days)» → public.bookings (lib/bl-revenue.js)
//    staff_copy  «App - Semana Marrocos / Sri Lanka (Week + Transfers)» → archived only
//  Anything else is «none» and is never touched. A message with a PDF is never a report → INVOICES ARE NEVER
//  ARCHIVED (Miguel downloads and pays them from the inbox). A report comes from no-reply@bookinglayer.com with NO
//  attachment: subject «Report: <date> - <title>», an HTML «Download report» link to a signed
//  https://downloads.bookinglayer.io/reports/<uuid>?expires=…&signature=… (30 days, no login). Only that host and path
//  are fetched (never api. / app.bookinglayer.io), 30 s timeout, 20 MB cap, redirects only to the same host or cloud
//  storage (logged), the body must be a CSV. 401 / 403 / 410 → «link expired». Every file downloaded is kept 30 days,
//  gzipped, in the private Storage bucket bl-reports (identical files once).
//
//  Safety: bl_report_settings (supabase/bl-report-ingest.sql) starts in DRY RUN — parse, compute, log the diff in
//  bl_report_runs, import nothing, archive nothing. Each Gmail message is processed once (bl_report_runs.message_id
//  unique, claimed before any work). Oldest first; for each camp only the newest pending report is imported, older
//  ones are «superseded»; bl_report_camp_apply re-checks under a per-camp lock that no newer report was imported.
//  Archiving = remove the INBOX label, only with settings.archive on, outside dry run, and when the mailbox token
//  has gmail.modify (the connection made before 17 Nov is read-only: reconnect with ?start=SECRET&modify=1).
// ════════════════════════════════════════════════════════════════════════════
import '../_shared/lib-globals.ts'          // first: the libraries below register themselves on self
import '../_shared/lib/camp-config.js'
import '../_shared/lib/transport-catalog.js'
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
// Bookinglayer's sender only; routeEmail decides on the title (anything else from it is logged «ignored» once).
export const REPORT_QUERY = 'from:no-reply@bookinglayer.com newer_than:2d -in:spam -in:trash'
const TRIPS_LOAD_FROM = '2026-10-01'   // = camp-hub/transport.js (the trips the import compares against)
const MAX_MESSAGES = 120
const MAX_DOWNLOAD = 20 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 30_000
const BUCKET = 'bl-reports'
const KEEP_DAYS = 30

export interface ReportDeps {
  gmail: (token: string, path: string) => Promise<Any>
  mailToken: (db: Any, acct: Record<string, unknown>) => Promise<string>
  header: (msg: Record<string, unknown>, name: string) => string
  b64urlToBytes: (s: string) => Uint8Array
  modify?: (token: string, id: string, body: Record<string, unknown>) => Promise<unknown>   // tests replace it
  fetch?: typeof fetch                                                                      // the report download (tests replace it)
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
// The text of the email's html / plain part (base64url in format=full).
function bodyOf(part: Record<string, unknown>, mime: string, b64: (s: string) => Uint8Array): string {
  if (!part) return ''
  const body = (part.body || {}) as Record<string, unknown>
  if (String(part.mimeType || '').toLowerCase() === mime && !part.filename && body.data) return new TextDecoder('utf-8').decode(b64(String(body.data)))
  for (const p of (part.parts as Record<string, unknown>[] | undefined) || []) { const t = bodyOf(p, mime, b64); if (t) return t }
  return ''
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
    const subject = deps.header(msg, 'Subject'), from = deps.header(msg, 'From')
    msgs.push({ id, msg, atts, subject, from, internalDate: Number(msg.internalDate || 0), labels: msg.labelIds || [],
      route: BI().routeEmail({ from, subject, html: bodyOf(msg.payload, 'text/html', deps.b64urlToBytes), text: bodyOf(msg.payload, 'text/plain', deps.b64urlToBytes),
        attachments: atts.map(a => ({ filename: a.filename, mime: a.mime })) }) })
  }
  summary.checked = msgs.length
  const { order, superseded } = BI().orderReports(msgs)
  if (msgs.length) await purgeFiles(db).catch(() => { /* the bucket is housekeeping, never a reason to stop */ })

  // 2 · one by one, oldest first
  for (const m of order) {
    const route = m.route
    const receivedAt = m.internalDate ? new Date(m.internalDate).toISOString() : null
    const claim = { account_email: REPORT_ACCOUNT, message_id: m.id, received_at: receivedAt, subject: String(m.subject || '').slice(0, 200),
      filename: (route.csv ? route.csv.filename : route.link ? BI().linkForLog(route.link) : (m.atts[0] || {}).filename || '').slice(0, 200), report: route.kind, location_slug: route.camp, status: 'processing' }
    const { data: run, error: claimErr } = await db.from('bl_report_runs').insert(claim).select('id').single()
    if (claimErr || !run) { lines.push(`${m.id}: already taken by another run`); continue }
    const dry = route.kind === 'revenue' ? !!settings.dry_run_revenue : !!settings.dry_run_camp
    let status = 'error'
    try {
      if (route.kind === 'none') status = await finish(db, run.id, 'ignored', { error: route.reason })
      else if (route.kind === 'staff_copy') status = await finish(db, run.id, dry ? 'dry_run' : 'copy', { changes: { action: 'staff copy: archive only (the hourly AUTO report is the source)' } })
      else if (superseded.has(m.id)) status = await finish(db, run.id, 'superseded', { error: 'a newer report of the same kind came in the same run' })
      else if (!route.csv && !route.link) status = await finish(db, run.id, 'refused', { error: route.reason })
      else if (await olderThanImported(db, route, receivedAt!)) status = await finish(db, run.id, 'superseded', { error: 'older than the report already imported' })
      else {
        const got = route.csv ? await attachmentFile(deps, token, m.id, route.csv, m.atts) : await downloadReport(deps.fetch || fetch, route.link)
        if (got.refused) status = await finish(db, run.id, 'refused', { error: got.refused, download: got.download || null })
        else {
          const file = await keepFile(db, route, m.id, got.bytes).catch((e: Error) => ({ file_error: String(e.message || e).slice(0, 300) }))
          await db.from('bl_report_runs').update({ download: got.download || null, ...file }).eq('id', run.id)
          const name = route.csv ? route.csv.filename : `${String(m.subject || 'report').replace(/[^\w .()&-]+/g, ' ').trim().slice(0, 120)}.csv`
          status = route.kind === 'camp' ? await handleCamp(db, run.id, route.camp, got.text, name, receivedAt!, settings, dry)
            : await handleRevenue(db, run.id, got.text, receivedAt!, dry)
        }
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
interface Got { text: string; bytes: Uint8Array; refused?: string; download?: Record<string, unknown> }
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
async function attachmentFile(deps: ReportDeps, token: string, messageId: string, csv: { filename: string }, atts: Att[]): Promise<Got> {
  const a = atts.find(x => x.filename === csv.filename)!
  let b64 = a.data
  if (!b64 && a.attachmentId) b64 = String((await deps.gmail(token, `messages/${messageId}/attachments/${a.attachmentId}`)).data || '')
  if (!b64) return { text: '', bytes: new Uint8Array(), refused: 'the CSV attachment is empty' }
  const bytes = deps.b64urlToBytes(b64)
  return { text: decode(bytes), bytes, download: { attachment: csv.filename } }
}
// The signed «Download report» link → the CSV. Only https://downloads.bookinglayer.io/reports/… (routeEmail checked it);
// redirects followed by hand, each one to the same host or cloud storage only, and logged without the signature.
export async function downloadReport(fetchFn: typeof fetch, url: string): Promise<Got> {
  const hops = [BI().linkForLog(url)]
  const no = (refused: string, extra: Record<string, unknown> = {}): Got => ({ text: '', bytes: new Uint8Array(), refused, download: { hops, ...extra } })
  if (!BI().safeReportUrl(url).url) return no('the download link is not https://downloads.bookinglayer.io/reports/… — not followed')
  let u = url
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      let r: Response
      try { r = await fetchFn(u, { redirect: 'manual', signal: ctl.signal, headers: { accept: 'text/csv, text/plain, */*' } }) }
      catch (e) { return no(ctl.signal.aborted ? `download timed out (${DOWNLOAD_TIMEOUT_MS / 1000} s)` : 'download failed: ' + String((e as Error).message || e).slice(0, 200)) }
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get('location'); if (!loc) return no(`HTTP ${r.status} without a location`)
        const next = new URL(loc, u).toString()
        if (!BI().allowedRedirect(next)) return no(`the download redirected to ${new URL(next).host} — not followed`)
        hops.push(BI().linkForLog(next)); u = next; continue
      }
      if ([401, 403, 410].includes(r.status)) return no(`link expired (HTTP ${r.status})`, { status: r.status })
      if (!r.ok) return no(`download failed: HTTP ${r.status}`, { status: r.status })
      const len = Number(r.headers.get('content-length') || 0)
      if (len > MAX_DOWNLOAD) return no(`the report is ${Math.round(len / 1048576)} MB — over the ${MAX_DOWNLOAD / 1048576} MB cap`)
      const chunks: Uint8Array[] = []; let total = 0
      const reader = r.body ? r.body.getReader() : null
      if (reader) for (;;) {
        const { done, value } = await reader.read(); if (done) break
        total += value.length; if (total > MAX_DOWNLOAD) { await reader.cancel().catch(() => {}); return no(`the report is over the ${MAX_DOWNLOAD / 1048576} MB cap`) }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length }
      const text = decode(bytes)
      const download = { hops, status: r.status, content_type: r.headers.get('content-type') || null, bytes: total }
      // an HTML «link expired» page, an XML S3 error, a PDF… is not the report
      if (!BI().looksLikeCsv(text)) return { text: '', bytes, refused: /expired|signature|accessdenied|request has expired/i.test(text.slice(0, 2000)) ? 'link expired (not a CSV: the page says so)' : 'the download is not a CSV', download }
      return { text, bytes, download }
    } finally { clearTimeout(tm) }
  }
  return no('too many redirects')
}

// ── The CSVs, kept 30 days for the audit (private bucket, gzip, one copy per identical file) ─────────
async function sha256Hex(bytes: Uint8Array) { const h = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('') }
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
async function keepFile(db: Any, route: Any, messageId: string, bytes: Uint8Array) {
  const sha = await sha256Hex(bytes)
  const { data: same } = await db.from('bl_report_runs').select('file_path').eq('file_sha256', sha).not('file_path', 'is', null).limit(1)
  if (same && same[0] && same[0].file_path) return { file_sha256: sha, file_bytes: bytes.length, file_path: same[0].file_path }
  const path = `${new Date().toISOString().slice(0, 10)}/${route.kind}${route.camp ? '-' + route.camp : ''}-${messageId}.csv.gz`
  const { error } = await db.storage.from(BUCKET).upload(path, await gzip(bytes), { contentType: 'application/gzip', upsert: true })
  if (error) return { file_sha256: sha, file_bytes: bytes.length, file_error: 'not kept: ' + String(error.message || error).slice(0, 200) }
  return { file_sha256: sha, file_bytes: bytes.length, file_path: path }
}
// Folders are days (YYYY-MM-DD/…): those older than 30 days are removed.
async function purgeFiles(db: Any) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10)
  const { data: days } = await db.storage.from(BUCKET).list('', { limit: 1000 })
  for (const d of (days || []).filter((x: Any) => /^\d{4}-\d{2}-\d{2}$/.test(x.name) && x.name < cutoff)) {
    const { data: files } = await db.storage.from(BUCKET).list(d.name, { limit: 1000 })
    const paths = (files || []).map((f: Any) => `${d.name}/${f.name}`)
    if (paths.length) await db.storage.from(BUCKET).remove(paths)
  }
}
// Before downloading: a report older than the last one imported (same camp, or Revenue) is never needed.
async function olderThanImported(db: Any, route: Any, receivedAt: string) {
  let q = db.from('bl_report_runs').select('received_at').eq('report', route.kind).eq('source', 'mail').eq('status', 'imported')
  if (route.camp) q = q.eq('location_slug', route.camp)
  const { data } = await q.order('received_at', { ascending: false }).limit(1)
  return !!(data && data[0] && BI().olderThanLast(receivedAt, data[0].received_at))
}
async function gmailModify(token: string, id: string, body: Record<string, unknown>) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Gmail modify: ${out?.error?.message || r.status}`)
  return out
}

// /prices rows as the camp hub reads them (camp-hub/index.html TRANSPORT_CATALOG_COLS); covers_pax / bl_product only once
// supabase/transport-catalog-one-source.sql has run.
const CATALOG_COLS = 'id,name,cost_per_guest,currency,sell_price,sell_currency,capacity,notes,linked_transport_preset_id,linked_camp_tab_id,picker_tab,sort_order'
async function catalogRows(db: Any, loc: string) {
  const q = (cols: string) => db.from('pricing_catalog').select(cols).eq('location_id', loc).eq('category', 'Transport').eq('show_in_transport_picker', true).eq('active', true).order('sort_order', { ascending: true })
  let { data, error } = await q(CATALOG_COLS + ',covers_pax,bl_product')
  if (error && /covers_pax|bl_product/.test(String(error.message || '') + String(error.details || '') + String(error.hint || ''))) ({ data, error } = await q(CATALOG_COLS))
  if (error) throw new Error('reading /prices: ' + (error.message || String(error)))
  return data || []
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
    catalogRows(db, loc.id),
  ])
  const now = BI().localNow(cfg.tz)
  const receivedYmd = BI().localNow(cfg.tz, receivedAt).slice(0, 10)
  const plan = BI().planCampReport({ text, fileName, slug, appTrips, appGuests, catalog, now, receivedYmd, cancelVanished: settings.cancel_vanished === true })
  const win = plan.window || BI().reportWindow(receivedYmd)
  await db.from('bl_report_runs').update({ rows: plan.rows ?? null, window_from: win.from, window_to: win.to, changes: plan.changes }).eq('id', runId)
  if (!plan.ok) return finish(db, runId, 'refused', { error: plan.refused })
  if (dry) return finish(db, runId, 'dry_run')
  const { data, error } = await db.rpc('bl_report_camp_apply', {
    p_run: runId, p_location: loc.id, p_received_at: receivedAt, p_merges: plan.merges, p_vanish: plan.vanish.map((a: Any) => a.id),
    p_export_date: plan.rpc.p_export_date, p_refs_present: plan.rpc.p_refs_present, p_trips: plan.rpc.p_trips, p_guests: plan.rpc.p_guests,
  })
  if (error) return finish(db, runId, 'error', { error: 'import failed (nothing saved): ' + (error.message || String(error)) })
  if (data && data.superseded) return 'superseded'   // the function wrote the run row
  // Bookings that left the report (check-out inside the window): their future trips go on hold with a question for the
  // camp, never an automatic cancel (audit 18 Nov 2026, WEEK-03). Only a live, unpaid trip is touched; the import above
  // never changes these trips (their booking is not in the file). A failure is logged on the run, the import stands.
  const failed: string[] = []
  for (const x of (plan.hold || [])) {
    const { error: he } = await db.from('camp_trips').update(x.patch).eq('id', x.id).eq('location_id', loc.id)
      .in('status', ['planned', 'sent', 'confirmed']).is('payment_entry_id', null)
    if (he) failed.push(`${x.trip.booking_ref}: ${he.message || String(he)}`)
  }
  if (failed.length) await db.from('bl_report_runs').update({ error: `imported, but ${failed.length} trip${failed.length === 1 ? '' : 's'} not put on hold — ${failed.join('; ')}` }).eq('id', runId)
  return 'imported'
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
  // A realized booking inside the file's check-in range that the file no longer has: listed «left the report — check»
  // in the run log, never changed (audit 18 Nov 2026, PRT-19 / SEAM-18). A failed read only loses the list.
  let left: Any[] = []
  const cis = parsed.rows.map((r: Any) => r.checkinMs ? new Date(r.checkinMs).toISOString().slice(0, 10) : '').filter(Boolean).sort()
  if (cis.length) {
    const range = { from: cis[0], to: cis[cis.length - 1] }
    const inRange: Any[] = []; let readErr = ''
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('bookings').select('booking_ref,check_in_on,location,raw_payload').gte('check_in_on', range.from).lte('check_in_on', range.to).order('booking_ref').range(from, from + 999)
      if (error) { readErr = error.message || String(error); break }
      inRange.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    if (readErr) plan.notes.push(`could not check for bookings that left the report: ${readErr}`)
    else left = BRV().leftReport(inRange, refs, range)
  }
  const changes = BRV().summarize(plan, parsed, left)
  await db.from('bl_report_runs').update({ rows: parsed.rows.length, changes }).eq('id', runId)
  if (dry) return finish(db, runId, 'dry_run')
  if (!plan.upserts.length) return finish(db, runId, 'imported', { result: { upserted: 0, snapshots: 0, partners_created: 0 } })
  const { data, error } = await db.rpc('bl_report_bookings_apply', { p_run: runId, p_received_at: receivedAt, p_rows: plan.upserts, p_new_partners: plan.newPartners })
  if (error) return finish(db, runId, 'error', { error: 'bookings update failed (nothing saved): ' + (error.message || String(error)) })
  return data && data.superseded ? 'superseded' : 'imported'
}
