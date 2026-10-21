/* ════════════════════════════════════════════════════════════════════════════
   BusinessPnl — the P&L of a "business" location (Wild Wednesday, The Suk…)
   rendered from its ledger_entries rows, the same way Max's Wild Excel reads:
   revenue by source, costs by rubric, profit, commissions after the profit,
   by night/day and by month. Shared by /hq/ (Businesses tab) and the
   business pages (/wild/, /suk/), so both show exactly the same numbers.

   Visual: a dark hero with the profit and a bar chart of every night
   (revenue stacked by source, cash costs as a thin bar beside it), then
   KPI tiles, a 100 % bar for the sources, ranked bars for the rubrics,
   month cards and a detail table. Pure inline SVG, no library.

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
  // Five source colours + a neutral for costs. Distinct in hue and lightness
  // so the stacked bars read in both themes.
  const PALETTE = ['#ff7a59', '#ffd166', '#4cc9f0', '#9b8cff', '#2ec4b6', '#f26ca7', '#a8dadc'];
  const COST = 'rgba(255,255,255,.28)';
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
  const dm = (iso) => { const [, m, d] = String(iso).split('-'); return `${Number(d)}/${Number(m)}`; };
  const monthName = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', {month:'short'}) + ' ' + y; };

  // Stacked bars, one per night: revenue by source + a thin bar for cash costs.
  function nightsChart(dayKeys, dayMap, revCols, colorOf){
    if (!dayKeys.length) return '';
    const W = 720, H = 190, padL = 8, padR = 8, padT = 14, padB = 26;
    const max = Math.max(1, ...dayKeys.map(k => dayMap[k].total));
    const slot = (W - padL - padR) / dayKeys.length;
    const bw = Math.min(34, slot * 0.58), cw = Math.max(3, bw * 0.22);
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    let out = '';
    dayKeys.forEach((k, i) => {
      const n = dayMap[k]; const x = padL + i * slot + (slot - bw - cw - 3) / 2;
      let acc = 0;
      revCols.forEach(c => {
        const v = n.rev[c] || 0; if (!v) return;
        const y1 = y(acc + v), y0 = y(acc);
        out += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${colorOf(c)}" rx="1.5"><title>${esc(dm(k))} · ${esc(short(c))}: ${eur(v)}</title></rect>`;
        acc += v;
      });
      if (n.cash) out += `<rect x="${(x + bw + 3).toFixed(1)}" y="${y(n.cash).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(0.5, y(0) - y(n.cash)).toFixed(1)}" fill="${COST}" rx="1.5"><title>${esc(dm(k))} · cash costs: ${eur(n.cash)}</title></rect>`;
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${y(n.total) - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.75)">${eur0(n.total)}</text>`;
      out += `<text x="${(x + (bw + cw + 3) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="rgba(255,255,255,.6)">${esc(dm(k))}</text>`;
    });
    return `<svg class="bz-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:190px;display:block">${out}</svg>`;
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
      container.innerHTML = `<div class="bz-empty">${esc(opts.emptyText || `No rows yet${year ? ' for ' + year : ''}.`)}</div>`;
      return null;
    }
    const s = summarize(rows, {snapWednesday: snap});
    const pct = (v) => s.revenue ? Math.round(100 * v / s.revenue) + ' %' : '—';
    const ordered = (order, map) => order.filter(c => map[c] != null).concat(Object.keys(map).filter(c => !order.includes(c)).sort((a, b) => map[b] - map[a]));
    const revCols = ordered(revOrder, s.revCat);
    const expCols = ordered(expOrder, s.expCat).filter(c => !isCommission(c));
    const colorOf = (c) => PALETTE[Math.max(0, revCols.indexOf(c)) % PALETTE.length];
    const perDay = s.days.length ? s.revenue / s.days.length : 0;

    // Per night/day
    const dayMap = {};
    const day = (k) => dayMap[k] || (dayMap[k] = { rev:{}, qty:{}, cash:0, total:0 });
    s.rev.forEach(r => { const n = day(dayOf(r.entry_date, r.source_kind, snap)); n.rev[r.category] = (n.rev[r.category] || 0) + Number(r.amount_eur || 0); n.qty[r.category] = (n.qty[r.category] || 0) + Number(r.qty || 0); n.total += Number(r.amount_eur || 0); });
    s.exp.filter(r => r.source_kind === 'manual' && !isCommission(r.category)).forEach(r => { day(dayOf(r.entry_date, r.source_kind, snap)).cash += Number(r.amount_eur || 0); });
    const dayKeys = Object.keys(dayMap).sort();
    const best = dayKeys.reduce((b, k) => (!b || dayMap[k].total > dayMap[b].total) ? k : b, null);

    // Per month
    const months = [...new Set(rows.map(r => String(r.entry_date).slice(0, 7)))].sort();
    const mSum = (m, type, pred = () => true) => rows.filter(r => r.type === type && String(r.entry_date).startsWith(m) && pred(r)).reduce((a, r) => a + Number(r.amount_eur || 0), 0);
    const maxExp = Math.max(1, ...expCols.map(c => s.expCat[c]));

    container.innerHTML = `
      <section class="bz-hero">
        <div class="bz-hero-top">
          <div>
            <div class="bz-eyebrow">${esc(title)} · ${esc(year)}</div>
            <div class="bz-hero-val ${s.profit >= 0 ? 'pos' : 'neg'}"><span class="hero-val">${eur(s.profit)}</span></div>
            <div class="bz-hero-sub">profit before commissions · ${s.days.length} ${dayLabel.toLowerCase()}${s.days.length === 1 ? '' : 's'} · ${eur0(perDay)} per ${dayLabel.toLowerCase()}${best ? ` · best ${esc(dm(best))} ${eur0(dayMap[best].total)}` : ''}</div>
          </div>
          <div class="bz-legend">
            ${revCols.map(c => `<span><i style="background:${colorOf(c)}"></i>${esc(short(c))}</span>`).join('')}
            <span><i style="background:${COST}"></i>cash costs</span>
          </div>
        </div>
        ${nightsChart(dayKeys, dayMap, revCols, colorOf)}
      </section>

      <div class="bz-kpis">
        <div class="summary-box pos bz-kpi"><div class="summary-lbl">Revenue</div><div class="summary-val">${eur(s.revenue)}</div><div class="bz-kpi-sub">tickets + door + online</div></div>
        <div class="summary-box neg bz-kpi"><div class="summary-lbl">Costs</div><div class="summary-val">${eur(s.costs)}</div><div class="bz-kpi-sub">${pct(s.costs)} of revenue</div></div>
        <div class="summary-box neutral bz-kpi"><div class="summary-lbl">Commissions</div><div class="summary-val">${eur(s.commissions)}</div><div class="bz-kpi-sub">after the profit</div></div>
        <div class="summary-box ${s.after >= 0 ? 'pos' : 'neg'} bz-kpi"><div class="summary-lbl">Gota keeps</div><div class="summary-val">${eur(s.after)}</div><div class="bz-kpi-sub">${pct(s.after)} of revenue</div></div>
      </div>

      <div class="bz-grid">
        <section class="bz-card">
          <h3>Revenue by source</h3>
          <div class="bz-stack">${revCols.map(c => `<i style="width:${s.revenue ? (100 * s.revCat[c] / s.revenue) : 0}%;background:${colorOf(c)}" title="${esc(short(c))} ${pct(s.revCat[c])}"></i>`).join('')}</div>
          <table class="bz-rev-cats bz-list"><tbody>
            ${revCols.map(c => `<tr><td><i class="bz-dot" style="background:${colorOf(c)}"></i>${esc(short(c))}</td><td class="num">${eur(s.revCat[c])}</td><td class="pct">${pct(s.revCat[c])}</td></tr>`).join('')}
            <tr class="total"><td>Revenue</td><td class="num">${eur(s.revenue)}</td><td></td></tr>
          </tbody></table>
        </section>
        <section class="bz-card">
          <h3>Costs by rubric</h3>
          <table class="bz-exp-cats bz-list bz-bars"><tbody>
            ${expCols.map(c => `<tr><td>${esc(short(c))}<div class="bz-bar"><i style="width:${(100 * s.expCat[c] / maxExp).toFixed(1)}%"></i></div></td><td class="num">${eur(s.expCat[c])}</td><td class="pct">${pct(s.expCat[c])}</td></tr>`).join('')}
            <tr class="total"><td>Costs</td><td class="num">${eur(s.costs)}</td><td class="pct">${pct(s.costs)}</td></tr>
            <tr class="total profit"><td>Profit</td><td class="num ${s.profit >= 0 ? 'pos' : 'neg'}">${eur(s.profit)}</td><td class="pct">${pct(s.profit)}</td></tr>
            <tr><td>Commissions</td><td class="num">${eur(s.commissions)}</td><td></td></tr>
            <tr class="total"><td>Gota keeps</td><td class="num ${s.after >= 0 ? 'pos' : 'neg'}">${eur(s.after)}</td><td class="pct">${pct(s.after)}</td></tr>
          </tbody></table>
        </section>
      </div>

      <section class="bz-card">
        <h3>By month</h3>
        <div class="bz-months">
          ${months.map(m => { const r = mSum(m, 'revenue'), c = mSum(m, 'expense', x => !isCommission(x.category)), k = mSum(m, 'expense', x => isCommission(x.category)), v = r - c - k; return `
            <div class="bz-month">
              <div class="bz-month-name">${esc(monthName(m))}</div>
              <div class="bz-month-res ${v >= 0 ? 'pos' : 'neg'}">${eur0(v)}</div>
              <div class="bz-month-line"><span>revenue</span><b>${eur0(r)}</b></div>
              <div class="bz-month-line"><span>costs</span><b>${eur0(c)}</b></div>
              ${k ? `<div class="bz-month-line"><span>commissions</span><b>${eur0(k)}</b></div>` : ''}
            </div>`; }).join('')}
        </div>
      </section>

      <section class="bz-card">
        <h3>By ${dayLabel.toLowerCase()}</h3>
        <div class="bz-scroll"><table class="bz-days bz-table"><thead><tr><th>${esc(dayLabel)}</th>${revCols.map(c => `<th class="num">${esc(short(c))}</th>`).join('')}<th class="num">Revenue</th><th class="num">Cash costs</th></tr></thead><tbody>
          ${dayKeys.map(k => { const n = dayMap[k]; return `<tr${k === best ? ' class="best"' : ''}><td><b>${k}</b></td>${revCols.map(c => `<td class="num">${n.rev[c] ? eur(n.rev[c]) : '<span class="dim">—</span>'}${n.qty[c] ? `<div class="bz-qty">${n.qty[c]} tickets</div>` : ''}</td>`).join('')}<td class="num total">${eur(n.total)}</td><td class="num">${n.cash ? eur(n.cash) : '<span class="dim">—</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="bz-foot">${esc(opts.footnote || 'Cash costs are the rows paid from the cash box. Bank-paid costs carry the payment date, so they only show by month and by rubric.')}</div>
      </section>`;
    return s;
  }

  // Styles for the pieces above. Themed through CSS variables the host page
  // sets: --bz-accent (hero number), --bz-hero-bg, --bz-card-bg, --bz-ink,
  // --bz-muted, --bz-border, --bz-pos, --bz-neg.
  const CSS = `
  .bz-empty{padding:22px;color:var(--bz-muted,#6b8099);font-size:13px}
  .bz-hero{background:var(--bz-hero-bg,linear-gradient(135deg,#1b2735 0%,#0f1a24 100%));color:#fff;padding:22px 22px 10px;border-radius:14px 14px 0 0;position:relative;overflow:hidden}
  .bz-hero::after{content:'';position:absolute;top:-30%;right:-10%;width:360px;height:360px;background:radial-gradient(circle,var(--bz-glow,rgba(255,122,89,.28)) 0%,transparent 70%);pointer-events:none}
  .bz-hero-top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;position:relative;z-index:1;margin-bottom:10px}
  .bz-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:rgba(255,255,255,.55);font-weight:700;margin-bottom:6px}
  .bz-hero-val{font-family:'DM Serif Display',Georgia,serif;font-size:50px;line-height:1;letter-spacing:-.02em}
  .bz-hero-val.pos{color:var(--bz-accent,#ff9a7a)}.bz-hero-val.neg{color:#ff8f8f}
  .bz-hero-sub{font-size:12px;color:rgba(255,255,255,.62);margin-top:8px}
  .bz-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:rgba(255,255,255,.75)}
  .bz-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  .bz-chart{position:relative;z-index:1}
  .bz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:14px 16px 0}
  .bz-kpi{border-radius:12px}
  .bz-kpi .summary-val{font-size:22px}
  .bz-kpi-sub{font-size:11px;color:var(--bz-muted,#6b8099);margin-top:4px}
  .bz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;padding:14px 16px 0}
  .bz-card{background:var(--bz-card-bg,#fff);border:1px solid var(--bz-border,#e3ebf3);border-radius:12px;padding:14px 16px;margin:14px 16px 0}
  .bz-grid .bz-card{margin:0}
  .bz-card h3{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--bz-muted,#6b8099);font-weight:800}
  .bz-stack{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#eef2f6;margin-bottom:10px}
  .bz-stack i{display:block;height:100%}
  .bz-list{width:100%;border-collapse:collapse;font-size:13px}
  .bz-list td{padding:7px 4px;border-bottom:1px solid var(--bz-border,#eef2f6);color:var(--bz-ink,#0d1b2a)}
  .bz-list tr:last-child td{border-bottom:none}
  .bz-list td.num{text-align:right;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
  .bz-list td.pct{text-align:right;color:var(--bz-muted,#6b8099);width:52px;font-size:12px}
  .bz-list tr.total td{font-weight:800;border-top:2px solid var(--bz-ink,#0d1b2a)}
  .bz-list tr.profit td{border-top:none}
  .bz-list .pos{color:var(--bz-pos,#118a5b)}.bz-list .neg{color:var(--bz-neg,#c94e42)}
  .bz-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:8px;vertical-align:-1px}
  .bz-bar{height:5px;background:#eef2f6;border-radius:3px;margin-top:5px;overflow:hidden}
  .bz-bar i{display:block;height:100%;background:var(--bz-accent,#ff7a59);border-radius:3px}
  .bz-months{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
  .bz-month{background:#f6f9fc;border-radius:10px;padding:10px 12px}
  .bz-month-name{font-size:11px;font-weight:800;color:var(--bz-muted,#6b8099);text-transform:uppercase;letter-spacing:.06em}
  .bz-month-res{font-size:20px;font-weight:800;margin:4px 0 6px;font-variant-numeric:tabular-nums}
  .bz-month-res.pos{color:var(--bz-pos,#118a5b)}.bz-month-res.neg{color:var(--bz-neg,#c94e42)}
  .bz-month-line{display:flex;justify-content:space-between;font-size:11px;color:var(--bz-muted,#6b8099)}
  .bz-month-line b{color:var(--bz-ink,#0d1b2a);font-weight:600}
  .bz-scroll{overflow-x:auto}
  .bz-table{border-collapse:collapse;font-size:12.5px;min-width:620px;width:100%}
  .bz-table th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--bz-muted,#6b8099);padding:6px 8px;border-bottom:2px solid var(--bz-border,#e3ebf3)}
  .bz-table th.num,.bz-table td.num{text-align:right;font-variant-numeric:tabular-nums}
  .bz-table td{padding:7px 8px;border-bottom:1px solid #eef2f6;vertical-align:top}
  .bz-table td.total{font-weight:800;color:var(--bz-pos,#118a5b)}
  .bz-table tr.best td{background:#fff7f3}
  .bz-table .dim{color:#c3cdd8}
  .bz-qty{font-size:10px;color:var(--bz-muted,#6b8099)}
  .bz-foot{font-size:11px;color:var(--bz-muted,#6b8099);margin-top:8px}
  @media (max-width:640px){.bz-hero{padding:18px 14px 6px;border-radius:0}.bz-hero-val{font-size:40px}.bz-card{margin:12px 10px 0;padding:12px}.bz-grid,.bz-kpis{padding:12px 10px 0}}
  `;
  if (typeof document !== 'undefined' && !document.getElementById('bz-css')) {
    const st = document.createElement('style'); st.id = 'bz-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  window.BusinessPnl = { dayOf, summarize, render, eur, isCommission, PALETTE };
})();
