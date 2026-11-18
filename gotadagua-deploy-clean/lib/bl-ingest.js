// Bookinglayer reports that arrive by email → the app (17 Nov 2026, Miguel: «faz isso automático»).
//
// mail-ingest (supabase/functions/mail-ingest) reads accounting@ every 15 minutes. Three kinds of
// Bookinglayer report land there; this file decides which is which and builds, with the SAME code
// the camp hub runs (lib/bl-report.js), what an import would change. Pure functions, no DOM, no
// Supabase: the Edge Function (through the synced copy in supabase/functions/_shared/lib/), the
// Node tests and the local dry run load this one file.
//
//   «AUTO Marrocos - hourly para a app (so accounting)»   } camp week + transfer report, hourly,
//   «AUTO Sri Lanka - hourly para a app (so accounting)»  } check-out −3..+32 days → imported
//   «App - Semana Marrocos (Week + Transfers)»            } the staff's daily copy, cc'd to
//   «App - Semana Sri Lanka (Week + Transfers)»           } accounting@ → archived only
//   «App - Revenue & Partners (check-in last 30 days)»      daily → bookings (lib/bl-revenue.js)
//
// The one rule that must never break: an invoice is never archived (Miguel downloads and pays
// from the inbox). Only a message FROM no-reply@bookinglayer.com whose subject carries one of the titles
// above, and that has no PDF attached, is a report; everything else is «none» and is left alone.
//
// How the reports really come (17 Nov 2026): no attachment. From no-reply@bookinglayer.com, subject
// «Report: 17 November 2026 - <report title>», an HTML body with a «Download report» link to
// https://downloads.bookinglayer.io/reports/<uuid>?expires=…&signature=… (signed, 30 days, no login).
// reportLink() takes that link (a Google redirect unwrapped) and accepts ONLY https://downloads.bookinglayer.io/reports/…
// — never api. or app.bookinglayer.io. mail-ingest downloads it server-side (reports.ts). A CSV attachment still works.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlIngest = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const BR = () => isNode ? require('./bl-report.js') : self.BlReport;
  const GT = () => isNode ? require('./guests-trips.js') : self.GuestsTrips;
  const CC = () => isNode ? require('./camp-config.js') : self.CampConfig;
  const TC = () => isNode ? require('./transport-catalog.js') : self.TransportCatalog;

  // ── Which email is which ─────────────────────────────────────────────────
  // Titles are matched loosely (accents, case, punctuation and spacing ignored) because Bookinglayer
  // may put the title in the subject, in the file name («AUTO_Marrocos_-_hourly…csv») or both.
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const TITLES = [
    { kind: 'camp', camp: 'morocco', re: /\bauto marrocos\b.*\bhourly\b/ },
    { kind: 'camp', camp: 'sri-lanka', re: /\bauto sri lanka\b.*\bhourly\b/ },
    { kind: 'staff_copy', camp: 'morocco', re: /\bapp semana marrocos\b/ },
    { kind: 'staff_copy', camp: 'sri-lanka', re: /\bapp semana sri lanka\b/ },
    { kind: 'revenue', camp: null, re: /\bapp revenue and partners\b/ },
  ];
  const SENDER = 'no-reply@bookinglayer.com';
  const fromBookinglayer = from => { const m = String(from || '').toLowerCase().match(/<([^>]+)>/); return (m ? m[1] : String(from || '').toLowerCase()).trim() === SENDER; };
  const isPdf = a => /\.pdf$/i.test(String(a.filename || '')) || /pdf/i.test(String(a.mime || ''));
  const isCsv = a => /\.csv$/i.test(String(a.filename || '')) || /^text\/(csv|comma-separated-values)\b/i.test(String(a.mime || '')) || /^application\/(csv|vnd\.ms-excel)\b/i.test(String(a.mime || '')) && /\.csv$/i.test(String(a.filename || ''));
  function titleOf(text) { const t = norm(text); return TITLES.find(x => x.re.test(t)) || null; }
  // msg = { from, subject, html, text, attachments: [{ filename, mime }] }
  //   → { kind: 'camp'|'staff_copy'|'revenue'|'none', camp, csv (an attachment to import) | link (the download URL),
  //       archivable, reason }
  function routeEmail(msg) {
    msg = msg || {};
    const atts = msg.attachments || [];
    const none = reason => ({ kind: 'none', camp: null, csv: null, link: null, archivable: false, reason });
    // A PDF anywhere = an invoice (or something Miguel must see): never a report, never archived.
    if (atts.some(isPdf)) return none('has a PDF attachment — left to the invoice pipeline');
    if (!fromBookinglayer(msg.from)) return none(`not from ${SENDER}`);
    const t = titleOf(msg.subject) || atts.map(a => titleOf(a.filename)).find(Boolean) || null;
    if (!t) return none('not a Bookinglayer report title');
    if (t.kind === 'staff_copy') return { kind: t.kind, camp: t.camp, csv: null, link: null, archivable: true, reason: 'staff copy — the hourly AUTO report is the source' };
    const csvs = atts.filter(isCsv);
    if (csvs.length === 1) return { kind: t.kind, camp: t.camp, csv: csvs[0], link: null, archivable: true, reason: '' };
    if (csvs.length > 1) return { kind: t.kind, camp: t.camp, csv: null, link: null, archivable: false, reason: `${csvs.length} CSV attachments — expected one` };
    const L = reportLink(msg.html, msg.text);
    if (!L.url) return { kind: t.kind, camp: t.camp, csv: null, link: null, archivable: false, reason: L.why };
    return { kind: t.kind, camp: t.camp, csv: null, link: L.url, archivable: true, reason: '' };
  }

  // ── The «Download report» link ───────────────────────────────────────────
  const DOWNLOAD_HOST = 'downloads.bookinglayer.io';
  const ent = s => String(s || '').replace(/&amp;/gi, '&').replace(/&#x?0*3[dD];|&#61;/g, '=').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  // A Google redirect (https://www.google.com/url?q=<the link>&sa=…) → the link inside it.
  function unwrap(u) {
    for (let i = 0; i < 3; i++) {
      let x; try { x = new URL(u); } catch (_) { return u; }
      if (/(^|\.)google\.[a-z.]+$/i.test(x.hostname) && x.pathname === '/url') { const q = x.searchParams.get('q') || x.searchParams.get('url'); if (!q) return u; u = q; continue; }
      return u;
    }
    return u;
  }
  // ONLY https://downloads.bookinglayer.io/reports/… (no user, no port). Anything else → null + why.
  function safeReportUrl(u) {
    let x; try { x = new URL(String(u || '').trim()); } catch (_) { return { url: null, why: 'the download link is not a URL' }; }
    if (x.protocol !== 'https:') return { url: null, why: `the download link is not https (${x.protocol})` };
    if (x.hostname.toLowerCase() !== DOWNLOAD_HOST) return { url: null, why: `the download link goes to ${x.hostname}, not ${DOWNLOAD_HOST} — not followed` };
    if (x.username || x.password || (x.port && x.port !== '443')) return { url: null, why: 'the download link has a user or a port — not followed' };
    if (!/^\/reports\/[^/]+/.test(x.pathname)) return { url: null, why: `the download link path is ${x.pathname}, not /reports/… — not followed` };
    return { url: x.toString(), why: '' };
  }
  // html / text of the email → { url, why }. The anchor whose text says «Download report» first; else any link to the
  // download host (the plain-text part, or a link without that text).
  function reportLink(html, text) {
    const anchors = [...String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ href: unwrap(ent(m[2]).trim()), label: ent(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }));
    const cands = anchors.filter(a => /download\s+report/i.test(a.label)).map(a => a.href)
      .concat(anchors.map(a => a.href).filter(h => h.includes(DOWNLOAD_HOST)))
      .concat([...String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map(m => unwrap(ent(m[0]))).filter(h => h.includes(DOWNLOAD_HOST) || /google\.[a-z.]+\/url/.test(h)));
    if (!cands.length) return { url: null, why: 'no «Download report» link in the email' };
    let last = null;
    for (const c of cands) { const r = safeReportUrl(c); if (r.url) return r; last = last || r; }
    return last;
  }
  // The host + path of a link, never its signature (for the run log).
  const linkForLog = u => { try { const x = new URL(u); return x.host + x.pathname; } catch (_) { return ''; } };
  // A redirect of the download may go to the same host or to cloud storage (S3 / Google / Azure / R2) — nothing else.
  function allowedRedirect(u) {
    let x; try { x = new URL(u); } catch (_) { return false; }
    if (x.protocol !== 'https:' || x.username || x.password) return false;
    const h = x.hostname.toLowerCase();
    return h === DOWNLOAD_HOST || /^([a-z0-9.-]+\.)?s3[a-z0-9.-]*\.amazonaws\.com$/.test(h) || h === 'storage.googleapis.com'
      || /\.blob\.core\.windows\.net$/.test(h) || /\.r2\.cloudflarestorage\.com$/.test(h);
  }
  // What came back is a CSV (not an HTML «link expired» page, not a PDF): a first line with commas, no markup.
  function looksLikeCsv(text) {
    const first = (String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '').trim();
    return !!first && first.includes(',') && !/^<|<html|<!doctype|%PDF/i.test(first);
  }

  // Oldest first; for each camp only the newest pending report is imported, the older ones are superseded.
  // msgs = [{ id, internalDate (ms), route }] → { order: [...], superseded: Set(id) }
  function orderReports(msgs) {
    const order = (msgs || []).slice().sort((a, b) => Number(a.internalDate) - Number(b.internalDate) || String(a.id).localeCompare(String(b.id)));
    const newest = new Map();
    order.forEach(m => { const k = m.route && (m.route.kind === 'camp' ? 'camp:' + m.route.camp : m.route.kind === 'revenue' ? 'revenue' : null); if (k) newest.set(k, m.id); });
    const superseded = new Set();
    order.forEach(m => { const k = m.route && (m.route.kind === 'camp' ? 'camp:' + m.route.camp : m.route.kind === 'revenue' ? 'revenue' : null); if (k && newest.get(k) !== m.id) superseded.add(m.id); });
    return { order, superseded };
  }
  // A report older than the last one imported for the same camp is never imported (hourly reports overlap).
  const olderThanLast = (receivedAt, lastImportedAt) => !!(lastImportedAt && receivedAt && new Date(receivedAt).getTime() < new Date(lastImportedAt).getTime());

  // ── Time in the camp ─────────────────────────────────────────────────────
  function localNow(tz, at) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at ? new Date(at) : new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  // ── The report window: check-out −3..+32 days around the day the report was sent ─────────────
  // A trip or guest only counts as «vanished = cancelled» when its booking's check-out is INSIDE this window:
  // outside it the booking is simply not in the report (left long ago, or checks out after +32). No check-out
  // known = outside (never cancelled on a guess).
  const WINDOW = { before: 3, after: 32 };
  function reportWindow(receivedYmd) { const G = GT(); return { from: G.addDaysIso(receivedYmd, -WINDOW.before), to: G.addDaysIso(receivedYmd, WINDOW.after) }; }
  const insideWindow = (checkout, w) => !!(checkout && w && w.from && w.to && String(checkout).slice(0, 10) >= w.from && String(checkout).slice(0, 10) <= w.to);

  // ── /prices (pricing_catalog) → vehicles and driver prices, as camp-hub/transport.js (17 Nov 2026) ───────
  // The rows the camp hub reads (category Transport, in the picker, active) grouped by lib/transport-catalog.js; the
  // price of an airport trip = TransportCatalog.costOf(the route's vehicles, vehicle) — presetPrice() in transport.js.
  //   price(kind, vehicle, place) · price.ready (both airport ways have a priced vehicle = pricesReady())
  //   price.cfg = the camp settings + the catalog's vehicles, what the parser picks each trip's vehicle from (catCfg()).
  function pricesFromCatalog(rows, slug) {
    const cfg = CC().get(slug) || CC().SL; const T = TC();
    const P = T.group(rows || []);
    const airPlace = place => place || (slug === 'sri-lanka' ? 'CMB' : cfg.airportDefault);
    const airVehicles = (kind, place) => T.airportVehicles(P, cfg, kind, airPlace(place));
    const fn = (kind, vehicle, place) => T.costOf(airVehicles(kind, place), vehicle);
    fn.ready = ['airport_arrival', 'airport_departure'].every(k => airVehicles(k).some(v => Number(v.cost != null ? v.cost : v.price) > 0));
    fn.loaded = T.count(P) > 0;
    fn.cfg = T.withCatalog(cfg, P);
    return fn;
  }

  // ── The camp report → what the Week / Transport import would do ──────────
  // The same steps as buildImport + saveImport in camp-hub/transport.js (17 Nov 2026), without a browser:
  //   parse (lib/bl-report.js) → prices from /prices → planTrips (merge, never blank; Sri Lanka never touches a
  //   trip of an earlier day; a paid trip is never changed) → planGuests → the arguments of camp_trips_import.
  // Plus the window guard: future, unpaid trips of a booking that left the report while its check-out is inside the
  // window are put on hold with a question (out.hold, applied by reports.ts after the import) — or, only with
  // cancel_vanished on, cancelled as «bookinglayer» (the reason an import uses, so the trip comes back if the booking returns).
  // o = { text, fileName, slug, appTrips, appGuests, catalog, now ('YYYY-MM-DDTHH:MM' camp time), receivedYmd,
  //       cancelVanished (default false — the camp hub's import never cancels them; bl_report_settings.cancel_vanished), vanishCap }
  const LIVE = ['planned', 'sent', 'confirmed'];
  function planCampReport(o) {
    const B = BR(); const G = GT();
    const slug = o.slug; const cfg = CC().get(slug);
    if (!cfg) return refuse(`camp «${slug}» has no settings`);
    const GTC = slug === 'sri-lanka' ? undefined : cfg;       // = transport.js (Sri Lanka parses with the defaults)
    const text = String(o.text || '').replace(/^﻿/, '');
    if (!B.isReportHeader(text)) return refuse('not the camp report: the «Booking: Reference», «Booking line: Id» or «Guest: Full name» column is missing');
    const now = o.now; const today = now.slice(0, 10);
    const receivedYmd = o.receivedYmd || today;
    const win = reportWindow(receivedYmd);
    const M = B.model(text, o.fileName, GTC);
    const price = pricesFromCatalog(o.catalog, slug);
    if (M.R.missing.length) return refuse(`columns missing from the report: ${M.R.missing.join(', ')}`);
    // Without the price column the old grouping comes back (2158 / 4297 / 4581 split again, trips cancelled as «split»).
    if (!M.R.priceColumn) return refuse('the «Booking line: Final price incl. tax» column is missing — the transfer rule needs it');
    if (!M.live.length) return refuse('no live booking of this camp in the report (an empty or wrong file?)');
    if (!price.loaded) return refuse('no transfer rows in /prices for this camp — nothing imported (a trip at 0 «fits» any payment)');
    // the parser picks each trip's vehicle from /prices (transport.js parses with catCfg())
    const parsed = B.parse(text, o.fileName, receivedYmd, price.cfg);
    const allGuests = B.guestRows(text, o.fileName, GTC);
    const okGuests = allGuests.filter(g => G.OK_STATUS.has(g.booking_status) && g.check_in && g.check_out);
    const partnerOf = r => { const g = okGuests.find(x => x.booking_ref === r && x.partner); return g ? g.partner : ''; };
    let trips = parsed.trips.map(t => ({ ...t, expected_price: price(t.kind, t.vehicle, t.place), hq_match: null, partner: partnerOf(t.booking_ref) || null }));
    // = noPrice() in transport.js: Sri Lanka refuses any trip at 0; Morocco only when /prices is not usable (an airport
    // without a row, Essaouira, is saved at 0 and flagged, as the app does).
    const noPrice = trips.filter(t => !(Number(t.expected_price) > 0) && (slug === 'sri-lanka' || !price.ready));
    if (noPrice.length) return refuse(`${noPrice.length} transfer${noPrice.length === 1 ? '' : 's'} without a price in /prices (${noPrice.map(t => `${t.booking_ref} ${t.vehicle}`).join(', ')})`);
    const maxCo = (parsed.bookings || []).reduce((m, b) => b.co > m ? b.co : m, '');
    const appTrips = o.appTrips || []; const appGuests = o.appGuests || [];
    const plan = B.planTrips(trips, appTrips, { today, now, exportDate: parsed.export_date, refsPresent: parsed.refs_active, window: maxCo ? { to: maxCo } : null, mergePast: slug !== 'sri-lanka' });
    trips = plan.send;
    // = buildImport: a trip whose vehicle was changed by hand keeps it (its price = that vehicle's /prices price), and a trip
    // split with «Separate» does not get the report's «N people, 1 transfer paid» back.
    const byKey = new Map(appTrips.filter(a => a.import_key).map(a => [a.import_key, a]));
    trips = trips.map(t => { const a = byKey.get(t.key); const ed = (a && a.edited_fields) || [];
      let x = a && ed.includes('vehicle') && !ed.includes('expected_price') && a.vehicle ? { ...t, expected_price: price(t.kind, a.vehicle, t.place) || t.expected_price } : t;
      if (ed.includes('together_split')) x = { ...x, flags: (x.flags || []).filter(f => !/^\d+ people, \d+ transfers? paid — one covers \d+$/.test(f)) };
      return x; });
    const guests = okGuests.map(g => ({ ...g, hq_match: null, partner: partnerOf(g.booking_ref) || null }));
    const guestPlan = B.planGuests(guests, appGuests);
    // Week asks «cancelled?» only for a stored guest whose check-out is inside the report window.
    guestPlan.wouldDrop = guestPlan.wouldDrop.filter(a => insideWindow(a.check_out, win));
    // ── Vanished bookings (window guard) ──
    const V = vanished(appTrips, parsed.refs_active, judgeWindow(win), now);
    const vanish = V.inside, outside = V.outside;
    const vanishRefs = [...new Set(vanish.map(a => a.booking_ref))];
    const cap = o.vanishCap != null ? o.vanishCap : vanishCap(parsed.refs_active.length);
    // Many bookings leaving at once is a broken file, not cancellations: nothing cancelled and nothing held (a held trip
    // stays out of «Send the whole day»). Otherwise, with cancelling switched off (the default), the trips are put on hold
    // with a question for the camp — never cancelled automatically (audit 18 Nov 2026, WEEK-03).
    let vanishHeld = ''; let hold = [];
    if (vanishRefs.length > cap) vanishHeld = `${vanishRefs.length} bookings left the report at once (more than ${cap}) — nothing cancelled or held, check the report`;
    else if (o.cancelVanished !== true && vanish.length) { vanishHeld = 'cancelling vanished bookings is switched off (bl_report_settings.cancel_vanished) — put on hold with a question'; hold = vanishHolds(vanish, today); }
    const merges = (plan.merge || []).map(m => ({ survivor: m.survivor.id, patch: m.patch, others: m.others.map(x => ({ id: x.id, needs_resend: ['sent', 'confirmed'].includes(x.status) })) }));
    const rpc = {
      p_export_date: [parsed.export_date, today].filter(Boolean).sort().pop(), p_is_preset: false,
      p_refs_present: parsed.refs_active, p_cancel_refs: [], p_trips: trips, p_guests: guestPlan.rows,
    };
    const out = { ok: true, slug, now, today, window: win, rows: M.R.rows, bookings: M.live.length, parsed, plan, guestPlan, merges, rpc,
      vanish: vanishHeld ? [] : vanish, vanishAll: vanish, vanishHeld, vanishOutside: outside, hold,
      warnings: B.importWarnings(text, o.fileName, GTC) };
    out.changes = summarize(out);
    return out;
  }
  // Future, unpaid, live airport trips (from Bookinglayer) of bookings that are not in the report: inside = the booking's
  // check-out is inside the report window (the report should have it: cancelled there?), outside = it simply is not in
  // this report. Shared by the hourly import (planCampReport) and the camp hub's manual import (transport.js).
  function vanished(appTrips, refsActive, win, now) {
    const refs = new Set(refsActive || []); const today = String(now).slice(0, 10); const nowMin = String(now).slice(11, 16);
    const future = a => a.trip_date > today || (a.trip_date === today && (a.trip_time || '23:59') > nowMin);
    const c = (appTrips || []).filter(a => (a.kind === 'airport_arrival' || a.kind === 'airport_departure') && a.source === 'bookinglayer' && a.booking_ref
      && LIVE.includes(a.status) && !a.payment_entry_id && !refs.has(a.booking_ref) && future(a));
    return { inside: c.filter(a => insideWindow(a.booking_checkout, win)), outside: c.filter(a => !insideWindow(a.booking_checkout, win)) };
  }
  // The window is dated in the camp's time zone, but Bookinglayer cuts the report at 00:00 UTC (audit WEEK-21: Sri Lanka's
  // window moves at 00:30 Colombo, the file 5.5 hours later). A booking checking out on the window's last day may simply not
  // be in the file yet: it is never judged «left the report».
  const judgeWindow = win => win && win.to ? { from: win.from, to: GT().addDaysIso(win.to, -1) } : win;
  const vanishCap = nRefs => Math.max(3, Math.ceil((nRefs || 0) * 0.15));
  // A booking that left the report keeps its trips, on hold: missing_since (out of «Send the whole day», in the chip «not in
  // the latest Bookinglayer file») + the question below on the trip. «Still needed» in Transport answers it for good
  // (KEPT_MARK in edited_fields); the booking back in a report clears both (camp_trips_import).
  const GONE_FLAG = 'booking no longer in the Bookinglayer report — cancel this trip?';
  const KEPT_MARK = 'kept:booking not in the report';
  const vanishHolds = (trips, today) => (trips || [])
    .filter(a => !(a.import_flags || []).includes(GONE_FLAG) && !(a.edited_fields || []).includes(KEPT_MARK))
    .map(a => ({ id: a.id, trip: a, patch: { missing_since: a.missing_since || today, import_flags: [...(a.import_flags || []), GONE_FLAG] } }));
  function refuse(why) { return { ok: false, refused: why, changes: { refused: why } }; }

  // The run log (bl_report_runs.changes): counts + one short line per change, so Miguel can read a dry run.
  const dirW = k => k === 'airport_departure' ? 'dep' : 'arr';
  const tL = t => `${t.booking_ref} ${dirW(t.kind)} ${t.date || t.trip_date} ${(t.guests || []).join(', ') || t.guest_names || ''} (${t.pax}p${t.time || t.trip_time ? ' ' + (t.time || t.trip_time) : ''})`;
  const cL = c => c.map(x => `${x.field} ${x.app === '' || x.app == null ? '∅' : x.app} → ${x.report === '' || x.report == null ? '∅' : x.report}${x.kept ? ' (kept)' : ''}`).join('; ');
  function summarize(r) {
    const P = r.plan, GP = r.guestPlan; const today = r.today;
    const cap = (xs, n = 60) => xs.length > n ? xs.slice(0, n).concat(`… ${xs.length - n} more`) : xs;
    return {
      file: { rows: r.rows, bookings: r.bookings, trips: r.parsed.trips.length, guests: GP.rows.length, window: r.window },
      counts: {
        send: P.send.length, create: P.create.length, update: P.update.length, same: P.same.length, revive: P.revive.length, merge: (P.merge || []).length,
        replaced: P.regroupCancel.length, flagRemoved: P.flagRemoved.length, withheld: (P.withheld || []).length, untouched: P.untouched.length,
        covered: P.covered.length, past: P.past.length, fills: P.fills.length, conflicts: P.conflicts.length,
        vanish: r.vanish.length, vanishHeld: r.vanishHeld ? r.vanishAll.length : 0, vanishOutside: r.vanishOutside.length, hold: (r.hold || []).length,
        guestsNew: GP.add.length, guestsChanged: GP.change.length, guestsSame: GP.same.length, guestFills: GP.fills.length, guestKept: GP.kept.length,
        guestConflicts: GP.conflicts.length, guestStatusDue: GP.statusDue.length, guestsWouldAskCancelled: GP.wouldDrop.length,
        pastTouched: [...P.update, ...P.revive].filter(x => x.trip.date < today).length + (P.merge || []).filter(m => m.trip.date < today).length + P.regroupCancel.filter(a => a.trip_date < today).length,
        paidTouched: [...P.update, ...P.revive].filter(x => x.app.payment_entry_id).length + (P.merge || []).filter(m => [m.survivor, ...m.others].some(a => a.payment_entry_id)).length,
      },
      trips: {
        create: cap(P.create.map(x => tL(x.trip))),
        update: cap(P.update.map(x => `${tL(x.trip)} — ${cL(x.changes)}`)),
        revive: cap(P.revive.map(x => tL(x.trip))),
        merge: (P.merge || []).map(m => `${tL(m.trip)} — keeps ${m.survivor.import_key}, merges ${m.others.map(x => x.import_key || x.guest_names).join(', ')}`),
        mergeInfo: (P.mergeInfo || []).map(m => `${tL(m.trip)} — ${m.why}`),
        replaced: P.regroupCancel.map(a => `${tL(a)} [${a.import_key}]`),
        flagRemoved: P.flagRemoved.map(a => `${tL(a)} [${a.import_key}]`),
        withheld: (P.withheld || []).map(x => `${tL(x.trip)} — ${x.why}`),
        fills: cap(P.fills.map(x => `${tL(x.trip)} — ${x.fills.map(c => `${c.field} ${c.report}`).join('; ')}`)),
        conflicts: P.conflicts.map(x => `${tL(x.trip)} — ${x.conflicts.map(c => `${c.field}: app ${c.app}, Bookinglayer ${c.report}`).join('; ')}`),
        questions: cap(P.send.filter(t => t.flags.some(f => /^Different times — coming together|transfers paid, same flight/.test(f))).map(t => `${tL(t)} — ${t.flags.filter(f => /^Different times|transfers paid/.test(f)).join(' | ')}`)),
        vanish: r.vanishAll.map(a => `${tL(a)} [${a.import_key}] check-out ${a.booking_checkout}`),
        vanishHeld: r.vanishHeld || null,
        hold: (r.hold || []).map(x => `${tL(x.trip)} [${x.trip.import_key}] check-out ${x.trip.booking_checkout} — on hold, asked`),
      },
      guests: {
        add: cap(GP.add.map(g => `${g.booking_ref} ${g.guest_name} ${g.check_in}→${g.check_out}`)),
        change: cap(GP.change.map(x => `${x.g.booking_ref} ${x.g.guest_name}: ${x.changes.map(c => `${c.field} ${c.app || '∅'} → ${c.report || '∅'}`).join('; ')}`)),
        fills: cap(GP.fills.map(x => `${x.g.booking_ref} ${x.g.guest_name}: ${x.fields.map(f => `${f.field} ${f.report}`).join('; ')}`)),
        conflicts: GP.conflicts.map(x => `${x.g.booking_ref} ${x.g.guest_name}: ${x.note}`),
        wouldAskCancelled: GP.wouldDrop.map(a => `${a.booking_ref} ${a.guest_name} ${a.check_in}→${a.check_out}`),
      },
      warnings: cap((r.warnings || []).map(w => w.text), 40),
    };
  }

  // ── «Last import: today 17:02 · Bookinglayer (automatic)» (Week, under the Import button) ──────
  // last = { at, source: 'mail'|'manual', by_name } · now = Date / ISO instant, or the camp's own «YYYY-MM-DDTHH:MM»
  // (window.TRANSPORT_NOW in the tests) · tz = the camp's zone. Amber after 3 hours.
  const STALE_HOURS = 3;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  function lastImportLine(last, now, tz) {
    if (!last || !last.at) return { text: 'Last import: none yet', amber: true };
    const at = localNow(tz, last.at); const nw = typeof now === 'string' && LOCAL_RE.test(now) ? now : localNow(tz, now || new Date());
    const day = at.slice(0, 10); const today = nw.slice(0, 10); const G = GT();
    const when = day === today ? 'today' : day === G.addDaysIso(today, -1) ? 'yesterday' : `${Number(day.slice(8))} ${MON[Number(day.slice(5, 7)) - 1]}`;
    const who = last.source === 'manual' ? `by hand${last.by_name ? ` (${String(last.by_name).split(/\s+/)[0]})` : ''}` : 'Bookinglayer (automatic)';
    const amber = (Date.parse(nw + ':00Z') - Date.parse(at + ':00Z')) > STALE_HOURS * 3600 * 1000;   // both in the camp's time
    return { text: `Last import: ${when} ${at.slice(11, 16)} · ${who}`, amber };
  }

  return { routeEmail, reportLink, safeReportUrl, unwrap, allowedRedirect, looksLikeCsv, linkForLog, fromBookinglayer, SENDER, DOWNLOAD_HOST, titleOf, norm, isPdf, isCsv, orderReports, olderThanLast, localNow, reportWindow, insideWindow, WINDOW, pricesFromCatalog, planCampReport, vanished, judgeWindow, vanishCap, vanishHolds, GONE_FLAG, KEPT_MARK, summarize, lastImportLine, STALE_HOURS };
});
