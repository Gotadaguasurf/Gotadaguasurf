// ════════════════════════════════════════════════════════════════════════════
//  mail-ingest — the invoices come by themselves (Miguel, 22 Oct 2026:
//  «quero tudo o mais automatizado possível»). Replaces the Chrome part of the
//  daily routine: reads the invoice mailboxes (READ ONLY — never replies,
//  never sends), takes every PDF attachment, parses it, routes it by the
//  buyer's NIF, files it in the Drive folder of the month, creates or
//  completes the hq_invoices line and links the bank debit.
//
//  Routes
//    GET  ?start=SECRET            Google consent for ONE mailbox (gmail.readonly
//                                  + email). Run once per mailbox, signed in as
//                                  that mailbox (accounting@, cafe@, miguel@, …).
//    GET  ?code=…&state=SECRET     callback → mail_ingest_account
//    GET  ?status=SECRET           what is connected + last runs
//    POST {action:'run'}           header x-mail-ingest-secret (pg_cron) or an
//                                  HQ-member JWT (button). Processes new mail.
//    POST {action:'decide', id, company:'water-movements'|'manjar'|'skip', location_slug?}
//                                  HQ-member JWT: resolves a «review» item.
//
//  Rules encoded (from the daily-routine SKILL):
//    buyer NIF 515059927 → Water (Drive + line) · 502379723 → Manjar (Drive of
//    Manjar + line on /suk/) · personal NIFs → never touched · cancelled /
//    credit notes / statements / reports → skipped · sales invoices FT IN2 →
//    left to the routine (partner_invoices) · unknown buyer → review.
//    Never duplicate: same invoice number, or same NIF+amount ±7 d, or same
//    amount ±10 d with similar supplier / a «[do extrato» line → the existing
//    line gets the PDF; a line that already has a PDF is left alone.
//    Lines get needs_review only when the category is unknown.
//
//  Secrets: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, MAIL_INGEST_SECRET,
//  ANTHROPIC_API_KEY, SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
//  Setup: add ${SUPABASE_URL}/functions/v1/mail-ingest to the OAuth client's
//  redirect URIs; deploy with --no-verify-jwt.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseInvoice, bytesToBase64, mediaTypeFor, type Parsed } from '../_shared/invoice-parse.ts'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SECRET        = Deno.env.get('MAIL_INGEST_SECRET') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const WATER_NIF = '515059927', MANJAR_NIF = '502379723'
const PERSONAL_NIFS = new Set(['268990719', '231351224'])
const MAX_ATTACHMENTS_PER_RUN = 12
const MAX_BYTES = 15 * 1024 * 1024
const GMAIL_QUERY = 'has:attachment newer_than:14d -in:spam -in:trash -"Sistema de MANJAR"'
const WATER_LOCATIONS = new Set(['portugal', 'surf-school', 'junior-camp', 'kids-camp', 'morocco', 'sri-lanka', 'wild-wednesday', 'general'])
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey, x-mail-ingest-secret',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })
const html = (body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px;max-width:560px">${body}</body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const selfUrl = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/mail-ingest`
type Db = ReturnType<typeof createClient>

// ── Google tokens ────────────────────────────────────────────────────────
async function refresh(refreshToken: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const tk = await r.json()
  if (!r.ok || !tk.access_token) throw new Error('Google recusou o refresh token: ' + JSON.stringify(tk).slice(0, 200))
  return { token: tk.access_token as string, expires: new Date(Date.now() + ((tk.expires_in || 3600) - 30) * 1000).toISOString() }
}
async function mailToken(db: Db, acct: Record<string, unknown>): Promise<string> {
  if (acct.access_token && acct.access_expires_at && new Date(String(acct.access_expires_at)).getTime() > Date.now() + 60_000) return String(acct.access_token)
  const t = await refresh(String(acct.refresh_token))
  await db.from('mail_ingest_account').update({ access_token: t.token, access_expires_at: t.expires, updated_at: new Date().toISOString() }).eq('id', acct.id)
  return t.token
}
async function driveToken(db: Db): Promise<string> {
  const { data: acct, error } = await db.from('drive_account').select('*').limit(1).single()
  if (error || !acct) throw new Error('A Drive não está ligada (drive_account vazio)')
  if (acct.access_token && acct.access_expires_at && new Date(acct.access_expires_at).getTime() > Date.now() + 60_000) return acct.access_token
  const t = await refresh(acct.refresh_token)
  await db.from('drive_account').update({ access_token: t.token, access_expires_at: t.expires, updated_at: new Date().toISOString() }).eq('id', acct.id)
  return t.token
}

// ── Gmail (read only) ────────────────────────────────────────────────────
const G = 'https://gmail.googleapis.com/gmail/v1/users/me'
async function gmail(token: string, path: string) {
  const r = await fetch(`${G}/${path}`, { headers: { authorization: 'Bearer ' + token } })
  const out = await r.json()
  if (!r.ok) throw new Error(`Gmail ${path.split('?')[0]}: ${out?.error?.message || r.status}`)
  return out
}
interface Att { filename: string; attachmentId: string; size: number; mime: string }
function collectAttachments(part: Record<string, unknown>, out: Att[]) {
  if (!part) return
  const filename = String(part.filename || '')
  const body = (part.body || {}) as Record<string, unknown>
  if (filename && body.attachmentId) out.push({ filename, attachmentId: String(body.attachmentId), size: Number(body.size || 0), mime: String(part.mimeType || '') })
  for (const p of (part.parts as Record<string, unknown>[] | undefined) || []) collectAttachments(p, out)
}
function header(msg: Record<string, unknown>, name: string): string {
  const hs = ((msg.payload as Record<string, unknown>)?.headers as { name: string; value: string }[]) || []
  return hs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}
function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : ''
  const bin = atob(b + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Drive ────────────────────────────────────────────────────────────────
async function driveFolderFor(db: Db, token: string, company: string, ym: string): Promise<string> {
  const { data } = await db.from('accountant_drive_folders').select('folder_id').eq('company', company).eq('month_key', ym).maybeSingle()
  if (data?.folder_id) return data.folder_id
  const { data: root } = await db.from('accountant_drive_folders').select('folder_id').eq('company', company).eq('month_key', '*').maybeSingle()
  if (!root?.folder_id) throw new Error(`sem pasta raiz na Drive para ${company}`)
  const [y, m] = ym.split('-').map(Number)
  const name = company === 'manjar' ? `${MONTHS_EN[m - 1]} ${y}` : `${MONTHS_EN[m - 1]}_${y}`
  // reuse a folder with that name if it already exists under the root
  const q = encodeURIComponent(`'${root.folder_id}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
  const found = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { authorization: 'Bearer ' + token } })).json()
  let id = found?.files?.[0]?.id
  if (!id) {
    const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [root.folder_id] }),
    })
    const out = await r.json(); if (!r.ok) throw new Error('Drive não criou a pasta do mês: ' + (out?.error?.message || r.status))
    id = out.id
  }
  await db.from('accountant_drive_folders').insert({ company, month_key: ym, folder_id: id })
  return id
}
async function driveUpload(token: string, folder: string, name: string, mime: string, bytes: Uint8Array) {
  const boundary = 'gota' + crypto.randomUUID().replace(/-/g, '')
  const enc = new TextEncoder()
  const head = enc.encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`)
  const tail = enc.encode(`\r\n--${boundary}--`)
  const payload = new Uint8Array(head.length + bytes.length + tail.length)
  payload.set(head, 0); payload.set(bytes, head.length); payload.set(tail, head.length + bytes.length)
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': `multipart/related; boundary=${boundary}` }, body: payload,
  })
  const out = await up.json()
  if (!up.ok) throw new Error('Drive recusou o upload: ' + (out?.error?.message || JSON.stringify(out).slice(0, 200)))
  return { id: out.id as string, link: `https://drive.google.com/file/d/${out.id}/view` }
}
function driveName(parsed: Parsed): string {
  const sup = String(parsed.company || 'fornecedor').replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60)
  const [y, m] = String(parsed.invoice_date).split('-').map(Number)
  const amount = Number(parsed.amount || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cur = (parsed.currency || 'EUR').toUpperCase()
  return `${sup} - ${MONTHS_PT[m - 1]} ${y} - ${amount}${cur === 'EUR' ? '€' : ' ' + cur}.pdf`
}

