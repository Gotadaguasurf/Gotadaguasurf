// ════════════════════════════════════════════════════════════════════════════
//  hq-weekly-digest — Sunday-morning owner email with the week's numbers.
//
//  Triggers:
//    A) pg_cron once a week, Authorization = service-role key.
//    B) Manual preview: GET/POST ?preview=1 returns the HTML without sending.
//    C) Manual send-to-one:  POST { to: "miguel@..." } (still service-role).
//
//  What it includes:
//    - Business profit for last full Mon–Sun (revenue − spend) + delta vs prev
//    - Bookings count + gross by location
//    - Spend by paying_company (Water Movements / MGRP / Wave)
//    - Cash-flow chips per company (invoices + transfers, net)
//    - Health: needs-review count, duplicates count, recurring due count
//    - Top 5 expenses last week
//
//  Secrets required:
//    GOOGLE_OAUTH_CLIENT_ID
//    GOOGLE_OAUTH_CLIENT_SECRET
//    DIGEST_TO_EMAIL           (default recipient; defaults to miguel@…)
//    SUPABASE_URL              (auto)
//    SUPABASE_SERVICE_ROLE_KEY (auto)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DEFAULT_TO    = Deno.env.get('DIGEST_TO_EMAIL') || 'miguel@gotadaguasurf.com'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

// ─── date helpers ──────────────────────────────────────────────────────────
// The digest runs Monday at ~09:00 Europe/Lisbon and covers the previous full
// Mon 00:00 → Sun 23:59:59 window. We compute in UTC to avoid DST issues.
function weekRange(now: Date): { start: Date; end: Date; prevStart: Date; prevEnd: Date; label: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // Sun=0..Sat=6
  const daysBackToLastMon = (dow === 0 ? 6 : dow - 1) + 7
  const start = new Date(d)
  start.setUTCDate(start.getUTCDate() - daysBackToLastMon)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  const prevStart = new Date(start)
  prevStart.setUTCDate(prevStart.getUTCDate() - 7)
  const prevEnd = new Date(start)
  const fmt = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const endInclusive = new Date(end); endInclusive.setUTCDate(endInclusive.getUTCDate() - 1)
  const label = `${fmt(start)} – ${fmt(endInclusive)}, ${endInclusive.getUTCFullYear()}`
  return { start, end, prevStart, prevEnd, label }
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

const eur = (n: number) => {
  const s = Math.round(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })
  return '€' + s
}

// ─── Gmail send (inline; we don't share JWT with gmail-send Edge Fn) ───────
async function ensureAccessToken(supa: ReturnType<typeof createClient>) {
  const { data: acct, error } = await supa.from('gmail_account').select('*').limit(1).single()
  if (error || !acct) throw new Error('No gmail_account row — connect via /gmail-oauth/start first')
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0
  if (acct.access_token && expiresAt > Date.now() + 60_000) return { token: acct.access_token, email: acct.email }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!resp.ok) throw new Error(`Token refresh failed: HTTP ${resp.status} ${await resp.text()}`)
  const tk = await resp.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + (tk.expires_in - 30) * 1000).toISOString()
  await supa.from('gmail_account').update({
    access_token: tk.access_token,
    access_expires_at: newExpiry,
    updated_at: new Date().toISOString(),
  }).eq('id', acct.id)
  return { token: tk.access_token, email: acct.email }
}

