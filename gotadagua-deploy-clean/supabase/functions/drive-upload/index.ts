// ════════════════════════════════════════════════════════════════════════════
//  drive-upload — põe um PDF/imagem na pasta do mês na Drive das faturas e
//  devolve o id/link. O ficheiro passa por aqui e segue; nada fica na app.
//  (Miguel, 6 Out 2026: «descarregar o ficheiro na app e a app passa para a
//  Drive, não quero que fique na app».)
//
//  POST (JWT de membro do HQ)  { folder_id, name, mime, data_base64 }
//       → { id, name, link }
//  GET  ?start=SECRET          → consentimento Google (scope drive + email),
//       uma vez, com a conta dona da Drive (ricardo.gasurfcamp@gmail.com)
//  GET  ?code=…&state=SECRET   → guarda o refresh token em drive_account
//       (a mesma tabela do drive-sync; o scope «drive» também serve para ler)
//
//  Secrets (já existem): GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET,
//  DRIVE_SYNC_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//  Setup único: adicionar ${SUPABASE_URL}/functions/v1/drive-upload aos
//  «Authorized redirect URIs» do cliente OAuth e abrir ?start=SECRET.
//  Deploy: supabase functions deploy drive-upload --no-verify-jwt
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SECRET        = Deno.env.get('DRIVE_SYNC_SECRET') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MAX_BYTES     = 20 * 1024 * 1024

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })
const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">${body}</body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const selfUrl = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/drive-upload`

async function accessToken(db: ReturnType<typeof createClient>): Promise<string> {
  const { data: acct, error } = await db.from('drive_account').select('*').limit(1).single()
  if (error || !acct) throw new Error('A Drive ainda não está ligada: abrir /drive-upload?start=SECRET com a conta ricardo.gasurfcamp@gmail.com')
  if (acct.access_token && acct.access_expires_at && new Date(acct.access_expires_at).getTime() > Date.now() + 60_000) return acct.access_token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: acct.refresh_token, grant_type: 'refresh_token' }),
  })
  const tk = await resp.json()
  if (!resp.ok || !tk.access_token) throw new Error('Google recusou o refresh token: ' + JSON.stringify(tk).slice(0, 200))
  await db.from('drive_account').update({ access_token: tk.access_token, access_expires_at: new Date(Date.now() + ((tk.expires_in || 3600) - 30) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', acct.id)
  return tk.access_token
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
      auth.searchParams.set('scope', 'https://www.googleapis.com/auth/drive email')
      auth.searchParams.set('access_type', 'offline')
      auth.searchParams.set('prompt', 'consent')
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
      if (!resp.ok || !tk.refresh_token) return html('<h2>Falhou a troca do código</h2><pre>' + JSON.stringify(tk).slice(0, 300) + '</pre>', 500)
      let email = ''
      try { email = (await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: 'Bearer ' + tk.access_token } })).json()).email || '' } catch (_e) { /* cosmético */ }
      await db.from('drive_account').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      const { error } = await db.from('drive_account').insert({ authed_email: email, refresh_token: tk.refresh_token, access_token: tk.access_token, access_expires_at: new Date(Date.now() + ((tk.expires_in || 3600) - 30) * 1000).toISOString() })
      if (error) return html('<h2>Falhou a gravar</h2><pre>' + error.message + '</pre>', 500)
      return html(`<h2>✓ Drive ligada (${email})</h2><p>Podes fechar esta janela. O HQ já consegue pôr faturas na Drive.</p>`)
    }
    return json({ error: 'use ?start=SECRET para autorizar' }, 400)
  }

  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  // Quem chama tem de ser membro do HQ (JWT do browser).
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt || jwt === SERVICE_KEY) return json({ error: 'Missing Authorization' }, 401)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Invalid auth' }, 401)
  const { data: isHq, error: rpcErr } = await userClient.rpc('is_hq_member')
  if (rpcErr || !isHq) return json({ error: 'HQ member required' }, 403)

  let body: { folder_id?: string; name?: string; mime?: string; data_base64?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const folder = String(body.folder_id || '').trim(), name = String(body.name || '').trim().slice(0, 200)
  const mime = String(body.mime || 'application/pdf')
  if (!folder || !name || !body.data_base64) return json({ error: 'folder_id, name e data_base64 são obrigatórios' }, 400)
  const bytes = Uint8Array.from(atob(body.data_base64), c => c.charCodeAt(0))
  if (bytes.length > MAX_BYTES) return json({ error: 'Ficheiro acima de 20 MB' }, 413)

  try {
    const token = await accessToken(db)
    const boundary = 'gota' + crypto.randomUUID().replace(/-/g, '')
    const enc = new TextEncoder()
    const head = enc.encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`)
    const tail = enc.encode(`\r\n--${boundary}--`)
    const payload = new Uint8Array(head.length + bytes.length + tail.length)
    payload.set(head, 0); payload.set(bytes, head.length); payload.set(tail, head.length + bytes.length)
    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': `multipart/related; boundary=${boundary}` }, body: payload,
    })
    const out = await up.json()
    if (!up.ok) return json({ error: 'Drive recusou: ' + (out?.error?.message || JSON.stringify(out).slice(0, 200)) }, 502)
    return json({ id: out.id, name: out.name, link: `https://drive.google.com/file/d/${out.id}/view` })
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
