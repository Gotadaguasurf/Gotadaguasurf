// ════════════════════════════════════════════════════════════════════════════
//  drive-sync — pulls NEW invoice files from the Google Drive expenses folder
//  and files them into hq_invoices as needs_review rows.
//
//  Flow (cron-invoked, no user in the loop):
//    1. Service-account JWT → Google OAuth token (drive.readonly).
//    2. List the monthly subfolders of DRIVE_ROOT_FOLDER_ID, then their files.
//    3. Skip anything already in hq_drive_ingest (dedup by Drive file id —
//       a file is processed exactly once, ever).
//    4. Download each new PDF/image, run the same extraction prompt the
//       parse-invoice function uses (Claude vision), insert into hq_invoices
//       with needs_review=true so Miguel confirms in the app.
//    5. Record the outcome per file in hq_drive_ingest (inserted / error /
//       skipped) — failures stay visible instead of vanishing.
//
//  Caps: MAX_PER_RUN files per invocation (Anthropic cost + edge time limit);
//  the cron runs every few hours so a backlog drains across runs.
//
//  Auth: OAuth refresh token (same pattern as gmail-sync) — the Workspace
//  org policy blocks service-account keys, and this is tidier anyway: the
//  folder owner (miguel@) authorises once via /drive-sync?start=SECRET and
//  the refresh token lives in the drive_account table (RLS deny-all).
//
//  Secrets required (GOOGLE_* already set for the gmail functions):
//    GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
//    DRIVE_SYNC_SECRET       gates cron calls AND the one-time consent URL
//    ANTHROPIC_API_KEY       (already set for parse-invoice)
//    DRIVE_ROOT_FOLDER_ID    optional override; defaults to the GENERAL EXPENSES folder
//  Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  One-time setup: add this function's URL to the OAuth client's Authorized
//  redirect URIs, then open /drive-sync?start=SECRET with miguel@ and accept.
//
//  Deploy: supabase functions deploy drive-sync --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID      = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET  = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SYNC_SECRET    = Deno.env.get('DRIVE_SYNC_SECRET') || ''
const ANTHROPIC_KEY  = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ROOT_FOLDER    = Deno.env.get('DRIVE_ROOT_FOLDER_ID') || '10plNGyUBfVUnde4U9kKe-QyzllbkYGH4'

const MODEL       = 'claude-sonnet-4-5'
const MAX_PER_RUN = 6
const MAX_BYTES   = 15 * 1024 * 1024

const FILE_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
])

// Miguel's model: EVERYTHING in Despesas HQ is paid by Water Movements
// (the PT entity's bank/cards) — Morocco/Sri Lanka local spending lives
// in each camp's Operations Ledger instead, so it never reaches this
// table. Location = whose cost it is; paying_company = who paid = PT.
// Exceptions are edited by hand in the app.
const KNOWN_SLUGS = new Set(['portugal','surf-school','junior-camp','kids-camp','wild-wednesday','general','morocco','sri-lanka'])
const PAYING_COMPANY_DEFAULT = 'water-movements'

// Same schema + rules as parse-invoice — keep the two prompts in sync.
const EXTRACTION_PROMPT = `You are an invoice-parsing assistant for a surf-camp business with entities in Portugal, Morocco, and Sri Lanka. Extract data from this invoice and return ONLY valid JSON, no markdown, no commentary.

Schema:
{
  "invoice_date": "YYYY-MM-DD or null",
  "company": "supplier name in lowercase, strip Lda/SA/SARL/Ltda suffixes",
  "supplier_nif": "tax registration number if present (Portuguese NIF, Moroccan ICE, etc.), or null",
  "description": "one-line description of what was purchased/paid, or null",
  "amount": "numeric total including tax, no currency symbol",
  "currency": "EUR | MAD | LKR | USD | GBP — inferred from currency symbol or country",
  "invoice_number": "invoice reference number, or null",
  "payment_type": "Cash | Card | Bank Transfer | Other — null if not visible on the document",
  "category_hint": "best guess from: Food, Setup, Rent, Services, Insurances, Transport, Salary, Utilities, Partners, Benefits, Taxes, Work Trips, Accounting, Cleaning Supplies, Wild, Miguel - Personal",
  "location_hint": "best guess from: portugal, surf-school, junior-camp, kids-camp, wild-wednesday, morocco, sri-lanka, general"
}

Rules:
- Portuguese addresses/NIF (9-digit) → location_hint=portugal or one of the PT camps if the item is camp-specific.
- Moroccan addresses (Dirham/MAD/ICE number) → location_hint=morocco.
- Sri Lankan (LKR/Colombo/Weligama) → location_hint=sri-lanka.
- Generic digital services (Google Workspace, Cloudways, Uber, Anthropic) → location_hint=general.
- Party/event suppliers (DJs, sound/light rental, event production — e.g. debeat, raimundo e cenas, namor cayres, david van der heyden, uljc) → location_hint=wild-wednesday with category_hint=Wild (the weekly party Water Movements runs).
- "Fatura-Recibo" documents from AT (Autoridade Tributária e Aduaneira) are Portuguese freelancer receipts (recibos verdes): ALWAYS category_hint=Salary. The supplier ("company") is the PERSON in "Dados do transmitente de bens ou do prestador de serviços" — NEVER "autoridade tributária". These people work at different camps, so location_hint=general unless the document itself names a camp — the owner assigns the real location during review. EXCEPTION: known Wild Wednesday crew (namor cayres, david van der heyden, and other party-supplier names above) keep location_hint=wild-wednesday and category_hint=Wild even on a Fatura-Recibo.
- "Utulities" is a legacy typo → return "Utilities".
- Amount uses . as decimal separator and no thousand separators.
- If a value is unreadable or absent, return null (except amount).

Return the JSON object and nothing else.`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