// ── FX ───────────────────────────────────────────────────────────────────
async function fxToEur(currency: string, date: string): Promise<number | null> {
  const cur = (currency || 'EUR').toUpperCase()
  if (cur === 'EUR') return 1
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${cur}&symbols=EUR`)
    const out = await r.json(); const rate = Number(out?.rates?.EUR)
    return rate > 0 ? rate : null
  } catch { return null }
}

// ── The pipeline for one document ────────────────────────────────────────
interface Ctx { db: Db; account: string; messageId: string; attachmentId: string; filename: string; sha: string; receivedAt: string | null; from: string; subject: string; gmailLink: string }
interface Outcome { status: 'inserted' | 'linked' | 'skipped' | 'review' | 'error'; reason: string; company?: string | null; hq_invoice_id?: string | null; bank_movement_id?: string | null; drive_file_id?: string | null; drive_link?: string | null }

function firstToken(s: string): string { return String(s || '').toLowerCase().replace(/[^a-z0-9àáâãçéêíóôõú ]/g, ' ').trim().split(/\s+/)[0] || '' }

async function placeDocument(ctx: Ctx, parsed: Parsed, bytes: Uint8Array, company: string, forcedLocation?: string | null): Promise<Outcome> {
  const { db } = ctx
  if (!parsed.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice_date) || parsed.amount == null) return { status: 'review', reason: 'sem data ou valor legível', company }
  const amount = Number(parsed.amount)
  const ym = parsed.invoice_date.slice(0, 7)
  const payingCompany = company
  // 1. an existing line? (never duplicate)
  const base = db.from('hq_invoices').select('id, drive_link, invoice_number, supplier_nif, company, amount_eur, invoice_date, notes').eq('paying_company', payingCompany).is('deleted_at', null)
  let existing: Record<string, unknown> | null = null
  if (parsed.invoice_number) {
    const { data } = await base.ilike('invoice_number', parsed.invoice_number.trim()).limit(2)
    if (data?.length) existing = data[0]
  }
  if (!existing) {
    const lo = new Date(parsed.invoice_date); lo.setDate(lo.getDate() - 10)
    const hi = new Date(parsed.invoice_date); hi.setDate(hi.getDate() + 10)
    const { data } = await db.from('hq_invoices').select('id, drive_link, invoice_number, supplier_nif, company, amount_eur, amount, currency, invoice_date, notes')
      .eq('paying_company', payingCompany).is('deleted_at', null).gte('invoice_date', lo.toISOString().slice(0, 10)).lte('invoice_date', hi.toISOString().slice(0, 10))
    const tok = firstToken(parsed.company || '')
    const cands = (data || []).filter(r => {
      const sameAmt = Math.abs(Number(r.amount_eur ?? r.amount) - amount) < 0.011 || (r.currency && r.currency === parsed.currency && Math.abs(Number(r.amount) - amount) < 0.011)
      if (!sameAmt) return false
      // SKILL rule 8: a different invoice number is a different document (two e-tickets of the same price, two Chubb policies…)
      if (parsed.invoice_number && r.invoice_number && String(r.invoice_number).trim().toLowerCase() !== parsed.invoice_number.trim().toLowerCase()) return false
      if (parsed.supplier_nif && r.supplier_nif && String(r.supplier_nif).replace(/\s/g, '') === parsed.supplier_nif) return true
      if (tok.length >= 4 && String(r.company || '').toLowerCase().startsWith(tok)) return true
      if (String(r.notes || '').includes('[do extrato')) return true
      return false
    })
    if (cands.length) existing = cands.sort((a, b) => Math.abs(new Date(String(a.invoice_date)).getTime() - new Date(parsed.invoice_date!).getTime()) - Math.abs(new Date(String(b.invoice_date)).getTime() - new Date(parsed.invoice_date!).getTime()))[0]
  }
  if (existing && existing.drive_link) return { status: 'skipped', reason: `já na app com PDF (linha ${String(existing.id).slice(0, 8)}, ${existing.invoice_number || 'sem nº'})`, company, hq_invoice_id: String(existing.id) }

  // 2. Drive
  const dtoken = await driveToken(db)
  const folder = await driveFolderFor(db, dtoken, payingCompany, ym)
  const up = await driveUpload(dtoken, folder, driveName(parsed), 'application/pdf', bytes)
  const fileName = driveName(parsed)

  // 3. complete the existing line, or create one
  if (existing) {
    const patch: Record<string, unknown> = { drive_link: up.link, file_name: fileName }
    if (!existing.invoice_number && parsed.invoice_number) patch.invoice_number = parsed.invoice_number
    if (!existing.supplier_nif && parsed.supplier_nif) patch.supplier_nif = parsed.supplier_nif
    patch.notes = `${String(existing.notes || '').trim()} [PDF do email ${ctx.account} ${(ctx.receivedAt || '').slice(0, 10)}]`.trim()
    const { error } = await db.from('hq_invoices').update(patch).eq('id', existing.id)
    if (error) return { status: 'error', reason: 'update falhou: ' + error.message, company, drive_file_id: up.id, drive_link: up.link }
    const { data: bm } = await db.rpc('hq_invoice_to_bank', { p_invoice: existing.id })
    return { status: 'linked', reason: `PDF ligado à linha existente${bm ? ' · débito do banco ligado' : ''}`, company, hq_invoice_id: String(existing.id), bank_movement_id: bm || null, drive_file_id: up.id, drive_link: up.link }
  }
  const { data: cats } = await db.from('hq_invoice_categories').select('id, name').eq('active', true)
  const cat = (cats || []).find(c => String(c.name).toLowerCase() === String(parsed.category_hint || '').toLowerCase()) || null
  const fx = await fxToEur(parsed.currency || 'EUR', parsed.invoice_date)
  const location = payingCompany === 'manjar' ? 'the-suk'
    : (forcedLocation && WATER_LOCATIONS.has(forcedLocation)) ? forcedLocation
    : (parsed.location_hint && WATER_LOCATIONS.has(parsed.location_hint)) ? parsed.location_hint : 'general'
  const notes = [`[do email ${ctx.account} ${(ctx.receivedAt || '').slice(0, 10)} · "${ctx.subject.slice(0, 70)}" · de ${ctx.from.slice(0, 60)}]`,
    cat ? '' : '[categoria por decidir]', fx == null ? '[câmbio por confirmar]' : '', parsed.service_month ? `[serviço: ${parsed.service_month}]` : '', parsed.atcud ? `[ATCUD ${parsed.atcud}]` : ''].filter(Boolean).join(' ')
  const row = {
    location_slug: location, paying_company: payingCompany, invoice_date: parsed.invoice_date,
    company: String(parsed.company || 'fornecedor').toLowerCase().slice(0, 120), supplier_nif: parsed.supplier_nif, description: parsed.description,
    amount, currency: (parsed.currency || 'EUR').toUpperCase(), fx_rate: fx ?? 1, amount_eur: fx == null ? amount : Math.round(amount * fx * 100) / 100,
    payment_type: ['Cash', 'Card', 'Bank Transfer', 'Other'].includes(String(parsed.payment_type)) ? parsed.payment_type : null,
    invoice_number: parsed.invoice_number, category_id: cat?.id || null, category_name: cat?.name || null,
    needs_review: !cat || fx == null, drive_link: up.link, file_name: fileName, notes,
  }
  const { data: ins, error } = await db.from('hq_invoices').insert(row).select('id').single()
  if (error) return { status: 'error', reason: 'insert falhou: ' + error.message, company, drive_file_id: up.id, drive_link: up.link }
  const { data: bm } = await db.rpc('hq_invoice_to_bank', { p_invoice: ins.id })
  return { status: 'inserted', reason: `linha criada (${location}${cat ? ', ' + cat.name : ', sem categoria'})${bm ? ' · débito do banco ligado' : ''}`, company, hq_invoice_id: ins.id, bank_movement_id: bm || null, drive_file_id: up.id, drive_link: up.link }
}

function routeByBuyer(parsed: Parsed): { company: string | null; outcome?: Outcome } {
  const dt = String(parsed.doc_type || 'other')
  if (parsed.is_cancelled) return { company: null, outcome: { status: 'skipped', reason: 'documento anulado / sem efeito' } }
  if (!['invoice', 'receipt'].includes(dt)) return { company: null, outcome: { status: 'skipped', reason: `não é fatura (${dt})` } }
  const nif = parsed.buyer_nif || ''
  if (PERSONAL_NIFS.has(nif)) return { company: null, outcome: { status: 'skipped', reason: 'documento pessoal' } }
  if (nif === WATER_NIF) return { company: 'water-movements' }
  if (nif === MANJAR_NIF) return { company: 'manjar' }
  const buyer = String(parsed.buyer_name || '').toLowerCase()
  if (/water\s*movements/.test(buyer)) return { company: 'water-movements' }
  if (/manjar/.test(buyer)) return { company: 'manjar' }
  return { company: null, outcome: { status: 'review', reason: nif ? `comprador desconhecido (NIF ${nif}${buyer ? ', ' + buyer : ''})` : 'comprador não identificado' } }
}

async function record(ctx: Ctx, o: Outcome, parsed: Parsed | null) {
  await ctx.db.from('mail_ingest_items').upsert({
    account_email: ctx.account, message_id: ctx.messageId, attachment_id: ctx.attachmentId, filename: ctx.filename, sha256: ctx.sha || null,
    received_at: ctx.receivedAt, from_addr: ctx.from.slice(0, 200), subject: ctx.subject.slice(0, 200), status: o.status, reason: o.reason.slice(0, 400),
    company: o.company || null, hq_invoice_id: o.hq_invoice_id || null, bank_movement_id: o.bank_movement_id || null,
    drive_file_id: o.drive_file_id || null, drive_link: o.drive_link || null, parsed: parsed || null, gmail_link: ctx.gmailLink,
  }, { onConflict: 'message_id,attachment_id' })
}

// ── One run over every connected mailbox ─────────────────────────────────
async function run(db: Db) {
  const { data: accounts } = await db.from('mail_ingest_account').select('*').eq('active', true)
  const summary: Record<string, unknown> = { accounts: (accounts || []).length, processed: 0, inserted: 0, linked: 0, skipped: 0, review: 0, error: 0, details: [] as string[] }
  let budget = MAX_ATTACHMENTS_PER_RUN
  for (const acct of accounts || []) {
    const account = String(acct.email)
    const perAccount: string[] = []
    try {
      const token = await mailToken(db, acct)
      const list = await gmail(token, `messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=40`)
      const ids: string[] = (list.messages || []).map((m: { id: string }) => m.id)
      if (!ids.length) { perAccount.push('sem mensagens com anexo'); continue }
      const { data: seen } = await db.from('mail_ingest_items').select('message_id').in('message_id', ids)
      const seenSet = new Set((seen || []).map(r => r.message_id))
      for (const id of ids) {
        if (budget <= 0) { perAccount.push('limite por execução atingido'); break }
        if (seenSet.has(id)) continue
        const msg = await gmail(token, `messages/${id}?format=full`)
        const from = header(msg, 'From'), subject = header(msg, 'Subject')
        const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null
        const gmailLink = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`
        const atts: Att[] = []; collectAttachments(msg.payload, atts)
        const pdfs = atts.filter(a => /\.pdf$/i.test(a.filename) || a.mime === 'application/pdf')
        const marker: Ctx = { db, account, messageId: id, attachmentId: '-', filename: '', sha: '', receivedAt, from, subject, gmailLink }
        if (/sistema de manjar/i.test(subject)) { await record(marker, { status: 'skipped', reason: 'relatório do POS do Manjar' }, null); continue }
        if (!pdfs.length) { await record(marker, { status: 'skipped', reason: 'sem PDF em anexo' }, null); continue }
        for (const a of pdfs) {
          if (budget <= 0) break
          const ctx: Ctx = { ...marker, attachmentId: a.attachmentId.slice(0, 120), filename: a.filename.slice(0, 200) }
          // claim the attachment first: two runs at once (cron + «Ler agora») created the same
          // line twice on 22 Oct 2026; the unique (message_id, attachment_id) makes the second
          // run skip it
          const { error: claimErr } = await db.from('mail_ingest_items').insert({ account_email: account, message_id: id, attachment_id: ctx.attachmentId, filename: ctx.filename, received_at: receivedAt, from_addr: from.slice(0, 200), subject: subject.slice(0, 200), status: 'seen', reason: 'a processar', gmail_link: gmailLink })
          if (claimErr) { perAccount.push(`${a.filename}: já tratado por outra execução`); continue }
          try {
            if (/factura-?in2|fatura\s*in2|FT\s*IN2/i.test(a.filename) || /FT IN2/i.test(subject)) { await record(ctx, { status: 'skipped', reason: 'fatura de venda a parceiro (rotina: partner_invoices)' }, null); continue }
            if (a.size > MAX_BYTES) { await record(ctx, { status: 'skipped', reason: 'anexo acima de 15 MB' }, null); continue }
            budget--; (summary.processed as number)++
            const att = await gmail(token, `messages/${id}/attachments/${a.attachmentId}`)
            const bytes = b64urlToBytes(String(att.data || ''))
            ctx.sha = await sha256(bytes)
            const { data: dup } = await db.from('mail_ingest_items').select('id, status, hq_invoice_id').eq('sha256', ctx.sha).in('status', ['inserted', 'linked', 'skipped']).limit(1)
            if (dup?.length) { await record(ctx, { status: 'skipped', reason: `mesmo ficheiro já tratado (${dup[0].status})`, hq_invoice_id: dup[0].hq_invoice_id }, null); continue }
            const { parsed } = await parseInvoice(bytesToBase64(bytes), mediaTypeFor(a.filename, 'application/pdf'), ANTHROPIC_KEY)
            const route = routeByBuyer(parsed)
            let outcome: Outcome
            if (route.outcome) outcome = route.outcome
            else outcome = await placeDocument(ctx, parsed, bytes, route.company!)
            await record(ctx, outcome, parsed)
            ;(summary[outcome.status] as number)++
            perAccount.push(`${a.filename}: ${outcome.status} — ${outcome.reason}`)
          } catch (e) {
            await record(ctx, { status: 'error', reason: (e as Error).message || String(e) }, null)
            ;(summary.error as number)++
            perAccount.push(`${a.filename}: erro — ${(e as Error).message}`)
          }
        }
        // the message itself is now known
        const { data: any } = await db.from('mail_ingest_items').select('id').eq('message_id', id).limit(1)
        if (!any?.length) await record(marker, { status: 'seen', reason: 'anexos sem resultado' }, null)
      }
    } catch (e) {
      perAccount.push('conta: ' + ((e as Error).message || String(e)))
      ;(summary.error as number)++
    }
    ;(summary.details as string[]).push(`${account}: ${perAccount.join(' | ') || 'nada novo'}`)
    await db.from('mail_ingest_account').update({ last_run_at: new Date().toISOString(), last_result: { at: new Date().toISOString(), lines: perAccount.slice(0, 30) } }).eq('id', acct.id)
  }
  return summary
}