function buildRawMultipart(args: { from: string; fromName: string; to: string; subject: string; html: string; text: string }) {
  const boundary = 'gd-boundary-' + Math.floor(Math.random() * 1e9).toString(36)
  const toUtf8 = (s: string) => unescape(encodeURIComponent(s || ''))
  const subjB64 = btoa(toUtf8(args.subject))
  const fromHeader = `"${args.fromName.replace(/"/g, "'")}" <${args.from}>`
  const lines = [
    `From: ${fromHeader}`,
    `Reply-To: ${args.from}`,
    `To: ${args.to}`,
    `Subject: =?utf-8?B?${subjB64}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    args.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    args.html,
    '',
    `--${boundary}--`,
    '',
  ]
  const msg = lines.join('\r\n')
  return btoa(toUtf8(msg)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sendViaGmail(supa: ReturnType<typeof createClient>, to: string, subject: string, html: string, text: string) {
  const { token, email } = await ensureAccessToken(supa)
  const raw = buildRawMultipart({ from: email, fromName: "Gota d'Água HQ", to, subject, html, text })
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!resp.ok) throw new Error(`Gmail send failed: HTTP ${resp.status} ${await resp.text()}`)
  return await resp.json()
}

// ─── data aggregation ──────────────────────────────────────────────────────
interface WeekNumbers {
  revenue: number
  spend: number
  profit: number
  bookingsCount: number
  bookingsByLoc: Map<string, { count: number; gross: number }>
  spendByCompany: Map<string, number>
  transfersNetByCompany: Map<string, number>
  needsReview: number
  duplicates: number
  recurringDue: number
  topExpenses: Array<{ date: string; company: string; category: string | null; amount: number; location: string | null }>
}

async function computeWeek(supa: ReturnType<typeof createClient>, start: Date, end: Date): Promise<WeekNumbers> {
  const s = iso(start); const e = iso(end)
  // Bookings — sum(total) where check_in_on ∈ [s, e). Non-duplicates only.
  const bookingsRes = await supa
    .from('bookings')
    .select('total, location, check_in_on')
    .gte('check_in_on', s).lt('check_in_on', e)
  const bookings = bookingsRes.data || []
  const bookingsByLoc = new Map<string, { count: number; gross: number }>()
  let revenue = 0, bookingsCount = 0
  for (const b of bookings) {
    const loc = (b.location as string) || 'unknown'
    const gross = Number(b.total) || 0
    revenue += gross
    bookingsCount++
    const prev = bookingsByLoc.get(loc) || { count: 0, gross: 0 }
    bookingsByLoc.set(loc, { count: prev.count + 1, gross: prev.gross + gross })
  }
  // Invoices — sum(amount_eur) where invoice_date ∈ [s, e) AND is_duplicate=false.
  const invRes = await supa
    .from('hq_invoices')
    .select('amount_eur, paying_company, invoice_date, company, category_name, location_slug, is_duplicate, needs_review')
    .gte('invoice_date', s).lt('invoice_date', e)
    .eq('is_duplicate', false)
  const invoices = invRes.data || []
  const spendByCompany = new Map<string, number>()
  let spend = 0
  for (const i of invoices) {
    const amt = Number(i.amount_eur) || 0
    spend += amt
    const co = (i.paying_company as string) || 'unknown'
    spendByCompany.set(co, (spendByCompany.get(co) || 0) + amt)
  }
  const topExpenses = [...invoices]
    .sort((a, b) => (Number(b.amount_eur) || 0) - (Number(a.amount_eur) || 0))
    .slice(0, 5)
    .map((i) => ({
      date: String(i.invoice_date),
      company: String(i.company || ''),
      category: (i.category_name as string) || null,
      amount: Number(i.amount_eur) || 0,
      location: (i.location_slug as string) || null,
    }))
  // Internal transfers — net per company (money in − out).
  const trRes = await supa
    .from('internal_transfers')
    .select('from_company, to_company, amount_eur, transfer_date')
    .gte('transfer_date', s).lt('transfer_date', e)
  const transfers = trRes.data || []
  const transfersNetByCompany = new Map<string, number>()
  for (const t of transfers) {
    const amt = Number(t.amount_eur) || 0
    const fromCo = String(t.from_company)
    const toCo = String(t.to_company)
    transfersNetByCompany.set(fromCo, (transfersNetByCompany.get(fromCo) || 0) - amt)
    transfersNetByCompany.set(toCo, (transfersNetByCompany.get(toCo) || 0) + amt)
  }
  // Health chips are AS-OF-NOW counts (backlog), not weekly.
  const [reviewRes, dupRes, recurRes] = await Promise.all([
    supa.from('hq_invoices').select('id', { count: 'exact', head: true }).eq('needs_review', true),
    supa.from('hq_invoices').select('id', { count: 'exact', head: true }).eq('is_duplicate', true),
    supa.from('hq_recurring_expenses').select('id, active, day_of_month, last_created_on').eq('active', true),
  ])
  const now = new Date()
  const todayDom = now.getUTCDate()
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const recurringDue = (recurRes.data || []).filter((r: any) => {
    if (todayDom < (r.day_of_month || 1)) return false
    if (!r.last_created_on) return true
    return String(r.last_created_on) < firstOfMonth
  }).length
  return {
    revenue, spend, profit: revenue - spend,
    bookingsCount, bookingsByLoc,
    spendByCompany, transfersNetByCompany,
    needsReview: reviewRes.count || 0,
    duplicates: dupRes.count || 0,
    recurringDue,
    topExpenses,
  }
}

// ─── HTML template ─────────────────────────────────────────────────────────
const COMPANY_LABELS: Record<string, string> = {
  'water-movements': 'Water Movements',
  'mgrp-sarl': 'MGRP SARL',
  'wave-movements': 'Wave Movements',
}
const LOC_LABELS: Record<string, string> = {
  'portugal': 'Portugal',
  'surf-school': 'Surf School',
  'junior-camp': 'Junior Camp',
  'kids-camp': 'Kids Camp',
  'wild-wednesday': 'Wild Wednesday',
  'morocco': 'Morocco',
  'sri-lanka': 'Sri Lanka',
  'general': 'General',
  'unknown': 'Unknown',
}

function renderHtml(label: string, wk: WeekNumbers, prev: WeekNumbers): string {
  const deltaPct = prev.profit !== 0 ? Math.round(((wk.profit - prev.profit) / Math.abs(prev.profit)) * 100) : null
  const deltaTxt = deltaPct === null ? 'no baseline'
    : (deltaPct >= 0 ? `▲ ${deltaPct}% vs prev week` : `▼ ${Math.abs(deltaPct)}% vs prev week`)
  const deltaColor = wk.profit >= prev.profit ? '#7ee2a8' : '#ff9591'
  const heroColor = wk.profit >= 0 ? '#7ee2a8' : '#ff9591'

  const bookingRows = [...wk.bookingsByLoc.entries()]
    .sort((a, b) => b[1].gross - a[1].gross)
    .map(([loc, v]) =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${LOC_LABELS[loc] || loc}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums">${v.count}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${eur(v.gross)}</td></tr>`
    ).join('') || `<tr><td colspan="3" style="padding:12px;color:#8595a8;font-style:italic;text-align:center">No bookings this week</td></tr>`

  const companyKeys = new Set([...wk.spendByCompany.keys(), ...wk.transfersNetByCompany.keys()])
  const cashFlowRows = [...companyKeys].map((co) => {
    const spent = wk.spendByCompany.get(co) || 0
    const netTr = wk.transfersNetByCompany.get(co) || 0
    const net = netTr - spent
    const color = net >= 0 ? '#118a5b' : '#c94e42'
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${COMPANY_LABELS[co] || co}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums">${eur(-spent)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums">${netTr >= 0 ? '+' : ''}${eur(netTr)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${color}">${net >= 0 ? '+' : ''}${eur(net)}</td></tr>`
  }).join('') || `<tr><td colspan="4" style="padding:12px;color:#8595a8;font-style:italic;text-align:center">No cash movement</td></tr>`

  const topExp = wk.topExpenses.map((e) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${e.date}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${e.company || '<em style=color:#8595a8>—</em>'}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#5a6b7d">${e.category || '<em style=color:#8595a8>uncategorised</em>'}</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${eur(e.amount)}</td></tr>`
  ).join('') || `<tr><td colspan="4" style="padding:12px;color:#8595a8;font-style:italic;text-align:center">No expenses this week</td></tr>`

  const healthChip = (label: string, count: number, color: string) =>
    count === 0 ? '' :
    `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;margin:0 4px 4px 0">${count} ${label}</span>`
  const healthBar = [
    healthChip('need review', wk.needsReview, '#c98a1f'),
    healthChip('duplicates', wk.duplicates, '#c94e42'),
    healthChip('recurring due', wk.recurringDue, '#1e6fa8'),
  ].join('') || `<span style="color:#118a5b;font-weight:700;font-size:13px">✓ All clear</span>`

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f0f5fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0d1b2a;line-height:1.45">
<div style="max-width:640px;margin:0 auto;background:#fff">
  <div style="background:linear-gradient(135deg,#28394b 0%,#1f2c3b 100%);color:#fff;padding:32px 28px;text-align:center">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#7aabcc;font-weight:700;margin-bottom:8px">Weekly digest · ${label}</div>
    <div style="font-family:Georgia,serif;font-size:14px;color:#a8c4db;margin-bottom:4px">Business profit</div>
    <div style="font-family:Georgia,serif;font-size:52px;line-height:1;color:${heroColor};margin:6px 0">${eur(wk.profit)}</div>
    <div style="font-size:12px;color:${deltaColor};font-weight:600;margin-top:6px">${deltaTxt}</div>
    <div style="font-size:12px;color:#a8c4db;margin-top:10px">Revenue ${eur(wk.revenue)} · Spend ${eur(wk.spend)}</div>
  </div>

  <div style="padding:24px 28px;border-bottom:1px solid #eef2f7">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#8595a8;font-weight:700;margin-bottom:12px">Health check</div>
    <div>${healthBar}</div>
  </div>

  <div style="padding:24px 28px 8px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#8595a8;font-weight:700;margin-bottom:12px">Bookings by location · ${wk.bookingsCount} total</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:#5a6b7d"><th style="padding:6px 12px;text-align:left;font-weight:600">Location</th><th style="padding:6px 12px;text-align:right;font-weight:600">Bookings</th><th style="padding:6px 12px;text-align:right;font-weight:600">Gross</th></tr></thead>
      <tbody>${bookingRows}</tbody>
    </table>
  </div>

  <div style="padding:24px 28px 8px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#8595a8;font-weight:700;margin-bottom:12px">Cash flow per company</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:#5a6b7d"><th style="padding:6px 12px;text-align:left;font-weight:600">Company</th><th style="padding:6px 12px;text-align:right;font-weight:600">Invoices out</th><th style="padding:6px 12px;text-align:right;font-weight:600">Transfers net</th><th style="padding:6px 12px;text-align:right;font-weight:600">Net</th></tr></thead>
      <tbody>${cashFlowRows}</tbody>
    </table>
  </div>

  <div style="padding:24px 28px 8px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#8595a8;font-weight:700;margin-bottom:12px">Top expenses</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:#5a6b7d"><th style="padding:6px 12px;text-align:left;font-weight:600">Date</th><th style="padding:6px 12px;text-align:left;font-weight:600">Supplier</th><th style="padding:6px 12px;text-align:left;font-weight:600">Category</th><th style="padding:6px 12px;text-align:right;font-weight:600">Amount</th></tr></thead>
      <tbody>${topExp}</tbody>
    </table>
  </div>

  <div style="padding:20px 28px 28px;text-align:center;color:#8595a8;font-size:12px">
    <a href="https://gotadaguasurf.com/hq/" style="color:#1e6fa8;text-decoration:none;font-weight:600">Open HQ →</a>
  </div>
</div></body></html>`
}

function renderText(label: string, wk: WeekNumbers): string {
  return [
    `Gota d'Água — weekly digest · ${label}`,
    ``,
    `Business profit: ${eur(wk.profit)}  (revenue ${eur(wk.revenue)} − spend ${eur(wk.spend)})`,
    `Bookings: ${wk.bookingsCount}`,
    `Needs review: ${wk.needsReview}  ·  duplicates: ${wk.duplicates}  ·  recurring due: ${wk.recurringDue}`,
    ``,
    `Open HQ:  https://gotadaguasurf.com/hq/`,
  ].join('\n')
}