// ── OAuth (mirrors gmail-sync's ensureAccessToken, table drive_account) ──
function selfUrl(): string {
  return (SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/drive-sync'
}
async function ensureDriveToken(db: ReturnType<typeof createClient>): Promise<string> {
  const { data: acct, error } = await db.from('drive_account').select('*').limit(1).single()
  if (error || !acct) throw new Error('drive_account vazio — abrir /drive-sync?start=SECRET com a conta dona da pasta')
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0
  if (acct.access_token && expiresAt > Date.now() + 60_000) return acct.access_token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token, grant_type: 'refresh_token',
    }),
  })
  if (!resp.ok) throw new Error('token refresh: HTTP ' + resp.status + ' ' + (await resp.text()).slice(0, 200))
  const tk = await resp.json() as { access_token: string; expires_in: number }
  await db.from('drive_account').update({
    access_token: tk.access_token,
    access_expires_at: new Date(Date.now() + (tk.expires_in - 30) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', acct.id)
  return tk.access_token
}

async function driveList(token: string, q: string): Promise<any[]> {
  const out: any[] = []
  let pageToken = ''
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files')
    url.searchParams.set('q', q)
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,createdTime,size)')
    url.searchParams.set('pageSize', '200')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const resp = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    const data = await resp.json()
    if (!resp.ok) throw new Error('drive list: ' + JSON.stringify(data).slice(0, 300))
    out.push(...(data.files || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return out
}

serve_handler()
function serve_handler() {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok')
    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const u = new URL(req.url)

    // ── One-time OAuth setup (GET) ──────────────────────────────────────
    // /drive-sync?start=SECRET  → redirect to Google's consent screen
    // /drive-sync?code=...&state=SECRET → store the refresh token
    if (req.method === 'GET') {
      if (u.searchParams.get('start')) {
        if (u.searchParams.get('start') !== SYNC_SECRET) return json({ error: 'unauthorized' }, 401)
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        auth.searchParams.set('client_id', CLIENT_ID)
        auth.searchParams.set('redirect_uri', selfUrl())
        auth.searchParams.set('response_type', 'code')
        auth.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.readonly email')
        auth.searchParams.set('access_type', 'offline')
        auth.searchParams.set('prompt', 'consent')
        auth.searchParams.set('state', SYNC_SECRET)
        return Response.redirect(auth.toString(), 302)
      }
      if (u.searchParams.get('code')) {
        if (u.searchParams.get('state') !== SYNC_SECRET) return json({ error: 'unauthorized' }, 401)
        const resp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            code: u.searchParams.get('code')!, grant_type: 'authorization_code',
            redirect_uri: selfUrl(),
          }),
        })
        const tk = await resp.json()
        if (!resp.ok || !tk.refresh_token) {
          return new Response('Falhou a troca do código: ' + JSON.stringify(tk).slice(0, 300), { status: 500 })
        }
        let email = ''
        try {
          const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { authorization: 'Bearer ' + tk.access_token },
          })
          email = (await ui.json()).email || ''
        } catch (_e) { /* cosmetic only */ }
        await db.from('drive_account').delete().neq('id', '00000000-0000-0000-0000-000000000000')
        const { error } = await db.from('drive_account').insert({
          authed_email: email,
          refresh_token: tk.refresh_token,
          access_token: tk.access_token,
          access_expires_at: new Date(Date.now() + ((tk.expires_in || 3600) - 30) * 1000).toISOString(),
        })
        if (error) return new Response('Falhou a gravar: ' + error.message, { status: 500 })
        return new Response('<h2>✓ Drive ligado (' + email + ')</h2><p>Podes fechar esta janela. O drive-sync já consegue ler a pasta das despesas.</p>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      return json({ error: 'use ?start=SECRET para autorizar' }, 400)
    }

    // ── Cron/manual sync (POST) ─────────────────────────────────────────
    // Shared-secret gate: this function is deployed --no-verify-jwt for the
    // cron; the header keeps anonymous internet callers from burning the
    // Anthropic budget.
    if (!SYNC_SECRET || req.headers.get('x-drive-sync-secret') !== SYNC_SECRET) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'GOOGLE_OAUTH_CLIENT_ID/SECRET missing' }, 500)
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY missing' }, 500)
    const summary = { scanned: 0, new: 0, inserted: 0, errors: 0, skipped_dup_invoice: 0, details: [] as string[] }
    try {
      const token = await ensureDriveToken(db)

      // 1. Subfolders of the root (the monthly folders) + the root itself.
      const folders = await driveList(token,
        `'${ROOT_FOLDER}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
      const folderIds = [{ id: ROOT_FOLDER, name: '(root)' }, ...folders.map(f => ({ id: f.id, name: f.name }))]

      // 2. Candidate files across folders.
      const candidates: { id: string; name: string; mime: string; folder: string; size: number; created: string }[] = []
      for (const f of folderIds) {
        const files = await driveList(token, `'${f.id}' in parents and trashed = false`)
        for (const file of files) {
          if (!FILE_MIMES.has(file.mimeType)) continue
          candidates.push({ id: file.id, name: file.name, mime: file.mimeType, folder: f.name, size: Number(file.size || 0), created: String(file.createdTime || '') })
        }
      }
      summary.scanned = candidates.length

      // 3. Which are NEW? (hq_drive_ingest never forgets a file id.)
      const ids = candidates.map(c => c.id)
      const seen = new Set<string>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from('hq_drive_ingest').select('drive_file_id').in('drive_file_id', ids.slice(i, i + 200))
        ;(data || []).forEach(r => seen.add(r.drive_file_id))
      }
      const unseen = candidates.filter(c => !seen.has(c.id))
      summary.new = unseen.length

      // BASELINE mode: register every current file WITHOUT parsing. Run once
      // at activation — the historical PDFs are already in hq_invoices via
      // the sheet migration; re-parsing them would double half a year of
      // expenses. After the baseline, only files added later are processed.
      let baselineMode = false, baselineBefore = ''
      try {
        const b = await req.clone().json()
        baselineMode = b?.baseline === true
        baselineBefore = String(b?.before || '')
      } catch (_e) { /* empty body */ }
      if (baselineMode) {
        const toRegister = baselineBefore
          ? unseen.filter(c => (c.created || '') < baselineBefore)
          : unseen
        for (let i = 0; i < toRegister.length; i += 100) {
          const batch = toRegister.slice(i, i + 100).map(c => ({
            drive_file_id: c.id, file_name: c.name, folder_name: c.folder,
            status: 'skipped', error: 'baseline — pre-sync file, not parsed',
          }))
          const { error } = await db.from('hq_drive_ingest').insert(batch)
          if (error) throw new Error('baseline insert: ' + error.message)
        }
        summary.details.push(`baseline: ${(baselineBefore ? unseen.filter(c => (c.created || '') < baselineBefore) : unseen).length} ficheiros registados sem processar${baselineBefore ? ' (criados antes de ' + baselineBefore + ')' : ''}`)
        return json(summary)
      }

      const fresh = unseen.slice(0, MAX_PER_RUN)

      // Category name → id map (matched case-insensitively).
      const { data: cats } = await db.from('hq_invoice_categories').select('id,name')
      const catByName = new Map((cats || []).map(c => [String(c.name).toLowerCase(), c.id]))

      // 4. Process each new file.
      for (const file of fresh) {
        try {
          if (file.size > MAX_BYTES) {
            await db.from('hq_drive_ingest').insert({ drive_file_id: file.id, file_name: file.name, folder_name: file.folder, status: 'skipped', error: 'file > 15MB' })
            summary.details.push(`skip ${file.name}: too big`)
            continue
          }
          const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { authorization: `Bearer ${token}` },
          })
          if (!dl.ok) throw new Error('download HTTP ' + dl.status)
          const bytes = new Uint8Array(await dl.arrayBuffer())
          const base64 = bytesToBase64(bytes)
          const isPdf = file.mime === 'application/pdf'
          const contentBlock = isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
            : { type: 'image', source: { type: 'base64', media_type: file.mime === 'image/heic' || file.mime === 'image/heif' ? 'image/jpeg' : file.mime, data: base64 } }

          const ai = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 1024,
              messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }],
            }),
          })
          const aiData = await ai.json()
          if (!ai.ok) throw new Error('anthropic: ' + JSON.stringify(aiData).slice(0, 200))
          const text = (aiData.content || []).map((b: any) => b.text || '').join('')
          const parsed = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/```\s*$/, ''))

          const amount = Number(parsed.amount)
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('no readable amount')
          const currency = ['EUR', 'MAD', 'LKR', 'USD', 'GBP'].includes(parsed.currency) ? parsed.currency : 'EUR'
          const slug = KNOWN_SLUGS.has(parsed.location_hint) ? parsed.location_hint : 'general'
          const categoryId = catByName.get(String(parsed.category_hint || '').toLowerCase()) || null

          // Miguel's rule: an expense that already lives in a location's
          // Operations Ledger belongs THERE — the Drive folder also holds
          // camp-float receipts (Junior's Makro runs etc.), and ingesting
          // them into hq_invoices would double-count the camp in All
          // Expenses. Match by amount + date ±2 days on ledger expenses.
          if (parsed.invoice_date) {
            const d0 = new Date(parsed.invoice_date)
            const lo = new Date(d0.getTime() - 2 * 86400000).toISOString().slice(0, 10)
            const hi = new Date(d0.getTime() + 2 * 86400000).toISOString().slice(0, 10)
            const { data: ledTwin } = await db.from('ledger_entries')
              .select('id, attributed_location')
              .eq('type', 'expense')
              .gte('entry_date', lo).lte('entry_date', hi)
              .gte('amount_local', amount - 0.005).lte('amount_local', amount + 0.005)
              .limit(1)
            if (ledTwin && ledTwin.length) {
              await db.from('hq_drive_ingest').insert({
                drive_file_id: file.id, file_name: file.name, folder_name: file.folder,
                status: 'skipped',
                error: 'já no Operations Ledger de ' + ledTwin[0].attributed_location + ' — pertence lá',
              })
              summary.details.push(`skip ${file.name}: já no ledger (${ledTwin[0].attributed_location})`)
              continue
            }
          }

          // Signature dedup against existing invoices (double-shot photos etc.)
          let isDup = false, dupOf: string | null = null
          if (parsed.invoice_number) {
            const { data: twin } = await db.from('hq_invoices')
              .select('id').is('deleted_at', null)
              .ilike('company', parsed.company || '')
              .eq('invoice_number', parsed.invoice_number)
              .eq('amount', amount)
              .limit(1)
            if (twin && twin.length) { isDup = true; dupOf = twin[0].id }
          }

          const { data: inserted, error: insErr } = await db.from('hq_invoices').insert({
            location_slug: slug,
            invoice_date: parsed.invoice_date || new Date().toISOString().slice(0, 10),
            company: parsed.company || file.name.replace(/\.[a-z0-9]+$/i, ''),
            description: parsed.description || null,
            supplier_nif: parsed.supplier_nif || null,
            amount,
            currency,
            fx_rate: currency === 'EUR' ? 1 : null,
            amount_eur: currency === 'EUR' ? amount : null,
            payment_type: parsed.payment_type || null,
            invoice_number: parsed.invoice_number || null,
            category_id: categoryId,
            needs_review: true,
            is_duplicate: isDup,
            duplicate_of: dupOf,
            paying_company: PAYING_COMPANY_DEFAULT,
            file_name: file.name,
            // Preview sem ocupar storage: o documento fica na Drive e a
            // lista do HQ mostra "↗ Drive" (render já existente em
            // hq/index.html) a abrir o ficheiro original.
            drive_link: 'https://drive.google.com/file/d/' + file.id + '/view',
          }).select('id').single()
          if (insErr) throw new Error('insert: ' + insErr.message)

          await db.from('hq_drive_ingest').insert({
            drive_file_id: file.id, file_name: file.name, folder_name: file.folder,
            status: 'inserted', invoice_id: inserted.id,
          })
          summary.inserted++
          if (isDup) summary.skipped_dup_invoice++
          summary.details.push(`ok ${file.name} → ${slug} ${amount} ${currency}${isDup ? ' (dup-flag)' : ''}`)
        } catch (fileErr) {
          summary.errors++
          summary.details.push(`err ${file.name}: ${String(fileErr).slice(0, 160)}`)
          await db.from('hq_drive_ingest').insert({
            drive_file_id: file.id, file_name: file.name, folder_name: file.folder,
            status: 'error', error: String(fileErr).slice(0, 500),
          }).then(() => {}, () => {})
        }
      }
      return json(summary)
    } catch (e) {
      return json({ error: String(e).slice(0, 400), ...summary }, 500)
    }
  })
}
