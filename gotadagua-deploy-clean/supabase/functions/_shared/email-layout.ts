// ════════════════════════════════════════════════════════════════════════════
//  The house look for every email the app sends on its own (invite, weekly
//  digest…): logo on top, white card on the light ocean background, one
//  ocean-blue button, the Gota Dagua footer. Table layout + inline styles so
//  Gmail, Apple Mail and Outlook all draw it the same. Outfit where the client
//  has it, Helvetica/Arial otherwise (no serif — docs/DESIGN-SYSTEM.md).
// ════════════════════════════════════════════════════════════════════════════

const ASSET_BASE = 'https://gotadaguasurf.vercel.app'
export const FONT = "Outfit,'Helvetica Neue',Helvetica,Arial,sans-serif"
export const C = {
  navy: '#28394b', ink: '#14212e', muted: '#5d7185', faint: '#8595a8',
  ocean: '#1e6fa8', bg: '#f0f5fa', line: '#e3eaf2',
}

export const escHtml = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A button that survives Outlook: the link sits inside a coloured table cell.
export function emailButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr>
  <td align="center" bgcolor="${C.ocean}" style="border-radius:12px;background:${C.ocean}">
    <a href="${escHtml(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${escHtml(label)}</a>
  </td></tr></table>`
}

export interface EmailLayout {
  preheader?: string   // grey preview line in the inbox list
  bodyHtml: string     // the card's content (already escaped)
  width?: number       // 560 for messages, wider for reports
  hero?: string        // optional block above the card body (e.g. a navy banner)
  flush?: boolean      // the body brings its own padding (reports with several sections)
}

export function brandedEmail(o: EmailLayout): string {
  const w = o.width || 560
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${escHtml(o.preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${w}px">
    <tr><td align="center" style="padding:4px 0 22px">
      <a href="https://www.gotadaguasurf.com" style="text-decoration:none"><img src="${ASSET_BASE}/assets/logos/logo-blue.png" width="132" alt="Gota Dagua Surf" style="display:block;border:0;width:132px;height:auto"></a>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${C.line}">
      ${o.hero || ''}
      <div style="padding:${o.flush ? '0' : '32px 32px 30px'};font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">${o.bodyHtml}</div>
    </td></tr>
    <tr><td align="center" style="padding:22px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.faint}">
      Gota Dagua Surf · Costa da Caparica · Ahangama · Tamraght<br>
      <a href="https://www.gotadaguasurf.com" style="color:${C.faint};text-decoration:underline">gotadaguasurf.com</a> ·
      <a href="https://www.instagram.com/gotadagua_surf" style="color:${C.faint};text-decoration:underline">Instagram</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}
