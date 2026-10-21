/* ════════════════════════════════════════════════════════════════════════════
   BusinessPnl — the P&L of a "business" location (Wild Wednesday, The Suk…)
   rendered from its ledger_entries rows, the same way Max's Wild Excel reads:
   revenue by source, costs by rubric, profit, commissions after the profit,
   by month and by day/night. Shared by /hq/ (Businesses tab) and the
   business pages (/wild/, /suk/), so both show exactly the same numbers.

   Rows: { type:'revenue'|'expense', category, entry_date, amount_eur,
           source_kind, payment_method, qty }
   Categories follow the «<Prefix> · <Rubrica>» convention; a category whose
   name contains "comiss" is a commission and is shown after the profit.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const eur = (n) => '€' + Number(n || 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
  const isCommission = (cat) => /comiss/i.test(String(cat || ''));
  const CAMP_TAB_KINDS = new Set(['camp_tab_per_item', 'camp_tab_per_guest', 'camp_tab']);

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

  function render(container, rows, opts = {}){
    if (!container) return null;
    const year = opts.year || '';
    const title = opts.title || 'Business';
    const dayLabel = opts.dayLabel || 'Day';
    const snap = !!opts.snapWednesday;
    const revOrder = opts.revOrder || [];
    const expOrder = opts.expOrder || [];
    if (!rows.length) {
      container.innerHTML = `<div class="hint" style="padding:18px 22px;color:var(--muted)">${opts.emptyText || `No rows yet${year ? ' for ' + year : ''}.`}</div>`;
      return null;
    }
    const s = summarize(rows, {snapWednesday: snap});
    const pct = (v) => s.revenue ? (100 * v / s.revenue).toFixed(0) + ' %' : '—';
    const money = (v) => v ? eur(v) : '<span style="color:var(--muted)">—</span>';
    const short = (c) => String(c).replace(/^[^·]+· /, '');
    const ordered = (order, map) => order.filter(c => map[c] != null).concat(Object.keys(map).filter(c => !order.includes(c)).sort((a, b) => map[b] - map[a]));
    const perDay = s.days.length ? s.revenue / s.days.length : 0;

    // ── Per day: revenue by source + cash-paid costs (bank-paid costs carry
    //    the payment date, not the party date, so they only appear by month).
    const dayMap = {};
    const day = (k) => dayMap[k] || (dayMap[k] = { rev:{}, qty:{}, cash:0, total:0 });
    s.rev.forEach(r => { const n = day(dayOf(r.entry_date, r.source_kind, snap)); n.rev[r.category] = (n.rev[r.category] || 0) + Number(r.amount_eur || 0); n.qty[r.category] = (n.qty[r.category] || 0) + Number(r.qty || 0); n.total += Number(r.amount_eur || 0); });
    s.exp.filter(r => r.source_kind === 'manual' && !isCommission(r.category)).forEach(r => { day(dayOf(r.entry_date, r.source_kind, snap)).cash += Number(r.amount_eur || 0); });
    const dayKeys = Object.keys(dayMap).sort();
    const revCols = ordered(revOrder, s.revCat);
    const expCols = ordered(expOrder, s.expCat).filter(c => !isCommission(c));

    // ── Per month
    const months = [...new Set(rows.map(r => String(r.entry_date).slice(0, 7)))].sort();
    const mSum = (m, type, pred = () => true) => rows.filter(r => r.type === type && String(r.entry_date).startsWith(m) && pred(r)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);
    const th = (t, right = true) => `<th style="text-align:${right ? 'right' : 'left'}">${t}</th>`;
    const sect = (t, mt = 22) => `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:${mt}px 0 8px">${t}</div>`;

    container.innerHTML = `
      <div class="hero-profit">
        <div class="hero-lbl">${title} ${year} · profit before commissions</div>
        <div class="hero-val" style="color:${s.profit >= 0 ? '#7ee2a8' : '#ff9b8f'}">${eur(s.profit)}</div>
        <div style="font-size:12px;color:#9fc3dd;margin-top:6px">${eur(s.revenue)} revenue − ${eur(s.costs)} costs · ${s.days.length} ${dayLabel.toLowerCase()}${s.days.length === 1 ? '' : 's'} · ${eur(perDay)} per ${dayLabel.toLowerCase()}</div>
      </div>
      <div class="summary-grid tight" style="margin-top:16px">
        <div class="summary-box pos"><div class="summary-lbl">Revenue</div><div class="summary-val">${eur(s.revenue)}</div></div>
        <div class="summary-box neg"><div class="summary-lbl">Costs</div><div class="summary-val">${eur(s.costs)}</div><div class="hint" style="margin-top:4px">${pct(s.costs)} of revenue</div></div>
        <div class="summary-box neutral"><div class="summary-lbl">Commissions</div><div class="summary-val">${eur(s.commissions)}</div></div>
        <div class="summary-box ${s.after >= 0 ? 'pos' : 'neg'}"><div class="summary-lbl">Gota keeps</div><div class="summary-val">${eur(s.after)}</div><div class="hint" style="margin-top:4px">after commissions</div></div>
      </div>
      <div style="padding:0 22px 22px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px">
          <div>
            ${sect('Revenue by source', 6)}
            <table class="tbl bz-rev-cats" style="width:100%"><tbody>
              ${revCols.map(c => `<tr><td>${short(c)}</td><td style="text-align:right;color:var(--green);font-weight:600">${eur(s.revCat[c])}</td><td style="text-align:right;color:var(--muted);width:56px">${pct(s.revCat[c])}</td></tr>`).join('')}
              <tr style="border-top:2px solid var(--navy)"><td style="font-weight:800">Revenue</td><td style="text-align:right;font-weight:800;color:var(--green)">${eur(s.revenue)}</td><td></td></tr>
            </tbody></table>
          </div>
          <div>
            ${sect('Costs by rubric', 6)}
            <table class="tbl bz-exp-cats" style="width:100%"><tbody>
              ${expCols.map(c => `<tr><td>${short(c)}</td><td style="text-align:right;font-weight:600">${eur(s.expCat[c])}</td><td style="text-align:right;color:var(--muted);width:56px">${pct(s.expCat[c])}</td></tr>`).join('')}
              <tr style="border-top:2px solid var(--navy)"><td style="font-weight:800">Costs</td><td style="text-align:right;font-weight:800">${eur(s.costs)}</td><td style="text-align:right;color:var(--muted)">${pct(s.costs)}</td></tr>
              <tr><td style="font-weight:800">Profit</td><td style="text-align:right;font-weight:800;color:${s.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(s.profit)}</td><td style="text-align:right;color:var(--muted)">${pct(s.profit)}</td></tr>
              <tr><td>Commissions</td><td style="text-align:right;font-weight:600">${eur(s.commissions)}</td><td></td></tr>
              <tr><td style="font-weight:800">Gota keeps</td><td style="text-align:right;font-weight:800;color:${s.after >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(s.after)}</td><td style="text-align:right;color:var(--muted)">${pct(s.after)}</td></tr>
            </tbody></table>
          </div>
        </div>

        ${sect('By month')}
        <div style="overflow-x:auto"><table class="tbl bz-monthly" style="min-width:520px"><thead><tr>${th('', false)}${months.map(m => th(m)).join('')}${th('Total')}</tr></thead><tbody>
          <tr><td style="font-weight:600">Revenue</td>${months.map(m => `<td style="text-align:right;color:var(--green)">${money(mSum(m, 'revenue'))}</td>`).join('')}<td style="text-align:right;font-weight:700;color:var(--green)">${eur(s.revenue)}</td></tr>
          <tr><td style="font-weight:600">Costs</td>${months.map(m => `<td style="text-align:right">${money(mSum(m, 'expense', r => !isCommission(r.category)))}</td>`).join('')}<td style="text-align:right;font-weight:700">${eur(s.costs)}</td></tr>
          <tr><td style="font-weight:600">Commissions</td>${months.map(m => `<td style="text-align:right">${money(mSum(m, 'expense', r => isCommission(r.category)))}</td>`).join('')}<td style="text-align:right;font-weight:700">${eur(s.commissions)}</td></tr>
          <tr style="border-top:2px solid var(--navy)"><td style="font-weight:800">Result</td>${months.map(m => { const v = mSum(m, 'revenue') - mSum(m, 'expense'); return `<td style="text-align:right;font-weight:800;color:${v >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(v)}</td>`; }).join('')}<td style="text-align:right;font-weight:800;color:${s.after >= 0 ? 'var(--green)' : 'var(--red)'}">${eur(s.after)}</td></tr>
        </tbody></table></div>

        ${sect('By ' + dayLabel.toLowerCase())}
        <div style="overflow-x:auto"><table class="tbl bz-days" style="min-width:640px"><thead><tr>${th(dayLabel, false)}${revCols.map(c => th(short(c))).join('')}${th('Revenue')}${th('Cash costs')}</tr></thead><tbody>
          ${dayKeys.map(k => { const n = dayMap[k]; return `<tr><td style="font-weight:600">${k}</td>${revCols.map(c => `<td style="text-align:right">${money(n.rev[c] || 0)}${n.qty[c] ? `<div style="font-size:10px;color:var(--muted)">${n.qty[c]} tickets</div>` : ''}</td>`).join('')}<td style="text-align:right;font-weight:700;color:var(--green)">${eur(n.total)}</td><td style="text-align:right">${money(n.cash)}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="hint" style="margin-top:8px;color:var(--muted);font-size:11px">${opts.footnote || 'Cash costs are the rows paid from the cash box. Bank-paid costs carry the payment date, so they only show by month and by rubric.'}</div>
      </div>`;
    return s;
  }

  window.BusinessPnl = { dayOf, summarize, render, eur, isCommission };
})();
