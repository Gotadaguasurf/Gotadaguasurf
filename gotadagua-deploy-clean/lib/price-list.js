/* ════════════════════════════════════════════════════════════════════════════
   PriceList — the guest / partner price list (17 Nov 2026, Miguel: «um botão que gera um PDF bonito da lista de
   preços para enviar»). Pure functions, no network: /prices/pricelist.html loads the rows and prints the HTML;
   the tests call the same functions in Node.

   PriceList.buildModel({ camps, period, sections, today })
     camps:    [{ slug, label, catalog:[pricing_catalog rows], accom:{ packs, seasons, rooms, prices } }]
     period:   'upcoming' (season dates ending today or later) | 'all' | 'YYYY' (dates touching that year)
     sections: ['accommodation','surf','tours','transfers','addons','bar']
   PriceList.render(model, { logo })  → HTML of the whole document (cover + one part per camp)

   Rules: every price comes from the tables (sell_price, accommodation_prices.sell_price) in its own currency
   (sell_currency, else currency); rows inactive or at 0 are left out; «audience» is not printed (Surf School rows are all
   «group», which would read «per group» on a board rental); costs are never read; internal notes
   («Imported from …») and transport notes (drivers) are not printed; a transfer's «up to N persons» is covers_pax.
   ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  const CONTACT = { phone: '+351 924 689 580', email: 'info@gotadaguasurf.com', web: 'www.gotadaguasurf.com' };
  const CAMP_ORDER = ['portugal', 'morocco', 'sri-lanka', 'junior-camp', 'surf-school'];
  const CAMP_LABEL = { portugal: 'Portugal', morocco: 'Morocco', 'sri-lanka': 'Sri Lanka', 'junior-camp': 'Junior Camp', 'surf-school': 'Surf School' };
  const SECTION_DEFS = [
    { key: 'surf', title: 'Surf packs & lessons', cats: ['Surf Pack', 'Lesson'] },
    { key: 'tours', title: 'Tours & activities', cats: ['Tour'] },
    { key: 'transfers', title: 'Transfers', cats: ['Transport', 'Transfer'] },
    { key: 'addons', title: 'Add-ons & extras', cats: ['Other Service', 'Extras'] },
    { key: 'bar', title: 'Bar & merch', cats: ['Drinks', 'Merch'] },
  ];
  const SECTION_TITLE = { accommodation: 'Accommodation', surf: 'Surf packs & lessons', tours: 'Tours & activities', transfers: 'Transfers', addons: 'Add-ons & extras', bar: 'Bar & merch' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function money(n, cur) {
    const v = Number(n || 0);
    const s = Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (cur || 'EUR') === 'EUR' ? '€' + s : `${cur} ${s}`;
  }
  const isInternalNote = (s) => /^\s*imported from\b/i.test(String(s || ''));
  const bySort = (a, b) => ((Number(a.sort_order) || 100) - (Number(b.sort_order) || 100)) || String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtRange(r) {
    const [ys, ms, ds] = r.start.split('-').map(Number), [ye, me, de] = r.end.split('-').map(Number);
    return ys === ye ? `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}` : `${ds} ${MONTHS[ms - 1]} ${ys} – ${de} ${MONTHS[me - 1]} ${ye}`;
  }
  function inPeriod(r, period, today) {
    if (!r || !r.start || !r.end) return false;
    if (period === 'all') return true;
    if (/^\d{4}$/.test(String(period))) return r.start <= `${period}-12-31` && r.end >= `${period}-01-01`;
    return r.end >= today;   // 'upcoming'
  }
  const seasonKey = (s) => ['low', 'mid', 'high', 'special'].includes(s && s.season_key) ? s.season_key : 'other';
  const titleCase = (t) => String(t || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const occLabel = (n) => n === 1 ? 'Single use' : n === 2 ? 'Sharing' : `${n} sharing`;

  function accommodationModel(accom, period, today) {
    if (!accom || !(accom.packs || []).length) return [];
    const packs = (accom.packs || []).filter(p => p.active !== false).slice().sort(bySort);
    const seasons = (accom.seasons || []).filter(s => s.active !== false).slice().sort(bySort);
    const rooms = (accom.rooms || []).filter(r => r.active !== false).slice().sort(bySort);
    const prices = (accom.prices || []).filter(p => Number(p.sell_price) > 0);
    const out = [];
    for (const pack of packs) {
      const mine = prices.filter(p => p.pack_id === pack.id);
      if (!mine.length) continue;
      const occs = [...new Set(mine.map(p => Number(p.occupancy)))].filter(n => n >= 1 && n <= 6).sort((a, b) => a - b);
      const cur = pack.currency || mine[0].currency || 'EUR';
      const blocks = [];
      for (const s of seasons) {
        const all = Array.isArray(s.date_ranges) ? s.date_ranges.filter(r => r && r.start && r.end) : [];
        const ranges = all.filter(r => inPeriod(r, period, today)).sort((a, b) => a.start.localeCompare(b.start));
        if (all.length && !ranges.length) continue;   // no dates of this season in the chosen period
        const rows = rooms.map(r => {
          const cells = occs.map(o => { const p = mine.find(x => x.season_id === s.id && x.room_type_id === r.id && Number(x.occupancy) === o); return p ? money(p.sell_price, p.currency || cur) : null; });
          return { room: r.label, desc: r.description || '', cells };
        }).filter(row => row.cells.some(Boolean));
        if (!rows.length) continue;
        blocks.push({ label: titleCase(s.label), key: seasonKey(s), ranges, dates: ranges.map(fmtRange), rows });
      }
      if (!blocks.length) continue;
      const flex = pack.price_basis === 'per_person_per_night';
      out.push({ label: pack.label, desc: pack.description || '', flex, basis: flex ? 'Per person, per night' : (pack.price_basis === 'per_person_per_week' ? 'Per person, 7 nights' : 'Per person'),
        currency: cur, occs: occs.map(occLabel), seasons: blocks });
    }
    return out;
  }

  function itemRows(catalog, cats) {
    return (catalog || []).filter(r => cats.includes(r.category) && r.active !== false && Number(r.sell_price) > 0)
      .slice().sort(bySort)
      .map(r => ({ name: r.name, note: (r.notes && !isInternalNote(r.notes)) ? r.notes : '', price: money(r.sell_price, r.sell_currency || r.currency || 'EUR'),
        group: r.audience === 'group' }));
  }

  function transferRows(catalog) {
    const rows = (catalog || []).filter(r => ['Transport', 'Transfer'].includes(r.category) && r.active !== false && Number(r.sell_price) > 0);
    const split = (name) => { const i = String(name || '').lastIndexOf(' — '); return i > 0 ? [name.slice(0, i).trim(), name.slice(i + 3).trim()] : [String(name || '').trim(), '']; };
    return rows.map(r => { const [route, vehicle] = split(r.name); return { r, route, vehicle }; })
      .sort((a, b) => ((/airport/i.test(a.route) ? 0 : 1) - (/airport/i.test(b.route) ? 0 : 1)) || a.route.localeCompare(b.route) ||
        ((Number(a.r.capacity) || 0) - (Number(b.r.capacity) || 0)) || bySort(a.r, b.r))
      .map(({ r, route, vehicle }) => ({ route, vehicle, covers: Number(r.covers_pax) > 0 ? Number(r.covers_pax) : null, price: money(r.sell_price, r.sell_currency || r.currency || 'EUR') }));
  }

  function campModel(camp, period, sections, today) {
    const parts = [];
    let accommodation = [];
    if (sections.includes('accommodation')) accommodation = accommodationModel(camp.accom, period, today);
    for (const def of SECTION_DEFS) {
      if (!sections.includes(def.key)) continue;
      if (def.key === 'transfers') { const rows = transferRows(camp.catalog); if (rows.length) parts.push({ key: def.key, title: def.title, kind: 'transfers', rows }); continue; }
      const rows = itemRows(camp.catalog, def.cats);
      if (rows.length) parts.push({ key: def.key, title: def.title, kind: 'items', rows });
    }
    const ranges = accommodation.flatMap(p => p.seasons.flatMap(s => s.ranges));
    const currencies = new Set();
    accommodation.forEach(p => currencies.add(p.currency));
    parts.forEach(p => p.rows.forEach(r => { const m = /^([A-Z]{3}) /.exec(r.price); currencies.add(m ? m[1] : 'EUR'); }));
    const covers = [...new Set(parts.filter(p => p.kind === 'transfers').flatMap(p => p.rows.map(r => r.covers)).filter(Boolean))];
    const notes = [];
    if (accommodation.length) notes.push('Accommodation prices are per person. The column is how many people share the room — a solo traveller in a double room pays the single-use rate.');
    if (accommodation.some(p => p.flex)) notes.push('Flexible pack prices are per person, per night.');
    if (covers.length === 1) notes.push(`Transfer prices are per transfer; one transfer covers up to ${covers[0]} persons.`);
    else if (covers.length > 1) notes.push('Transfer prices are per transfer; «up to» is how many persons one transfer covers.');
    const nonEur = [...currencies].filter(c => c !== 'EUR');
    if (nonEur.length) notes.push(`Prices are in euro unless marked ${nonEur.join(' / ')}.`);
    return { slug: camp.slug, label: camp.label || CAMP_LABEL[camp.slug] || camp.slug, accommodation, parts, ranges, notes,
      empty: !accommodation.length && !parts.length };
  }

  function periodLabel(ranges, period, today) {
    if (ranges.length) {
      const y0 = Math.min(...ranges.map(r => +r.start.slice(0, 4))), y1 = Math.max(...ranges.map(r => +r.end.slice(0, 4)));
      return y0 === y1 ? String(y0) : `${y0} – ${y1}`;
    }
    if (/^\d{4}$/.test(String(period))) return String(period);
    return String(today || '').slice(0, 4);
  }

  function buildModel(o) {
    const today = o.today || new Date().toISOString().slice(0, 10);
    const period = o.period || 'upcoming';
    const sections = (o.sections && o.sections.length) ? o.sections : ['accommodation', 'surf', 'tours', 'transfers', 'addons'];
    const camps = (o.camps || []).slice().sort((a, b) => CAMP_ORDER.indexOf(a.slug) - CAMP_ORDER.indexOf(b.slug))
      .map(c => campModel(c, period, sections, today)).filter(c => !c.empty);
    const ranges = camps.flatMap(c => c.ranges);
    const title = camps.length === 1 ? camps[0].label : 'All camps';
    const pl = periodLabel(ranges, period, today);
    const [y, m, d] = today.split('-').map(Number);
    return { camps, title, period: pl, generated: `${d} ${MONTHS[m - 1]} ${y}`, contact: CONTACT,
      fileTitle: `Gota Dagua price list - ${title} ${pl.replace(/\s+/g, '')}`,
      sections: sections.filter(k => camps.some(c => (k === 'accommodation' ? c.accommodation.length : c.parts.some(p => p.key === k)))).map(k => SECTION_TITLE[k]) };
  }

  // ── HTML ──────────────────────────────────────────────────────────────────
  function accomHtml(p) {
    const cols = p.occs.length;
    return `<div class="pl-pack">
      <div class="pl-pack-head"><h3>${esc(p.label)}</h3><span class="pl-basis">${esc(p.basis)}</span></div>
      ${p.desc ? `<p class="pl-pack-desc">${esc(p.desc)}</p>` : ''}
      ${p.seasons.map(s => `<table class="pl-table pl-season">
        <colgroup><col class="pl-col-name">${p.occs.map(() => '<col class="pl-col-num">').join('')}</colgroup>
        <thead>
          <tr class="pl-season-row"><th colspan="${cols + 1}"><span class="pl-pill ${s.key}">${esc(s.label)}</span>${s.dates.length ? `<span class="pl-dates">${esc(s.dates.join('  ·  '))}</span>` : ''}</th></tr>
          <tr><th>Room type</th>${p.occs.map(o => `<th class="r">${esc(o)}</th>`).join('')}</tr>
        </thead>
        <tbody>${s.rows.map(r => `<tr><td>${esc(r.room)}</td>${r.cells.map(c => `<td class="r${c ? '' : ' na'}">${c ? esc(c) : '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`).join('')}
    </div>`;
  }
  function partHtml(part) {
    if (part.kind === 'transfers') {
      // one heading row per route, its vehicles under it: «Agadir Airport» → Car · up to 3 · €30
      const routes = [];
      part.rows.forEach(r => { let g = routes.find(x => x.route === r.route); if (!g) routes.push(g = { route: r.route, rows: [] }); g.rows.push(r); });
      const body = routes.map(g => (g.rows.length === 1 && !g.rows[0].vehicle)
        ? `<tr><td><b>${esc(g.route)}</b></td><td>${g.rows[0].covers ? `up to ${g.rows[0].covers} persons` : '—'}</td><td class="r pl-price">${esc(g.rows[0].price)}</td></tr>`
        : `<tr class="pl-route-row"><td colspan="3">${esc(g.route)}</td></tr>` + g.rows.map(r =>
          `<tr class="pl-veh"><td>${esc(r.vehicle || r.route)}</td><td>${r.covers ? `up to ${r.covers} persons` : '—'}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')).join('');
      return `<section class="pl-part"><h2>${esc(part.title)}</h2>
        <table class="pl-table pl-transfers"><colgroup><col><col class="pl-col-mid"><col class="pl-col-num"></colgroup>
          <thead><tr><th>Route and vehicle</th><th>One transfer covers</th><th class="r">Per transfer</th></tr></thead>
          <tbody>${body}</tbody>
        </table></section>`;
    }
    return `<section class="pl-part"><h2>${esc(part.title)}</h2>
      <table class="pl-table"><colgroup><col><col class="pl-col-num"></colgroup>
        <tbody>${part.rows.map(r => `<tr><td><b>${esc(r.name)}</b>${r.note ? `<span class="pl-sub">${esc(r.note)}</span>` : ''}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')}</tbody>
      </table></section>`;
  }
  function render(model, opts) {
    const logo = (opts && opts.logo) || '';
    const logoNavy = logo.replace(/#fff4d5/gi, '#28394b');
    const c = model.contact;
    const contactHtml = `<div class="pl-contact"><span>${esc(c.phone)}</span><span>${esc(c.email)}</span><span>${esc(c.web)}</span></div>`;
    const cover = `<section class="pl-cover">
      <div class="pl-cover-logo">${logo}</div>
      <div class="pl-cover-main">
        <div class="pl-eyebrow">Price list</div>
        <h1>${esc(model.title)}</h1>
        <div class="pl-cover-period">${esc(model.period)}</div>
        ${model.camps.length > 1 ? `<div class="pl-cover-camps">${model.camps.map(x => esc(x.label)).join('<span>·</span>')}</div>` : ''}
        ${model.sections.length ? `<ul class="pl-cover-list">${model.sections.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="pl-cover-foot">${contactHtml}<div class="pl-generated">Prices as of ${esc(model.generated)}</div></div>
    </section>`;
    if (!model.camps.length) return cover + `<section class="pl-camp"><p class="pl-empty">Nothing to print: no published prices in the chosen camp, dates and sections.</p></section>`;
    const camps = model.camps.map(camp => `<section class="pl-camp" data-camp="${esc(camp.slug)}">
      <header class="pl-camp-head"><div class="pl-camp-logo">${logoNavy}</div><div><div class="pl-eyebrow dark">Gota Dagua price list</div><h1>${esc(camp.label)}</h1></div></header>
      ${camp.accommodation.length ? `<section class="pl-part pl-accom"><h2>Accommodation</h2>${camp.accommodation.map(accomHtml).join('')}</section>` : ''}
      ${camp.parts.map(partHtml).join('')}
      ${camp.notes.length ? `<section class="pl-part pl-notes"><h2>Good to know</h2><ul>${camp.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    </section>`).join('');
    const end = `<section class="pl-end"><div class="pl-end-title">Questions or ready to book?</div>${contactHtml}<div class="pl-generated">Prices as of ${esc(model.generated)}.</div></section>`;
    return cover + camps + end;
  }

  const api = { buildModel, render, money, inPeriod, fmtRange, CONTACT, CAMP_ORDER, CAMP_LABEL, isInternalNote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceList = api;
})(typeof window !== 'undefined' ? window : this);
