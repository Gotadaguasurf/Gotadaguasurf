// ════════════════════════════════════════════════════════════════════════════
//  Outbound mail construction — ONE implementation, imported by every sender.
//
//  This file exists because there were two. gmail-send (Compose, Reply) and
//  email-dispatch (queued campaigns) each carried their own copy of buildRaw.
//  Fixes landed on one and not the other, so single sends went out correctly
//  addressed and fully branded while the campaign — the high-volume path —
//  kept sending "JoÃƒÂ£o Maria AndrÃƒÂ©" in plain text to real prospects.
//  Anything that sends mail must import from here.
// ════════════════════════════════════════════════════════════════════════════

// Assets are served from our own deploy; a free image host deleted the
// previous ones and every signature in the wild broke at once.
const ASSET_BASE = 'https://gotadaguasurf.vercel.app'

// team_users has no phone or photo column, so the per-mailbox extras live
// here. Keep in step with SIG_PHONES / SIG_PHOTOS in crm/index.html.
const SIG_PHONE: Record<string, string> = {
  'groups@gotadaguasurf.com': '+351 917 744 363',
}
const SIG_PHOTO: Record<string, string> = {
  'groups@gotadaguasurf.com': 'joao-maria.jpg',
}

export interface Sender {
  full_name?: string | null
  role?: string | null
  email?: string | null
  signature?: string | null
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The house signature: logo, sender photo, name and role, contact lines.
export function signatureHtml(sender: Sender): string {
  const name = esc(sender?.full_name || 'Gota Dagua Surf')
  const role = esc(sender?.role || '')
  const email = esc(sender?.email || '')
  const phone = SIG_PHONE[sender?.email || ''] || ''
  const photo = SIG_PHOTO[sender?.email || ''] || ''
  const cell = 'vertical-align:middle;'
  const link = 'color:#233a4d;text-decoration:none;'
  const social = (icon: string, href: string, label: string) =>
    `<div style="margin-bottom:6px;white-space:nowrap"><a href="${href}" style="${link}">` +
    `<img src="${ASSET_BASE}/assets/sig/${icon}.png" width="20" height="20" alt="" style="vertical-align:middle;border:0"> ` +
    `<span style="vertical-align:middle">${label}</span></a></div>`
  return `<div style="margin-bottom:10px">Best,</div>
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#233a4d;font-size:13px;line-height:1.4"><tbody><tr>
  <td style="${cell}padding-right:20px;border-right:2px solid #e5e7eb"><a href="https://www.gotadaguasurf.com" style="text-decoration:none"><img src="${ASSET_BASE}/assets/logos/logo-blue.png" alt="Gota Dagua Surf Camp" width="130" style="display:block;border:0"></a></td>
  ${photo ? `<td style="${cell}padding:0 0 0 20px"><img src="${ASSET_BASE}/assets/sig/people/${photo}" width="72" height="72" alt="" style="display:block;border:0;border-radius:50%"></td>` : ''}
  <td style="${cell}padding:0 20px;border-right:2px solid #e5e7eb">
    <div style="font-weight:bold;font-size:17px;margin-bottom:2px">${name}</div>
    ${role ? `<div style="color:#6b7280;margin-bottom:10px">${role}</div>` : ''}
    ${phone ? `<div style="white-space:nowrap;margin-bottom:6px"><a href="tel:${phone.replace(/ /g, '')}" style="${link}"><img src="${ASSET_BASE}/assets/sig/phone.png" width="18" height="18" alt="" style="vertical-align:middle;border:0"> <span style="vertical-align:middle">${phone}</span></a></div>` : ''}
    ${email ? `<div style="white-space:nowrap"><a href="mailto:${email}" style="${link}"><img src="${ASSET_BASE}/assets/sig/mail.png" width="18" height="18" alt="" style="vertical-align:middle;border:0"> <span style="vertical-align:middle">${email}</span></a></div>` : ''}
  </td>
  <td style="${cell}padding-left:20px">
    ${social('ig', 'https://www.instagram.com/gotadagua_surf', 'gotadagua_surf')}
    ${social('yt', 'https://www.youtube.com/@gotadaguasurf1939', 'gotadagua_surf')}
    ${social('web', 'https://www.gotadaguasurf.com', 'www.gotadaguasurf.com')}
  </td>
</tr></tbody></table>`
}

// Turns the typed body into the HTML alternative: newlines become <br>, and
// the plain-text signature at the end is swapped for the branded block.
// `trailer` (an unsubscribe line, say) is appended after the signature so it
// survives the swap instead of being cut away with it.
export function buildEmailHtml(body: string, sender: Sender, trailer = ''): string {
  let text = String(body || '').replace(/\r\n/g, '\n')
  const sig = (sender?.signature || '').trim().replace(/\r\n/g, '\n')
  if (sig) {
    const at = text.lastIndexOf(sig)
    if (at >= 0) text = text.slice(0, at).replace(/\s+$/, '')
  }
  const escaped = esc(text).replace(/\n/g, '<br>')
  const tail = trailer
    ? `<div style="margin-top:18px;font-size:12px;color:#6b7280">${esc(trailer.replace(/^\s+/, '')).replace(/\n/g, '<br>')}</div>`
    : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2a44;line-height:1.5">${escaped}<br><br>${signatureHtml(sender)}${tail}</div>`
}

// RFC 2822 message, base64url encoded for the Gmail API's `raw` field.
// When `html` is given the message is multipart/alternative: plain text
// first (spam filters read it, basic clients fall back to it), HTML second.
export interface MailAttachment {
  name: string
  type: string
  bytes: Uint8Array
}

// Base64 de um Uint8Array sem construir uma string binária gigante pelo meio.
// O corte é múltiplo de 3, por isso o base64 dos pedaços concatenados é igual
// ao base64 do todo.
function b64FromBytes(buf: Uint8Array): string {
  const CH = 3 * 4096
  const out: string[] = []
  for (let i = 0; i < buf.length; i += CH) {
    const sub = buf.subarray(i, i + CH)
    out.push(btoa(String.fromCharCode.apply(null, sub as unknown as number[])))
  }
  return out.join('')
}

// Limite total dos anexos. Acima disto a função fica sem memória a montar a
// mensagem, e o erro que chega ao utilizador não explica nada.
export const ATTACH_TOTAL_LIMIT = 12 * 1024 * 1024

// Vai buscar ao bucket os ficheiros que a app carregou. Guarda os bytes; a
// conversão para base64 acontece uma só vez, no fim, sobre a mensagem inteira.
export async function fetchAttachments(
  list: Array<{ url: string; name?: string; type?: string }>,
): Promise<{ files: MailAttachment[]; skipped: string[] }> {
  const files: MailAttachment[] = []
  const skipped: string[] = []
  let total = 0
  for (const f of list || []) {
    if (!f?.url) continue
    const nome = f.name || (f.url.split('/').pop() || 'anexo')
    try {
      const resp = await fetch(f.url)
      if (!resp.ok) { skipped.push(nome); continue }
      const bytes = new Uint8Array(await resp.arrayBuffer())
      if (total + bytes.length > ATTACH_TOTAL_LIMIT) { skipped.push(nome); continue }
      total += bytes.length
      files.push({
        name: nome,
        type: f.type || resp.headers.get('content-type') || 'application/octet-stream',
        bytes,
      })
    } catch { skipped.push(nome) }
  }
  return { files, skipped }
}

// RFC 2045: corpos base64 quebram aos 76 caracteres.
function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join('\r\n')
}

