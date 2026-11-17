/* ════════════════════════════════════════════════════════════════════════════
   Camp Tab comps — why something was given away free (15 Nov 2026)

   Miguel: «Quando se oferece qualquer coisa no POS, bebida ou t-shirt ou tour,
   saber qual o motivo.» A line at price 0 in the Camp Tab needs a reason before
   it is added (camp-tab-inner.html → addResolvedItem → openCompReasonModal).
   The reason lives on the camp_tab_items row only:
     meta.comp_reason  staff | gift | compensation | marketing | other
     meta.comp_note    short note (required for «other»)
     meta.list_price   the catalog (guest) price at the time — the value given away
   A free line never reaches the ledger (Pay skips price-0 lines), so comps are
   visibility only, never a cost or revenue line.

   Loaded by BOTH pages:
     camp-hub/camp-tab-inner.html — the «Comps» sub-tab (lines / summarize)
     camp-hub/index.html          — the «Comps» line under the Weekly P&L week
                                    (CampComps.afterWeekly(ws), reads the Camp Tab
                                    state the frame posts: camp-tab-state-changed)
   Same keys as transport's «Why is it free?» (camp-hub/paylink.js FREE_REASONS,
   camp_trips.free_reason) plus «marketing», which only the POS has.

   17 Nov 2026:
   · «Make it an offer» — a line already on the tab with a price is made free
     afterwards (camp-tab-inner.html makeOfferForLine / applyOffer / undoOfferForLine).
     Same reasons; meta.offer_from keeps what the line was ({p, priceType, s, …}) for
     «Undo offer», meta.comp_at / comp_by / comp_by_name say when and who. A paid line
     is refused («Mark unpaid» first), so a ledger row never has to be rewritten.
   · Staff plus — STAFF_PLUS below: per camp, N free lines a Sat–Fri week for a staff
     member flagged «Staff plus» (camp_guests.meta.staffPlus). The allowance is counted
     from the lines (reason «staff_plus», note «k/N»), never stored.
   ════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const REASONS = [['staff', 'Staff'], ['gift', 'Gift to guest'], ['compensation', 'Compensation'], ['marketing', 'Marketing / influencer'], ['other', 'Other']];
  const SHORT = { staff: 'Staff', gift: 'Gift', compensation: 'Compensation', marketing: 'Marketing', other: 'Other' };
  const HINT = { compensation: 'something went wrong' };
  const NO_REASON = 'none';
  const NO_REASON_LABEL = 'No reason (before 15 Nov)';
  const NOTE_MAX = 80;

  // Reasons the app sets by itself — never a chip in «Why is it free?» (17 Nov 2026).
  const AUTO_REASONS = [['staff_plus', 'Staff plus allowance']];
  SHORT.staff_plus = 'Staff plus';
  const ALL_REASONS = [...REASONS, ...AUTO_REASONS];

  const isReason = (k) => ALL_REASONS.some((r) => r[0] === k);
  const label = (k) => (ALL_REASONS.find((r) => r[0] === k) || [])[1] || NO_REASON_LABEL;
  const short = (k) => SHORT[k] || 'No reason';
  // The reason as one phrase: «Gift to guest — birthday», «Staff plus allowance (3/7)».
  const whyText = (k, note) => {
    const n = cleanNote(note);
    if (k === 'staff_plus') return `${label(k)}${n ? ` (${n})` : ''}`;
    return `${label(k)}${n ? ` — ${n}` : ''}`;
  };
  const needsNote = (k) => k === 'other';
  const cleanNote = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  // A reason the caller may use: a known key, and a note when it is «other».
  const validWhy = (why) => !!why && isReason(why.reason) && (!needsNote(why.reason) || !!cleanNote(why.note));

  // ── Staff plus (17 Nov 2026, Sri Lanka only for now) ─────────────────────
  // Miguel: a staff type «Staff plus» with N free drinks a week. Per camp:
  //   perWeek     free lines per person per Sat–Fri week (the Weekly P&L week)
  //   categories  Camp Tab categories that count (default: every item in Drinks —
  //               soft drinks and water too, when they are in the Drinks tab)
  // Add a camp here to switch it on there; change 7 to change the allowance.
  const STAFF_PLUS = {
    'sri-lanka': { perWeek: 7, categories: ['Drinks'] },
  };
  const staffPlusConfig = (slug) => { const c = STAFF_PLUS[String(slug || '').toLowerCase()]; return c && c.perWeek > 0 ? c : null; };
  const staffPlusCounts = (item, cfg) => !!cfg && !!item && (cfg.categories || ['Drinks']).includes(item.c);
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  // Every allowance line of this person (all staff rows with the name — a closed
  // and re-added tab is the same person) in the Sat–Fri week of ymd, oldest first.
  function staffPlusUsed(state, name, ymd) {
    const ws = weekStartSat(ymd); const we = addDays(ws, 6);
    const weeks = [...(Array.isArray(state && state.history) ? state.history : [])];
    if (state && state.activeWeek) weeks.push(state.activeWeek);
    const out = []; const seen = new Set();
    weeks.forEach((wk) => (Array.isArray(wk && wk.staff) ? wk.staff : []).forEach((row) => {
      if (!sameName(row && row.name, name)) return;
      (Array.isArray(row.items) ? row.items : []).forEach((it, pos) => {
        if (!it || it.compReason !== 'staff_plus') return;
        if (it.id) { if (seen.has(it.id)) return; seen.add(it.id); }
        const d = String(it.d || '').slice(0, 10);
        if (!d || d < ws || d > we) return;
        out.push({ item: it, row, key: `${d} ${String(it.t || '').padStart(5, '0')} ${String(pos).padStart(5, '0')}` });
      });
    }));
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  function staffPlusLeft(state, name, ymd, cfg) {
    if (!cfg) return 0;
    return Math.max(0, cfg.perWeek - staffPlusUsed(state, name, ymd).length);
  }

  // Free = price 0. Bar lines are a running total typed by hand (never a comp)
  // and Sri Lanka Dipløria is pass-through (paid to the brand, not the camp).
  function isFreeLine(item, isPass) {
    if (!item) return false;
    if (Number(item.p || 0) !== 0) return false;
    if (item.c === 'Bar') return false;
    if (typeof isPass === 'function' && isPass(item)) return false;
    return true;
  }

  // ── Dates (pure YYYY-MM-DD arithmetic, never the browser zone) ───────────
  const dayNum = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000; };
  const addDays = (ymd, n) => new Date((dayNum(ymd) + n) * 86400000).toISOString().slice(0, 10);
  // Saturday of the Sat–Fri week — the Weekly P&L rule (index.html weekStartSat).
  const weekStartSat = (ymd) => { const dow = new Date(dayNum(ymd) * 86400000).getUTCDay(); return addDays(ymd, -((dow + 1) % 7)); };
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  function periodRange(kind, today) {
    if (kind === 'week') { const ws = weekStartSat(today); return { from: ws, to: addDays(ws, 6) }; }
    if (kind === 'month') { const ym = today.slice(0, 7); return { from: ym + '-01', to: monthEnd(ym) }; }
    if (kind === 'last-month') { const first = today.slice(0, 7) + '-01'; const ym = addDays(first, -1).slice(0, 7); return { from: ym + '-01', to: monthEnd(ym) }; }
    return { from: '', to: '' };
  }

  // Current guest price per item name, for old comps saved without list_price.
  function menuPriceMap(menu) {
    const m = new Map();
    Object.values(menu && typeof menu === 'object' ? menu : {}).forEach((rows) => (Array.isArray(rows) ? rows : []).forEach((r) => {
      const k = String(r && r.n || '').trim().toLowerCase(); const p = Number(r && r.p || 0);
      if (k && p > 0 && !m.has(k)) m.set(k, p);
    }));
    return m;
  }

  // Every free line in the Camp Tab state (all weeks, both rosters, closed
  // guests included), optionally between from..to (YYYY-MM-DD, inclusive).
  function lines(state, menu, opts) {
    const o = opts || {};
    const prices = menuPriceMap(menu);
    const weeks = [...(Array.isArray(state && state.history) ? state.history : [])];
    if (state && state.activeWeek) weeks.push(state.activeWeek);
    const seen = new Set();
    const out = [];
    weeks.forEach((wk) => [['guests', 'Guest'], ['staff', 'Staff']].forEach(([key, roster]) => {
      (Array.isArray(wk && wk[key]) ? wk[key] : []).forEach((g) => (Array.isArray(g && g.items) ? g.items : []).forEach((it) => {
        if (!isFreeLine(it, o.isPass)) return;
        if (it.id) { if (seen.has(it.id)) return; seen.add(it.id); }
        const d = String(it.d || '').slice(0, 10);
        if (o.from && (!d || d < o.from)) return;
        if (o.to && (!d || d > o.to)) return;
        const stored = Number(it.listPrice);
        const hasStored = Number.isFinite(stored) && stored > 0;
        const guess = prices.get(String(it.n || '').trim().toLowerCase()) || 0;
        out.push({
          id: it.id || '', n: String(it.n || ''), c: String(it.c || ''), d, t: String(it.t || ''),
          to: String(g.name || ''), roster,
          reason: isReason(it.compReason) ? it.compReason : NO_REASON,
          note: cleanNote(it.compNote),
          value: hasStored ? stored : guess,
          estimated: !hasStored,
          createdBy: it.createdBy || '',
          // Made an offer after it was charged (17 Nov 2026): who, when, and the price it had.
          // (a Staff plus allowance line also keeps offerFrom, for Undo — it is not a manual offer)
          offer: !!(it.offerFrom && typeof it.offerFrom === 'object') && it.compReason !== 'staff_plus',
          wasPrice: it.offerFrom && Number.isFinite(Number(it.offerFrom.p)) ? Number(it.offerFrom.p) : null,
          compAt: it.compAt || '',
          compBy: it.compBy || '',
          compByName: it.compByName || '',
        });
      }));
    }));
    return out.sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t));
  }

  function summarize(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const byReason = [...ALL_REASONS.map((r) => r[0]), NO_REASON].map((key) => {
      const rs = list.filter((x) => x.reason === key);
      return { key, label: label(key), count: rs.length, value: rs.reduce((s, x) => s + x.value, 0) };
    }).filter((x) => x.count > 0);
    const items = new Map();
    list.forEach((x) => {
      const k = x.n.toLowerCase();
      if (!items.has(k)) items.set(k, { n: x.n, c: x.c, count: 0, value: 0 });
      const it = items.get(k); it.count++; it.value += x.value;
    });
    return {
      count: list.length,
      value: list.reduce((s, x) => s + x.value, 0),
      estimated: list.some((x) => x.estimated),
      byReason,
      byItem: [...items.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.n.localeCompare(b.n)),
    };
  }

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Camp hub: the «Comps» line under the selected Weekly P&L week ────────
  // index.html renderWeeklyPL() leaves <div id="wplCompsSlot"> and calls
  // CampComps.afterWeekly(sel). Visibility only — not a cost line.
  function hubMoney(n) {
    const cur = (typeof LOCAL_CURRENCY !== 'undefined' && LOCAL_CURRENCY) || 'EUR';
    const fx = (typeof LOCAL_PER_EUR !== 'undefined' && Number(LOCAL_PER_EUR)) || 1;
    const v = Number(n || 0);
    const eur = '€' + Math.round(cur === 'EUR' ? v : v / fx).toLocaleString('en-US');
    return cur === 'EUR' ? eur : `${cur} ${Math.round(v).toLocaleString('en-US')} · ${eur}`;
  }
  function hubState() {
    try {
      if (typeof readJsonStorage !== 'function' || typeof CAMPTAB_KEY === 'undefined') return null;
      return { state: readJsonStorage(CAMPTAB_KEY, null), menu: typeof CAMPTAB_MENU_KEY !== 'undefined' ? readJsonStorage(CAMPTAB_MENU_KEY, null) : null };
    } catch (_) { return null; }
  }
  const dm = (ymd) => new Date(dayNum(ymd) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  function weeklyLineHtml(ws) {
    const hs = hubState();
    if (!hs || !hs.state) return '';
    const isPass = (it) => it && it.c === 'Diploria' && typeof __HUB_LOCATION_SLUG !== 'undefined' && __HUB_LOCATION_SLUG === 'sri-lanka';
    const rows = lines(hs.state, hs.menu, { from: ws, to: addDays(ws, 6), isPass });
    const sum = summarize(rows);
    // What was given, to whom and why — the week's list (Miguel 15 Nov 2026: «ver o que oferecemos e a razão… por semana»)
    const MAX = 40;
    const list = rows.slice(0, MAX).map((r) => `<div class="wpl-comps-line" data-reason="${r.reason}">
        <span class="wpl-comps-what"><b>${escHtml(r.n)}</b> → ${escHtml(r.to)}${r.roster === 'Staff' ? ' <span class="wpl-comps-n">(staff)</span>' : ''}</span>
        <span class="wpl-comps-val">${r.estimated ? '≈ ' : ''}${hubMoney(r.value)}</span>
        <span class="wpl-comps-why">${escHtml(whyText(r.reason, r.note))}${r.offer ? ' · made an offer after it was charged' : ''}${r.d ? ` · ${dm(r.d)}` : ''}</span></div>`).join('')
      + (rows.length > MAX ? `<div class="wpl-comps-n" style="margin-top:6px">+${rows.length - MAX} more in Camp Tab → Top sellers → Given free</div>` : '');
    const by = sum.byReason.map((r) => `<span class="wpl-comps-r" data-reason="${r.key}">${escHtml(r.label)} <b>${hubMoney(r.value)}</b>${r.count > 1 ? ` <span class="wpl-comps-n">×${r.count}</span>` : ''}</span>`).join('');
    return `<div class="card wpl-comps" id="wplComps"><div class="card-pad">
      <div class="wpl-comps-top"><span class="wpl-comps-k">Comps · ${dm(ws)} – ${dm(addDays(ws, 6))}</span>
        <span class="wpl-comps-v" id="wplCompsTotal">${sum.count ? `${sum.estimated ? '≈ ' : ''}${hubMoney(sum.value)} at list price · ${sum.count} item${sum.count === 1 ? '' : 's'}` : 'Nothing given free'}</span></div>
      ${by ? `<div class="wpl-comps-by">${by}</div>` : ''}
      ${list ? `<div class="wpl-comps-list" id="wplCompsList">${list}</div>` : ''}
      <div class="card-hint">Given free in the Camp Tab, at the catalog price. Not a cost line — shown so you can see why. Other weeks: Camp Tab → Top sellers → Given free.</div>
    </div></div>`;
  }
  function injectHubStyles() {
    if (document.getElementById('campCompsCss')) return;
    const st = document.createElement('style');
    st.id = 'campCompsCss';
    st.textContent = `
.wpl-comps{margin-bottom:16px}
.wpl-comps-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.wpl-comps-k{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.wpl-comps-v{font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums}
.wpl-comps-by{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:13px;color:var(--text,inherit)}
.wpl-comps-r b{font-weight:600;font-variant-numeric:tabular-nums}
.wpl-comps-n{color:var(--muted);font-size:12px}
.wpl-comps .card-hint{margin-top:6px}
.wpl-comps-list{margin-top:10px;border-top:1px solid var(--border,#e5e7eb)}
.wpl-comps-line{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:8px 0;border-bottom:1px solid var(--border,#e5e7eb);font-size:13px}
.wpl-comps-what{min-width:0;overflow-wrap:anywhere}
.wpl-comps-val{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.wpl-comps-why{grid-column:1 / -1;color:var(--muted);font-size:12px}`;
    document.head.appendChild(st);
  }
  function afterWeekly(ws) {
    try {
      const slot = document.getElementById('wplCompsSlot');
      if (!slot || !ws) return;
      injectHubStyles();
      slot.innerHTML = weeklyLineHtml(ws);
    } catch (err) { console.warn('[comps] weekly line', err); }
  }

  root.CampComps = {
    REASONS, AUTO_REASONS, SHORT, HINT, NO_REASON, NO_REASON_LABEL, NOTE_MAX,
    isReason, label, short, whyText, needsNote, cleanNote, validWhy, isFreeLine,
    STAFF_PLUS, staffPlusConfig, staffPlusCounts, staffPlusUsed, staffPlusLeft, sameName,
    weekStartSat, addDays, periodRange, menuPriceMap, lines, summarize, escHtml,
    afterWeekly, weeklyLineHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
