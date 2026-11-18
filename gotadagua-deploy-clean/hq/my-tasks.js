// «My tasks» — the HQ tab for owners (18 Nov 2026): one card per source Miguel
// has to keep up to date (bank statements, the camps' banks, the documents the
// automatic routine fetches, the automatic imports), overdue first, with the
// website one tap away.
//
// The facts come from the SQL function hq_my_tasks() (supabase/hq-my-tasks.sql);
// the status rule lives here, in MyTasks.status, so the HQ «My tasks: N» chip and
// the tab always agree. Pure functions (status, summarize, weekdaysBetween) take
// «today» as a YYYY-MM-DD string and never read the clock themselves.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyTasks = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // ── Sources: name, rule, website, existing importer ─────────────────────
  // kind (from SQL): bank2 = every 2 working days · week = every 7 days ·
  // monthly = last month complete by the 10th · doc = fetched by the automatic
  // routine · run = automatic import (cron).
  const SOURCES = {
    santander:      { name: 'Santander',        sub: 'Current account', url: 'https://www.santander.pt/empresas', upload: 'santander' },
    cgd:            { name: 'CGD',              sub: 'Current account', url: 'https://www.cgd.pt/Empresas' },
    santander_card: { name: 'Santander card',   sub: 'Credit card statement', url: 'https://www.santander.pt/empresas' },
    paypal:         { name: 'PayPal',           sub: 'Monthly statement', url: 'https://www.paypal.com/reports/statements/monthly' },
    bcp:            { name: 'Millennium BCP',   sub: 'Manjar account', url: 'https://empresas.millenniumbcp.pt', upload: 'bcp' },
    sampath:        { name: 'Sampath',          sub: 'Sri Lanka camp bank', url: 'https://www.sampath.lk' },
    sg_morocco:     { name: 'Société Générale', sub: 'Morocco camp bank', url: 'https://www.sgmaroc.com' },
    uber:           { name: 'Uber',             sub: 'Trip invoices', url: 'https://riders.uber.com/trips' },
    via_verde:      { name: 'Via Verde',        sub: 'Monthly statement', url: 'https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos' },
    mailchimp:      { name: 'Mailchimp',        sub: 'Billing history', url: 'https://us4.admin.mailchimp.com/account/billing-history/' },
    google_ads:     { name: 'Google Ads',       sub: 'Billing documents', url: 'https://ads.google.com/aw/billing/documents?ocid=214208330' },
    meta_ads:       { name: 'Meta Ads',         sub: 'Payment activity', url: 'https://adsmanager.facebook.com/adsmanager/billing_hub/payment_activity/?asset_id=814598912211070&business_id=2279734382295092' },
    bl_reports:     { name: 'Bookinglayer reports', sub: 'Camp reports by email, every hour' },
    bl_revenue:     { name: 'Bookinglayer revenue report', sub: 'Revenue report by email, every morning' },
    mail_items:     { name: 'Emailed invoices', sub: 'Invoices read from the mailboxes' },
  };
  const RULE = {
    bank2:   'Every 2 working days',
    week:    'Every 7 days',
    monthly: 'Last month by the 10th',
    doc:     'Fetched daily by the automatic routine',
    run:     'Overdue after 2 h without a run',
    daily:   'Overdue after a day without a report',
    check:   'What failed in the last 30 days',
  };
  const BLOCKS = [
    { id: 'water-movements', label: 'Water Movements' },
    { id: 'manjar',          label: 'Manjar' },
  ];
  const RUN_MAX_MS = 2 * 3600 * 1000;   // automatic imports: overdue after 2 h without a run
  const DAILY_MAX_MS = 26 * 3600 * 1000; // the daily revenue report: overdue after 26 h without one
  const DOC_GRACE_DAY = 8;              // automatic documents: last month must have one after the 8th
  const CARD_DAY = 10;                  // card statement: last month missing on the 10th = overdue

  // ── Dates (UTC calendar days, no time zone surprises) ───────────────────
  const toDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const DAY = 86400000;
  // days strictly after a and strictly before b (the days that fully passed uncovered)
  function daysBetween(a, b){ const x = toDay(a), y = toDay(b); return x == null || y == null ? null : Math.max(0, Math.round((y - x) / DAY) - 1); }
  function weekdaysBetween(a, b){
    const x = toDay(a), y = toDay(b); if (x == null || y == null) return null;
    let n = 0; for (let t = x + DAY; t < y; t += DAY) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
    return n;
  }
  const lastDayPrevMonth = (today) => { const t = new Date(toDay(today)); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).toISOString().slice(0, 10); };
  const dayOfMonth = (today) => new Date(toDay(today)).getUTCDate();
  const localToday = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date()); } catch (_e) { return new Date().toISOString().slice(0, 10); } };

  // ── The rule ────────────────────────────────────────────────────────────
  // → { code: 'ok' | 'due' | 'overdue' | 'auto', why }
  function status(row, today, nowMs){
    const kind = row && row.kind;
    const now = nowMs == null ? Date.now() : nowMs;
    const last = row && row.last_date && toDay(row.last_date) <= toDay(today) ? row.last_date : null;   // a future date never counts
    if (kind === 'run' || kind === 'daily') {
      if (row.error) return { code: 'overdue', why: 'Last run failed' };
      const t = row.last_run_at ? Date.parse(row.last_run_at) : NaN;
      if (!isFinite(t)) return { code: 'overdue', why: 'Never ran' };
      if (kind === 'run' && now - t > RUN_MAX_MS) return { code: 'overdue', why: 'No run for more than 2 hours' };
      if (kind === 'daily' && now - t > DAILY_MAX_MS) return { code: 'overdue', why: 'No report since yesterday' };
      // the run worked but left something to decide (audit PRT-06 / SEAM-06): amber, with what it is
      if (row.warning) return { code: 'due', why: String(row.warning) };
      return { code: 'auto', why: '' };
    }
    if (kind === 'check') return row.error ? { code: 'due', why: String(row.error) } : { code: 'auto', why: '' };
    if (kind === 'doc') {
      if (dayOfMonth(today) > DOC_GRACE_DAY && !Number(row.prev_month_docs || 0)) return { code: 'overdue', why: 'No document for last month' };
      return { code: 'auto', why: '' };
    }
    if (!last) return { code: 'overdue', why: 'Nothing loaded yet' };
    if (kind === 'monthly') {
      if (toDay(last) >= toDay(lastDayPrevMonth(today))) return { code: 'ok', why: '' };
      return dayOfMonth(today) >= CARD_DAY ? { code: 'overdue', why: 'Last month is missing' } : { code: 'due', why: 'Last month is missing' };
    }
    if (kind === 'week') {
      const gap = daysBetween(last, today);
      return gap > 7 ? { code: 'overdue', why: `${gap} days not covered` } : gap === 7 ? { code: 'due', why: '7 days not covered' } : { code: 'ok', why: '' };
    }
    // bank2: weekends do not count
    const gap = weekdaysBetween(last, today);
    return gap > 2 ? { code: 'overdue', why: `${gap} working days not covered` } : gap === 2 ? { code: 'due', why: '2 working days not covered' } : { code: 'ok', why: '' };
  }
  const RANK = { overdue: 0, due: 1, ok: 2, auto: 3 };
  function evaluate(data, nowMs){
    const today = (data && data.today) || localToday();
    const rows = (data && Array.isArray(data.sources) ? data.sources : []).map((r, i) => ({ ...r, i, st: status(r, today, nowMs) }));
    rows.sort((a, b) => (RANK[a.st.code] - RANK[b.st.code]) || (a.i - b.i));
    return { today, rows };
  }
  function summarize(data, nowMs){
    const { rows } = evaluate(data, nowMs);
    return { overdue: rows.filter(r => r.st.code === 'overdue').length, due: rows.filter(r => r.st.code === 'due').length };
  }

  // ── Load (handles the SQL not run yet) ──────────────────────────────────
  // → { state: 'ok', data } | { state: 'missing' } | { state: 'denied', message } | { state: 'error', message }
  async function load(sb){
    try {
      const { data, error } = await sb.rpc('hq_my_tasks');
      if (error) {
        const msg = String(error.message || error.code || error);
        if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(msg)) return { state: 'missing' };
        if (error.code === '42501' || /owner required|permission denied/i.test(msg)) return { state: 'denied', message: msg };
        return { state: 'error', message: msg };
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.sources)) return { state: 'missing' };
      return { state: 'ok', data };
    } catch (e) {
      return { state: 'error', message: String((e && e.message) || e) };
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => (typeof AppShell !== 'undefined' && AppShell.icon) ? AppShell.icon(n) : '';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmtDate(s, today){
    const t = toDay(s); if (t == null) return '—';
    const d = new Date(t), y = d.getUTCFullYear();
    return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}${String(y) !== String(today || '').slice(0, 4) ? ' ' + y : ''}`;
  }
  function fmtStamp(iso, today){
    const t = Date.parse(iso || ''); if (!isFinite(t)) return '—';
    let p; try { p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)); } catch (_e) { p = null; }
    if (!p) return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    const g = (k) => (p.find(x => x.type === k) || {}).value;
    const day = `${g('year')}-${g('month')}-${g('day')}`, hm = `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
    return day === today ? `today ${hm}` : `${fmtDate(day, today)} ${hm}`;
  }
  const BADGE = { ok: ['badge-green', 'OK'], due: ['badge-amber', 'Due'], overdue: ['badge-red', 'Overdue'], auto: ['badge-grey', 'Automatic'] };

  function meta(r, today){
    const facts = [];
    if (r.kind === 'check') {
      facts.push(r.error ? 'Add these by hand in Expenses' : 'Nothing failed');
    } else if (r.kind === 'run' || r.kind === 'daily') {
      facts.push(`Last run ${r.last_run_at ? fmtStamp(r.last_run_at, today) : 'never'}`);
    } else if (r.kind === 'doc') {
      facts.push(`Last document ${r.last_date ? fmtDate(r.last_date, today) : 'none'}`);
    } else {
      facts.push(`Covered until ${r.last_date ? fmtDate(r.last_date, today) : '—'}`);
      if (r.loaded_at) facts.push(`Loaded ${fmtStamp(r.loaded_at, today)}`);
    }
    return facts;
  }
  function describe(r){
    if (String(r.key || '').startsWith('mail:')) return { name: 'Mail ingest', sub: r.key.slice(5) + ' · every 15 minutes' };
    const s = SOURCES[r.key] || { name: r.key, sub: '' };
    return s;
  }
  function rowHtml(r, today){
    const s = describe(r);
    const [cls, word] = BADGE[r.st.code] || BADGE.auto;
    const rule = RULE[r.kind] || '';
    const actions = [];
    if (s.url) actions.push(`<a class="btn btn-s mt-btn" href="${esc(s.url)}" target="_blank" rel="noopener" data-act="open">${icon('external')} Open</a>`);
    if (s.upload === 'santander') actions.push(`<button class="btn btn-s mt-btn" type="button" data-act="upload" onclick="MyTasks.upload('santander')">${icon('upload')} Upload</button>`);
    if (s.upload === 'bcp') actions.push(`<a class="btn btn-s mt-btn" href="/suk/?import=1#bank" data-act="upload">${icon('upload')} Upload</a>`);
    const why = r.error ? esc(String(r.error).replace(/^conta:\s*/, '').slice(0, 160)) : esc(String(r.st.why || '').slice(0, 240));
    return `<div class="mt-row" data-key="${esc(r.key)}" data-status="${r.st.code}">
      <div class="mt-main">
        <div class="mt-name">${esc(s.name)}<span class="badge ${cls} mt-badge">${word}</span></div>
        <div class="mt-sub">${esc(s.sub)}${s.sub && rule ? ' · ' : ''}${esc(rule)}</div>
        <div class="mt-facts">${meta(r, today).map(esc).join(' · ')}</div>
        ${why ? `<div class="mt-why ${r.st.code === 'overdue' ? 'neg' : r.st.code === 'due' ? 'kv-amber' : ''}">${why}</div>` : ''}
      </div>
      ${actions.length ? `<div class="mt-actions">${actions.join('')}</div>` : ''}
    </div>`;
  }
  function headHtml(sub){
    return `<div class="section-head page-head">
      <div><div class="section-title">My tasks</div><div class="section-sub" id="mtSummary">${sub}</div></div>
      <div class="hq-filters"><button class="btn btn-s" type="button" onclick="renderMyTasks()">${icon('refresh')} Refresh</button></div>
    </div>`;
  }
  function render(el, res, nowMs){
    if (!el) return;
    if (!res || res.state === 'missing') {
      el.innerHTML = headHtml('Statements and automatic imports to keep up to date') + `<div class="card"><div class="empty-state" data-state="missing">${icon('info')}<div class="empty-title">My tasks needs the SQL update</div><p>Run <span class="mono">supabase/hq-my-tasks.sql</span> in the Supabase SQL Editor, then refresh this page.</p></div></div>`;
      return;
    }
    if (res.state === 'denied') {
      el.innerHTML = headHtml('') + `<div class="status-msg status-err" data-state="denied">Only owners can see My tasks.</div>`;
      return;
    }
    if (res.state === 'error') {
      el.innerHTML = headHtml('') + `<div class="status-msg status-err" data-state="error">Could not load My tasks: ${esc(res.message)}</div>`;
      return;
    }
    const { today, rows } = evaluate(res.data, nowMs);
    const n = { overdue: rows.filter(r => r.st.code === 'overdue').length, due: rows.filter(r => r.st.code === 'due').length };
    const blocks = BLOCKS.map(b => ({ ...b, rows: rows.filter(r => (r.block || 'water-movements') === b.id) })).filter(b => b.rows.length);
    el.innerHTML = headHtml(`${n.overdue} overdue · ${n.due} due`) + blocks.map(b => `
      <div class="mt-block" data-block="${b.id}">
        <div class="mt-block-title">${esc(b.label)}</div>
        <div class="mt-list">${b.rows.map(r => rowHtml(r, today)).join('')}</div>
      </div>`).join('');
  }

  // «Upload» opens the importer the app already has (Santander: the accountant pack panel).
  function upload(which){
    if (which !== 'santander' || typeof openAccountantPanel !== 'function') return;
    openAccountantPanel();
    setTimeout(() => { const f = document.getElementById('acc_bank_file'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }, 50);
  }

  return { SOURCES, RULE, status, evaluate, summarize, load, render, upload, weekdaysBetween, daysBetween, localToday };
}));
