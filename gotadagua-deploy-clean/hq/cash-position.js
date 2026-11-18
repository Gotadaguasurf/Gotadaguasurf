// «Cash today and the next 30 days» — top of the HQ «Cash flow» tab, owners only
// (18 Nov 2026): the closing balance of each Water Movements account, the fixed
// payments still to leave in the next 30 days and the lowest point of each account.
//
// The facts come from the SQL function hq_cash_position() (supabase/hq-cash-position.sql:
// balances from the statements, a small fixed set of recurring debits with the usual
// amount and day). The rule that turns them into dates and a lowest point lives here,
// in CashPosition.plan, a pure function: «today» comes from the data, never the clock.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashPosition = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const ACCOUNTS = { santander: 'Santander', cgd: 'CGD', paypal: 'PayPal' };
  const PAYMENTS = {
    salaries:        'Salaries',
    social_security: 'Social Security',
    state_iva:       'State · IVA',
    state_irs:       'State · IRS',
    state_irc:       'State · IRC on account',
    leasing:         'Leasing',
    catering:        'Catering · Manjar',
    rent:            'Rent',
  };
  const WINDOW_DAYS = 30;   // «next 30 days»
  const BUFFER = 2000;      // lowest point under this (or under zero) is shown in red
  const LEFT_SHARE = 0.5;   // this month's counts as paid once half the usual amount has left (leasing and IRS leave in pieces)

  // ── Dates (UTC calendar days) ───────────────────────────────────────────
  const DAY = 86400000;
  const toDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  // day d of a month, or its last day when the month is shorter
  const dayIn = (y, m0, d) => Date.UTC(y, m0, Math.min(d, new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round(n * 100) / 100;
  function median(list){
    const a = list.map(num).filter(n => n > 0).sort((x, y) => x - y);
    if (!a.length) return 0;
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  }

  // ── The rule ────────────────────────────────────────────────────────────
  // data = { today, accounts: [{key, balance, as_of, currency}], payments: [{key, name, account, amount, day,
  //          recent, months, this_month_amount, this_month_date}] }
  // → { today, until, accounts, toLeave (in the window, by date), paid (this month's left, next one after the window), lows }
  function plan(data){
    const today = String((data && data.today) || '').slice(0, 10);
    const t0 = toDay(today);
    const accounts = (data && Array.isArray(data.accounts) ? data.accounts : []).map(a => ({ ...a, label: ACCOUNTS[a.key] || a.key, balance: num(a.balance) }));
    if (t0 == null) return { today, until: null, accounts, toLeave: [], paid: [], lows: [] };
    const end = t0 + WINDOW_DAYS * DAY;
    const T = new Date(t0), y = T.getUTCFullYear(), m = T.getUTCMonth();

    const rows = (data && Array.isArray(data.payments) ? data.payments : []).map(p => {
      const usual = num(p.amount);
      const leftAmt = num(p.this_month_amount);
      const left = usual > 0 && leftAmt >= LEFT_SHARE * usual;
      const months = Array.isArray(p.months) && p.months.length ? p.months.map(Number) : null;   // fixed calendar (e.g. Jul · Sep · Dec)
      const day = Math.min(31, Math.max(1, Math.round(num(p.day)) || 1));
      let due = null, late = false, amount = usual;
      for (let k = 0; k < 13 && due == null; k++) {
        const mm = (m + k) % 12, yy = y + Math.floor((m + k) / 12);
        if (months && !months.includes(mm + 1)) continue;
        if (k === 0 && left) continue;                        // this month's already left → the next one
        due = dayIn(yy, mm, day);
        if (k === 0) { amount = Math.max(usual - leftAmt, 0); late = due < t0; }
        else if (left && !months) amount = median([leftAmt].concat(Array.isArray(p.recent) ? p.recent.slice(0, 2) : [usual]));
      }
      const when = late ? t0 : due;                           // expected day passed and not seen: it can leave any day now
      return {
        key: p.key, account: p.account, accountLabel: ACCOUNTS[p.account] || p.account,
        label: p.key === 'rent' && p.name ? `Rent · ${p.name}` : (PAYMENTS[p.key] || p.key),
        amount: round2(amount), due: due == null ? null : iso(due), when: when == null ? null : iso(when), late,
        inWindow: when != null && when <= end,
        left, leftDate: leftAmt > 0 ? (p.this_month_date || null) : null, leftAmount: round2(leftAmt),
      };
    });

    const toLeave = rows.filter(r => r.inWindow && r.amount > 0)
      .sort((a, b) => (toDay(a.when) - toDay(b.when)) || (b.amount - a.amount));
    const paid = rows.filter(r => !r.inWindow && r.left)
      .sort((a, b) => (toDay(a.leftDate) || 0) - (toDay(b.leftDate) || 0));

    // lowest point per account: the balance minus every payment of the list, in date order (no money in)
    const lows = accounts.map(a => {
      let bal = a.balance, lowest = a.balance, on = null, belowZeroFrom = null, out = 0;
      toLeave.filter(r => r.account === a.key).forEach(r => {
        bal -= r.amount; out += r.amount;
        if (bal < lowest) { lowest = bal; on = r.when; }
        if (bal < 0 && !belowZeroFrom) belowZeroFrom = r.when;
      });
      return { key: a.key, label: a.label, currency: a.currency || 'EUR', balance: a.balance, out: round2(out),
               lowest: round2(lowest), on, belowZeroFrom, alert: lowest < BUFFER };
    });
    return { today, until: iso(end), accounts, toLeave, paid, lows };
  }

  // ── Load (handles the SQL not run yet) ──────────────────────────────────
  // → { state: 'ok', data } | { state: 'missing' } | { state: 'denied' } | { state: 'error', message }
  async function load(sb){
    try {
      const { data, error } = await sb.rpc('hq_cash_position');
      if (error) {
        const msg = String(error.message || error.code || error);
        if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(msg)) return { state: 'missing' };
        if (error.code === '42501' || /owner required|permission denied/i.test(msg)) return { state: 'denied' };
        return { state: 'error', message: msg };
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.accounts)) return { state: 'missing' };
      return { state: 'ok', data };
    } catch (e) {
      return { state: 'error', message: String((e && e.message) || e) };
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => (typeof AppShell !== 'undefined' && AppShell.icon) ? AppShell.icon(n) : '';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmtDate(s, today){
    const t = toDay(s); if (t == null) return '—';
    const d = new Date(t), yr = d.getUTCFullYear();
    return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}${String(yr) !== String(today || '').slice(0, 4) ? ' ' + yr : ''}`;
  }
  const SYMBOL = { EUR: '€', LKR: 'LKR ', MAD: 'MAD ', USD: '$', GBP: '£' };
  // money(-1234.5, 'EUR', 0) → «−€1,235»
  function money(n, currency, decimals){
    const v = num(n), d = decimals == null ? 2 : decimals;
    const body = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (v < 0 && Number(Math.abs(v).toFixed(d)) !== 0 ? '−' : '') + (SYMBOL[currency || 'EUR'] || (currency + ' ')) + body;
  }

  function balanceRow(a, today){
    return `<div class="cp-row cp-bal" data-account="${esc(a.key)}">
      <div class="cp-main"><div class="cp-name">${esc(a.label)}</div><div class="cp-sub">as of ${esc(fmtDate(a.as_of, today))}</div></div>
      <div class="cp-amt cp-big${a.balance < 0 ? ' neg' : ''}">${esc(money(a.balance, a.currency, 2))}</div>
    </div>`;
  }
  function payRow(r, today){
    const month = MONTH[new Date(toDay(today)).getUTCMonth()];
    const sub = [r.accountLabel];
    if (r.late) sub.push(`expected ${fmtDate(r.due, today)}, not in the statement yet`);
    else if (r.left) sub.push(`${month} paid`);
    else if (r.leftAmount > 0) sub.push(`${money(r.leftAmount, 'EUR', 0)} already paid`);
    return `<div class="cp-row" data-key="${esc(r.key)}" data-account="${esc(r.account)}" data-state="${r.late ? 'due' : 'todo'}">
      <div class="cp-when">${r.late ? 'Now' : '≈ ' + esc(fmtDate(r.when, today))}</div>
      <div class="cp-main"><div class="cp-name">${esc(r.label)}${r.late ? '<span class="badge badge-amber">Due</span>' : ''}</div><div class="cp-sub">${sub.map(esc).join(' · ')}</div></div>
      <div class="cp-amt">≈ ${esc(money(r.amount, 'EUR', 0))}</div>
    </div>`;
  }
  function paidRow(r, today){
    return `<div class="cp-row" data-key="${esc(r.key)}" data-account="${esc(r.account)}" data-state="paid">
      <div class="cp-when">${esc(fmtDate(r.leftDate, today))}</div>
      <div class="cp-main"><div class="cp-name">${esc(r.label)}<span class="badge badge-green">Paid</span></div><div class="cp-sub">${esc(r.accountLabel)}</div></div>
      <div class="cp-amt">${esc(money(r.leftAmount, 'EUR', 2))}</div>
    </div>`;
  }
  function lowLine(l, today){
    const n = `≈ ${money(l.lowest, l.currency, 0)}`;
    const tail = l.on ? ` on ${fmtDate(l.on, today)}` : ' · nothing expected to leave';
    const zero = l.belowZeroFrom ? ` · below zero from ${fmtDate(l.belowZeroFrom, today)}` : '';
    return `<div class="cp-low${l.alert ? ' neg' : ''}" data-account="${esc(l.key)}" data-alert="${l.alert ? 1 : 0}">Lowest point: ${esc(l.label)} <b>${esc(n)}</b>${esc(tail)}${esc(zero)}</div>`;
  }

  function render(el, res){
    if (!el) return;
    // SQL not run yet (or not an owner on the server): the tab stays exactly as it was
    if (!res || res.state === 'missing' || res.state === 'denied') { el.innerHTML = ''; el.hidden = true; el.dataset.state = res ? res.state : 'missing'; return; }
    el.hidden = false; el.dataset.state = res.state;
    if (res.state === 'error') {
      el.innerHTML = `<div class="status-msg status-err">Could not load the bank balances: ${esc(res.message)}</div>`;
      return;
    }
    const p = plan(res.data), today = p.today;
    if (!p.accounts.length) {
      el.innerHTML = `<div class="card"><div class="empty-state">${icon('inbox')}<div class="empty-title">No bank balance yet</div><p>Import a Santander or CGD statement and the balance shows here.</p></div></div>`;
      return;
    }
    const list = p.toLeave.map(r => payRow(r, today)).join('') + p.paid.map(r => paidRow(r, today)).join('');
    el.innerHTML = `
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Bank balances</div><div class="card-hint">Water Movements · closing balance of the last statement loaded</div></div></div>
        <div class="cp-list">${p.accounts.map(a => balanceRow(a, today)).join('')}</div>
        <div class="cp-note">PayPal, the Santander card and the camp banks are not here: their statements carry no balance.</div>
      </div>
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Next 30 days</div><div class="card-hint">Fixed payments still to leave, until ${esc(fmtDate(p.until, today))}</div></div></div>
        ${list ? `<div class="cp-list">${list}</div>` : `<div class="empty-state">${icon('calendar')}<div class="empty-title">No fixed payment found</div><p>Salaries, State, Social Security, leasing and rents show here once they repeat in the statements.</p></div>`}
        ${list ? `<div class="cp-lows">${p.lows.map(l => lowLine(l, today)).join('')}</div>` : ''}
        <div class="cp-note">If nothing comes in. Amounts are the usual of the last 3 months. Not in the list: transfers to the camps, suppliers, salaries paid one by one.</div>
      </div>`;
  }

  return { ACCOUNTS, PAYMENTS, WINDOW_DAYS, BUFFER, plan, load, render, money, fmtDate, median };
}));