// ─── HTTP handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Auth gate: service-role only. pg_cron passes it via Authorization; a
  // manual curl from Miguel would too. No user-JWT path — this reads
  // financial data across every workspace.
  const auth = req.headers.get('authorization') || ''
  const key = auth.replace(/^Bearer\s+/i, '')
  if (key !== SERVICE_KEY) return jsonResp({ error: 'Service role required' }, 401)

  const url = new URL(req.url)
  const preview = url.searchParams.get('preview') === '1'
  let to = url.searchParams.get('to') || DEFAULT_TO

  // POST body can override recipient (useful for testing).
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (body?.to && typeof body.to === 'string') to = body.to
    } catch { /* no body is fine */ }
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  try {
    const now = new Date()
    const { start, end, prevStart, prevEnd, label } = weekRange(now)
    const [wk, prev] = await Promise.all([
      computeWeek(supa, start, end),
      computeWeek(supa, prevStart, prevEnd),
    ])
    const html = renderHtml(label, wk, prev)
    const text = renderText(label, wk)
    const subject = `Gota d'Água — weekly digest · ${label} · profit ${eur(wk.profit)}`

    if (preview) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...CORS } })
    }
    const send = await sendViaGmail(supa, to, subject, html, text)
    return jsonResp({ ok: true, to, subject, gmail_message_id: send.id, profit: wk.profit, revenue: wk.revenue, spend: wk.spend })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResp({ error: `hq-weekly-digest failed: ${msg}` }, 500)
  }
})