// Um nome de ficheiro com acentos precisa de RFC 2047 no cabeçalho.
function encodeFilename(name: string, toUtf8: (s: string) => string): string {
  return /[^\x20-\x7e]/.test(name)
    ? `=?utf-8?B?${btoa(toUtf8(name))}?=`
    : name.replace(/"/g, "'")
}

export function buildRaw(args: {
  fromEmail: string
  fromDisplay: string
  to: string
  cc?: string
  subject: string
  body: string
  html?: string
  inReplyTo?: string
  references?: string
  attachments?: MailAttachment[]
}): string {
  const toUtf8 = (s: string) => unescape(encodeURIComponent(s || ''))
  const escapedDisplay = (args.fromDisplay || '').replace(/"/g, "'")
  // A header carries ASCII. "João" written straight into one arrives as
  // mojibake, so anything outside printable ASCII gets RFC 2047 B-encoded.
  const displayWord = /[^\x20-\x7e]/.test(escapedDisplay)
    ? `=?utf-8?B?${btoa(toUtf8(escapedDisplay))}?=`
    : `"${escapedDisplay}"`
  const lines: string[] = [
    `From: ${escapedDisplay ? `${displayWord} <${args.fromEmail}>` : args.fromEmail}`,
    `Reply-To: ${args.fromEmail}`,
    `To: ${args.to}`,
  ]
  if (args.cc) lines.push(`Cc: ${args.cc}`)
  lines.push(`Subject: =?utf-8?B?${btoa(toUtf8(args.subject || ''))}?=`, 'MIME-Version: 1.0')

  const atts = args.attachments || []
  if (atts.length) {
    // multipart/mixed
    //   ├── multipart/alternative  (texto + HTML)
    //   └── um part por ficheiro
    // Montado em BYTES e convertido para base64 uma única vez no fim. A
    // versão anterior construía a mensagem como string e corria
    // encodeURIComponent + btoa por cima: com tres PDF a funcao ficava sem
    // memoria e devolvia WORKER_RESOURCE_LIMIT.
    const outer = 'gds_mix_5a1e9d'
    const inner = 'gds_alt_7f3b2c'
    lines.push(`Content-Type: multipart/mixed; boundary="${outer}"`)
    if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`)
    if (args.references) lines.push(`References: ${args.references}`)
    const enc = new TextEncoder()
    const chunks: Uint8Array[] = []
    chunks.push(enc.encode(
      lines.join('\r\n') + '\r\n\r\n' +
      `--${outer}\r\nContent-Type: multipart/alternative; boundary="${inner}"\r\n\r\n` +
      `--${inner}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      (args.body || '') + '\r\n\r\n' +
      `--${inner}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      (args.html || (args.body || '')) + `\r\n\r\n--${inner}--\r\n`,
    ))
    for (const a of atts) {
      const fn = encodeFilename(a.name, toUtf8)
      chunks.push(enc.encode(
        `\r\n--${outer}\r\n` +
        `Content-Type: ${a.type}; name="${fn}"\r\n` +
        `Content-Disposition: attachment; filename="${fn}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n`,
      ))
      chunks.push(enc.encode(wrap76(b64FromBytes(a.bytes)) + '\r\n'))
    }
    chunks.push(enc.encode(`\r\n--${outer}--\r\n`))
    let total = 0
    for (const c of chunks) total += c.length
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
    return b64FromBytes(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  if (args.html) {
    const b = 'gds_alt_7f3b2c'
    lines.push(`Content-Type: multipart/alternative; boundary="${b}"`)
    if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`)
    if (args.references) lines.push(`References: ${args.references}`)
    const message = lines.join('\r\n') + '\r\n\r\n' +
      `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      (args.body || '') + '\r\n\r\n' +
      `--${b}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n` +
      args.html + `\r\n\r\n--${b}--\r\n`
    return btoa(toUtf8(message)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit')
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`)
  if (args.references) lines.push(`References: ${args.references}`)
  const message = lines.join('\r\n') + '\r\n\r\n' + (args.body || '')
  return btoa(toUtf8(message)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
