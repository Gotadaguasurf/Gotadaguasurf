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
