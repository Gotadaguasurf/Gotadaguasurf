/* ════════════════════════════════════════════════════════════════════════════
   BusinessPnl — the P&L of a "business" location (Wild Wednesday, The Suk…)
   rendered from its ledger_entries rows, laid out like Max's Wild Excel:
   one table, rubrics down the side, months across, totals first. Shared by
   /hq/ (Businesses tab) and the business pages (/wild/, /suk/), so both show
   exactly the same numbers. Plain tables, no charts (Miguel, 21 Oct 2026:
   «quero coisas simples, não preciso desses gráficos»).

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
    return { revenue, costs, commissions, profit: revenue - costs, after: revenue - costs - commissions, revCat, expCat, days, rev, exp };
  }

  const short = (c) => String(c).replace(/^[^·]+· /, '');
  const monthName = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', {month:'short'}); };

  function render(container, rows, opts = {}){
    if (!container) return null;
    const year = opts.year || '';
    const title = opts.title || 'Business';
    const dayLabel = opts.dayLabel || 'Day';
    const snap = !!opts.snapWednesday;
    const revOrder = opts.revOrder || [];
    const expOrder = opts.expOrder || [];
    if (!rows.length) {
      container.innerHTML = `<div class="bz-empty">${esc(opts.emptyText || `No rows yet${year ? ' for ' + year : ''}.`)}</div>`;
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

    // Rubric × month
    const months = [...new Set(rows.map(r => String(r.entry_date).slice(0, 7)))].sort();
    const cell = (type, pred, m) => rows.filter(r => r.type === type && (!m || String(r.entry_date).startsWith(m)) && pred(r)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);
    const line = (label, type, pred, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num total">${money(cell(type, pred))}</td>${months.map(m => `<td class="num">${money(cell(type, pred, m))}</td>`).join('')}</tr>`;
    const calc = (label, fn, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num total ${fn() >= 0 ? '' : 'neg'}">${eur0(fn())}</td>${months.map(m => { const v = fn(m); return `<td class="num ${v >= 0 ? '' : 'neg'}">${eur0(v)}</td>`; }).join('')}</tr>`;
    const R = (m) => cell('revenue', () => true, m);
    const C = (m) => cell('expense', r => !isCommission(r.category), m);
    const K = (m) => cell('expense', r => isCommission(r.category), m);

    // Per night/day
    const dayMap = {};
    const day = (k) => dayMap[k] || (dayMap[k] = { rev:{}, qty:{}, cash:0, total:0 });
    s.rev.forEach(r => { const n = day(dayOf(r.entry_date, r.source_kind, snap)); n.rev[r.category] = (n.rev[r.category] || 0) + Number(r.amount_eur || 0); n.qty[r.category] = (n.qty[r.category] || 0) + Number(r.qty || 0); n.total += Number(r.amount_eur || 0); });
    s.exp.filter(r => r.source_kind === 'manual' && !isCommission(r.category)).forEach(r => { day(dayOf(r.entry_date, r.source_kind, snap)).cash += Number(r.amount_eur || 0); });
    const dayKeys = Object.keys(dayMap).sort();

    container.innerHTML = `
      <div class="bz-top">
        <div class="bz-profit">
          <div class="bz-lbl">${esc(title)} ${esc(year)} · profit before commissions</div>
          <div class="hero-val bz-big ${s.profit >= 0 ? 'pos' : 'neg'}">${eur(s.profit)}</div>
          <div class="bz-sub">${s.days.length} ${dayLabel.toLowerCase()}${s.days.length === 1 ? '' : 's'} · ${eur0(perDay)} per ${dayLabel.toLowerCase()}</div>
        </div>
        <div class="bz-kpis">
          <div class="summary-box pos"><div class="summary-lbl">Revenue</div><div class="summary-val">${eur(s.revenue)}</div></div>
          <div class="summary-box neg"><div class="summary-lbl">Costs</div><div class="summary-val">${eur(s.costs)}</div><div class="bz-kpi-sub">${pct(s.costs)} of revenue</div></div>
          <div class="summary-box neutral"><div class="summary-lbl">Commissions</div><div class="summary-val">${eur(s.commissions)}</div></div>
          <div class="summary-box ${s.after >= 0 ? 'pos' : 'neg'}"><div class="summary-lbl">Gota keeps</div><div class="summary-val">${eur(s.after)}</div><div class="bz-kpi-sub">after commissions</div></div>
        </div>
      </div>

      <div class="bz-section">
        <h3>Season by rubric and month</h3>
        <div class="bz-scroll"><table class="bz-table bz-matrix">
          <thead><tr><th></th><th class="num">Total</th>${months.map(m => `<th class="num">${esc(monthName(m))}</th>`).join('')}</tr></thead>
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
        </table></div>
      </div>

      <div class="bz-section">
        <h3>By ${dayLabel.toLowerCase()}</h3>
        <div class="bz-scroll"><table class="bz-table bz-days">
          <thead><tr><th>${esc(dayLabel)}</th>${revCols.map(c => `<th class="num">${esc(short(c))}</th>`).join('')}<th class="num">Revenue</th><th class="num">Cash costs</th></tr></thead>
          <tbody>
            ${dayKeys.map(k => { const n = dayMap[k]; return `<tr><td><b>${k}</b></td>${revCols.map(c => `<td class="num">${n.rev[c] ? eur(n.rev[c]) : '<span class="dim">—</span>'}${n.qty[c] ? `<div class="bz-qty">${n.qty[c]} tickets</div>` : ''}</td>`).join('')}<td class="num total">${eur(n.total)}</td><td class="num">${n.cash ? eur(n.cash) : '<span class="dim">—</span>'}</td></tr>`; }).join('')}
          </tbody>
        </table></div>
        <div class="bz-foot">${esc(opts.footnote || 'Cash costs are the rows paid from the cash box. Bank-paid costs carry the payment date, so they show in the season table, by month.')}</div>
      </div>`;
    return s;
  }

  // Plain, app-styled: white, navy text, green/red only for results.
  const CSS = `
  .bz-empty{padding:22px;color:var(--muted,#6b8099);font-size:13px}
  .bz-top{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:18px;align-items:center;padding:18px 22px 6px}
  .bz-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted,#6b8099);font-weight:800}
  .bz-big{font-family:'DM Serif Display',Georgia,serif;font-size:46px;line-height:1.05;letter-spacing:-.02em;margin:6px 0 4px}
  .bz-big.pos{color:var(--green,#118a5b)}.bz-big.neg{color:var(--red,#c94e42)}
  .bz-sub{font-size:13px;color:var(--muted,#6b8099)}
  .bz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
  .bz-kpis .summary-val{font-size:20px}
  .bz-kpi-sub{font-size:11px;color:var(--muted,#6b8099);margin-top:3px}
  .bz-section{padding:12px 22px 6px}
  .bz-section h3{margin:10px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted,#6b8099);font-weight:800}
  .bz-scroll{overflow-x:auto}
  .bz-table{border-collapse:collapse;font-size:14px;width:100%;min-width:560px}
  .bz-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#6b8099);padding:8px 10px;border-bottom:2px solid var(--border,#d8dee6);white-space:nowrap}
  .bz-table th.num,.bz-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .bz-table td{padding:9px 10px;border-bottom:1px solid #eef2f6;vertical-align:top;color:var(--ink,#0d1b2a)}
  .bz-table td.total{font-weight:800}
  .bz-table td.neg{color:var(--red,#c94e42)}
  .bz-table tr.group td{background:#f6f9fc;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--muted,#6b8099);padding:7px 10px}
  .bz-table tr.sum td{font-weight:800;border-top:2px solid var(--navy,#28394b);background:#fff}
  .bz-table tr.result td{color:var(--green,#118a5b)}
  .bz-table tr.result td.neg{color:var(--red,#c94e42)}
  .bz-table .dim{color:#c3cdd8}
  .bz-days td.total{color:var(--green,#118a5b)}
  .bz-qty{font-size:11px;color:var(--muted,#6b8099);font-weight:400}
  .bz-foot{font-size:11px;color:var(--muted,#6b8099);margin:8px 0 12px}
  @media (max-width:720px){.bz-top{grid-template-columns:1fr;padding:14px 14px 4px}.bz-big{font-size:38px}.bz-section{padding:10px 10px 4px}.bz-table{font-size:13px}}
  `;
  if (typeof document !== 'undefined' && !document.getElementById('bz-css')) {
    const st = document.createElement('style'); st.id = 'bz-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  window.BusinessPnl = { dayOf, summarize, render, eur, isCommission };
})();
