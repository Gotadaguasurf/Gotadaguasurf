/* ════════════════════════════════════════════════════════════════════════════
   PriceList — the guest / partner price list (17 Nov 2026, Miguel: «um botão que gera um PDF bonito da lista de
   preços para enviar»). Pure functions, no network: /prices/pricelist.html loads the rows and prints the HTML;
   the tests call the same functions in Node.

   PriceList.buildModel({ camps, period, sections, today })
     camps:    [{ slug, label, catalog:[pricing_catalog rows], accom:{ packs, seasons, rooms, prices } }]
     period:   'upcoming' (season dates ending today or later) | 'all' | 'YYYY' (dates touching that year)
     sections: ['accommodation','flexible','surf','tours','transfers','addons','shop','bar']
   PriceList.render(model, { logo })  → HTML of the whole document (cover + one part per camp)
   lang: buildModel({ …, lang: 'en' | 'pt' }) (19 Nov 2026, Miguel: «podíamos escolher as línguas… Português ou inglês»).
   Every fixed text the PDF prints comes from I18N below (a missing PT key falls back to English); room, pack and product
   names come from the tables and are printed as they are (the names guests book under). /prices keeps English.

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
  const CAMP_PHOTO = { portugal: ['loc-portugal', 'pack-portugal', 'tour-portugal'], morocco: ['loc-morocco', 'pack-morocco', 'tour-morocco'],
    'sri-lanka': ['loc-srilanka', 'pack-srilanka', 'tour-srilanka'], 'junior-camp': ['loc-junior', 'loc-junior', ''], 'surf-school': ['pack-portugal', 'pack-portugal', ''] };   // photos hand-picked from the team Drive (18 Nov 2026)
  const SECTION_LEAD = {
    seasons: 'When each price applies.',
    accommodation: 'Prices per person. Pick your room — the season sets the price.',
    surf: 'From your first wave to your best one.',
    tours: 'Days out with the crew.',
    transfers: 'We pick you up at the airport.',
    addons: 'Add to your booking.',
    shop: 'Sold at the camp.',
    bar: 'At the camp bar and shop.',
  };
  // 19 Nov 2026 (Miguel: «no add-ons o yoga é uma activity; os extras é só o que se vende no camp e não são add-ons»):
  // add-ons = bought with the booking; «Camp shop» = sold / charged only at the camp, its own section, off by default
  const SECTION_DEFS = [
    { key: 'surf', cats: ['Surf Pack', 'Lesson'] },
    { key: 'tours', cats: ['Tour'] },
    { key: 'transfers', cats: ['Transport', 'Transfer'] },
    { key: 'addons', cats: ['Other Service'] },
    { key: 'shop', cats: ['Extras'] },
    { key: 'bar', cats: ['Drinks', 'Merch'] },
  ];
  const AT_CAMP_ONLY = /lost key|extra dinner/i;   // charged at the camp, never booked ahead
  function sectionOfRow(r) {
    const name = String((r && r.name) || '');
    if (['Transport', 'Transfer'].includes(r.category)) return 'transfers';
    if (/yoga/i.test(name)) return 'tours';                                   // yoga is an activity, whatever its category
    if (AT_CAMP_ONLY.test(name) && ['Other Service', 'Extras'].includes(r.category)) return 'shop';
    const d = SECTION_DEFS.find(x => x.cats.includes(r.category));
    return d ? d.key : null;
  }
  const SECTION_TITLE = { accommodation: 'Accommodation', surf: 'Surf packs & lessons', tours: 'Tours & activities', transfers: 'Transfers', addons: 'Add-ons', shop: 'Camp shop', bar: 'Bar & merch' };

  // ── Languages (19 Nov 2026) ── one dictionary; T(key, …args) reads the current language, else English
  const I18N = {
    en: {
      lead_seasons: SECTION_LEAD.seasons, lead_accommodation: SECTION_LEAD.accommodation, lead_surf: SECTION_LEAD.surf, lead_tours: SECTION_LEAD.tours,
      lead_transfers: SECTION_LEAD.transfers, lead_addons: SECTION_LEAD.addons, lead_shop: SECTION_LEAD.shop, lead_bar: SECTION_LEAD.bar,
      sec_accommodation: SECTION_TITLE.accommodation, sec_surf: SECTION_TITLE.surf, sec_tours: SECTION_TITLE.tours, sec_transfers: SECTION_TITLE.transfers,
      sec_addons: SECTION_TITLE.addons, sec_shop: SECTION_TITLE.shop, sec_bar: SECTION_TITLE.bar, sec_seasons: 'Seasons',
      occ_single: 'Single use', occ_sharing: 'Sharing', occ_n_sharing: (n) => `${n} sharing`,
      occs_single: 'Single', occs_shared: 'Shared', occs_n: (n) => `${n} share`,
      basis_night: 'Per person, per night', basis_nights: (n) => `Per person, ${n} nights`, basis_week: 'Per person, 7 nights', basis_pp: 'Per person',
      season_dates: 'Season dates', closed: 'Closed', not_set: 'Not set', today: 'Today', room: 'Room',
      legend_all: 'All prices per person', legend_single: '<b>Single</b> = alone in the room', legend_n: (labels, n) => `<b>${labels}</b> = per guest, ${n} in the room`,
      up_to: (n) => `up to ${n} persons`, boards: 'with surfboards', th_route: 'Route and vehicle', th_covers: 'One transfer covers', th_per: 'Per transfer',
      good_to_know: 'Good to know',
      note_accom: 'Accommodation prices are per person. Single use = one guest alone in the room; sharing = the price each guest pays when they share it.',
      note_flex: 'Flexible pack prices are per person, per night.',
      note_cover1: (n) => `Transfer prices are per transfer; one transfer covers up to ${n} persons.`,
      note_covers: 'Transfer prices are per transfer; «up to» is how many persons one transfer covers.',
      note_boards: 'Travelling with a surfboard? Book a vehicle marked «with surfboards» — the car has no room for boards.',
      note_currency: (list) => `Prices are in euro unless marked ${list}.`,
      all_camps: 'All camps', for_partners: 'For agencies &amp; partners', price_list: 'Price list', from: 'from',
      tagline: 'Where waves become stories and people become friends.', reservations: 'Reservations &amp; partnerships:',
      as_of: (d) => `Prices as of ${d}`, end_line: (d) => `Prices as of ${d}. Gota Dagua surf camps in Portugal, Morocco and Sri Lanka.`,
      empty: 'Nothing to print: no published prices in the chosen camp, dates and sections.',
      kicker_camp: 'Surf camp', kicker_school: 'Surf school', kicker_junior: 'Junior surf camp', file: 'Gota Dagua price list',
      school_title: 'Surf school price list', sch_group: 'Group lessons', sch_private: 'Private lessons', sch_rentals: 'Rentals',
      sch_students: 'Erasmus / students', sch_residents: 'Residents', sch_lessons: 'Surf lessons', sch_extras: 'Extras', sch_other: 'More',
      sch_contacts: 'Contacts', sch_book: 'Book online', sch_n: (n) => n === 1 ? '1 lesson' : `${n} lessons`,
      sch_n_summer: (n) => `${n === 1 ? '1 lesson' : n + ' lessons'} · 1 Jul – 31 Aug`, sch_friend: (n) => `Friend of a student · ${n === 1 ? '1 lesson' : n + ' lessons'}`,
      gear_bw: 'Board & wetsuit', gear_b: 'Board', gear_w: 'Wetsuit', gear_any: 'Board & wetsuit',
      dur_1h: '1 hour', dur_2h: '2 hours', dur_3h: '3 hours', dur_all: 'All day', dur_2d: '2 days', dur_3d: '3 days', dur_1w: '1 week',
      sn_max: (n) => `Max ${n} people per instructor`, sn_dur: (d) => `${d} per lesson`, sn_extra: (p, n) => n ? `Extra person ${p} per lesson (max ${n} people)` : `Extra person ${p} per lesson`,
      sn_deposit: (p) => `${p} deposit to take the gear away`, sn_esn: 'ESN / Erasmus document required', sn_proof: 'Student or Erasmus proof required',
      sn_summer: (p) => `+${p} from 1 Jul to 31 Aug`, sn_resident: 'Portuguese residency document required',
    },
    pt: {
      lead_seasons: 'Quando se aplica cada preço.', lead_accommodation: 'Preços por pessoa. O preço depende do quarto e da época.',
      lead_surf: 'Da primeira onda à melhor de todas.', lead_tours: 'Dias fora com a equipa.', lead_transfers: 'Recolha e entrega no aeroporto.',
      lead_addons: 'Para juntar à reserva.', lead_shop: 'À venda no camp.', lead_bar: 'No bar e na loja do camp.',
      sec_accommodation: 'Alojamento', sec_surf: 'Packs e aulas de surf', sec_tours: 'Tours e atividades', sec_transfers: 'Transfers',
      sec_addons: 'Extras na reserva', sec_shop: 'Loja do camp', sec_bar: 'Bar e merchandising', sec_seasons: 'Épocas',
      occ_single: 'Uso individual', occ_sharing: 'Partilhado', occ_n_sharing: (n) => `${n} a partilhar`,
      occs_single: 'Individual', occs_shared: 'Partilhado', occs_n: (n) => `${n} pessoas`,
      basis_night: 'Por pessoa, por noite', basis_nights: (n) => `Por pessoa, ${n} noites`, basis_week: 'Por pessoa, 7 noites', basis_pp: 'Por pessoa',
      season_low: 'Época baixa', season_mid: 'Época média', season_high: 'Época alta', season_special: 'Época especial',
      season_dates: 'Datas das épocas', closed: 'Fechado', not_set: 'Por definir', today: 'Hoje', room: 'Quarto',
      legend_all: 'Todos os preços por pessoa', legend_single: '<b>Individual</b> = uma pessoa no quarto', legend_n: (labels, n) => `<b>${labels}</b> = por hóspede, ${n} no quarto`,
      up_to: (n) => `até ${n} pessoas`, boards: 'com pranchas', th_route: 'Percurso e veículo', th_covers: 'Um transfer leva', th_per: 'Por transfer',
      good_to_know: 'Informações úteis',
      note_accom: 'Os preços de alojamento são por pessoa. Uso individual = um hóspede sozinho no quarto; partilhado = o preço que cada hóspede paga quando partilha o quarto.',
      note_flex: 'Os preços do Flexible pack são por pessoa, por noite.',
      note_cover1: (n) => `Os preços de transfer são por transfer; um transfer leva até ${n} pessoas.`,
      note_covers: 'Os preços de transfer são por transfer; «até» é o número de pessoas que um transfer leva.',
      note_boards: 'Com prancha de surf? É preciso um veículo marcado «com pranchas»: o carro não tem espaço para pranchas.',
      note_currency: (list) => `Preços em euros, exceto quando indicado ${list}.`,
      all_camps: 'Todos os camps', for_partners: 'Para agências e parceiros', price_list: 'Tabela de preços', from: 'desde',
      tagline: 'Onde as ondas se tornam histórias e as pessoas se tornam amigas.', reservations: 'Reservas e parcerias:',
      as_of: (d) => `Preços em vigor a ${d}`, end_line: (d) => `Preços em vigor a ${d}. Surf camps Gota Dagua em Portugal, Marrocos e Sri Lanka.`,
      empty: 'Nada para imprimir: não há preços publicados no camp, datas e secções escolhidos.',
      kicker_camp: 'Surf camp', kicker_school: 'Escola de surf', kicker_junior: 'Surf camp júnior', file: 'Gota Dagua tabela de preços',
      camp_morocco: 'Marrocos',
      school_title: 'Tabela de preços – Escola de surf', sch_group: 'Aulas de grupo', sch_private: 'Aulas privadas', sch_rentals: 'Aluguer de material',
      sch_students: 'Erasmus / estudantes', sch_residents: 'Residentes', sch_lessons: 'Aulas de surf', sch_extras: 'Extras', sch_other: 'Outros',
      sch_contacts: 'Contactos', sch_book: 'Reservar online', sch_n: (n) => n === 1 ? '1 aula' : `${n} aulas`,
      sch_n_summer: (n) => `${n === 1 ? '1 aula' : n + ' aulas'} · 1 jul – 31 ago`, sch_friend: (n) => `Amigo de um estudante · ${n === 1 ? '1 aula' : n + ' aulas'}`,
      gear_bw: 'Prancha e fato', gear_b: 'Prancha', gear_w: 'Fato', gear_any: 'Prancha e fato',
      dur_1h: '1 hora', dur_2h: '2 horas', dur_3h: '3 horas', dur_all: 'Dia inteiro', dur_2d: '2 dias', dur_3d: '3 dias', dur_1w: '1 semana',
      sn_max: (n) => `Máx. ${n} pessoas por instrutor`, sn_dur: (d) => `${d} por aula`, sn_extra: (p, n) => n ? `Pessoa extra ${p} por aula (máx. ${n} pessoas)` : `Pessoa extra ${p} por aula`,
      sn_deposit: (p) => `Caução de ${p} para levar o material`, sn_esn: 'Documento ESN / Erasmus obrigatório', sn_proof: 'Comprovativo de estudante ou Erasmus obrigatório',
      sn_summer: (p) => `+${p} de 1 jul a 31 ago`, sn_resident: 'Documento de residência em Portugal obrigatório',
    },
  };
  // Catalog notes written in Portuguese (the Portugal rows): the English PDF prints the English line; any other note that is
  // clearly Portuguese is left out of the English PDF. The Portuguese PDF prints the notes as written.
  const CATALOG_NOTES = {
    'Por semana.': 'Per week.',
    'Banho de gelo.': 'Ice bath.',
    '1 aula de yoga.': '1 yoga class.',
    'Pack de 5 aulas de yoga.': 'Pack of 5 yoga classes.',
    'Aula de surf skate.': 'Surf skate lesson.',
    'Visita a Paradise Beach.': 'Day trip to Paradise Beach.',
    'Festa na praia.': 'Beach party.',
    '7 aulas. Só com Weekly Pack.': '7 lessons. Weekly Pack only.',
    '5 aulas de 1h30 + teoria + vídeo. Só com Weekly Pack.': '5 lessons of 1h30 + theory + video. Weekly Pack only.',
    '1 aula individual de surf · 1h30.': '1 private surf lesson · 1h30.',
    '1h30, prancha + fato incluídos. Marcada na véspera com o head coach. Para clientes em Flexible Pack.': '1h30, board and wetsuit included. Booked the day before with the head coach. For Flexible Pack guests.',
  };
  const looksPortuguese = (t) => /[ãõçáéíóúâêôà]|\b(aulas?|só|com|para|por|semana|noites?|prancha|fato|véspera|visita|festa|praia|banho|gelo|incluíd[oa]s?)\b/i.test(t);
  function catalogNote(raw) {
    const t = String(raw || '').trim();
    if (!t || isInternalNote(t)) return '';
    if (LANG !== 'en') return t;
    if (CATALOG_NOTES[t]) return CATALOG_NOTES[t];
    return looksPortuguese(t) ? '' : t;
  }
  let LANG = 'en';
  const LANGS = Object.keys(I18N);
  function T(key, ...a) {
    const d = I18N[LANG] && I18N[LANG][key] !== undefined ? I18N[LANG][key] : I18N.en[key];
    return typeof d === 'function' ? d(...a) : d;
  }
  function withLang(lang, fn) { const prev = LANG; LANG = LANGS.includes(lang) ? lang : 'en'; try { return fn(); } finally { LANG = prev; } }
  const numLocale = () => LANG === 'pt' ? 'pt-PT' : 'en-GB';
  // EUR: «€529» in English, «529 €» in Portuguese (no break before the sign); other currencies keep their code in front
  const withCur = (s, cur) => (cur || 'EUR') === 'EUR' ? (LANG === 'pt' ? s + '\u00a0€' : '€' + s) : `${cur} ${s}`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function money(n, cur) {
    const v = Number(n || 0);
    const s = Number.isInteger(v) ? v.toLocaleString(numLocale()) : v.toLocaleString(numLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return withCur(s, cur);
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
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let MONTHS_PT = null;   // «jan», «fev»… from Intl pt-PT (the dot of the abbreviation dropped)
  function monthsNow() {
    if (LANG !== 'pt') return MONTHS_EN;
    if (!MONTHS_PT) { try { const f = new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' });
      MONTHS_PT = MONTHS_EN.map((_, i) => f.format(new Date(Date.UTC(2026, i, 1))).replace(/\.$/, '')); } catch (_) { MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; } }
    return MONTHS_PT;
  }
  function fmtRange(r) {
    const [ys, ms, ds] = r.start.split('-').map(Number), [ye, me, de] = r.end.split('-').map(Number);
    const MONTHS = monthsNow();
    return ys === ye ? `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}` : `${ds} ${MONTHS[ms - 1]} ${ys} – ${de} ${MONTHS[me - 1]} ${ye}`;
  }
  // period: 'upcoming' | 'all' | 'YYYY' | 'years:2027,2028' (19 Nov 2026, Miguel: «escolher as seasons que queremos: 2026 e 2027,
  // ou só 2027 e 2028») — a range is kept when it touches a chosen year and has not ended yet (inside the current year = upcoming)
  const yearsOf = (period) => { const m = /^years:([\d,\s]+)$/.exec(String(period || '')); return m ? [...new Set(m[1].split(',').map(x => Number(x.trim())).filter(Boolean))].sort((a, b) => a - b) : null; };
  function inPeriod(r, period, today) {
    if (!r || !r.start || !r.end) return false;
    if (period === 'all') return true;
    const ys = yearsOf(period);
    if (ys) return r.end >= today && ys.some(y => r.start <= `${y}-12-31` && r.end >= `${y}-01-01`);
    if (/^\d{4}$/.test(String(period))) return r.start <= `${period}-12-31` && r.end >= `${period}-01-01`;
    return r.end >= today;   // 'upcoming'
  }
  const seasonKey = (s) => ['low', 'mid', 'high', 'special'].includes(s && s.season_key) ? s.season_key : 'other';
  const titleCase = (t) => String(t || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  // a season's printed name: the Portuguese name by season key, else the table's label
  // the short form on pills (narrow matrix columns): «Low» / «Baixa», as the English drops «season»
  const shortSeason = (label) => String(label || '').replace(/\s*season$/i, '').replace(/^Época\s+(\S)/, (_, c) => c.toUpperCase());
  const seasonName = (s) => (LANG !== 'en' && seasonKey(s) !== 'other' && I18N[LANG]['season_' + seasonKey(s)]) || titleCase(s && s.label);

  // ── Accommodation matrix (17 Nov 2026, Miguel: «isto ainda não está bonito») ─────────────────────────────
  // ONE grid per pack: rows = room types, columns = seasons, each cell lists the room's sharing prices
  // (only the occupancies that room is sold at; a room sold one way shows the price alone). Shared by /prices
  // (editable, with cell ids) and the price list (read-only). Money is one format per pack: per-night packs (or any
  // price with cents) always 2 decimals, weekly packs whole euros.
  const OCC_LABEL = (n, occs) => n === 1 ? T('occ_single') : (n === 2 && !(occs || []).some(x => x > 2)) ? T('occ_sharing') : T('occ_n_sharing', n);
  const OCC_SHORT = (n, occs) => n === 1 ? T('occs_single') : (n === 2 && !(occs || []).some(x => x > 2)) ? T('occs_shared') : T('occs_n', n);
  function packDecimals(pack, prices) {
    if (pack && pack.price_basis === 'per_person_per_night') return 2;
    return (prices || []).some(p => Math.round(Number(p.sell_price) * 100) % 100 !== 0) ? 2 : 0;
  }
  function moneyFixed(n, cur, dec) {
    const s = Number(n || 0).toLocaleString(numLocale(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return withCur(s, cur);
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
  function fmtDay(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${monthsNow()[m - 1]} ${y}`; }
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
      return { id: s.id, label: seasonName(s), key: seasonKey(s), ranges, dates: ranges.map(fmtRange), when: seasonWhen(ranges, today), hadDates: all.length > 0 };
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
      basis: flex ? (nights > 1 ? T('basis_nights', nights) : T('basis_night')) : (pack.price_basis === 'per_person_per_week' ? T('basis_week') : T('basis_pp')) };
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
        rooms: m.rows.map(r => ({ room: r.room, cells: r.cells.map(cs => cs.filter(x => x.price || cs.length > 1).map(x => ({ label: x.label, occ: x.occ, price: x.text }))) })) });
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
      const d = (iso, yr) => { const [Y, M, D] = iso.split('-').map(Number); return `${D} ${monthsNow()[M - 1]}${yr ? ' ' + Y : ''}`; };
      return sy === y && ey === y ? `${d(p.start)} – ${d(p.end)}` : `${d(p.start, sy !== y)} – ${d(p.end, true)}`; };
    const rows = seasons.filter(s => periods.some(p => p.s === s)).map(s => ({ label: seasonName(s), key: seasonKey(s),
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
      if (a > cur) bands.push({ key: cur > lastKnown ? 'unset' : 'closed', label: cur > lastKnown ? T('not_set') : T('closed'), start: cur, end: add(a, -1) });
      const b = p.end >= we ? add(we, -1) : p.end;
      bands.push({ key: seasonKey(p.s), label: shortSeason(seasonName(p.s)), start: a, end: b });
      if (add(b, 1) > cur) cur = add(b, 1);
    });
    if (cur < we) bands.push({ key: cur > lastKnown ? 'unset' : 'closed', label: cur > lastKnown ? T('not_set') : T('closed'), start: cur, end: add(we, -1) });
    const strip = bands.map(b => ({ ...b, left: pct(b.start), width: pct(add(b.end, 1)) - pct(b.start) })).filter(b => b.width > 0);
    const months = []; for (let i = 0; i < MONTHS_N; i++) { const d = new Date(Date.UTC(ty, tm - 1 + i, 1)); months.push({ m: monthsNow()[d.getUTCMonth()], y: (i === 0 || d.getUTCMonth() === 0) ? d.getUTCFullYear() : null }); }
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
      if (prev && add(prev.end, 1) < p.start) out.push({ key: 'closed', label: T('closed'), text: fmtRange({ start: add(prev.end, 1), end: add(p.start, -1) }) });
      out.push({ key: seasonKey(p.s), label: shortSeason(seasonName(p.s)), text: fmtRange(p) });
    });
    return out;
  }
  // Camp Tab price variants («Surf Lesson - 30», «Surf Lesson - 35») are how staff ring a lesson at a given price;
  // they are not products for agencies, so the price list leaves them out (Miguel 19 Nov 2026).
  const campTabVariant = (r) => /\s-\s\d+(?:[.,]\d+)?$/.test(String(r.name || ''));
  function itemRows(catalog, key) {
    return (catalog || []).filter(r => sectionOfRow(r) === key && r.active !== false && Number(r.sell_price) > 0 && !campTabVariant(r))
      .slice().sort(bySort)
      .map(r => ({ name: r.name, note: catalogNote(r.notes), price: money(r.sell_price, r.sell_currency || r.currency || 'EUR'),
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

  // ── Surf School (19 Nov 2026, Miguel: «para o pdf … uma coisa deste género era mais fácil» — his one-page flyer) ──
  // Compact tables built from the catalog row names «<Kind> — <detail> (<Standard | Erasmus/Student | Resident>)»; every
  // price is a row of the table, a cell with no row prints «–», a row the names don't explain goes to «More» (never dropped).
  // The notes under each table are the facts written in the rows' notes («Max 5 per instructor · 1h30», «€250 deposit…»), in
  // the chosen language.
  const SCHOOL_CONTACT = { phone: '+351 939 591 707', email: 'surfschool@gotadaguasurf.com',
    book: 'https://bookings.gotadaguasurf.com/en/category/surf-school-in-costa-da-caparica-lisbon-portugal' };
  const SCH_DUR = [['1h', /^1\s*h(ours?)?$/i], ['2h', /^2\s*h(ours?)?$/i], ['3h', /^3\s*h(ours?)?$/i], ['all', /^(all|full)\s*day$/i],
    ['2d', /^2\s*days?$/i], ['3d', /^3\s*days?$/i], ['1w', /^1\s*week$/i]];
  const SCH_GEAR = [['bw', /^board\s*&\s*wetsuit$/i], ['b', /^board$/i], ['w', /^wetsuit$/i]];
  const durKey = (t) => (SCH_DUR.find(([, re]) => re.test(String(t).trim())) || [null])[0];
  function schoolFacts(note, cur, into) {
    const t = String(note || '');
    let m;
    if ((m = /max\.?\s*(\d+)\s*(?:people\s*)?per instructor/i.exec(t))) into.add('max|' + m[1]);
    if ((m = /\b(\d+h\d{2})\b/i.exec(t))) into.add('dur|' + m[1]);
    if (/deposit/i.test(t) && (m = /€\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s?€/.exec(t))) into.add('deposit|' + money(Number((m[1] || m[2]).replace(',', '.')), cur));
    if (/\bESN\b|erasmus document/i.test(t)) into.add('esn');
    else if (/proof required/i.test(t)) into.add('proof');
    if ((m = /\+\s?(\d+(?:[.,]\d+)?)\s?€\s*1 Jul/i.exec(t))) into.add('summer|' + money(Number(m[1].replace(',', '.')), cur));
  }
  const factText = (f) => { const [k, ...a] = f.split('|'); return T('sn_' + k, ...a); };
  function schoolModel(catalog, withExtras) {
    const rows = (catalog || []).filter(r => r.active !== false && Number(r.sell_price) > 0 && !campTabVariant(r));
    const lessonRows = rows.filter(r => ['Lesson', 'Surf Pack'].includes(r.category));
    if (!lessonRows.length) return null;
    const blank = () => ({ rows: [], facts: new Set() });
    const S = { group: blank(), priv: blank(), stuLessons: blank(), stuRentals: blank(), resLessons: blank(), resRentals: blank(),
      rent: { cells: {}, cols: [], gears: [], facts: new Set() }, other: [], extras: [] };
    let extra = null;
    for (const r of lessonRows) {
      const cur = r.sell_currency || r.currency || 'EUR', price = money(r.sell_price, cur), num = Number(r.sell_price);
      const m = /^(.+?)\s+—\s+(.+?)\s*(?:\(([^)]*)\))?\s*$/.exec(String(r.name || ''));
      if (!m) { S.other.push({ label: r.name, price, num }); continue; }
      const kind = m[1].trim(), detail = m[2].trim(), tag = String(m[3] || '');
      const who = /erasmus|student/i.test(tag) ? 'stu' : /resident/i.test(tag) ? 'res' : 'std';
      const summer = /jul/i.test(tag);
      const nM = /(\d+)\s+lessons?/i.exec(detail), n = nM ? Number(nM[1]) : null;
      if (/^private lesson$/i.test(kind) && /extra person/i.test(detail)) { extra = { price, max: (/max\.?\s*(\d+)/i.exec(r.notes || '') || [])[1] || null }; continue; }
      if (/lesson$/i.test(kind) && n) {
        const box = who === 'stu' ? S.stuLessons : who === 'res' ? S.resLessons : /^private/i.test(kind) ? S.priv : S.group;
        const label = /friend/i.test(detail) ? T('sch_friend', n) : summer ? T('sch_n_summer', n) : T('sch_n', n);
        box.rows.push({ label, price, num, n, order: (/friend/i.test(detail) ? 2000 : summer ? 1000 : 0) + n });
        schoolFacts(r.notes, cur, box.facts);
        continue;
      }
      const gear = (SCH_GEAR.find(([, re]) => re.test(kind)) || [null])[0];
      const dk = durKey(detail);
      if ((gear || /^rental$/i.test(kind)) && dk) {
        if (who !== 'std' || !gear) {
          const box = who === 'res' ? S.resRentals : S.stuRentals;
          box.rows.push({ label: (gear && gear !== 'bw' ? T('gear_' + gear) + ' · ' : '') + T('dur_' + dk), price, num, order: SCH_DUR.findIndex(d => d[0] === dk) });
          schoolFacts(r.notes, cur, box.facts);
        } else {
          (S.rent.cells[gear] = S.rent.cells[gear] || {})[dk] = price;
          schoolFacts(r.notes, cur, S.rent.facts);
        }
        continue;
      }
      S.other.push({ label: r.name, price, num });
    }
    S.rent.cols = SCH_DUR.map(d => d[0]).filter(k => Object.values(S.rent.cells).some(c => c[k]));
    S.rent.gears = SCH_GEAR.map(g => g[0]).filter(g => S.rent.cells[g]);
    [S.group, S.priv, S.stuLessons, S.resLessons, S.stuRentals, S.resRentals].forEach(b => b.rows.sort((a, c) => a.order - c.order || a.num - c.num));
    if (extra) S.priv.facts.add('extra|' + extra.price + '|' + (extra.max || ''));
    if (S.resLessons.rows.length || S.resRentals.rows.length) S.resLessons.facts.add('resident');
    const notes = (b) => [...b.facts].sort((a, c) => FACT_ORDER.indexOf(a.split('|')[0]) - FACT_ORDER.indexOf(c.split('|')[0])).map(factText);
    const out = (b) => ({ rows: b.rows.map(({ label, price }) => ({ label, price })), notes: notes(b) });
    if (withExtras) S.extras = itemRows(catalog, 'addons').map(r => ({ label: r.name, price: r.price, note: r.note }));
    return {
      group: out(S.group), priv: out(S.priv),
      rentals: { cols: S.rent.cols.map(k => ({ key: k, label: T('dur_' + k) })),
        rows: S.rent.gears.map(g => ({ label: T('gear_' + g), cells: S.rent.cols.map(k => S.rent.cells[g][k] || null) })), notes: notes(S.rent) },
      students: { lessons: out(S.stuLessons), rentals: out(S.stuRentals) },
      residents: { lessons: out(S.resLessons), rentals: out(S.resRentals) },
      other: S.other.map(({ label, price }) => ({ label, price })), extras: S.extras, contact: SCHOOL_CONTACT,
    };
  }
  const FACT_ORDER = ['max', 'dur', 'extra', 'deposit', 'esn', 'proof', 'summer', 'resident'];

  function campModel(camp, period, sections, today) {
    const parts = [];
    let accommodation = [];
    let seasons = null, calendar = [];
    if (sections.includes('accommodation') || sections.includes('flexible')) { accommodation = accommodationModel(camp.accom, period, today, { weekly: sections.includes('accommodation'), flex: sections.includes('flexible') }); if (accommodation.length) { seasons = seasonsModel(camp.accom, period, today); calendar = seasonCalendar(camp.accom, period, today); } }
    const school = camp.slug === 'surf-school' && sections.includes('surf') ? schoolModel(camp.catalog, sections.includes('addons')) : null;
    for (const def of SECTION_DEFS) {
      if (!sections.includes(def.key)) continue;
      if (school && (def.key === 'surf' || def.key === 'addons')) continue;   // in the school flyer
      if (def.key === 'transfers') { const rows = transferRows(camp.catalog); if (rows.length) parts.push({ key: def.key, title: T('sec_' + def.key), kind: 'transfers', rows }); continue; }
      const rows = itemRows(camp.catalog, def.key);
      if (rows.length) parts.push({ key: def.key, title: T('sec_' + def.key), kind: 'items', rows });
    }
    const ranges = accommodation.flatMap(p => p.seasons.flatMap(s => s.ranges));
    const currencies = new Set();
    accommodation.forEach(p => currencies.add(p.currency));
    parts.forEach(p => p.rows.forEach(r => { const m = /^([A-Z]{3}) /.exec(r.price); currencies.add(m ? m[1] : 'EUR'); }));
    const covers = [...new Set(parts.filter(p => p.kind === 'transfers').flatMap(p => p.rows.map(r => r.covers)).filter(Boolean))];
    const notes = [];
    if (accommodation.length) notes.push(T('note_accom'));
    if (accommodation.some(p => p.flex)) notes.push(T('note_flex'));
    if (covers.length === 1) notes.push(T('note_cover1', covers[0]));
    else if (covers.length > 1) notes.push(T('note_covers'));
    const tRows = parts.filter(p => p.kind === 'transfers').flatMap(p => p.rows);
    if (tRows.some(r => r.boards) && tRows.some(r => !r.boards)) notes.push(T('note_boards'));
    const nonEur = [...currencies].filter(c => c !== 'EUR');
    if (nonEur.length) notes.push(T('note_currency', nonEur.join(' / ')));
    // «from €…» = the lowest weekly per-person price printed (as the website's package cards say it)
    const weekly = (camp.accom && camp.accom.prices || []).filter(pr => { const pk = (camp.accom.packs || []).find(x => x.id === pr.pack_id); return pk && pk.price_basis !== 'per_person_per_night' && Number(pr.sell_price) > 0; });
    const printed = new Set(accommodation.filter(a => !a.flex).flatMap(a => a.rooms.flatMap(r => r.cells.flat().map(x => x.price))));
    const fromVals = weekly.map(pr => Number(pr.sell_price)).filter(v => printed.has(moneyFixed(v, 'EUR', 0)) || printed.has(moneyFixed(v, 'EUR', 2)));
    const from = fromVals.length ? moneyFixed(Math.min(...fromVals), 'EUR', Number.isInteger(Math.min(...fromVals)) ? 0 : 2) : '';
    return { slug: camp.slug, label: T('camp_' + camp.slug) || camp.label || CAMP_LABEL[camp.slug] || camp.slug, place: CAMP_PLACE[camp.slug] || '', from, seasons, calendar, accommodation, parts, ranges, notes,
      school, empty: !accommodation.length && !parts.length && !school };
  }

  function periodLabel(ranges, period, today) {
    const ys = yearsOf(period);
    if (ys && ys.length) return ys.length === 1 ? String(ys[0]) : `${ys[0]} – ${ys[ys.length - 1]}`;   // the years chosen, as chosen
    if (ranges.length) {
      const y0 = Math.min(...ranges.map(r => +r.start.slice(0, 4))), y1 = Math.max(...ranges.map(r => +r.end.slice(0, 4)));
      return y0 === y1 ? String(y0) : `${y0} – ${y1}`;
    }
    if (/^\d{4}$/.test(String(period))) return String(period);
    return String(today || '').slice(0, 4);
  }

  function buildModel(o) { return withLang(o && o.lang, () => buildModelIn(o)); }
  function buildModelIn(o) {
    const today = o.today || new Date().toISOString().slice(0, 10);
    const period = o.period || 'upcoming';
    const sections = (o.sections && o.sections.length) ? o.sections : ['accommodation', 'surf', 'tours', 'transfers', 'addons'];
    const camps = (o.camps || []).slice().sort((a, b) => CAMP_ORDER.indexOf(a.slug) - CAMP_ORDER.indexOf(b.slug))
      .map(c => campModel(c, period, sections, today)).filter(c => !c.empty);
    const ranges = camps.flatMap(c => c.ranges);
    const title = camps.length === 1 ? camps[0].label : T('all_camps');
    const pl = periodLabel(ranges, period, today);
    const [y, m, d] = today.split('-').map(Number);
    return { lang: LANG, camps, title, period: pl, generated: `${d} ${monthsNow()[m - 1]} ${y}`, contact: CONTACT,
      fileTitle: `${T('file')} - ${title} ${pl.replace(/\s+/g, '')}`,
      sections: sections.filter(k => camps.some(c => (k === 'accommodation' ? c.accommodation.length : c.parts.some(p => p.key === k) || (c.school && (k === 'surf' || (k === 'addons' && c.school.extras.length)))))).map(k => T('sec_' + k)) };
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
        <thead><tr><th class="pl-room-h">${esc(T('room'))}</th>${p.seasons.map(s => { const up = s.upcoming || s.dates || [];
          return `<th class="pl-season-h"><span class="pl-pill ${s.key}">${esc(shortSeason(s.label))}</span><span class="pl-dates">${up.map(esc).join('<br>')}</span></th>`; }).join('')}</tr></thead>
        <tbody>${p.rooms.map(r => `<tr><td class="pl-room">${esc(r.room)}</td>${r.cells.map(cs => `<td class="pl-cell">${cs.length ? cs.map(x => `<div class="pl-line">${x.label ? `<span class="pl-occ-in">${esc(x.label)}</span>` : ''}<span class="pl-amt${x.price ? '' : ' na'}">${x.price ? esc(x.price) : '—'}</span></div>`).join('') : '<div class="pl-line"><span class="pl-amt na">—</span></div>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  }
  // what «Single / Shared / 3 share» mean, next to the prices (the notes come a page later)
  function legendHtml(p) {
    // by occupancy number (not by the printed word, which changes with the language)
    const cells = p.rooms.flatMap(r => r.cells.flat()).filter(x => x.label);
    if (!cells.length) return '';
    const bits = [];
    if (cells.some(x => x.occ === 1)) bits.push(T('legend_single'));
    const byN = {};
    cells.forEach(x => { if (x.occ > 1) (byN[x.occ] = byN[x.occ] || new Set()).add(x.label); });
    Object.keys(byN).map(Number).sort((x, y) => x - y).forEach(n => bits.push(T('legend_n', [...byN[n]].sort().reverse().map(esc).join(' / '), n)));
    return bits.length ? `<p class="pl-legend">${T('legend_all')} · ${bits.join(' · ')}.</p>` : '';
  }
  function calendarHtml(cal) {
    if (!cal || !cal.length) return '';
    return `<div class="pl-cal"><div class="pl-cal-h">${esc(T('season_dates'))}</div><ul>${cal.map(c => `<li class="${c.key === 'closed' ? 'closed' : ''}"><span class="pl-pill ${esc(c.key)}">${esc(c.label)}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></div>`;
  }
  function seasonsHtml(sm) {
    if (!sm) return '';
    return `<section class="pl-part pl-seasons whole" data-part="seasons">${sectionHead('seasons', T('sec_seasons'))}
      <div class="pl-season-card">
        <div class="pl-strip">${sm.strip.map(b => `<div class="pl-band ${b.key}" style="left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%">${b.width > 6 ? esc(b.label) : ''}</div>`).join('')}<div class="pl-today" style="left:${sm.today.toFixed(3)}%"><span>${esc(T('today'))}</span></div></div>
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
        ? `<tr><td><b>${esc(g.route)}</b></td><td>${g.rows[0].covers ? esc(T('up_to', g.rows[0].covers)) : '—'}</td><td class="r pl-price">${esc(g.rows[0].price)}</td></tr>`
        : `<tr class="pl-route-row"><td colspan="3">${esc(g.route)}</td></tr>` + g.rows.map(r =>
          `<tr class="pl-veh"><td>${esc(r.vehicle || r.route)}${r.boards ? ` <span class="pl-boards">${esc(T('boards'))}</span>` : ''}</td><td>${r.covers ? esc(T('up_to', r.covers)) : '—'}</td><td class="r pl-price">${esc(r.price)}</td></tr>`).join('')).join('');
      return `<section class="pl-part${part.rows.length <= 12 ? ' whole' : ''}" data-part="transfers">${sectionHead(part.key, part.title)}
        <table class="pl-table pl-transfers"><colgroup><col><col class="pl-col-mid"><col class="pl-col-num"></colgroup>
          <thead><tr><th>${esc(T('th_route'))}</th><th>${esc(T('th_covers'))}</th><th class="r">${esc(T('th_per'))}</th></tr></thead>
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
    return camp.notes.length ? `<div class="pl-notes"><h3>${esc(T('good_to_know'))}</h3><ul>${camp.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
  }
  function sectionHead(key, title) {
    return `<header class="pl-sec-head"><h2>${esc(title)}</h2>${T('lead_' + key) ? `<p class="pl-lead">${esc(T('lead_' + key))}</p>` : ''}</header>`;
  }

  // ── the Surf School sheet (the flyer) ──
  function schTable(title, block, cls) {
    if (!block || !block.rows.length) return '';
    return `<div class="sch-box${cls ? ' ' + cls : ''}"><div class="sch-bar">${esc(title)}</div>
      <table class="pl-table sch-tbl"><colgroup><col><col class="sch-col-num"></colgroup><tbody>${block.rows.map(r => `<tr><td>${esc(r.label)}${r.note ? `<span class="pl-sub">${esc(r.note)}</span>` : ''}</td><td class="r sch-price">${esc(r.price)}</td></tr>`).join('')}</tbody></table>
      ${block.notes && block.notes.length ? `<p class="sch-note">${block.notes.map(esc).join(' · ')}</p>` : ''}</div>`;
  }
  // a short list in two columns (the extras): half the height on the page, one column on a phone
  function schTable2(title, rows) {
    const half = Math.ceil(rows.length / 2), L = rows.slice(0, half), Rr = rows.slice(half);
    const cell = (r) => r ? `<td>${esc(r.label)}</td><td class="r sch-price">${esc(r.price)}</td>` : '<td></td><td></td>';
    return `<div class="sch-box sch-wide"><div class="sch-bar">${esc(title)}</div>
      <table class="pl-table sch-tbl sch-tbl2"><colgroup><col><col class="sch-col-num"><col class="sch-col-gap"><col><col class="sch-col-num"></colgroup><tbody>${L.map((r, i) => `<tr>${cell(r)}<td class="sch-gap"></td>${cell(Rr[i])}</tr>`).join('')}</tbody></table></div>`;
  }
  function schPair(a, b) { const x = [a, b].filter(Boolean); return x.length ? `<div class="sch-grid${x.length === 1 ? ' one' : ''}">${x.join('')}</div>` : ''; }
  function schBand(title) { return `<div class="sch-band"><span>${esc(title)}</span></div>`; }
  function schoolHtml(camp, opts) {
    const S = camp.school, logo = (opts && opts.logo) || '';
    const R = S.rentals;
    const rentals = R.rows.length ? `<div class="sch-box sch-wide"><div class="sch-bar">${esc(T('sch_rentals'))}</div>
      <table class="pl-table sch-tbl sch-matrix sch-cols-${R.cols.length}"><colgroup><col class="sch-col-gear">${R.cols.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th></th>${R.cols.map(c => `<th class="r">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${R.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.cells.map(v => `<td class="r sch-price${v ? '' : ' na'}">${v ? esc(v) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${R.notes.length ? `<p class="sch-note">${R.notes.map(esc).join(' · ')}</p>` : ''}</div>` : '';
    const stu = S.students, res = S.residents;
    const more = S.other.length ? schPair(schTable(T('sch_extras'), { rows: S.extras, notes: [] }), schTable(T('sch_other'), { rows: S.other, notes: [] }))
      : S.extras.length ? schTable2(T('sch_extras'), S.extras) : '';
    const c = S.contact;
    const bookShort = c.book.replace(/^https?:\/\//, '').replace(/\/en\/category\/.*/, '');
    return `<section class="pl-camp pl-school" data-camp="${esc(camp.slug)}">
      <header class="sch-head">${logo ? `<div class="sch-logo">${logo}</div>` : ''}
        <div class="sch-rule"><span>${esc(T('school_title'))}</span></div>
        <div class="sch-place">Costa da Caparica</div></header>
      ${schPair(schTable(T('sch_group'), S.group), schTable(T('sch_private'), S.priv))}
      ${rentals}
      ${stu.lessons.rows.length || stu.rentals.rows.length ? schBand(T('sch_students')) + schPair(schTable(T('sch_lessons'), stu.lessons), schTable(T('sch_rentals'), stu.rentals)) : ''}
      ${res.lessons.rows.length || res.rentals.rows.length ? schBand(T('sch_residents')) + schPair(schTable(T('sch_lessons'), res.lessons), schTable(T('sch_rentals'), res.rentals)) : ''}
      ${more}
      <footer class="sch-contact"><div class="sch-bar">${esc(T('sch_contacts'))}</div>
        <div class="sch-contact-in"><span>${esc(c.phone)}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a><a href="${esc(c.book)}">${esc(T('sch_book'))}: ${esc(bookShort)}</a></div></footer>
    </section>`;
  }
  // the sheet's look — shared by /prices/pricelist.html and the «Price list» view of /prices (variables set on the sheet itself)
  const SCHOOL_CSS = `
.pl-school{--gd-navy:#27384a;--gd-navy-soft:#46596b;--gd-card:#fffdf7;--gd-line:#e8dcb4;--gd-line-2:#ddd2ad;--gd-bone:#f6f0d8;--gd-moss:#60633c;
  --gd-serif:"Gaya","Frastha",Georgia,serif;--gd-display:"Londrina","Arial Narrow",sans-serif;color:var(--gd-navy)}
.pl-school .sch-head{text-align:center;margin-bottom:4mm}
.pl-school .sch-logo svg{width:28mm;height:auto;display:block;margin:0 auto 2mm}
.pl-school .sch-rule{display:flex;align-items:center;gap:5mm}
.pl-school .sch-rule::before,.pl-school .sch-rule::after{content:'';flex:1;height:1.5px;background:var(--gd-navy)}
.pl-school .sch-rule span{font-family:var(--gd-display);font-size:24px;letter-spacing:.06em;text-transform:uppercase;line-height:1}
.pl-school .sch-place{font-family:var(--gd-serif);font-size:14px;color:var(--gd-moss);margin-top:1mm}
.pl-school .sch-grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-bottom:4mm}
.pl-school .sch-grid.one{grid-template-columns:1fr}
.pl-school .sch-box{background:var(--gd-card);border:1px solid var(--gd-line);border-radius:12px;overflow:hidden;break-inside:avoid}
.pl-school .sch-wide{margin-bottom:4mm}
.pl-school .sch-bar{background:var(--gd-navy);color:#fffdf7;text-align:center;font-family:var(--gd-display);font-size:14px;letter-spacing:.08em;text-transform:uppercase;line-height:1;padding:6px 10px 5px}
.pl-school .sch-tbl{font-size:12px}
.pl-school .sch-tbl col.sch-col-num{width:24mm}
.pl-school .sch-tbl col.sch-col-gear{width:38mm}
.pl-school .sch-tbl td,.pl-school .sch-tbl th{padding:4px 4mm;border-bottom:1px dashed var(--gd-line-2);vertical-align:top}
.pl-school .sch-tbl th{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--gd-navy-soft);border-bottom:1.5px solid var(--gd-navy)}
.pl-school .sch-tbl tbody tr:nth-child(even) td{background:var(--gd-bone)}
.pl-school .sch-tbl tbody tr:last-child td{border-bottom:0}
.pl-school .sch-tbl td.r,.pl-school .sch-tbl th.r{text-align:right}
.pl-school .sch-price{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.pl-school .sch-price.na{color:#b8ad8a;font-weight:400}
.pl-school .sch-matrix td,.pl-school .sch-matrix th{padding-left:2mm;padding-right:3mm}
.pl-school .sch-note{font-size:9.5px;color:var(--gd-navy-soft);padding:4px 4mm 5px;margin:0;line-height:1.4}
.pl-school .sch-band{display:flex;align-items:center;gap:4mm;margin:1mm 0 3mm}
.pl-school .sch-band::before,.pl-school .sch-band::after{content:'';flex:1;height:1px;background:var(--gd-line-2)}
.pl-school .sch-band span{font-family:var(--gd-display);font-size:16px;letter-spacing:.06em;text-transform:uppercase}
.pl-school .sch-contact{border:1px solid var(--gd-line);border-radius:12px;overflow:hidden;break-inside:avoid}
.pl-school .sch-contact-in{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;padding:8px 4mm;font-size:12px;font-weight:600;background:var(--gd-card)}
.pl-school .sch-contact-in a{color:inherit;text-decoration:none;overflow-wrap:anywhere}
@media screen and (max-width:820px){
  .pl-school .sch-grid{grid-template-columns:1fr}
  .pl-school .sch-wide{overflow-x:auto}
  .pl-school .sch-matrix{table-layout:auto}
  .pl-school .sch-tbl col.sch-col-gear{width:auto}
  .pl-school .sch-matrix td,.pl-school .sch-matrix th{padding-left:6px;padding-right:6px;font-size:11px}
  .pl-school .sch-rule span{font-size:19px}
  .pl-school .sch-tbl2,.pl-school .sch-tbl2 tbody,.pl-school .sch-tbl2 tr{display:block}
  .pl-school .sch-tbl2 tr{display:grid;grid-template-columns:1fr auto}
  .pl-school .sch-tbl2 td.sch-gap{display:none}
  .pl-school .sch-tbl2 td:empty{display:none}
}
@media print{ .pl-running + .pl-school{break-before:auto} .pl-running + .pl-school{padding-top:10mm;padding-bottom:16mm} }
.pl-school .sch-tbl2 col.sch-col-num{width:18mm}
.pl-school .sch-tbl2 col.sch-col-gap{width:6mm}
.pl-school .sch-tbl2 td.sch-gap{padding:0;border-bottom:0;background:transparent}
`;

  function render(model, opts) { return withLang(model && model.lang, () => renderIn(model, opts)); }
  function renderIn(model, opts) {
    const logo = (opts && opts.logo) || '';
    const logoNavy = logo.replace(/#fff4d5/gi, '#27384a');
    const c = model.contact;
    // the price list goes to agencies and partners (guests book on the website): no «Book now», a reservations line instead
    const partnerLine = `${T('reservations')} <a href="mailto:${esc(c.email)}">${esc(c.email)}</a> · ${esc(c.phone)}`;
    const one = model.camps.length === 1 ? model.camps[0] : null;
    const coverPhotos = (one ? [one.slug] : model.camps.map(x => x.slug).filter(sl => CAMP_PHOTO[sl]).slice(0, 3))
      .map(sl => `<div class="pl-cover-photo" style="background-image:url('/assets/pricelist/${(CAMP_PHOTO[sl] || CAMP_PHOTO.portugal)[0]}.jpg')"></div>`).join('');
    const cover = `<section class="pl-cover">
      <div class="pl-cover-photos n${one ? 1 : Math.min(3, model.camps.length) || 1}">${coverPhotos}</div>
      <div class="pl-cover-shade"></div>
      <div class="pl-cover-top"><div class="pl-cover-logo">${logo}</div><span class="pl-cover-for">${T('for_partners')}</span></div>
      <div class="pl-cover-main">
        <div class="pl-kicker">${esc(T('price_list'))} ${esc(model.period)}</div>
        <h1>${esc(model.title)}</h1>
        ${one && one.place ? `<div class="pl-place">${esc(one.place)}</div>` : ''}
        ${model.camps.length > 1 ? `<div class="pl-place">${model.camps.map(x => esc(x.label)).join(' · ')}</div>` : ''}
        <p class="pl-cover-tag">${esc(T('tagline'))}</p>
      </div>
      <div class="pl-cover-foot"><div class="pl-reserv">${partnerLine}</div><div class="pl-generated">${esc(T('as_of', model.generated))}</div></div>
    </section>`;
    if (!model.camps.length) return cover + `<section class="pl-camp"><p class="pl-empty">${esc(T('empty'))}</p></section>`;
    const running = `<div class="pl-running">${logoNavy}<span>gotadaguasurf.com · ${esc(c.email)} · ${esc(c.phone)}</span></div>`;
    // the Surf School alone = its one-page sheet (no cover, no back page)
    if (model.camps.length === 1 && model.camps[0].school && !model.camps[0].accommodation.length && !model.camps[0].parts.length)
      return running + schoolHtml(model.camps[0], { logo: logoNavy });
    const camps = model.camps.map(camp => {
      if (camp.school) return schoolHtml(camp, { logo: logoNavy });
      const ph = CAMP_PHOTO[camp.slug] || CAMP_PHOTO.portugal;
      camp.parts.forEach(pt => { if (pt.key === 'tours' && ph[2] && pt.rows.length >= 3) pt.photo = ph[2]; });
      return `<section class="pl-camp" data-camp="${esc(camp.slug)}">
      <header class="pl-camp-card" style="background-image:url('/assets/pricelist/${ph[1]}.jpg')">
        <div class="pl-camp-card-in">
          <div class="pl-camp-kicker">${esc(camp.slug === 'surf-school' ? T('kicker_school') : camp.slug === 'junior-camp' ? T('kicker_junior') : T('kicker_camp'))}</div>
          <h2 class="pl-camp-name">${esc(camp.label)}</h2>
          ${camp.place ? `<div class="pl-camp-place">${esc(camp.place.replace(/^(Junior Camp|Surf School) · /, ''))}</div>` : ''}
          ${camp.from ? `<div class="pl-camp-from">${esc(T('from'))} ${esc(camp.from)}</div>` : ''}
        </div>
      </header>
      ${''/* no Seasons section in the PDF (Miguel 17 Nov 2026): every date is under its season in the matrix */}
      ${camp.accommodation.length ? `<section class="pl-part pl-accom" data-part="accommodation"><div class="pl-keep">${sectionHead('accommodation', T('sec_accommodation'))}${calendarHtml(camp.calendar)}${accomHtml(camp.accommodation[0])}</div>${camp.accommodation.slice(1).map(accomHtml).join('')}${notesHtml(camp)}</section>` : ''}
      ${camp.parts.map(partHtml).join('')}
      ${camp.accommodation.length ? '' : notesHtml(camp)}
    </section>`;
    }).join('');
    const end = `<section class="pl-end">
      <div class="pl-end-logo">${logo}</div>
      <div class="pl-reserv">${partnerLine}</div>
      <div class="pl-contact"><span>${esc(c.web)}</span></div>
      <div class="pl-generated">${esc(T('end_line', model.generated))}</div>
    </section>`;
    return running + cover + camps + end;
  }

  // The PDF dialog (19 Nov 2026, Miguel: «quando está a escola fica aquilo tudo selecionado é estranho»): only the sections
  // that print something for the chosen camp(s), and one choice per year that still has season dates.
  // camp = { slug, catalog, accom:{ packs, seasons, prices } } (rows as the page reads them)
  function availableSections(camp, today) {
    const out = new Set();
    if (!camp) return out;
    if (camp.slug === 'surf-school') { if (schoolModel(camp.catalog, false)) out.add('school'); return out; }
    const a = camp.accom || {};
    const priced = (a.prices || []).filter(p => Number(p.sell_price) > 0);
    (a.packs || []).filter(pk => pk.active !== false).forEach(pk => {
      if (!priced.some(p => p.pack_id === pk.id)) return;
      out.add(pk.price_basis === 'per_person_per_night' ? 'flexible' : 'accommodation');
    });
    SECTION_DEFS.forEach(d => { if (d.key === 'transfers' ? transferRows(camp.catalog).length : itemRows(camp.catalog, d.key).length) out.add(d.key); });
    return out;
  }
  function seasonYears(seasons, today) {
    const t = today || new Date().toISOString().slice(0, 10), y0 = Number(t.slice(0, 4));
    const ys = new Set();
    (seasons || []).filter(s => s.active !== false).forEach(s => (Array.isArray(s.date_ranges) ? s.date_ranges : []).forEach(r => {
      if (!r || !r.start || !r.end || r.end < t) return;                  // only dates not yet ended
      for (let y = Math.max(y0, Number(r.start.slice(0, 4))); y <= Number(r.end.slice(0, 4)); y++) ys.add(y);
    }));
    const years = [...ys].sort((a, b) => a - b);
    return { years, preset: years.filter(y => y === y0 || y === y0 + 1) };
  }
  function schoolSheet(catalog, o) { return withLang(o && o.lang, () => { const school = schoolModel(catalog, !(o && o.extras === false)); return school ? schoolHtml({ slug: 'surf-school', school }, { logo: (o && o.logo) || '' }) : ''; }); }
  const api = { buildModel, render, schoolSheet, availableSections, seasonYears, SCHOOL_CSS, SCHOOL_CONTACT, I18N, LANGS, sectionOfRow, CATALOG_NOTES, accomMatrix, seasonWhen, moneyFixed, money, inPeriod, fmtRange, CONTACT, CAMP_ORDER, CAMP_LABEL, isInternalNote, guestText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceList = api;
})(typeof window !== 'undefined' ? window : this);
