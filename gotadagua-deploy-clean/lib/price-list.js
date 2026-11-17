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
  // the place under each camp name, as on gotadaguasurf.com; photos from the website (assets/pricelist/)
  const CAMP_PLACE = { portugal: 'Costa da Caparica', morocco: 'Tamraght', 'sri-lanka': 'Ahangama', 'junior-camp': 'Junior Camp · Costa da Caparica', 'surf-school': 'Surf School · Costa da Caparica' };
  const CAMP_PHOTO = { portugal: ['loc-portugal', 'pack-portugal', ''], morocco: ['loc-morocco', 'pack-morocco', 'tour-morocco'],
    'sri-lanka': ['loc-srilanka', 'pack-srilanka', 'tour-srilanka'], 'junior-camp': ['loc-junior', 'loc-junior', ''], 'surf-school': ['pack-portugal', 'pack-portugal', ''] };   // the site's tour-portugal.jpg shows the Sri Lanka house: not used
  const BOOK_URL = 'https://bookings.gotadaguasurf.com';
  const SECTION_LEAD = {
    accommodation: 'Prices per person. Pick your room — the season sets the price.',
    surf: 'From your first wave to your best one.',
    tours: 'Days out with the crew.',
    transfers: 'We pick you up at the airport.',
    addons: 'Little extras for your stay.',
    bar: 'At the camp bar and shop.',
  };
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
  // Notes written for the team, never for guests: «Imported from …», Bookinglayer product references, Camp Tab prices.
  const isInternalNote = (s) => /^\s*imported from\b|\bbookinglayer\b|\bcamp tab\b|\bBL\b/i.test(String(s || ''));
  // A pack description is always printed: Bookinglayer references are cut out of it, never the guest facts.
  function guestText(s) {
    let t = String(s || '');
    t = t.replace(/\s*\((?:[^()]|\([^()]*\))*\b(?:Bookinglayer|BL)\b(?:[^()]|\([^()]*\))*\)/g, '');
    t = t.replace(/Bookinglayer\s*«[^»]*»\s*:?\s*/g, '');
    t = t.split(/(?<=\.)\s+/).filter(x => !/\bbookinglayer\b|\bBL\b/i.test(x)).join(' ');
    return t.replace(/\s+([,.;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }
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

  // ── Accommodation matrix (17 Nov 2026, Miguel: «isto ainda não está bonito») ─────────────────────────────
  // ONE grid per pack: rows = room types, columns = seasons, each cell lists the room's sharing prices
  // (only the occupancies that room is sold at; a room sold one way shows the price alone). Shared by /prices
  // (editable, with cell ids) and the price list (read-only). Money is one format per pack: per-night packs (or any
  // price with cents) always 2 decimals, weekly packs whole euros.
  const OCC_LABEL = (n, occs) => n === 1 ? 'Single use' : (n === 2 && !(occs || []).some(x => x > 2)) ? 'Sharing' : `${n} sharing`;
  function packDecimals(pack, prices) {
    if (pack && pack.price_basis === 'per_person_per_night') return 2;
    return (prices || []).some(p => Math.round(Number(p.sell_price) * 100) % 100 !== 0) ? 2 : 0;
  }
  function moneyFixed(n, cur, dec) {
    const s = Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (cur || 'EUR') === 'EUR' ? '€' + s : `${cur} ${s}`;
  }
  // a season's periods: «Now · until …», else «Next · …», else «Last · …» — the full list stays one click away
  function seasonWhen(ranges, today) {
    const r = (ranges || []).slice().sort((a, b) => a.start.localeCompare(b.start));
    const now = r.find(x => x.start <= today && x.end >= today);
    if (now) return { tag: 'Now', text: 'until ' + fmtDay(now.end), range: now };
    const next = r.find(x => x.start > today);
    if (next) return { tag: 'Next', text: fmtRange(next), range: next };
    const last = r[r.length - 1];
    return last ? { tag: 'Last', text: fmtRange(last), range: last } : null;
  }
  function fmtDay(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
  // opts: { pack, seasons, rooms, prices, today, period ('all' | 'upcoming' | 'YYYY' | 'from-this-year'), nights, allOccs, keepEmpty }
  function accomMatrix(o) {
    const pack = o.pack, today = o.today || new Date().toISOString().slice(0, 10);
    const nights = Math.max(1, Number(o.nights) || 1);
    const mine = (o.prices || []).filter(p => p.pack_id === pack.id && Number(p.sell_price) > 0);
    const cur = pack.currency || (mine[0] && mine[0].currency) || 'EUR';
    const dec = packDecimals(pack, mine);
    const packOccs = [...new Set(mine.map(p => Number(p.occupancy)))].filter(n => n >= 1 && n <= 6).sort((a, b) => a - b);
    if (!packOccs.length) packOccs.push(1, 2);
    const yearStart = today.slice(0, 4) + '-01-01';
    const cols = (o.seasons || []).filter(s => s.active !== false).slice().sort(bySort).map(s => {
      const all = (Array.isArray(s.date_ranges) ? s.date_ranges : []).filter(r => r && r.start && r.end && r.end >= r.start);
      const ranges = (o.period === 'from-this-year' ? all.filter(r => r.end >= yearStart) : o.period ? all.filter(r => inPeriod(r, o.period, today)) : all)
        .slice().sort((a, b) => a.start.localeCompare(b.start));
      return { id: s.id, label: titleCase(s.label), key: seasonKey(s), ranges, dates: ranges.map(fmtRange), when: seasonWhen(ranges, today), hadDates: all.length > 0 };
    }).filter(c => o.keepEmpty || !c.hadDates || c.ranges.length);
    const priceAt = (sid, rid, occ) => mine.find(x => x.season_id === sid && x.room_type_id === rid && Number(x.occupancy) === occ) || null;
    const rows = (o.rooms || []).filter(r => r.active !== false).slice().sort(bySort).map(r => {
      const own = [...new Set(mine.filter(p => p.room_type_id === r.id).map(p => Number(p.occupancy)))].sort((a, b) => a - b);
      const occs = o.allOccs ? packOccs : (own.length ? own : (o.keepEmpty ? [packOccs[0]] : []));
      const cells = cols.map(c => occs.map(occ => {
        const p = priceAt(c.id, r.id, occ);
        const v = p ? Number(p.sell_price) * nights : 0;
        return { occ, label: occs.length > 1 ? OCC_LABEL(occ, occs) : '', price: v, text: v ? moneyFixed(v, (p && p.currency) || cur, dec) : '' };
      }));
      return { id: r.id, room: r.label, desc: r.description || '', occs, cells, any: cells.some(cs => cs.some(x => x.price)) };
    }).filter(r => o.keepEmpty || r.any);
    const cleanCols = o.keepEmpty ? cols : cols.filter((c, i) => rows.some(r => r.cells[i].some(x => x.price)));
    if (!o.keepEmpty && cleanCols.length !== cols.length) {
      const keep = cols.map(c => cleanCols.includes(c));
      rows.forEach(r => { r.cells = r.cells.filter((_, i) => keep[i]); });
    }
    const flex = pack.price_basis === 'per_person_per_night';
    return { pack, currency: cur, decimals: dec, flex, nights, cols: cleanCols, rows, occsInPack: packOccs,
      basis: flex ? (nights > 1 ? `Per person, ${nights} nights` : 'Per person, per night') : (pack.price_basis === 'per_person_per_week' ? 'Per person, 7 nights' : 'Per person') };
  }

  function accommodationModel(accom, period, today) {
    if (!accom || !(accom.packs || []).length) return [];
    const packs = (accom.packs || []).filter(p => p.active !== false).slice().sort(bySort);
    const out = [];
    for (const pack of packs) {
      const m = accomMatrix({ pack, seasons: accom.seasons, rooms: accom.rooms, prices: accom.prices, today, period });
      if (!m.rows.length || !m.cols.length) continue;
      out.push({ label: pack.label, desc: guestText(pack.description), flex: m.flex, basis: m.basis, currency: m.currency,
        seasons: m.cols.map(c => ({ label: c.label, key: c.key, ranges: c.ranges, dates: c.dates })),
        rooms: m.rows.map(r => ({ room: r.room, cells: r.cells.map(cs => cs.filter(x => x.price || cs.length > 1).map(x => ({ label: x.label, price: x.text }))) })) });
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
    if (accommodation.length) notes.push('Accommodation prices are per person. Single use = one guest alone in the room; sharing = the price each guest pays when they share it.');
    if (accommodation.some(p => p.flex)) notes.push('Flexible pack prices are per person, per night.');
    if (covers.length === 1) notes.push(`Transfer prices are per transfer; one transfer covers up to ${covers[0]} persons.`);
    else if (covers.length > 1) notes.push('Transfer prices are per transfer; «up to» is how many persons one transfer covers.');
    const nonEur = [...currencies].filter(c => c !== 'EUR');
    if (nonEur.length) notes.push(`Prices are in euro unless marked ${nonEur.join(' / ')}.`);
    // «from €…» = the lowest weekly per-person price printed (as the website's package cards say it)
    const weekly = (camp.accom && camp.accom.prices || []).filter(pr => { const pk = (camp.accom.packs || []).find(x => x.id === pr.pack_id); return pk && pk.price_basis !== 'per_person_per_night' && Number(pr.sell_price) > 0; });
    const printed = new Set(accommodation.filter(a => !a.flex).flatMap(a => a.rooms.flatMap(r => r.cells.flat().map(x => x.price))));
    const fromVals = weekly.map(pr => Number(pr.sell_price)).filter(v => printed.has(moneyFixed(v, 'EUR', 0)) || printed.has(moneyFixed(v, 'EUR', 2)));
    const from = fromVals.length ? moneyFixed(Math.min(...fromVals), 'EUR', Number.isInteger(Math.min(...fromVals)) ? 0 : 2) : '';
    return { slug: camp.slug, label: camp.label || CAMP_LABEL[camp.slug] || camp.slug, place: CAMP_PLACE[camp.slug] || '', from, accommodation, parts, ranges, notes,
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
    const n = p.seasons.length;
    const occCol = p.rooms.some(r => r.cells.some(cs => cs.length > 1));
    return `<div class="pl-pack">
      <div class="pl-pack-head"><h3>${esc(p.label)}</h3><span class="pl-basis">${esc(p.basis)}</span></div>
      ${p.desc ? `<p class="pl-pack-desc">${esc(p.desc)}</p>` : ''}
      <table class="pl-table pl-matrix pl-cols-${n}">
        <colgroup><col class="pl-col-room">${occCol ? '<col class="pl-col-occ">' : ''}${p.seasons.map(() => '<col class="pl-col-season">').join('')}</colgroup>
        <thead><tr><th class="pl-room-h">Room</th>${occCol ? '<th></th>' : ''}${p.seasons.map(s => `<th class="pl-season-h"><span class="pl-pill ${s.key}">${esc(s.label.replace(/\s*season$/i, ''))}</span>${s.dates.length ? `<span class="pl-dates">${s.dates.map(esc).join('<br>')}</span>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${p.rooms.map(r => {
          const labels = (r.cells.find(cs => cs.length) || []).map(x => x.label);
          return `<tr><td class="pl-room">${esc(r.room)}</td>${occCol ? `<td class="pl-occ">${labels.filter(Boolean).map(l => `<div class="pl-line">${esc(l)}</div>`).join('')}</td>` : ''}${r.cells.map(cs => `<td class="pl-cell">${cs.length ? cs.map(x => `<div class="pl-line"><span class="pl-amt${x.price ? '' : ' na'}">${x.price ? esc(x.price) : '—'}</span></div>`).join('') : '<div class="pl-line"><span class="pl-amt na">—</span></div>'}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table>
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
      return `<section class="pl-part" data-part="transfers">${sectionHead(part.key, part.title)}
        <table class="pl-table pl-transfers"><colgroup><col><col class="pl-col-mid"><col class="pl-col-num"></colgroup>
          <thead><tr><th>Route and vehicle</th><th>One transfer covers</th><th class="r">Per transfer</th></tr></thead>
          <tbody>${body}</tbody>
        </table></section>`;
    }
    return `<section class="pl-part" data-part="${esc(part.key)}">${sectionHead(part.key, part.title)}
      <div class="pl-items${part.photo ? ' with-photo' : ''}">
        <table class="pl-table pl-list"><colgroup><col><col class="pl-col-num"></colgroup>
          <tbody>${part.rows.map(r => `<tr><td><span class="pl-name">${esc(r.name)}</span>${r.note ? `<span class="pl-sub">${esc(r.note)}</span>` : ''}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')}</tbody>
        </table>
        ${part.photo ? `<div class="pl-photo" style="background-image:url('/assets/pricelist/${esc(part.photo)}.jpg')"></div>` : ''}
      </div></section>`;
  }
  function sectionHead(key, title) {
    return `<header class="pl-sec-head"><h2>${esc(title)}</h2>${SECTION_LEAD[key] ? `<p class="pl-lead">${esc(SECTION_LEAD[key])}</p>` : ''}</header>`;
  }

  function render(model, opts) {
    const logo = (opts && opts.logo) || '';
    const logoNavy = logo.replace(/#fff4d5/gi, '#27384a');
    const c = model.contact;
    const contact = `<span>${esc(c.phone)}</span><span>${esc(c.email)}</span><span>${esc(c.web)}</span>`;
    const one = model.camps.length === 1 ? model.camps[0] : null;
    const coverPhotos = (one ? [one.slug] : model.camps.map(x => x.slug).filter(sl => CAMP_PHOTO[sl]).slice(0, 3))
      .map(sl => `<div class="pl-cover-photo" style="background-image:url('/assets/pricelist/${(CAMP_PHOTO[sl] || CAMP_PHOTO.portugal)[0]}.jpg')"></div>`).join('');
    const cover = `<section class="pl-cover">
      <div class="pl-cover-photos n${one ? 1 : Math.min(3, model.camps.length) || 1}">${coverPhotos}</div>
      <div class="pl-cover-shade"></div>
      <div class="pl-cover-top"><div class="pl-cover-logo">${logo}</div><a class="pl-book" href="${BOOK_URL}">Book now</a></div>
      <div class="pl-cover-main">
        <div class="pl-kicker">Price list ${esc(model.period)}</div>
        <h1>${esc(model.title)}</h1>
        ${one && one.place ? `<div class="pl-place">${esc(one.place)}</div>` : ''}
        ${model.camps.length > 1 ? `<div class="pl-place">${model.camps.map(x => esc(x.label)).join(' · ')}</div>` : ''}
        <p class="pl-cover-tag">Where waves become stories and people become friends.</p>
      </div>
      <div class="pl-cover-foot"><div class="pl-contact">${contact}</div><div class="pl-generated">Prices as of ${esc(model.generated)}</div></div>
    </section>`;
    if (!model.camps.length) return cover + `<section class="pl-camp"><p class="pl-empty">Nothing to print: no published prices in the chosen camp, dates and sections.</p></section>`;
    const camps = model.camps.map(camp => {
      const ph = CAMP_PHOTO[camp.slug] || CAMP_PHOTO.portugal;
      camp.parts.forEach(pt => { if (pt.key === 'tours' && ph[2] && pt.rows.length >= 3) pt.photo = ph[2]; });
      return `<section class="pl-camp" data-camp="${esc(camp.slug)}">
      <header class="pl-camp-card" style="background-image:url('/assets/pricelist/${ph[1]}.jpg')">
        <div class="pl-camp-card-in">
          <div class="pl-camp-kicker">${camp.slug === 'surf-school' ? 'Surf school' : camp.slug === 'junior-camp' ? 'Junior surf camp' : 'Surf camp'}</div>
          <h2 class="pl-camp-name">${esc(camp.label)}</h2>
          ${camp.place ? `<div class="pl-camp-place">${esc(camp.place.replace(/^(Junior Camp|Surf School) · /, ''))}</div>` : ''}
          ${camp.from ? `<div class="pl-camp-from">from ${esc(camp.from)}</div>` : ''}
        </div>
      </header>
      ${camp.accommodation.length ? `<section class="pl-part pl-accom" data-part="accommodation">${sectionHead('accommodation', 'Accommodation')}${camp.accommodation.map(accomHtml).join('')}</section>` : ''}
      ${camp.parts.map(partHtml).join('')}
      ${camp.notes.length ? `<section class="pl-part pl-notes"><h3>Good to know</h3><ul>${camp.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
    </section>`;
    }).join('');
    const end = `<section class="pl-end">
      <div class="pl-end-logo">${logo}</div>
      <div class="pl-end-title">Ready to catch some waves?</div>
      <p>Book online or write to us.</p>
      <a class="pl-book big" href="${BOOK_URL}">Book now</a>
      <div class="pl-contact">${contact}</div>
      <div class="pl-generated">Prices as of ${esc(model.generated)}. Gota Dagua surf camps in Portugal, Morocco and Sri Lanka.</div>
    </section>`;
    return `<div class="pl-running">${logoNavy}<span>gotadaguasurf.com · ${esc(c.email)} · ${esc(c.phone)}</span></div>` + cover + camps + end;
  }

  const api = { buildModel, render, accomMatrix, seasonWhen, moneyFixed, money, inPeriod, fmtRange, CONTACT, CAMP_ORDER, CAMP_LABEL, isInternalNote, guestText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceList = api;
})(typeof window !== 'undefined' ? window : this);
