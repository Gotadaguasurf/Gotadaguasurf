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
  const SECTION_LEAD = {
    seasons: 'When each price applies.',
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
  const OCC_SHORT = (n, occs) => n === 1 ? 'Single' : (n === 2 && !(occs || []).some(x => x > 2)) ? 'Shared' : `${n} share`;
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
        return { occ, label: occs.length > 1 ? (o.shortLabels ? OCC_SHORT : OCC_LABEL)(occ, occs) : '', price: v, text: v ? moneyFixed(v, (p && p.currency) || cur, dec) : '' };
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

  // kinds: { weekly, flex } — per-night packs only when «Flexible pack» is ticked in the dialog (off by default, Miguel 17 Nov 2026)
  function accommodationModel(accom, period, today, kinds) {
    const k = kinds || { weekly: true, flex: true };
    if (!accom || !(accom.packs || []).length) return [];
    const packs = (accom.packs || []).filter(p => p.active !== false && (p.price_basis === 'per_person_per_night' ? k.flex : k.weekly)).slice().sort(bySort);
    const out = [];
    for (const pack of packs) {
      const m = accomMatrix({ pack, seasons: accom.seasons, rooms: accom.rooms, prices: accom.prices, today, period, shortLabels: true });
      if (!m.rows.length || !m.cols.length) continue;
      out.push({ label: pack.label, desc: guestText(pack.description), flex: m.flex, basis: m.basis, currency: m.currency,
        seasons: m.cols.map(c => ({ label: c.label, key: c.key, ranges: c.ranges, dates: c.dates, upcoming: c.ranges.filter(r => r.end >= today).map(fmtRange) })),
        rooms: m.rows.map(r => ({ room: r.room, cells: r.cells.map(cs => cs.filter(x => x.price || cs.length > 1).map(x => ({ label: x.label, price: x.text }))) })) });
    }
    return out;
  }

  // «Seasons» section (17 Nov 2026): the season × year table and a 15-month strip, only periods not yet ended
  function seasonsModel(accom, period, today) {
    const seasons = ((accom && accom.seasons) || []).filter(s => s.active !== false).slice().sort(bySort);
    const periods = [];
    seasons.forEach(s => (Array.isArray(s.date_ranges) ? s.date_ranges : []).forEach(r => {
      if (r && r.start && r.end && r.end >= r.start && r.end >= today && inPeriod(r, period, today)) periods.push({ s, start: r.start, end: r.end });
    }));
    if (!periods.length) return null;
    periods.sort((a, b) => a.start.localeCompare(b.start));
    const y0 = +today.slice(0, 4), yMax = Math.max(...periods.map(p => +p.end.slice(0, 4)));
    const colOf = (p) => Math.max(y0, +p.start.slice(0, 4));
    const years = []; for (let y = y0; y <= yMax; y++) if (periods.some(p => colOf(p) === y)) years.push(y);
    const inYear = (p, y) => { const sy = +p.start.slice(0, 4), ey = +p.end.slice(0, 4);
      const d = (iso, yr) => { const [Y, M, D] = iso.split('-').map(Number); return `${D} ${MONTHS[M - 1]}${yr ? ' ' + Y : ''}`; };
      return sy === y && ey === y ? `${d(p.start)} – ${d(p.end)}` : `${d(p.start, sy !== y)} – ${d(p.end, true)}`; };
    const rows = seasons.filter(s => periods.some(p => p.s === s)).map(s => ({ label: titleCase(s.label), key: seasonKey(s),
      cells: years.map(y => periods.filter(p => p.s === s && colOf(p) === y).map(p => inYear(p, y))) }));
    // strip: 15 months from this month; holes named «Closed» (between seasons) or «Not set» (after the last date)
    const MONTHS_N = 15;
    const [ty, tm] = today.split('-').map(Number);
    const ws = `${ty}-${String(tm).padStart(2, '0')}-01`;
    const we = new Date(Date.UTC(ty, tm - 1 + MONTHS_N, 1)).toISOString().slice(0, 10);
    const add = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const t0 = Date.parse(ws + 'T00:00:00Z'), len = Date.parse(we + 'T00:00:00Z') - t0;
    const pct = (iso) => (Date.parse(iso + 'T00:00:00Z') - t0) / len * 100;
    const all = [];
    seasons.forEach(s => (Array.isArray(s.date_ranges) ? s.date_ranges : []).forEach(r => { if (r && r.start && r.end && r.end >= r.start) all.push({ s, start: r.start, end: r.end }); }));
    all.sort((a, b) => a.start.localeCompare(b.start));
    const lastKnown = all.reduce((m, p) => p.end > m ? p.end : m, '');
    const bands = []; let cur = ws;
    all.filter(p => p.end >= ws && p.start < we).forEach(p => {
      const a = p.start < ws ? ws : p.start;
      if (a > cur) bands.push({ key: cur > lastKnown ? 'unset' : 'closed', label: cur > lastKnown ? 'Not set' : 'Closed', start: cur, end: add(a, -1) });
      const b = p.end >= we ? add(we, -1) : p.end;
      bands.push({ key: seasonKey(p.s), label: titleCase(p.s.label).replace(/\s*season$/i, ''), start: a, end: b });
      if (add(b, 1) > cur) cur = add(b, 1);
    });
    if (cur < we) bands.push({ key: cur > lastKnown ? 'unset' : 'closed', label: cur > lastKnown ? 'Not set' : 'Closed', start: cur, end: add(we, -1) });
    const strip = bands.map(b => ({ ...b, left: pct(b.start), width: pct(add(b.end, 1)) - pct(b.start) })).filter(b => b.width > 0);
    const months = []; for (let i = 0; i < MONTHS_N; i++) { const d = new Date(Date.UTC(ty, tm - 1 + i, 1)); months.push({ m: MONTHS[d.getUTCMonth()], y: (i === 0 || d.getUTCMonth() === 0) ? d.getUTCFullYear() : null }); }
    return { years, rows, strip, months, today: pct(today) };
  }

  // «Season dates» (17 Nov 2026, after the owner dropped the Seasons page): one line per period in date order, above the
  // accommodation, so an agency finds the season of a date at a glance; a hole between two periods is «Closed».
  function seasonCalendar(accom, period, today) {
    const seasons = ((accom && accom.seasons) || []).filter(s => s.active !== false);
    const list = [];
    seasons.forEach(s => (Array.isArray(s.date_ranges) ? s.date_ranges : []).forEach(r => {
      if (r && r.start && r.end && r.end >= r.start && r.end >= today && inPeriod(r, period, today)) list.push({ s, start: r.start, end: r.end });
    }));
    list.sort((a, b) => a.start.localeCompare(b.start));
    const add = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const out = [];
    list.forEach((p, i) => {
      const prev = list[i - 1];
      if (prev && add(prev.end, 1) < p.start) out.push({ key: 'closed', label: 'Closed', text: fmtRange({ start: add(prev.end, 1), end: add(p.start, -1) }) });
      out.push({ key: seasonKey(p.s), label: titleCase(p.s.label).replace(/\s*season$/i, ''), text: fmtRange(p) });
    });
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
      .map(({ r, route, vehicle }, _, all) => {
        // surfboards go in anything bigger than the route's smallest vehicle (the app's rule: boards → at least the Minivan)
        const caps = all.filter(x => x.route === route).map(x => Number(x.r.capacity) || 0);
        const boards = caps.length > 1 && (Number(r.capacity) || 0) > Math.min(...caps);
        return { route, vehicle, covers: Number(r.covers_pax) > 0 ? Number(r.covers_pax) : null, boards, price: money(r.sell_price, r.sell_currency || r.currency || 'EUR') };
      });
  }

  function campModel(camp, period, sections, today) {
    const parts = [];
    let accommodation = [];
    let seasons = null, calendar = [];
    if (sections.includes('accommodation') || sections.includes('flexible')) { accommodation = accommodationModel(camp.accom, period, today, { weekly: sections.includes('accommodation'), flex: sections.includes('flexible') }); if (accommodation.length) { seasons = seasonsModel(camp.accom, period, today); calendar = seasonCalendar(camp.accom, period, today); } }
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
    const tRows = parts.filter(p => p.kind === 'transfers').flatMap(p => p.rows);
    if (tRows.some(r => r.boards) && tRows.some(r => !r.boards)) notes.push('Travelling with a surfboard? Book a vehicle marked «with surfboards» — the car has no room for boards.');
    const nonEur = [...currencies].filter(c => c !== 'EUR');
    if (nonEur.length) notes.push(`Prices are in euro unless marked ${nonEur.join(' / ')}.`);
    // «from €…» = the lowest weekly per-person price printed (as the website's package cards say it)
    const weekly = (camp.accom && camp.accom.prices || []).filter(pr => { const pk = (camp.accom.packs || []).find(x => x.id === pr.pack_id); return pk && pk.price_basis !== 'per_person_per_night' && Number(pr.sell_price) > 0; });
    const printed = new Set(accommodation.filter(a => !a.flex).flatMap(a => a.rooms.flatMap(r => r.cells.flat().map(x => x.price))));
    const fromVals = weekly.map(pr => Number(pr.sell_price)).filter(v => printed.has(moneyFixed(v, 'EUR', 0)) || printed.has(moneyFixed(v, 'EUR', 2)));
    const from = fromVals.length ? moneyFixed(Math.min(...fromVals), 'EUR', Number.isInteger(Math.min(...fromVals)) ? 0 : 2) : '';
    return { slug: camp.slug, label: camp.label || CAMP_LABEL[camp.slug] || camp.slug, place: CAMP_PLACE[camp.slug] || '', from, seasons, calendar, accommodation, parts, ranges, notes,
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
    return `<div class="pl-pack">
      <div class="pl-pack-head"><h3>${esc(p.label)}</h3><span class="pl-basis">${esc(p.basis)}</span></div>
      ${p.desc ? `<p class="pl-pack-desc">${esc(p.desc)}</p>` : ''}
      ${legendHtml(p)}
      <table class="pl-table pl-matrix pl-cols-${n}">
        <colgroup><col class="pl-col-room">${p.seasons.map(() => '<col class="pl-col-season">').join('')}</colgroup>
        <thead><tr><th class="pl-room-h">Room</th>${p.seasons.map(s => { const up = s.upcoming || s.dates || [];
          return `<th class="pl-season-h"><span class="pl-pill ${s.key}">${esc(s.label.replace(/\s*season$/i, ''))}</span><span class="pl-dates">${up.map(esc).join('<br>')}</span></th>`; }).join('')}</tr></thead>
        <tbody>${p.rooms.map(r => `<tr><td class="pl-room">${esc(r.room)}</td>${r.cells.map(cs => `<td class="pl-cell">${cs.length ? cs.map(x => `<div class="pl-line">${x.label ? `<span class="pl-occ-in">${esc(x.label)}</span>` : ''}<span class="pl-amt${x.price ? '' : ' na'}">${x.price ? esc(x.price) : '—'}</span></div>`).join('') : '<div class="pl-line"><span class="pl-amt na">—</span></div>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  }
  // what «Single / Shared / 3 share» mean, next to the prices (the notes come a page later)
  function legendHtml(p) {
    const used = new Set(p.rooms.flatMap(r => r.cells.flat().map(x => x.label)).filter(Boolean));
    if (!used.size) return '';
    const bits = [];
    if (used.has('Single')) bits.push('<b>Single</b> = alone in the room');
    const byN = {};
    [...used].forEach(l => { const n = l === 'Shared' ? 2 : (/^(\d+) share$/.exec(l) || [])[1]; if (n) (byN[n] = byN[n] || []).push(l); });
    Object.keys(byN).map(Number).sort((x, y) => x - y).forEach(n => bits.push(`<b>${byN[n].sort().reverse().map(esc).join(' / ')}</b> = per guest, ${n} in the room`));
    return bits.length ? `<p class="pl-legend">All prices per person · ${bits.join(' · ')}.</p>` : '';
  }
  function calendarHtml(cal) {
    if (!cal || !cal.length) return '';
    return `<div class="pl-cal"><div class="pl-cal-h">Season dates</div><ul>${cal.map(c => `<li class="${c.key === 'closed' ? 'closed' : ''}"><span class="pl-pill ${esc(c.key)}">${esc(c.label)}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></div>`;
  }
  function seasonsHtml(sm) {
    if (!sm) return '';
    return `<section class="pl-part pl-seasons whole" data-part="seasons">${sectionHead('seasons', 'Seasons')}
      <div class="pl-season-card">
        <div class="pl-strip">${sm.strip.map(b => `<div class="pl-band ${b.key}" style="left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%">${b.width > 6 ? esc(b.label) : ''}</div>`).join('')}<div class="pl-today" style="left:${sm.today.toFixed(3)}%"><span>Today</span></div></div>
        <div class="pl-months" style="grid-template-columns:repeat(${sm.months.length},1fr)">${sm.months.map(m => `<span>${m.m}${m.y ? `<b>${m.y}</b>` : ''}</span>`).join('')}</div>
        <table class="pl-table pl-season-table"><thead><tr><th></th>${sm.years.map(y => `<th>${y}</th>`).join('')}</tr></thead>
          <tbody>${sm.rows.map(r => `<tr><th><span class="pl-pill ${r.key}">${esc(r.label)}</span></th>${r.cells.map(c => `<td>${c.length ? c.map(t => `<div>${esc(t)}</div>`).join('') : '<span class="na">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div></section>`;
  }
  function partHtml(part) {
    if (part.kind === 'transfers') {
      // one heading row per route, its vehicles under it: «Agadir Airport» → Car · up to 3 · €30
      const routes = [];
      part.rows.forEach(r => { let g = routes.find(x => x.route === r.route); if (!g) routes.push(g = { route: r.route, rows: [] }); g.rows.push(r); });
      const body = routes.map(g => (g.rows.length === 1 && !g.rows[0].vehicle)
        ? `<tr><td><b>${esc(g.route)}</b></td><td>${g.rows[0].covers ? `up to ${g.rows[0].covers} persons` : '—'}</td><td class="r pl-price">${esc(g.rows[0].price)}</td></tr>`
        : `<tr class="pl-route-row"><td colspan="3">${esc(g.route)}</td></tr>` + g.rows.map(r =>
          `<tr class="pl-veh"><td>${esc(r.vehicle || r.route)}${r.boards ? ' <span class="pl-boards">with surfboards</span>' : ''}</td><td>${r.covers ? `up to ${r.covers} persons` : '—'}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')).join('');
      return `<section class="pl-part${part.rows.length <= 12 ? ' whole' : ''}" data-part="transfers">${sectionHead(part.key, part.title)}
        <table class="pl-table pl-transfers"><colgroup><col><col class="pl-col-mid"><col class="pl-col-num"></colgroup>
          <thead><tr><th>Route and vehicle</th><th>One transfer covers</th><th class="r">Per transfer</th></tr></thead>
          <tbody>${body}</tbody>
        </table></section>`;
    }
    return `<section class="pl-part${part.rows.length <= 12 ? ' whole' : ''}" data-part="${esc(part.key)}">${sectionHead(part.key, part.title)}
      <div class="pl-items${part.photo ? ' with-photo' : ''}${part.rows.length <= 12 ? ' whole' : ''}">
        <table class="pl-table pl-list"><colgroup><col><col class="pl-col-num"></colgroup>
          <tbody>${part.rows.map(r => `<tr><td><span class="pl-name">${esc(r.name)}</span>${r.note ? `<span class="pl-sub">${esc(r.note)}</span>` : ''}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')}</tbody>
        </table>
        ${part.photo ? `<div class="pl-photo" style="background-image:url('/assets/pricelist/${esc(part.photo)}.jpg')"></div>` : ''}
      </div></section>`;
  }
  // «Good to know» sits under the accommodation (never alone on a page)
  function notesHtml(camp) {
    return camp.notes.length ? `<div class="pl-notes"><h3>Good to know</h3><ul>${camp.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
  }
  function sectionHead(key, title) {
    return `<header class="pl-sec-head"><h2>${esc(title)}</h2>${SECTION_LEAD[key] ? `<p class="pl-lead">${esc(SECTION_LEAD[key])}</p>` : ''}</header>`;
  }

  function render(model, opts) {
    const logo = (opts && opts.logo) || '';
    const logoNavy = logo.replace(/#fff4d5/gi, '#27384a');
    const c = model.contact;
    // the price list goes to agencies and partners (guests book on the website): no «Book now», a reservations line instead
    const partnerLine = `Reservations &amp; partnerships: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a> · ${esc(c.phone)}`;
    const one = model.camps.length === 1 ? model.camps[0] : null;
    const coverPhotos = (one ? [one.slug] : model.camps.map(x => x.slug).filter(sl => CAMP_PHOTO[sl]).slice(0, 3))
      .map(sl => `<div class="pl-cover-photo" style="background-image:url('/assets/pricelist/${(CAMP_PHOTO[sl] || CAMP_PHOTO.portugal)[0]}.jpg')"></div>`).join('');
    const cover = `<section class="pl-cover">
      <div class="pl-cover-photos n${one ? 1 : Math.min(3, model.camps.length) || 1}">${coverPhotos}</div>
      <div class="pl-cover-shade"></div>
      <div class="pl-cover-top"><div class="pl-cover-logo">${logo}</div><span class="pl-cover-for">For agencies &amp; partners</span></div>
      <div class="pl-cover-main">
        <div class="pl-kicker">Price list ${esc(model.period)}</div>
        <h1>${esc(model.title)}</h1>
        ${one && one.place ? `<div class="pl-place">${esc(one.place)}</div>` : ''}
        ${model.camps.length > 1 ? `<div class="pl-place">${model.camps.map(x => esc(x.label)).join(' · ')}</div>` : ''}
        <p class="pl-cover-tag">Where waves become stories and people become friends.</p>
      </div>
      <div class="pl-cover-foot"><div class="pl-reserv">${partnerLine}</div><div class="pl-generated">Prices as of ${esc(model.generated)}</div></div>
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
      ${''/* no Seasons section in the PDF (Miguel 17 Nov 2026): every date is under its season in the matrix */}
      ${camp.accommodation.length ? `<section class="pl-part pl-accom" data-part="accommodation"><div class="pl-keep">${sectionHead('accommodation', 'Accommodation')}${calendarHtml(camp.calendar)}${accomHtml(camp.accommodation[0])}</div>${camp.accommodation.slice(1).map(accomHtml).join('')}${notesHtml(camp)}</section>` : ''}
      ${camp.parts.map(partHtml).join('')}
      ${camp.accommodation.length ? '' : notesHtml(camp)}
    </section>`;
    }).join('');
    const end = `<section class="pl-end">
      <div class="pl-end-logo">${logo}</div>
      <div class="pl-reserv">${partnerLine}</div>
      <div class="pl-contact"><span>${esc(c.web)}</span></div>
      <div class="pl-generated">Prices as of ${esc(model.generated)}. Gota Dagua surf camps in Portugal, Morocco and Sri Lanka.</div>
    </section>`;
    return `<div class="pl-running">${logoNavy}<span>gotadaguasurf.com · ${esc(c.email)} · ${esc(c.phone)}</span></div>` + cover + camps + end;
  }

  const api = { buildModel, render, accomMatrix, seasonWhen, moneyFixed, money, inPeriod, fmtRange, CONTACT, CAMP_ORDER, CAMP_LABEL, isInternalNote, guestText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceList = api;
})(typeof window !== 'undefined' ? window : this);
