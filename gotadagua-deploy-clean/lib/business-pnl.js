/* ════════════════════════════════════════════════════════════════════════════
   BusinessPnl — the P&L of a "business" location (Wild Wednesday, The Suk…)
   rendered from its ledger_entries rows, in the camp-hub Overview grammar:
   section titles, KPI cards, plain tables. Shared by the business pages
   (/wild/, /suk/). No charts (Miguel, 21 Oct 2026).

   Rows: { type:'revenue'|'expense', category, entry_date, amount_eur,
           source_kind, payment_method, qty }
   Categories follow «<Prefix> · <Rubrica>»; a category whose name contains
   "comiss" is a commission and is shown after the profit.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const eur = (n) => '€' + Number(n || 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
  const eur0 = (n) => '€' + Math.round(Number(n || 0)).toLocaleString('en-GB');
  const isCommission = (cat) => /comiss/i.test(String(cat || ''));
  const CAMP_TAB_KINDS = new Set(['camp_tab_per_item', 'camp_tab_per_guest', 'camp_tab']);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const METHODS = ['Cash', 'Card', 'Online', 'Bank Transfer'];

  // Payment method of a row, normalised. HQ invoices come through the bank.
  function methodOf(r){
    if (r.source_kind === 'hq_invoice') return 'Bank Transfer';
    const m = String(r.payment_method || '').toLowerCase();
    if (m === 'online') return 'Online';
    if (m === 'card') return 'Card';
    if (m === 'bank transfer' || m === 'bank-transfer' || m === 'transfer') return 'Bank Transfer';
    return 'Cash';
  }

  // The night/day a row belongs to. Manual rows are dated on the day itself.
  // Camp-tab tickets are marked paid the day(s) after a Wednesday party, so
  // with snapWednesday they go back to the previous Wednesday.
  function dayOf(dateStr, sourceKind, snapWednesday){
    const s = String(dateStr || '').slice(0, 10);
    if (!snapWednesday || !CAMP_TAB_KINDS.has(sourceKind)) return s;
    const d = new Date(s + 'T12:00:00');
    if (isNaN(d)) return s;
    d.setDate(d.getDate() - ((d.getDay() + 4) % 7));   // Wed → 0, Thu → 1 … Tue → 6
    return d.toISOString().slice(0, 10);
  }

  function summarize(rows, opts = {}){
    const snap = !!opts.snapWednesday;
    const sum = (arr) => arr.reduce((s, r) => s + Number(r.amount_eur || 0), 0);
    const rev = rows.filter(r => r.type === 'revenue');
    const exp = rows.filter(r => r.type === 'expense');
    const byCat = (arr) => { const m = {}; arr.forEach(r => { const k = r.category || '—'; m[k] = (m[k] || 0) + Number(r.amount_eur || 0); }); return m; };
    const revCat = byCat(rev), expCat = byCat(exp);
    const commissions = Object.keys(expCat).filter(isCommission).reduce((s, k) => s + expCat[k], 0);
    const revenue = sum(rev);
    const costs = sum(exp) - commissions;
    const days = [...new Set(rev.map(r => dayOf(r.entry_date, r.source_kind, snap)))].sort();
    const byMethod = {};
    rows.forEach(r => { const m = methodOf(r); const b = byMethod[m] || (byMethod[m] = {rev:0, exp:0}); if (r.type === 'revenue') b.rev += Number(r.amount_eur || 0); else b.exp += Number(r.amount_eur || 0); });
    return { revenue, costs, commissions, profit: revenue - costs, after: revenue - costs - commissions, revCat, expCat, days, rev, exp, byMethod };
  }

  const short = (c) => String(c).replace(/^[^·]+· /, '');
  const monthName = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', {month:'short'}); };

  function render(container, rows, opts = {}){
    if (!container) return null;
    const year = opts.year || '';
    const dayLabel = opts.dayLabel || 'Day';
    const snap = !!opts.snapWednesday;
    const revOrder = opts.revOrder || [];
    const expOrder = opts.expOrder || [];
    if (!rows.length) {
      container.innerHTML = `<div class="card card-pad bz-empty">${esc(opts.emptyText || `No rows yet${year ? ' for ' + year : ''}.`)}</div>`;
      return null;
    }
    const s = summarize(rows, {snapWednesday: snap});
    const pct = (v) => s.revenue ? Math.round(100 * v / s.revenue) + ' %' : '—';
    const ordered = (order, map) => order.filter(c => map[c] != null).concat(Object.keys(map).filter(c => !order.includes(c)).sort((a, b) => map[b] - map[a]));
    const revCols = ordered(revOrder, s.revCat);
    const expCols = ordered(expOrder, s.expCat).filter(c => !isCommission(c));
    const commCols = Object.keys(s.expCat).filter(isCommission);
    const perDay = s.days.length ? s.revenue / s.days.length : 0;
    const money = (v) => v ? eur0(v) : '<span class="dim">—</span>';
    const cashRev = (s.byMethod.Cash || {}).rev || 0, onlineRev = ((s.byMethod.Online || {}).rev || 0) + ((s.byMethod.Card || {}).rev || 0) + ((s.byMethod['Bank Transfer'] || {}).rev || 0);
    const cashExp = (s.byMethod.Cash || {}).exp || 0, bankExp = ((s.byMethod['Bank Transfer'] || {}).exp || 0) + ((s.byMethod.Card || {}).exp || 0) + ((s.byMethod.Online || {}).exp || 0);

    // Rubric × month
    const months = [...new Set(rows.map(r => String(r.entry_date).slice(0, 7)))].sort();
    const cell = (type, pred, m) => rows.filter(r => r.type === type && (!m || String(r.entry_date).startsWith(m)) && pred(r)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);
    const methodsOf = (type, pred) => { const t = {}; rows.filter(r => r.type === type && pred(r)).forEach(r => { const m = methodOf(r); t[m] = (t[m] || 0) + Number(r.amount_eur || 0); }); return METHODS.filter(m => t[m]).map(m => `${m.toLowerCase()} ${eur0(t[m])}`).join(' · '); };
    const line = (label, type, pred) => `<tr><td>${label}<div class="bz-how">${esc(methodsOf(type, pred))}</div></td><td class="r total">${money(cell(type, pred))}</td>${months.map(m => `<td class="r">${money(cell(type, pred, m))}</td>`).join('')}</tr>`;
    const calc = (label, fn, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r total ${fn() >= 0 ? '' : 'neg'}">${eur0(fn())}</td>${months.map(m => { const v = fn(m); return `<td class="r ${v >= 0 ? '' : 'neg'}">${eur0(v)}</td>`; }).join('')}</tr>`;
    const R = (m) => cell('revenue', () => true, m);
    const C = (m) => cell('expense', r => !isCommission(r.category), m);
    const K = (m) => cell('expense', r => isCommission(r.category), m);

    // Per night/day
    const dayMap = {};
    const day = (k) => dayMap[k] || (dayMap[k] = { rev:{}, qty:{}, cash:0, total:0, cashIn:0 });
    s.rev.forEach(r => { const n = day(dayOf(r.entry_date, r.source_kind, snap)); n.rev[r.category] = (n.rev[r.category] || 0) + Number(r.amount_eur || 0); n.qty[r.category] = (n.qty[r.category] || 0) + Number(r.qty || 0); n.total += Number(r.amount_eur || 0); if (methodOf(r) === 'Cash') n.cashIn += Number(r.amount_eur || 0); });
    s.exp.filter(r => r.source_kind === 'manual' && !isCommission(r.category)).forEach(r => { day(dayOf(r.entry_date, r.source_kind, snap)).cash += Number(r.amount_eur || 0); });
    const dayKeys = Object.keys(dayMap).sort();

    const kpi = (label, value, sub, cls = '') => `<div class="card kpi summary-box ${cls}"><div class="kpi-label summary-lbl">${label}</div><div class="kpi-value summary-val ${cls}">${value}</div><div class="kpi-sub">${sub}</div></div>`;

    container.innerHTML = `
      <section class="ov-section">
        <div class="ov-section-head">
          <div class="ov-section-title">Performance</div>
          <div class="ov-section-sub">${esc(year)} · ${s.days.length} ${dayLabel.toLowerCase()}${s.days.length === 1 ? '' : 's'} · ${eur0(perDay)} revenue per ${dayLabel.toLowerCase()}</div>
        </div>
        <div class="g4 bz-g4">
          <div class="card kpi bz-profit"><div class="kpi-label">Profit before commissions</div><div class="kpi-value hero-val ${s.profit >= 0 ? 'pos' : 'neg'}">${eur(s.profit)}</div><div class="kpi-sub">${pct(s.profit)} of revenue · commissions ${eur0(s.commissions)} · Gota keeps <b>${eur0(s.after)}</b></div></div>
          ${kpi('Revenue', eur(s.revenue), `cash ${eur0(cashRev)} · online/card ${eur0(onlineRev)}`, 'pos')}
          ${kpi('Costs', eur(s.costs), `cash ${eur0(cashExp)} · bank ${eur0(bankExp)} · ${pct(s.costs)} of revenue`, 'neg')}
          ${kpi('Commissions', eur(s.commissions), 'paid after the profit', 'neutral')}
          ${kpi('Gota keeps', eur(s.after), 'after commissions', s.after >= 0 ? 'pos' : 'neg')}
        </div>
      </section>

      <section class="ov-section">
        <div class="ov-section-head">
          <div class="ov-section-title">Season by rubric</div>
          <div class="ov-section-sub">Totals first, then month by month · under each rubric, how it was paid</div>
        </div>
        <div class="card"><div class="tbl-wrap"><table class="bz-matrix">
          <thead><tr><th></th><th class="r">Total</th>${months.map(m => `<th class="r">${esc(monthName(m))}</th>`).join('')}</tr></thead>
          <tbody class="bz-rev-cats">
            <tr class="group"><td colspan="${months.length + 2}">Revenue</td></tr>
            ${revCols.map(c => line(esc(short(c)), 'revenue', r => r.category === c)).join('')}
            ${calc('Revenue', R, 'sum')}
          </tbody>
          <tbody class="bz-exp-cats">
            <tr class="group"><td colspan="${months.length + 2}">Costs</td></tr>
            ${expCols.map(c => line(esc(short(c)), 'expense', r => r.category === c)).join('')}
            ${calc('Costs', C, 'sum')}
            ${calc('Profit', (m) => R(m) - C(m), 'sum result')}
            ${commCols.map(c => line(esc(short(c)), 'expense', r => r.category === c)).join('')}
            ${calc('Gota keeps', (m) => R(m) - C(m) - K(m), 'sum result')}
          </tbody>
        </table></div></div>
      </section>

      <section class="ov-section">
        <div class="ov-section-head">
          <div class="ov-section-title">${esc(dayLabel)}s</div>
          <div class="ov-section-sub">Revenue by source per ${dayLabel.toLowerCase()} · cash in = what went into the cash box · cash costs = what was paid out of it</div>
        </div>
        <div class="card"><div class="tbl-wrap"><table class="bz-days">
          <thead><tr><th>${esc(dayLabel)}</th>${revCols.map(c => `<th class="r">${esc(short(c))}</th>`).join('')}<th class="r">Revenue</th><th class="r">Cash costs</th><th class="r">Cash in</th></tr></thead>
          <tbody>
            ${dayKeys.map(k => { const n = dayMap[k]; return `<tr><td><b>${k}</b></td>${revCols.map(c => `<td class="r">${n.rev[c] ? eur(n.rev[c]) : '<span class="dim">—</span>'}${n.qty[c] ? `<div class="bz-qty">${n.qty[c]} tickets</div>` : ''}</td>`).join('')}<td class="r total">${eur(n.total)}</td><td class="r">${n.cash ? eur(n.cash) : '<span class="dim">—</span>'}</td><td class="r">${n.cashIn ? eur(n.cashIn) : '<span class="dim">—</span>'}</td></tr>`; }).join('')}
          </tbody>
        </table></div></div>
        <div class="bz-foot">${esc(opts.footnote || 'Bank-paid costs (sound, invoiced DJs, video, ads) carry the payment date, so they only appear in the season table.')}</div>
      </section>`;
    return s;
  }

  // Only what the camp-hub stylesheet does not already give the host page.
  const CSS = `
  .bz-empty{color:var(--muted,#6b8099);font-size:13px}
  .bz-g4{grid-template-columns:2fr 1fr 1fr 1fr 1fr}
  @media (max-width:1100px){.bz-g4{grid-template-columns:1fr 1fr 1fr}}
  @media (max-width:720px){.bz-g4{grid-template-columns:1fr 1fr}}
  .bz-profit .kpi-value{font-size:38px}
  .kpi-value.pos{color:var(--green,#1a7a40)}.kpi-value.neg{color:var(--red,#b91c1c)}
  .bz-matrix td,.bz-days td{font-size:13px}
  .bz-matrix td.r,.bz-days td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:'DM Mono',monospace;font-size:12px}
  .bz-matrix td.total,.bz-days td.total{font-weight:700;color:var(--navy,#28394b)}
  .bz-matrix td.neg{color:var(--red,#b91c1c)}
  .bz-matrix tr.group td{background:#f6f9fc;font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted,#6b8099);padding:7px 13px}
  .bz-matrix tr.sum td{font-weight:800;border-top:2px solid var(--navy,#28394b)}
  .bz-matrix tr.result td{color:var(--green,#1a7a40)}
  .bz-matrix tr.result td.neg{color:var(--red,#b91c1c)}
  .bz-how{font-size:10.5px;color:var(--muted,#6b8099);margin-top:2px;font-family:'Outfit',sans-serif}
  .bz-days td.total{color:var(--green,#1a7a40)}
  .bz-qty{font-size:10px;color:var(--muted,#6b8099);font-family:'Outfit',sans-serif}
  .dim{color:#c3cdd8}
  .bz-foot{font-size:11px;color:var(--muted,#6b8099);margin:8px 4px 0}
  `;
  if (typeof document !== 'undefined' && !document.getElementById('bz-css')) {
    const st = document.createElement('style'); st.id = 'bz-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  window.BusinessPnl = { dayOf, summarize, render, eur, isCommission, methodOf, METHODS };
})();