// ── A «review» item decided by a person ──────────────────────────────────
async function decide(db: Db, body: Record<string, unknown>, who: string) {
  const id = String(body.id || ''); const company = String(body.company || '')
  const { data: item } = await db.from('mail_ingest_items').select('*').eq('id', id).maybeSingle()
  if (!item) return json({ error: 'item não encontrado' }, 404)
  if (company === 'skip') {
    await db.from('mail_ingest_items').update({ status: 'skipped', reason: 'ignorado por ' + who, decided_at: new Date().toISOString(), decided_by: who }).eq('id', id)
    return json({ ok: true, status: 'skipped' })
  }
  if (!['water-movements', 'manjar'].includes(company)) return json({ error: 'company inválida' }, 400)
  const { data: acct } = await db.from('mail_ingest_account').select('*').eq('email', item.account_email).maybeSingle()
  if (!acct) return json({ error: 'caixa de email já não está ligada' }, 400)
  const token = await mailToken(db, acct)
  const att = await gmail(token, `messages/${item.message_id}/attachments/${item.attachment_id}`)
  const bytes = b64urlToBytes(String(att.data || ''))
  const parsed = (item.parsed || {}) as Parsed
  const ctx: Ctx = { db, account: item.account_email, messageId: item.message_id, attachmentId: item.attachment_id, filename: item.filename || '', sha: item.sha256 || '', receivedAt: item.received_at, from: item.from_addr || '', subject: item.subject || '', gmailLink: item.gmail_link || '' }
  const outcome = await placeDocument(ctx, parsed, bytes, company, body.location_slug ? String(body.location_slug) : null)
  await record(ctx, outcome, parsed)
  await db.from('mail_ingest_items').update({ decided_at: new Date().toISOString(), decided_by: who }).eq('id', id)
  return json({ ok: true, ...outcome })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const u = new URL(req.url)

  if (req.method === 'GET') {
    if (u.searchParams.get('start')) {
      if (u.searchParams.get('start') !== SECRET) return json({ error: 'unauthorized' }, 401)
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.searchParams.set('client_id', CLIENT_ID)
      auth.searchParams.set('redirect_uri', selfUrl())
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly email')
      auth.searchParams.set('access_type', 'offline')
      auth.searchParams.set('prompt', 'consent select_account')
      auth.searchParams.set('state', SECRET)
      return Response.redirect(auth.toString(), 302)
    }
    if (u.searchParams.get('code')) {
      if (u.searchParams.get('state') !== SECRET) return json({ error: 'unauthorized' }, 401)
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: u.searchParams.get('code')!, grant_type: 'authorization_code', redirect_uri: selfUrl() }),
      })
      const tk = await resp.json()
      if (!resp.ok || !tk.refresh_token) return html('<h2>Falhou a troca do código</h2><p>Se a conta já tinha dado consentimento, remove o acesso em myaccount.google.com/permissions e repete.</p><pre>' + JSON.stringify(tk).slice(0, 300) + '</pre>', 500)
      const profile = await (await fetch(`${G}/profile`, { headers: { authorization: 'Bearer ' + tk.access_token } })).json()
      const email = String(profile?.emailAddress || '').toLowerCase()
      if (!email) return html('<h2>Não consegui ler o endereço da caixa</h2>', 500)
      const { error } = await db.from('mail_ingest_account').upsert({ email, refresh_token: tk.refresh_token, access_token: tk.access_token, access_expires_at: new Date(Date.now() + ((tk.expires_in || 3600) - 30) * 1000).toISOString(), active: true, updated_at: new Date().toISOString() }, { onConflict: 'email' })
      if (error) return html('<h2>Falhou a gravar</h2><pre>' + error.message + '</pre>', 500)
      return html(`<h2>✓ Caixa ${email} ligada (só leitura)</h2><p>A partir de agora as faturas que chegam a esta caixa entram sozinhas na app e na Drive, de 30 em 30 minutos. Podes fechar esta janela.</p><p>Para ligar outra caixa, abre o mesmo link e escolhe a outra conta.</p>`)
    }
    if (u.searchParams.get('status')) {
      if (u.searchParams.get('status') !== SECRET) return json({ error: 'unauthorized' }, 401)
      const { data: accounts } = await db.from('mail_ingest_account').select('email, active, last_run_at, last_result, updated_at')
      const { data: items } = await db.from('mail_ingest_items').select('account_email, received_at, filename, status, reason, company').order('created_at', { ascending: false }).limit(40)
      return json({ accounts, items })
    }
    return json({ error: 'use ?start=SECRET para ligar uma caixa de email' }, 400)
  }

  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { body = {} }
  const action = String(body.action || 'run')

  // auth: cron secret, or an HQ member's JWT
  let who = ''
  const secretHdr = req.headers.get('x-mail-ingest-secret') || ''
  if (SECRET && secretHdr === SECRET) who = 'cron'
  else {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt || jwt === SERVICE_KEY) return json({ error: 'Missing Authorization' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Invalid auth' }, 401)
    const { data: isHq } = await userClient.rpc('is_hq_member')
    if (!isHq) return json({ error: 'HQ member required' }, 403)
    who = user.email || user.id
  }
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

  try {
    if (action === 'decide') return await decide(db, body, who)
    const summary = await run(db)
    return json({ ok: true, by: who, ...summary })
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
