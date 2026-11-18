// Bookinglayer «App - Revenue & Partners (check-in last 30 days)» → public.bookings (17 Nov 2026).
//
// The daily 08:00 report (one row per booking, all locations, Status Confirmed / Deposit paid / Paid, check-in
// −30..−1 days) carries what the HQ «Import bookings» (index.html → handleGlobalCsvImport) reads from the
// Bookings-list export, under other headers. This file reads it with an alias map and computes, row by row, what
// the HQ import would write — keeping the HQ import's rules:
//   · partner = Company/Channel (else «Backoffice via X»), matched to the partners table without case;
//     commission counted ONCE, in the booking: commission = total × % when there is a partner, net = total − commission;
//   · notes / payment / external_ref / anything written in the app stay (the old payload is merged, never replaced);
//   · raw_payload.total_override = true, or a booking already marked in another currency → total / net /
//     commission kept as the app has them;
//   · a NEW booking in another currency is held (not written) and listed: its euro value has to be set by hand;
//   · status «Deposit paid» → deposit_paid; deposit → paid updates come through;
//   · Kilroy country: Booker Country goes to raw_payload.country; the bookings_fill_country trigger copies it to
//     bookings.country only when that is empty — a country fixed by hand is never overwritten;
//   · the Partners app's pay route reads raw_payload.bookingSource («Connect: X» / «Partner: X» / …) and due:
//     an existing bookingSource is kept (the Via column speaks another vocabulary), a new booking gets one built
//     from Via + Company/Channel.
// Nothing here talks to Bookinglayer (registering a payment there issues an invoice — forbidden).
//
// THE ALIAS MAP IS THE PART TO ADJUST when the first real file arrives: header → field, compared without case,
// accents, punctuation or the «Booking:» / «Booker:» prefix.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlRevenue = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const GT = () => isNode ? require('./guests-trips.js') : self.GuestsTrips;

  // field → accepted headers (first match wins). Prefixes «Booking:», «Booker:», «Booking line:» are optional.
  const ALIASES = {
    ref: ['Booking: Reference', 'Reference', 'Booking reference', 'Booking #', 'Booking number'],
    status: ['Booking: Status', 'Status', 'Booking status'],
    created: ['Booking: Created at', 'Created at', 'Created on', 'Created'],
    checkin: ['Booking: Check-in date', 'Check-in date', 'Check-in', 'Check-in on', 'Check in'],
    checkout: ['Booking: Check-out date', 'Check-out date', 'Check-out', 'Check-out on', 'Check out'],
    pax: ['Booking: Pax', 'Pax', 'Number of guests', 'Guests', 'Persons'],
    nights: ['Booking: Nights', 'Nights', 'Number of nights'],
    total: ['Booking: Final price incl. tax', 'Final price incl. tax', 'Final price incl tax', 'Total incl. tax', 'Total', 'Final price'],
    paid: ['Booking: Paid amount', 'Paid amount', 'Booking: Paid', 'Paid', 'Amount paid'],
    due: ['Booking: Due amount', 'Due amount', 'Booking: Due', 'Due', 'Amount due'],
    currency: ['Booking: Currency', 'Currency'],
    via: ['Booking: Via', 'Via', 'Booking: Source', 'Source', 'Created via'],
    channel: ['Company/Channel', 'Company / Channel', 'Booking: Company/Channel', 'Channel', 'Company', 'Partner'],
    commissionTotal: ['Booking: Commission total', 'Commission total', 'Total commission', 'Commission amount'],
    commissionPct: ['Booking: Commission %', 'Commission %', 'Commission percentage', 'Partner commission %', 'Commission'],
    locations: ['Booking: List of locations', 'List of locations', 'Locations', 'Location'],
    products: ['Booking: List of products', 'List of products', 'Products'],
    bookerName: ['Booker: Full name', 'Booker: Name', 'Booker name', 'Booker full name', 'Booker'],
    bookerEmail: ['Booker: Email', 'Booker email', 'Booker: E-mail', 'Email'],
    bookerCountry: ['Booker: Country', 'Booker country', 'Country'],
    packages: ['Booking: List of packages', 'List of packages', 'List of packages (title)', 'Packages', 'Package'],
    payMethods: ['Booking: List of payment methods', 'List of payment methods', 'Payment methods'],
    payDates: ['Booking: List of payment dates', 'List of payment dates', 'Payment dates'],
    payAmounts: ['Booking: List of payment amounts', 'List of payment amounts', 'Payment amounts'],
    url: ['Booking: Backoffice URL', 'Backoffice URL', 'Backoffice link', 'URL'],
  };
  // Without these the run stops: a missing partner / commission / due column must never turn into «direct, 0».
  const REQUIRED = ['ref', 'status', 'checkin', 'total', 'due', 'currency', 'channel', 'commissionPct', 'locations'];
  const hnorm = s => String(s || '').replace(/^﻿/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^(booking line|booking|booker)\s*:\s*/, (m, p) => p + ' ').replace(/[^a-z0-9%#]+/g, ' ').trim();
  // «Booking: Reference» and «Reference» both → «reference»; «Booker: Email» stays «booker email» (a booker field).
  const key = s => hnorm(s).replace(/^booking (line )?/, '');

  function headerIndex(headers) {
    const H = headers.map(key);
    const ix = {};
    Object.keys(ALIASES).forEach(f => {
      ix[f] = -1;
      for (const a of ALIASES[f]) { const i = H.indexOf(key(a)); if (i >= 0) { ix[f] = i; break; } }
    });
    return ix;
  }

  // ── Location: the stay decides (same codes and order as the HQ import) ──
  const CODE_TO_NAME = { LK: 'Surf Camp Ahangama', MA: 'Tamraght Camp', PT: 'Surf Camp Portugal', JUN: 'Junior Camp Caparica', COL: 'Coliving Portugal Caparica', COLON: 'Kids Camp Caparica', CKC: 'Kids Camp Caparica', SC: 'Surf School Caparica' };
  // Names Bookinglayer may print in «List of locations» → code. Adjust with the real file.
  const NAME_TO_CODE = [
    [/aha[mn]gama|sri\s*lanka/i, 'LK'], [/tamraght|morocco|marrocos|taghazout/i, 'MA'], [/junior/i, 'JUN'], [/kids/i, 'COLON'],
    [/coliving/i, 'COL'], [/surf\s*school/i, 'SC'], [/surf\s*camp\s*portugal|caparica|portugal/i, 'PT'],
  ];
  const STAY_FIRST = ['LK', 'MA', 'PT', 'JUN', 'COLON', 'SC'];
  function locationOf(listText, packages) {
    const parts = String(listText || '').split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    const codes = [];
    parts.forEach(p => {
      const up = p.toUpperCase(); let c = CODE_TO_NAME[up] ? up : null;
      if (!c) { const hit = NAME_TO_CODE.find(([re]) => re.test(p)); c = hit ? hit[1] : null; }
      if (c && !codes.includes(c)) codes.push(c);
    });
    if (!codes.length) {
      // «List of locations» not recognised: the package name decides before giving up («Surf Camp Ahangama, Sri Lanka»)
      const hit = NAME_TO_CODE.find(([re]) => re.test(String(packages || '')));
      if (hit) return { code: hit[1], name: CODE_TO_NAME[hit[1]], unknown: parts, codes: [hit[1]] };
      return { code: '', name: '', unknown: parts, codes };
    }
    let code = codes[0];
    if (codes.length > 1) {
      const pk = String(packages || '').toLowerCase();
      const byPkg = codes.find(c => { const n = (CODE_TO_NAME[c] || '').toLowerCase(); return n && pk && (pk.includes(n) || n.split(/\s+/).some(t => t.length > 3 && !['surf', 'camp', 'the'].includes(t) && pk.includes(t))); });
      code = byPkg || STAY_FIRST.find(c => codes.includes(c)) || code;
    }
    return { code, name: CODE_TO_NAME[code] || code, unknown: [], codes };
  }

  // «1.234,56» / «1,234.56» / «€ 30.00» → number
  function num(v) {
    let t = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '');
    if (!t) return null;
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (t.includes(',')) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
    const n = parseFloat(t); return Number.isFinite(n) ? n : null;
  }
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const statusKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
  // «Sat 14 Nov 2026» (Bookinglayer), «2026-11-14», «14/11/2026»
  function dateMs(s) {
    const t = String(s || '').trim(); let d = GT().ymd(t);
    if (!d) { const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
    if (!d) { const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    if (!d) return null; const [y, mo, dd] = d.split('-').map(Number); return Date.UTC(y, mo - 1, dd);
  }

  // text → { rows: [model], missing: [header names], headers, unknownLocations: [...] }
  function parse(text) {
    const all = GT().parseCsv(String(text || '').replace(/^﻿/, ''));
    const headers = (all[0] || []).map(h => String(h).trim());
    const ix = headerIndex(headers);
    const missing = REQUIRED.filter(f => ix[f] < 0).map(f => ALIASES[f][0]);
    const rows = []; const unknownLocations = new Set();
    all.slice(1).forEach((r, n) => {
      if (!r.some(c => String(c).trim())) return;
      const get = f => ix[f] >= 0 && ix[f] < r.length ? String(r[ix[f]]).trim() : '';
      const ref = get('ref'); if (!ref) return;
      const loc = locationOf(get('locations'), get('packages'));
      loc.unknown.forEach(u => unknownLocations.add(u));
      const via = get('via'); const channel = get('channel');
      const viaPartner = ((via.match(/\bvia\s+(.+)$/i) || [])[1] || '').trim();
      const ci = dateMs(get('checkin')), co = dateMs(get('checkout'));
      rows.push({
        locationCodes: loc.codes || [],
        line: n + 2, ref, guest: get('bookerName'), status: statusKey(get('status') || 'confirmed'),
        checkinMs: ci, checkoutMs: co, nights: (ci && co) ? Math.max(1, Math.round((co - ci) / 86400000)) : (num(get('nights')) || 7),   // = the HQ import
        pax: parseInt(get('pax'), 10) || 1, locationCode: loc.code, locationName: loc.name, locationTags: get('locations'),
        partner: channel || (/backoffice/i.test(via) ? viaPartner : '') || 'Direct Bookings',
        commissionPct: num(get('commissionPct')) || 0, commissionTotal: num(get('commissionTotal')),
        package: get('packages'), products: get('products'), gross: num(get('total')) || 0,
        bookerEmail: get('bookerEmail').toLowerCase(), country: get('bookerCountry'), paidAmount: num(get('paid')) || 0,
        // Partners reads Number(raw.due): a «€ 35.00» cell is stored as «35.00»
        due: /^-?\d+(\.\d+)?$/.test(get('due')) ? get('due') : (num(get('due')) == null ? get('due') : num(get('due')).toFixed(2)), currency: (get('currency') || 'EUR').toUpperCase(), via, channel,
        createdOn: get('created'), payments: { methods: get('payMethods'), dates: get('payDates'), amounts: get('payAmounts') }, url: get('url'),
      });
    });
    return { rows, missing, headers, index: ix, unknownLocations: [...unknownLocations] };
  }

  // The Source text the Partners app reads (bookingPayRoute tests /^connect/), for a booking the app does not have yet.
  function sourceFor(r, partnerName) {
    if (/connect/i.test(r.via)) return `Connect: ${partnerName || r.channel || ''}`.trim();
    if (partnerName) return `Partner: ${partnerName}`;
    return r.via || '';
  }

  // The keys this import owns in raw_payload (the rest of the old payload is kept as it is).
  const OWN_RAW = ['ref', 'guest', 'status', 'checkinMs', 'checkoutMs', 'nights', 'pax', 'locationCode', 'partner', 'commissionPct', 'package', 'gross',
    'bookerEmail', 'country', 'paidAmount', 'due', 'createdOn', 'locationTags', 'currency', 'via', 'channel', 'commissionTotal', 'products', 'payments', 'url'];
  // Changes that matter to the money (listed first in the run log); the others are «extra information added».
  const MATERIAL = ['total', 'net_amount', 'commission_amount', 'partner_name', 'partner_commission_pct', 'location', 'check_in_on', 'raw.status', 'raw.due', 'raw.paidAmount', 'raw.currency'];
  // Equal whatever the order of an object's keys: Postgres jsonb gives raw_payload.payments back as {dates, amounts,
  // methods}, parse() builds {methods, dates, amounts} — compared as plain text they never matched, and every booking was
  // rewritten and snapshotted every morning (18 Nov 2026: 305 «changed», 0 material).
  const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = sorted(v[k]); return o; }, {}) : v;
  const same = (a, b) => JSON.stringify(sorted(a == null ? null : a)) === JSON.stringify(sorted(b == null ? null : b));

  // rows (parse().rows) · existing = [bookings rows] · partners = [names] → the rows to upsert and what changes.
  function plan(rows, existing, partners) {
    const prevBy = new Map((existing || []).map(b => [String(b.booking_ref), b]));
    const byLower = new Map((partners || []).filter(Boolean).map(n => [String(n).trim().toLowerCase(), n]));
    const out = { upserts: [], changes: [], created: [], held: [], unchanged: 0, newPartners: [], notes: [] };
    const seen = new Set();
    rows.forEach(r => {
      if (seen.has(r.ref)) { out.notes.push(`${r.ref}: twice in the report — the first row is used`); return; }
      seen.add(r.ref);
      const prev = prevBy.get(r.ref) || null; const prp = (prev && prev.raw_payload) || {};
      let partnerName = r.partner && r.partner !== 'Direct Bookings' ? r.partner : null;
      let pctIn = Number(r.commissionPct) || 0;
      // An EMPTY Company/Channel cell on a booking the app has with a partner never turns it direct (the 26 Oct 2026 error):
      // the app's partner and commission stay, with a note.
      if (!partnerName && prev && prev.partner_name) {
        partnerName = prev.partner_name; pctIn = Number(prev.partner_commission_pct) || 0;
        out.notes.push(`${r.ref}: no Company/Channel in the report — kept the app's partner ${prev.partner_name} (${pctIn} %)`);
      }
      if (partnerName) { const hit = byLower.get(partnerName.trim().toLowerCase()); if (hit) partnerName = hit; else if (!out.newPartners.includes(partnerName)) out.newPartners.push(partnerName); }
      const gross = r2(r.gross); const pct = pctIn;
      const commission = partnerName ? r2(gross * pct / 100) : 0;
      const ciIso = r.checkinMs ? new Date(r.checkinMs).toISOString().slice(0, 10) : null;
      const foreign = r.currency && r.currency !== 'EUR';
      if (!ciIso) { out.held.push({ ref: r.ref, why: 'check-in date not readable — not imported' }); return; }
      if (foreign && !prev) { out.held.push({ ref: r.ref, why: `new booking in ${r.currency} (${gross}) — set the euro value by hand, then the import keeps it` }); return; }
      const raw = { ...prp };
      OWN_RAW.forEach(k => { raw[k] = k === 'partner' ? (partnerName || 'Direct Bookings') : r[k]; });
      raw.commissionPct = pct;
      // the Bookings export stamped the hour in checkinMs / checkoutMs; the same day keeps the stored value
      const sameDay = k => prp[k] != null && raw[k] != null && Math.floor(Number(prp[k]) / 86400000) === Math.floor(raw[k] / 86400000);
      const keptDays = ['checkinMs', 'checkoutMs'].filter(k => { if (sameDay(k)) { raw[k] = prp[k]; return true; } return false; });
      if (keptDays.length === 2 && prp.nights != null) raw.nights = prp.nights;   // same stay: the stored night count stays
      raw.gross = gross;
      // the currency: the app's mark wins (CHF / USD bookings carry their euro value in total)
      if (prp.currency) raw.currency = prp.currency;
      else if (foreign) { raw.currency = r.currency; raw['total_' + r.currency.toLowerCase()] = gross; }
      else delete raw.currency;   // euros: no mark (the HQ import never wrote one)
      // «List of locations» as Bookinglayer wrote it; locationTags keeps the codes the HQ import stored («LK», «SC, TRANS»)
      raw.locationList = r.locationTags; raw.locationTags = prp.locationTags || r.locationCodes.join(', ');
      if (!prp.bookingSource) raw.bookingSource = sourceFor(r, partnerName);
      if (!prp.source) raw.source = 'bl-revenue-report';
      if (!r.locationCode && prp.locationCode) raw.locationCode = prp.locationCode;
      // no location recognised: keep the app's (never «Unknown» over a real camp)
      const location = r.locationName || (prev && prev.location) || 'Unknown';
      const row = {
        booking_ref: r.ref, booker: r.guest || (prev && prev.booker) || '', check_in_on: ciIso, month_key: ciIso ? ciIso.slice(0, 7) : null,
        total: gross, pax: Number(r.pax || 1), location, package: r.package || (prev && prev.package) || '',
        partner_name: partnerName, booking_type: partnerName ? 'surfcamp' : 'direct', partner_commission_pct: pct,
        commission_amount: commission, net_amount: r2(gross - commission), raw_payload: raw,
      };
      const keepEur = prev && ((prp.currency && prp.currency !== 'EUR') || prp.total_override || (foreign && !prp.currency));
      if (keepEur) { row.total = Number(prev.total); row.net_amount = Number(prev.net_amount); row.commission_amount = Number(prev.commission_amount);
        if (foreign && !prp.currency) out.notes.push(`${r.ref}: ${r.currency} ${gross} in Bookinglayer, the app has ${prev.total} € — marked ${r.currency}; check the euro value`); }
      if (r.commissionTotal != null && partnerName && Math.abs(r.commissionTotal - commission) > 0.05 && !keepEur) out.notes.push(`${r.ref}: commission ${commission} (${pct} % of ${gross}) vs Bookinglayer's commission total ${r.commissionTotal}`);
      if (/kilroy/i.test(partnerName || '') && prev && prev.country && r.country && prev.country.trim().toLowerCase() !== r.country.trim().toLowerCase())
        out.notes.push(`${r.ref}: KILROY — app country ${prev.country}, Booker Country ${r.country} (the app is kept; check the office in info@)`);
      if (/kilroy/i.test(partnerName || '') && !r.country && !(prev && prev.country)) out.notes.push(`${r.ref}: KILROY booking without a country — find the office in info@`);
      if (!r.locationName) out.notes.push(`${r.ref}: location «${r.locationTags}» not recognised — ${prev ? 'kept ' + prev.location : 'saved as Unknown'}`);
      if (!prev) { out.upserts.push(row); out.created.push(r.ref); return; }
      const diffs = [];
      ['booker', 'check_in_on', 'month_key', 'total', 'pax', 'location', 'package', 'partner_name', 'booking_type', 'partner_commission_pct', 'commission_amount', 'net_amount'].forEach(f => {
        const a = prev[f], b = row[f];
        const eq = ['total', 'pax', 'partner_commission_pct', 'commission_amount', 'net_amount'].includes(f) ? Number(a || 0) === Number(b || 0) : String(a == null ? '' : a) === String(b == null ? '' : b);
        if (!eq) diffs.push({ field: f, from: a == null ? null : a, to: b });
      });
      const NUMK = ['due', 'gross', 'paidAmount', 'commissionPct', 'pax', 'nights'];
      Object.keys(raw).forEach(k => { if (NUMK.includes(k) && prp[k] != null && prp[k] !== '' && Number(prp[k]) === Number(raw[k])) return; if (!same(prp[k], raw[k])) diffs.push({ field: 'raw.' + k, from: prp[k] == null ? null : prp[k], to: raw[k] }); });
      if (!diffs.length) { out.unchanged++; return; }
      out.upserts.push(row);
      out.changes.push({ ref: r.ref, material: diffs.filter(d => MATERIAL.includes(d.field)), extra: diffs.filter(d => !MATERIAL.includes(d.field)).map(d => d.field) });
    });
    return out;
  }

  function summarize(p, parsed) {
    const fmt = v => v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v);
    const mat = p.changes.filter(c => c.material.length);
    return {
      file: { rows: parsed.rows.length, missing: parsed.missing, unknownLocations: parsed.unknownLocations },
      counts: { upserts: p.upserts.length, created: p.created.length, changed: p.changes.length, materialChanges: mat.length, unchanged: p.unchanged, held: p.held.length, newPartners: p.newPartners.length },
      created: p.created.slice(0, 200),
      material: mat.slice(0, 200).map(c => `${c.ref}: ${c.material.map(d => `${d.field.replace('raw.', '')} ${fmt(d.from)} → ${fmt(d.to)}`).join('; ')}`),
      extraOnly: p.changes.filter(c => !c.material.length).length,
      held: p.held.map(h => `${h.ref}: ${h.why}`),
      newPartners: p.newPartners,
      notes: p.notes.slice(0, 200),
    };
  }

  return { ALIASES, REQUIRED, headerIndex, key, parse, plan, summarize, locationOf, num, sourceFor, CODE_TO_NAME, OWN_RAW };
});
