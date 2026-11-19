// Camp hub · Transport (Sri Lanka 13 Nov 2026; Morocco 14 Nov 2026)
//
// Morocco (lib/camp-config.js): the same airport transfers (Let Us Tours, Agadir /
// Marrakech / Essaouira) and, instead of tuk-tuks, van runs (Fathoune: surf spot,
// Dunes, Paradise Valley…), one tap per run with the people in the van. Nobody pays
// in cash there: every driver is paid by SG bank transfer, so «Paid» = the trip is
// linked to a Transport · Bank Transfer line in the ledger (typed by Floriane or
// brought by the statement), in Reconcile → Payments. No «Pay a driver» in Morocco.
//
// Airport transfers and tuk-tuk runs for the full view (Francisco, Miguel,
// HQ). Never in camp-tab-only.
//
// UX pass (16 Nov 2026, Miguel: «van runs???? depois pay driver e depois add transfer???… sem coisas duplicadas»):
//   · the page reads top-down: the pills (All · Airport · Surf vans · Tours · Overview — CampConfig.transportTabs), «To do»
//     chips, «Owed to drivers» (each driver «Pay» = the one way to pay), the week bar with the pill's ONE blue button
//     (Airport / All: Send the whole week; a runs pill: Add surf vans / tour vans / tuk-tuk runs + Plan the day), the
//     days, and «Drivers and contacts · Export month» at the foot. No header button row any more.
//   · an airport transfer by hand is FREE only (staff, gift, compensation, other): guests' transfers come from Bookinglayer.
//   · every airport row has one checkpoint strip — Booked · Info · Driver · Guest · Paid — and a labelled «Edit».
//   · Overview (v2): three numbers (cost with up/down, owed now, per person), the year as bars by kind, one bar per kind,
//     drivers and suppliers; old months read like new ones (lib/transport-overview.js classifies the ledger lines).
// Plan the day → send (17 Nov 2026, Miguel: «o dia é organizado primeiro, depois a mensagem é enviada ao motorista»):
//   · Sri Lanka (tuk-tuks): marked in the run sheet per lesson session — Morning / Afternoon with its pickup time
//     (CampConfig.runSessions) — then one blue «Send to Sampath on WhatsApp» for the runs of the day not sent yet; the
//     afternoon message never repeats the morning. «Plan the day» (default today, Tomorrow a tap away) is the second door
//     to the same batches. The runs he marks are the ones done.
//   · Morocco (surf vans, tours): «Plan the day», default TOMORROW (Today a tap away), one batch per day, sent to Fathoune
//     the evening before; «All went as planned» in «Log runs» marks the plan done (the same rows, never new ones).
//   · Each batch: «Not sent» / «Planned · not sent» → «Sent 07:12 ✓ to Sampath» → a run added, edited or removed while
//     the driver still has it to come → «Changed after sending — send again», and the resend lists only the changes
//     («UPDATE:», … NEW / (was 2) / CANCELLED). States live in sent_at / needs_resend / sent_snapshot (no new column).
//   · Airport: the day header shows «Not sent» / «Sent 18:30 ✓ to Dilan» / «Changed after sending — send again · N»,
//     «Send the update» sends only the changed / new / cancelled transfers; the week line «Week sent 16 Nov 19:00 · 2 changed since».
// Driver payments, simplified (Miguel 16 Nov 2026, «sim, avança com a proposta dos motoristas»):
//   · «Pay a driver» is the one door to pay a driver, in both camps. Tap a driver in «Owed to
//     drivers»: everything done and unpaid since the last payment, by day × route, already ticked;
//     «+ Run not in the list» adds a run nobody logged, «−» removes one that did not happen, a
//     remaining difference needs a reason. Sri Lanka writes Cash rows split by item; Morocco one
//     Bank Transfer row, or links the SG transfer already loaded from the statement.
//   · Sri Lanka ?view=local (Nadith) has this page as «Drivers»: the owed line, the runs (log and
//     Plan the day, send) and the day list; airport rows are read-only there. supabase/camp-trips-local-pay.sql
//     lets him log tuk-tuk runs and pay; nothing else in his access changes.
//   · Reconcile and the week-total tiles are gone. Two chips stay: «N payments to check» (a
//     payment typed elsewhere that is not linked → Link trips) and «N paid, not done».
//
//   Trips      the one list of airport transfers (15 Nov 2026: Week → Transfers is gone), by day
//              (Sat–Fri week): WhatsApp to the «Send transfers to» contact — a trip, «Send the
//              whole day», «Send the whole week» (the message Week used to send, same builder) —
//              the status select Pending → Message Sent → Confirmed (Floriane, 16 Nov 2026), «Time changed,
//              resend», a red line when the driver is missing something, the guests' confirmations; «Export month» (CSV).
//   Reconcile  trips ↔ payments, like HQ → Month close → Reconcile.
//   The Monday Guests import has one door, in Week (15 Nov 2026: «Week = guests and camp
//   teams, Transport = drivers and money»): Week shows renderNext() as TransportUI.importHtml.
//   + Tuk-tuk runs (one tap = one run; «Send» / «Plan the day» + the WhatsApp order
//     to the tuk-tuk contact), Add transfer (guest or staff), Pay a driver, Drivers.
//   Every row shows Paid / Owed / Planned, and «Free» (staff, gift…) when nobody
//   pays us for it — the driver is still paid. Week totals sit on top of Trips.
//
// Loaded after the hub's main script: it reads the hub's globals (S,
// transportPresets, LOCAL_MANAGER_MODE, getHubSupabaseClient, …) and adds
// renderTransportPage() + one check to window.CAMP_CHECKS.
(function () {
  'use strict';
  const GT = window.GuestsTrips;
  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const CC = (window.CampConfig && CampConfig.get(SLUG)) || (window.CampConfig && CampConfig.SL) || {};
  const IS_SL = SLUG === 'sri-lanka';
  const GTC = IS_SL ? undefined : CC;          // parser settings: none = Sri Lanka's, exactly as before
  // The camp's runs: Sri Lanka tuk-tuks, Morocco vans (camp_trips.kind 'other', no database change).
  const RUN = IS_SL ? { kind: 'tuktuk', drv: 'tuktuk', label: 'Tuk-tuk', plural: 'Tuk-tuk runs', lower: 'tuk-tuk', veh: 'Tuk-tuk', contact: 'tuktuk_contact' }
    : { kind: (CC.runs || {}).kind || 'other', drv: 'van', label: 'Van', plural: 'Van runs', lower: 'van', veh: (CC.runs || {}).vehicle || 'Van', contact: 'van_contact' };
  const BANK_PAID = CC.payMethod === 'Bank Transfer';   // Morocco: drivers are paid by SG bank transfer
  const CUR = CC.currency || 'LKR';

  // ── Settings (kept as constants so Miguel can change them later) ────────
  const TRIPS_ENABLED_LOCATIONS = new Set(['sri-lanka', 'morocco']);
  const TRIPS_GO_LIVE = IS_SL ? '2026-11-14' : (CC.goLive || '2026-11-14');  // = camp_trips_go_live() in the SQL; start of the first camp week with trips (was 16 Nov)
  const goLive = () => window.TRIPS_GO_LIVE_OVERRIDE || TRIPS_GO_LIVE;   // tests move it into the past
  const TRIPS_LOAD_FROM = '2026-10-01';
  const TRIPS_BL_LOCATION_LABELS = IS_SL ? ['Surf Camp Ahangama'] : (CC.blLocations || []);
  // Vehicles, seats, driver cost and guest price: /prices only (lib/transport-catalog.js, 17 Nov 2026) — no list here.
  // Sri Lanka's camp runs: the purposes only. The price is the /prices row of the same name (picker «tuktuk») — no
  // price written here (17 Nov 2026: the old 500 LKR fallback is gone). No row → the run is saved at 0, flagged
  // «no /prices row», and shows «price to confirm» until the row exists.
  const TUKTUK_CAMP_RUNS = [
    { label: 'Market / food', purpose: 'food' }, { label: 'Laundry', purpose: 'laundry' }, { label: 'Staff', purpose: 'staff' }, { label: 'Errand', purpose: 'errand' },
  ];
  const NO_ROW_FLAG = label => `no /prices row for «${label}» — price to set in /prices`;
  const LINKED_ITEM_BY_PURPOSE = { surf: 'Transport Surf Lesson', food: 'Food Supply', laundry: 'Laundry', staff: 'Staff', errand: 'Errand', other: 'Errand' };
  const DIFF_REASONS = ['Waiting time', 'Extra stop', 'Tip', 'Price changed', 'Other'];
  const CHARGE_LABEL = { bookinglayer: 'In booking', camp_tab: 'Camp Tab', free: 'Free' };
  // A trip nobody pays us for (the driver is still paid). Stored as charge = 'free' + free_reason
  // (supabase/camp-trips-v2.sql); a free trip without a reason is an older row.
  const FREE_REASONS = [['staff', 'Staff'], ['gift', 'Gift to guest'], ['compensation', 'Compensation'], ['other', 'Other']];
  const FREE_SHORT = { staff: 'Staff', gift: 'Gift', compensation: 'Compensation', other: 'Other' };
  const TUKTUK_CONTACT = RUN.contact;         // default_for of the person who gets the tuk-tuk order
  const PLAN_DEFAULT_TIME = '07:30';
  const LOCAL_MANAGER_NAME = IS_SL ? 'Nadith' : (CC.localManager || 'the local manager');             // who pays the drivers in ?view=local («linked by Nadith» in Reconcile)

  // Sri Lanka's local manager (Nadith) gets the page as «Drivers» (16 Nov 2026). Morocco has no ?view=local.
  const LOCAL = IS_SL && (typeof LOCAL_MANAGER_MODE !== 'undefined') && !!LOCAL_MANAGER_MODE;
  const enabled = () => TRIPS_ENABLED_LOCATIONS.has(SLUG) && !CAMP_TAB_ONLY_MODE && (!LOCAL_MANAGER_MODE || LOCAL);
  const PAY_METHOD = (LOCAL || !BANK_PAID) ? 'Cash' : 'Bank Transfer';

  const TR = {
    loaded: false, loading: null, error: '', drivers: [], trips: [], links: [],
    view: 'trips', filter: 'all', week: null,
    imp: null, busy: new Set(),
  };

  // ── Time: Colombo, never the browser's zone. window.TRANSPORT_NOW pins it in tests.
  function colomboNow() {
    if (window.TRANSPORT_NOW) return String(window.TRANSPORT_NOW).slice(0, 16);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CC.tz || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const cToday = () => colomboNow().slice(0, 10);
  const cTime = () => colomboNow().slice(11, 16);
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = iso => iso ? `${DAY[GT.weekday(iso)]} ${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}` : '';
  const fmtShort = iso => iso ? `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}` : '';
  const fmtRange = (a, b) => a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${fmtShort(b)}` : `${fmtShort(a)} – ${fmtShort(b)}`;
  const money = n => (typeof lkr === 'function' ? lkr(n) : 'LKR ' + Math.round(n));
  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = n => (window.AppShell && AppShell.icon) ? AppShell.icon(n) : '';
  const say = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind); };

  // ── Rules (pure, tested) ───────────────────────────────────────────────
  // Done without anyone pressing Done: the trip's date and time have passed in Colombo.
  function isDone(t) {
    if (t.status === 'done') return true;
    if (!['planned', 'sent', 'confirmed'].includes(t.status)) return false;
    return `${t.trip_date}T${t.trip_time || '23:59'}` < colomboNow();
  }
  // Reconcile status of one trip. Precedence (first rule that fits wins):
  //   1 paid + (cancelled | no-show | not happened yet)  → paid_not_done  «Paid, not done»     to do
  //   2 cancelled                                         → cancelled      «Cancelled»          neutral
  //   3 no-show                                           → no_show        «No-show»            neutral (Francisco decided)
  //   4 not done yet                                      → upcoming       «Upcoming»           neutral, never blocks «reconciled»
  //   5 done, not paid, «did the driver go?» unanswered   → on_hold        «On hold»            to do: answer first (16 Nov 2026:
  //     a flagged trip is never «Owed», nor in «Owed to drivers» / the Overview, until «Driver went» or «Didn't go»)
  //   6 done, not paid, dated before go-live              → before_go_live «Before go-live»     neutral (paid in the old lumps)
  //   7 done, not paid                                    → owed           «Owed to driver»     to do
  //   7 done, paid, from Bookinglayer (or a tuk-tuk run)  → matched        «Matched»
  //   8 done, paid, added by hand (no booking)            → extra          «Extra»              neutral
  function reconcileStatus(t) {
    const paid = !!t.payment_entry_id;
    const done = isDone(t);
    if (paid && (t.status === 'cancelled' || t.status === 'no_show' || t.status === 'merged' || !done)) return 'paid_not_done';
    if (t.status === 'cancelled' || t.status === 'merged') return 'cancelled';
    if (t.status === 'no_show') return 'no_show';
    if (!done) return 'upcoming';
    if (!paid && blFlagged(t)) return 'on_hold';
    if (!paid && t.trip_date < goLive()) return 'before_go_live';
    if (!paid) return 'owed';
    if (t.source === 'bookinglayer' || t.kind === RUN.kind) return 'matched';
    return 'extra';
  }
  const REC_LABEL = {
    matched: ['Matched', 'badge-green'], owed: ['Owed to driver', 'badge-amber'], on_hold: ['On hold — answer first', 'badge-amber'], paid_not_done: ['Paid, not done', 'badge-red'],
    no_show: ['No-show', 'badge-grey'], before_go_live: ['Before go-live', 'badge-grey'], extra: ['Extra', 'badge-blue'], upcoming: ['Upcoming', 'badge-grey'], cancelled: ['Cancelled', 'badge-grey'],
  };
  const REC_TODO = new Set(['owed', 'paid_not_done', 'on_hold']);
  const isAirport = t => t.kind === 'airport_arrival' || t.kind === 'airport_departure';
  // The one week rule (Trips, the week totals and Reconcile): Sat–Fri, and a departure on the
  // Saturday a week ends belongs to that week's guests (Miguel, 13 Nov: «Beliz has departure and
  // was not there») — week Sat 14–Fri 20 holds the Sat 21 departures, and week 21–27 starts with
  // the Sat 21 arrivals only.
  function inWeek(t, ws) {
    const dep = t.kind === 'airport_departure';
    return (t.trip_date >= ws && t.trip_date <= GT.addDaysIso(ws, 6) && !(t.trip_date === ws && dep)) || (t.trip_date === GT.addDaysIso(ws, 7) && dep);
  }
  // The flags worth one amber line on the day list (the full list stays inside the trip).
  const REMOVED_FLAG = /^transfer removed in Bookinglayer/;
  // The whole booking left the Bookinglayer report (cancelled there?): its trips are held with this question (lib/bl-ingest.js
  // GONE_FLAG, audit 18 Nov 2026 WEEK-03). «Still needed» answers it for good (GONE_KEPT in edited_fields).
  const GONE_FLAG = /^booking no longer in the Bookinglayer report/;
  const GONE_KEPT = 'kept:booking not in the report';
  // lib/bl-report.js moneyCheck + GuestsTrips.pickVehicle: «4 people, 1 transfer paid — one covers 3», «no transfer paid»,
  // «paid €70, /prices €80 (Ann A)», «9 people over capacity — 2nd vehicle?».
  const MONEY_FLAG = /^\d+ people, \d+ transfers? paid — one covers \d+$|^no transfer paid$|^paid €[\d.,]+, \/prices €|people over capacity — 2nd vehicle\?$/;
  function rowFlag(t) {
    const F = t.import_flags || [];
    const says = F.find(f => /^guest says:/.test(f));
    if (blFlagged(t)) return questionFlag(t).replace(/:\s*/, ' — ');
    if (F.some(f => REMOVED_FLAG.test(f))) return 'Transfer removed in Bookinglayer — cancel it, or keep it if it is still needed';
    if (t.missing_since && F.some(f => GONE_FLAG.test(f))) return 'Booking no longer in the Bookinglayer report — cancel this trip, or keep it if it is still needed';
    if (t.missing_since) return 'Not in the latest Bookinglayer file';
    if (says) { const m = says.match(/«([^»]*)»/); const q = m ? m[1].trim() : ''; return `Guest says: «${q.length > 60 ? q.slice(0, 57) + '…' : q}» — still needed?`; }
    if (F.some(f => /^night arrival/.test(f))) return `Night arrival — the driver leaves the evening before (${fmtDay(GT.addDaysIso(t.trip_date, -1))})`;
    // A trip bigger than the largest /prices vehicle (17 Nov 2026) — amber, never blocks. The money questions («N people,
    // 1 transfer paid», «no transfer paid», «paid €X, /prices €Y») have their own line with «OK — known» / «Charge guest».
    const over = F.find(f => MONEY_FLAG.test(f) && !isMoneyFlag(f)); if (over) return over.charAt(0).toUpperCase() + over.slice(1);
    return '';
  }
  // Held back from «Send the whole day» until Francisco has looked: the booking or its transfer left the file.
  const onHold = t => !!t.missing_since;
  // ── Checked in Bookinglayer (supabase/camp-trips-bl-check.sql, 16 Nov 2026) ──
  // The Guests export cannot tell one transfer leg from two, nor their dates: every imported airport leg is «to check
  // in Bookinglayer» until somebody has looked at the booking page — «Booked ✓» / «Not booked» on the row, or the
  // morning assistant through camp_trips_bl_verify. Unchecked legs still go out to the driver (never blocked).
  // Off until the SQL is run: a row without the column bl_checked_at never shows the check.
  const blOn = t => !!t && Object.prototype.hasOwnProperty.call(t, 'bl_checked_at');
  function blToCheck(t) {
    return blOn(t) && !t.bl_checked_at && isAirport(t) && t.source === 'bookinglayer' && !t.payment_entry_id
      && ['planned', 'sent', 'confirmed'].includes(t.status) && String(t.trip_date || '') >= GT.addDaysIso(cToday(), -1);
  }
  const blList = () => TR.trips.filter(blToCheck).sort((a, b) => (a.trip_date + (a.trip_time || '99')).localeCompare(b.trip_date + (b.trip_time || '99')));
  const blUrl = ref => `https://app.bookinglayer.io/bookings?page=1&limit=25&search=${encodeURIComponent(ref)}&query=${encodeURIComponent(ref)}`;
  // camp_trips_bl_verify kept a past trip that the booking page does not have: «did the driver go?»
  // QA 16 Nov 2026: every flag that asks whether the driver went — «Not booked in Bookinglayer: did the driver go?» (the
  // morning check), «Transfer cancelled in Bookinglayer: did Dilan go…», «No arrival transfer booked…» — shows the same
  // amber question with «Driver went (pay)» / «Didn't go (cancel)», and Pay never ticks such a trip by itself.
  const BL_NOT_BOOKED_FLAG = 'Not booked in Bookinglayer: did the driver go? If not, cancel this trip';   // = camp_trips_bl_verify's v_flag
  // («No arrival transfer booked…» is matched from the QA's quote; its exact wording is not in the repo.)
  const QUESTION_FLAG = /did (the driver|\S+) go\?|^not booked in bookinglayer|^no (arrival|departure) transfer booked/i;
  const questionFlag = t => (t.import_flags || []).find(f => QUESTION_FLAG.test(String(f))) || '';
  const blFlagged = t => !!questionFlag(t) && isDone(t) && !t.payment_entry_id && !['cancelled', 'no_show', 'merged'].includes(t.status);
  const isFree = t => t.charge === 'free' || !!t.free_reason;
  const freeLabel = t => 'Free' + (t.free_reason && FREE_SHORT[t.free_reason] ? ' · ' + FREE_SHORT[t.free_reason] : '');
  const counts = t => !['cancelled', 'no_show', 'merged'].includes(t.status);
  // What Francisco reads on every row — built on reconcileStatus so Trips, the week totals and
  // Reconcile can never disagree. key: paid | owed | planned | old (before go-live) | off.
  function payState(t) {
    if (t.payment_entry_id) {
      const e = ledgerById(t.payment_entry_id); const by = linkedByLabel(linkOf(t.payment_entry_id));
      return { key: 'paid', label: 'Paid', cls: 'badge-green', sub: [e && e.date ? fmtShort(e.date) : '', by].filter(Boolean).join(' · ') };
    }
    if (t.status === 'cancelled' || t.status === 'merged') return { key: 'off', label: 'Cancelled', cls: 'badge-grey', sub: '' };
    if (t.status === 'no_show') return { key: 'off', label: 'No-show', cls: 'badge-grey', sub: '' };
    const s = reconcileStatus(t);
    if (s === 'owed') return { key: 'owed', label: 'Owed', cls: 'badge-amber', sub: 'done, not paid' };
    if (s === 'on_hold') return { key: 'hold', label: 'On hold', cls: 'badge-amber', sub: 'answer first: did the driver go?' };
    if (s === 'before_go_live') return { key: 'old', label: 'Before go-live', cls: 'badge-grey', sub: `not tracked before ${fmtShort(goLive())}` };
    return { key: 'planned', label: t.status === 'confirmed' ? 'Confirmed' : t.status === 'sent' ? 'Sent' : 'Planned', cls: t.status === 'confirmed' ? 'badge-green' : t.status === 'sent' ? 'badge-blue' : 'badge-grey', sub: '' };
  }
  const payBadge = t => { const p = payState(t); return `<span class="badge ${p.cls}" data-pay="${p.key}">${p.label}</span>`; };
  const runLabel = t => !IS_SL ? (vanRateOf(t) ? vanRateOf(t).label : (t.route || t.purpose || 'Run')) : t.tour_name ? 'Tour · ' + t.tour_name : t.purpose === 'surf' ? 'Camp → ' + (t.route || '') : (t.route || t.purpose || 'Run');
  const vanRateOf = t => (CC.vanRates || []).find(r => r.route === t.route) || null;
  // ── /prices: the one source of vehicles, seats and prices (17 Nov 2026) ─────────────────────────────────
  // transportPresets = the hub's catalog read (camp-hub/index.html loadTransportPresets → TransportCatalog.group):
  // routes with vehicles [{ label, capacity, cost, currency, sell, sellCurrency, coversPax, blProduct }] by capacity.
  // Nothing loaded → «prices not loaded» and no save (__transportPricesError); never a list or a price written here.
  const TC = window.TransportCatalog;
  const catalog = () => (typeof transportPresets !== 'undefined' && transportPresets) || {};
  const pricesError = () => (typeof __transportPricesError !== 'undefined' && __transportPricesError) || '';
  const airPlace = place => place || (IS_SL ? 'CMB' : CC.airportDefault);
  const airVehicles = (kind, place) => TC.airportVehicles(catalog(), CC, kind, airPlace(place));
  const airChoices = (kind, place) => TC.vehicleChoices(catalog(), CC, kind, airPlace(place));   // to pick from (Essaouira: Agadir's vans)
  const airLabels = (kind, place, keep) => { const ls = airChoices(kind, place).map(v => v.label); return keep && !ls.includes(keep) ? ls.concat(keep) : ls; };
  // The vehicle for N people on an airport trip (GuestsTrips.pickVehicle: bl_product, then capacity, over → largest + flag).
  const pickAir = (kind, place, pax, boards, products) => GT.pickVehicle(pax, { vehicles: airChoices(kind, place), boards, products });
  // A trip that already has a vehicle keeps it while it is on the route and holds the people (a surfboards Minivan stays a
  // Minivan when one guest leaves); otherwise the rule picks again. = camp_trips__reprice in the SQL.
  const keepOrPick = (kind, place, pax, current) => { const v = airChoices(kind, place).find(x => x.label === current);
    return v && v.capacity != null && v.capacity >= (Number(pax) || 1) ? current : (pickAir(kind, place, pax).label || current); };
  // The camp settings + the catalog's vehicles, for the parsers (the import picks each trip's vehicle from /prices).
  const catCfg = () => TC.withCatalog(GTC || CC, catalog());
  // Morocco (Miguel, 16 Nov 2026): Fathoune charges per VEHICLE — Car / Minivan / Big Van — never per person.
  // The price is the /prices row «Dunes — Big Van» (picker surf / tours, cost_per_guest = the vehicle price).
  // vanRates = route → purpose / tour / label only. A run tapped by hand carries no head count (Miguel, 17 Nov 2026); runs
  // saved from «people per surf spot» (19 Nov 2026) carry the people in that van (pax).
  // A route's /prices rows: one («Dunes»), or several added up («Paradise + Souk» = the Paradise Valley van + the Souk van).
  function vanPresets(r) {
    if (!r) return null;
    const names = (r.catalogs || []).length ? r.catalogs : [r.catalog || r.route];
    if (!names[0] || (r.confirm && !r.catalog && !(r.catalogs || []).length)) return null;
    const P = catalog();
    const all = [...(P.surf || []), ...(P.tours || [])];
    const ps = names.map(n => all.find(p => String(p.name || '').toLowerCase() === String(n).toLowerCase()) || null);
    return ps.every(p => p && (p.vehicles || []).length) ? ps : null;
  }
  // Every van vehicle /prices has (the vehicle picked before the route: «Log runs»), smallest first.
  function vanLabels(keep) {
    const P = catalog(); const seen = new Map();
    [...(P.surf || []), ...(P.tours || [])].forEach(p => (p.vehicles || []).forEach(v => { const o = seen.get(v.label); if (!o || ((v.capacity || 0) > (o.capacity || 0))) seen.set(v.label, v); }));
    const ls = TC.byCapacity([...seen.values()]).map(v => v.label);
    return keep && !ls.includes(keep) ? ls.concat(keep) : ls;
  }
  function vanVehicles(r) {
    const ps = vanPresets(r); if (!ps) return [];
    return TC.byCapacity(ps[0].vehicles.map(v => {
      const each = ps.map(p => (p.vehicles || []).find(x => x.label === v.label));
      return { label: v.label, capacity: v.capacity, price: each.every(Boolean) ? each.reduce((a, x) => a + (Number(x.cost != null ? x.cost : x.price) || 0), 0) : null };
    }));
  }
  // Nothing picked yet: the middle-sized vehicle /prices has (Car · Minivan · Big Van → Minivan).
  function vanDefaultVehicle(r) {
    const ls = r ? vanVehicles(r).map(v => v.label) : vanLabels();
    return ls.length ? ls[Math.floor(ls.length / 2)] : '';
  }
  function vanPrice(r, vehicle) {
    if (!r) return { price: 0, confirm: true };
    const v = vanVehicles(r).find(x => x.label === vehicle);
    if (v && v.price != null) return { price: v.price, confirm: !!r.confirm };
    return { price: 0, confirm: true };
  }
  const runPrice = (r, vehicle) => IS_SL ? Number(r.price) || 0 : vanPrice(r, vehicle).price;
  const ppl = n => `${n} ${Number(n) === 1 ? 'person' : 'people'}`;
  // A van run's head count when somebody typed one (runs from 17 Nov 2026 have none): null = not counted.
  const runPax = t => (t.pax == null || t.pax === '' || !(Number(t.pax) > 0)) ? null : Number(t.pax);
  const airportCity = place => IS_SL ? 'Colombo' : (CC.airportCity[place] || CC.airportCity[CC.airportDefault]);

  // The driver's price of an airport trip: /prices route × vehicle (0 = no such row; the import says so, never a guess).
  function presetPrice(kind, vehicle, place) { return TC.costOf(airVehicles(kind, place), vehicle); }
  const contact = () => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes('transfers_contact'));
  // Who gets the tuk-tuk order: the «Tuk-tuk orders to» person, else the default tuk-tuk driver (Sampath).
  const tukContact = () => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes(TUKTUK_CONTACT)) || defaultDriver(RUN.drv);
  const driverById = id => TR.drivers.find(d => d.id === id);
  const defaultDriver = kind => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes(kind));
  const driversFor = kind => TR.drivers.filter(d => d.active !== false && ((d.kinds || []).includes(kind) || (kind === 'airport' && (d.kinds || []).includes('other'))));
  const ledgerById = id => (typeof S !== 'undefined' && S.ledger || []).find(e => e.id === id);
  const linkOf = entryId => TR.links.find(l => l.entry_id === entryId);
  // Morocco: a Transport · Bank Transfer line (typed by Floriane or brought by the SG statement) that pays
  // a driver and is not linked to trips yet. Shown in Reconcile → Payments as «To review» until it is
  // linked (camp_transport_link_set accepts any Transport expense). Sri Lanka: none (its payments are cash).
  function bankCandidates() {
    if (!BANK_PAID) return [];
    const known = new Set(TR.links.map(l => l.entry_id));
    return ((typeof S !== 'undefined' && S.ledger) || []).filter(e => e && e.type === 'expense' && e.category === 'Transport' && e.paymentMethod === 'Bank Transfer'
      && String(e.date || '') >= bankCheckFrom() && !known.has(e.id) && looksLikeDriverPayment(e))
      .map(e => ({ entry_id: e.id, location_id: e.locationId || null, driver_id: driverIn(e.description), entry_amount: Number(e.amountLocal || 0), trips_amount: 0, trips_count: 0,
        state: 'review', reason: 'no trips linked', linked_by: 'auto', pending: true }));
  }
  const bankCheckFrom = () => { const a = goLive(), b = CC.bankCheckFrom || ''; return b > a ? b : a; };
  const allLinks = () => BANK_PAID ? TR.links.concat(bankCandidates()) : TR.links;
  function driverIn(text) {
    const t = String(text || '').toLowerCase();
    const hits = TR.drivers.filter(d => d && d.active !== false && !((d.kinds || []).length === 1 && d.kinds[0] === 'contact') && [d.name, ...(d.aliases || [])].some(a => a && t.includes(String(a).toLowerCase())));
    return hits.length === 1 ? hits[0].id : null;
  }
  function waText(t) { return GT.whatsappText(t, GTC); }

  // ── Data ───────────────────────────────────────────────────────────────
  const client = () => (typeof getHubSupabaseClient === 'function') ? getHubSupabaseClient() : null;
  // A table that does not exist yet is a set-up job for Miguel; anything else (a dropped connection, a timeout) is a
  // load that failed: say so, offer Retry, and keep the real error visible in small print (audit UXC-09).
  const missingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));
  function loadErrorHtml(what, err, missing, retry) {
    if (missing) return `<div class="status-msg status-warn">${h(what)} is not set up yet — tell Miguel.<div class="hint">${h(err)}</div></div>`;
    return `<div class="status-msg status-warn">Couldn't load ${h(what)} — check the connection and try again. <button class="btn btn-s btn-sm" onclick="${retry}">Retry</button><div class="hint">${h(err)}</div></div>`;
  }
  function retry() { TR.error = ''; TR.errorMissing = false; TR.loading = null; render(); load(true).then(render); }
  async function load(force) {
    if (!enabled()) return;
    if (TR.loading && !force) return TR.loading;
    TR.loading = (async () => {
      const c = client(); const loc = await ensureHubLocationId().catch(() => '');
      if (!c || !loc) { TR.error = 'Not connected'; return; }
      if (!LOCAL) { try { await c.rpc('camp_transport_autolink', { p_location: loc }); } catch (_) { /* table not set up yet */ } }
      // PostgREST returns 1.000 rows at most: page through (10–25 tuk-tuk runs a day add up fast).
      const all = async (build) => {
        const out = [];
        for (let p = 0; p < 50; p++) {
          const { data, error } = await build().range(p * 1000, p * 1000 + 999);
          if (error) return { error };
          out.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return { data: out };
      };
      const [d, t, l] = await Promise.all([
        c.from('camp_drivers').select('*').eq('location_id', loc).order('name'),
        all(() => c.from('camp_trips').select('*').eq('location_id', loc).gte('trip_date', TRIPS_LOAD_FROM).order('trip_date').order('trip_time').order('id')),
        LOCAL ? Promise.resolve({ data: [] }) : all(() => c.from('camp_transport_payments').select('*').eq('location_id', loc).order('entry_id')),
      ]);
      const err = d.error || t.error || l.error;
      if (err) { TR.error = err.message || String(err); TR.errorMissing = missingTable(err); TR.loaded = false; return; }
      TR.drivers = d.data || []; TR.trips = t.data || []; TR.links = l.data || [];
      try { const { data: ss } = await c.auth.getSession(); TR.me = String((ss && ss.session && ss.session.user && ss.session.user.email) || '').toLowerCase(); } catch (_) { TR.me = ''; }
      TR.error = ''; TR.errorMissing = false; TR.loaded = true;
    })();
    try { await TR.loading; } finally { TR.loading = null; }
    try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {}
    if (typeof activePage !== 'undefined' && (activePage === 'transport' || activePage === 'week')) render();
    // Tours by product counts the runs done for each tour (paid or not): redraw it once the trips are in.
    try { if (typeof activePage !== 'undefined' && activePage === 'overview' && typeof renderOverview === 'function') renderOverview(); } catch (_) {}
  }
  // free_reason / added_by_local arrive with supabase/camp-trips-v2.sql. Until it is run, a save
  // that carries them is repeated without them (charge = 'free' is still stored) — never a lost edit.
  const NEW_COLS = ['free_reason', 'added_by_local', 'guest_notified_at', 'guest_confirmed_at', 'guest_told_snapshot'];
  const newColMissing = error => !!error && /free_reason|added_by_local|guest_notified_at|guest_confirmed_at|guest_told_snapshot/.test(String(error.message || '') + String(error.details || ''));
  const withoutNew = row => { const r = { ...row }; NEW_COLS.forEach(k => delete r[k]); return r; };
  // edited = fields typed by hand (the import keeps them); cleared = fields back on the /prices value (the import and
  // camp_trips_reprice may change them again).
  async function updateTrip(id, patch, edited, cleared) {
    const t = TR.trips.find(x => x.id === id); if (!t) return null;
    const row = { ...patch };
    const had = t.edited_fields || [];
    if ((edited && edited.length) || (cleared && cleared.length && had.some(f => cleared.includes(f)))) row.edited_fields = [...new Set([...had, ...(edited || [])])].filter(f => !(cleared || []).includes(f));
    let { data, error } = await client().from('camp_trips').update(row).eq('id', id).select();
    if (newColMissing(error)) {
      // Nothing else to save (e.g. «Guest told ✓» before the database update): keep it on this screen only.
      if (!Object.keys(withoutNew(row)).length) { const local = { ...t, ...row }; TR.trips = TR.trips.map(x => x.id === id ? local : x); return local; }
      ({ data, error } = await client().from('camp_trips').update(withoutNew(row)).eq('id', id).select());
    }
    if (error) { say("Couldn't save — " + (error.message || 'error'), 'err'); return null; }
    const fresh = (data && data[0]) || { ...t, ...row };
    TR.trips = TR.trips.map(x => x.id === id ? fresh : x);
    return fresh;
  }
  async function insertTrip(row) {
    const loc = await ensureHubLocationId();
    if (!IS_SL && !row.currency) row = { ...row, currency: CUR };   // the column defaults to LKR
    let { data, error } = await client().from('camp_trips').insert({ location_id: loc, ...row }).select();
    if (newColMissing(error)) ({ data, error } = await client().from('camp_trips').insert({ location_id: loc, ...withoutNew(row) }).select());
    // A van run has no head count (17 Nov 2026). Until supabase/transport-catalog-one-source.sql lets pax be empty, the
    // database default (1) is stored instead — the Overview then treats it like any other count.
    if (error && row.pax === null && /pax/.test(String(error.message || '') + String(error.details || ''))) { const r2 = { ...row }; delete r2.pax; ({ data, error } = await client().from('camp_trips').insert({ location_id: loc, ...withoutNew(r2) }).select()); }
    if (error) { say("Couldn't save — " + (error.message || 'error'), 'err'); return null; }
    const fresh = (data && data[0]) || { id: 'tmp' + Date.now(), location_id: loc, ...row };
    TR.trips.push(fresh);
    return fresh;
  }
  async function deleteTrip(id) {
    const { error } = await client().from('camp_trips').delete().eq('id', id);
    if (error) { say("Couldn't remove — " + (error.message || 'error'), 'err'); return false; }
    TR.trips = TR.trips.filter(x => x.id !== id);
    return true;
  }
  async function rpc(name, args) {
    const { data, error } = await client().rpc(name, args);
    if (error) { say(error.message || 'Error', 'err'); throw error; }
    return data;
  }

  // ── Modal (one shared overlay) ─────────────────────────────────────────
  function modal(title, sub, body, footer) {
    let ov = document.getElementById('trOv');
    if (!ov) {
      ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'trOv';
      ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<div class="modal tr-modal"><div class="mhdr"><div><div class="mhdr-title">${h(title)}</div>${sub ? `<div class="mhdr-sub">${sub}</div>` : ''}</div>
      <button class="mclose" onclick="TransportUI.closeModal()" title="Close">${ic('x')}</button></div>
      <div class="mbody">${body}</div>${footer ? `<div class="mfooter">${footer}</div>` : ''}</div>`;
    ov.classList.add('open');
    return ov;
  }
  function closeModal() { const ov = document.getElementById('trOv'); if (ov) ov.classList.remove('open'); }
  // The one import door is in Week (15 Nov 2026).
  function toImport() {
    TR.view = 'trips';
    if (typeof showPage === 'function') showPage('week');
    if (window.WeekUI && WeekUI.setMode) WeekUI.setMode('import');
  }
  // Open Transport → Trips on a week (Week's Sat–Fri start) and, when given, scroll to that day's card.
  // Used by Week (Overview transfers, Team messages, after the import): same week, same day.
  function setWeek(ws, day) {
    TR.week = ws || GT.weekStart(cToday()); TR.view = 'trips'; TR.filter = 'all'; TR.scrollDay = day && day !== 'week' ? day : '';
    if (typeof showPage === 'function' && (typeof activePage === 'undefined' || activePage !== 'transport')) showPage('transport'); else render();
  }
  const $ = id => document.getElementById(id);
  // Times are picked on the quarter hour only (19 Nov 2026, Miguel: «tipo 9, 9:15, 9:30, 9:45 e 10, só estes»): one
  // native select (on a phone a wheel that opens on the time already there), 00:00 … 23:45. A saved time that is not on a
  // quarter — a flight landing at 10:55 from Bookinglayer — stays in the list as it is, shown and saved unchanged.
  const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
  // clearable: a time that may be empty (a trip's flight / pick-up time, a run's time) keeps a «No time» choice.
  function timeSelect(id, value, attrs, clearable) {
    const v = /^\d\d:\d\d$/.test(String(value || '')) ? String(value) : '';
    const list = v && !QUARTERS.includes(v) ? QUARTERS.concat(v).sort() : QUARTERS;
    return `<select id="${id}" class="tr-time" ${attrs || ''}>${!v || clearable ? `<option value=""${v ? '' : ' selected'}>${clearable ? 'No time' : 'Time'}</option>` : ''}${list.map(q => `<option value="${q}"${q === v ? ' selected' : ''}>${q}</option>`).join('')}</select>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Page
  // ════════════════════════════════════════════════════════════════════════
  function renderTransportPage() {
    if (!enabled()) return;
    if (!TR.week) TR.week = GT.weekStart(cToday());
    if (!TR.loaded && !TR.error) { load().then(render); }
    render();
  }
  function render() {
    // The Week tab (camp-hub/week.js) shows the same import: hand the redraw to it, and keep one copy of the import inputs in the DOM.
    if (typeof activePage !== 'undefined' && activePage === 'week' && window.WeekUI) { WeekUI.render(); return; }
    const wk = $('weekRoot'); if (wk && wk.querySelector('.wk-import')) wk.innerHTML = '';
    const root = $('transportRoot'); if (!root) return;
    // One page head, no button row (16 Nov 2026 UX pass, Miguel: «van runs???? depois pay driver e depois add transfer???»):
    // what to add lives in the pill you are on, paying lives in «Owed to drivers», Drivers and Export month at the foot.
    const head = `<div class="section-head page-head"><div><div class="section-title">${LOCAL ? 'Drivers' : 'Transport'}</div><div class="section-sub tr-how">${h(LOCAL ? (CC.localDriversHow || '') : (CC.transportHow || ''))}</div></div></div>`;
    if (TR.error) { root.innerHTML = head + loadErrorHtml('Transport', TR.error, TR.errorMissing, 'TransportUI.retry()'); return; }
    if (!TR.loaded) { root.innerHTML = head + '<div class="loading">Loading trips…</div>'; return; }
    // One view (16 Nov 2026): Reconcile is gone — «Owed to drivers» opens Pay, two chips cover the rest.
    // Order on screen: what it is (the pills) → what needs doing (To do) → what is owed → the week, day by day.
    const ov = TR.view === 'overview' && !LOCAL;
    root.innerHTML = head + tabsHtml() + (ov ? '' : attentionStrip() + owedLine()) + `<div class="tr-tripview">${ov ? renderOverview() : renderTrips()}</div>` + footLinks();
    if (TR.scrollDay) { const el = $('trDay-' + TR.scrollDay); TR.scrollDay = ''; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }
  }

  // What is owed to each driver right now (every done, unpaid trip since go-live), in one card: the one way to pay.
  // Each driver is a button «Name · MAD 2,900 · Pay»: it opens Pay with everything owed to him already ticked (16 Nov 2026).
  // «Pay another driver» opens the same sheet for a driver with nothing owed yet (an airport transfer paid ahead).
  function owedLine() {
    const by = new Map();
    TR.trips.forEach(t => { if (reconcileStatus(t) !== 'owed') return; const k = t.driver_id || ''; by.set(k, (by.get(k) || 0) + Number(t.expected_price || 0)); });
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, sum]) => id
      ? `<button class="tr-owed-d" data-owed="${id}" onclick="TransportUI.payPick('${id}')" title="Pay ${h(driverById(id)?.name || '')}">${h(driverById(id)?.name || 'Driver')} <b class="num">${money(sum)}</b><span class="tr-owed-pay">${ic('euro')} Pay</span></button>`
      : `<span class="tr-owed-d tr-owed-nodrv" data-owed="">No driver <b class="num">${money(sum)}</b><span class="hint">pick the driver on the trips</span></span>`);
    return `<div class="tr-owed" id="trOwed"><span class="tr-owed-l">Owed to drivers</span>${parts.length ? parts.join('') : '<span class="tr-owed-d tr-owed-none">Nothing owed</span>'}
      <button class="btn-link tr-owed-other" id="trPayOther" onclick="TransportUI.openPay()">Pay another driver</button></div>`;
  }
  // The pills: what kind of trip (the camp's own words, CampConfig.transportTabs) and the Overview.
  function tabsHtml() {
    const special = SPECIAL_FILTERS.includes(TR.filter); const ov = TR.view === 'overview' && !LOCAL;
    const pill = (k, label) => `<button class="pill${!ov && !special && (TR.filter || 'all') === k ? ' active' : ''}" data-cat="${k}" onclick="TransportUI.setFilter('${k}')">${h(label)}</button>`;
    return `<div class="pills tr-cats tr-tabs" role="tablist">${pill('all', 'All')}${CATS.map(c => pill(c[0], c[1])).join('')}${ovPill(ov)}</div>`;
  }
  // Rarely needed, so at the foot of the page: who the drivers are (phones, the «Send transfers to» contact) and the month export.
  function footLinks() {
    if (LOCAL || (TR.error && !TR.loaded)) return '';
    return `<div class="tr-foot-links" data-foot-links><span class="tr-owed-l">More</span>
      <button class="btn btn-s btn-sm" data-drivers onclick="TransportUI.openDrivers()">${ic('users')} Drivers and contacts</button>
      <button class="btn btn-s btn-sm" data-export-month onclick="TransportUI.openExport()">${ic('download')} Export month</button></div>`;
  }
  // Chip «N without time» and its filter share one rule: an airport transfer still to come with no flight time
  // (held trips have their own chip «not in the latest Bookinglayer file»). Moved from Week → To check, 15 Nov 2026.
  const noTimeTrip = t => isAirport(t) && !t.trip_time && counts(t) && !t.missing_since && !isDone(t);
  const SPECIAL_FILTERS = ['resend', 'tosend', 'missing', 'notime', 'noinfo', 'paidnotdone', 'blcheck', 'onhold'];
  // «N missing info» (16 Nov 2026 UX pass): an airport transfer still to come that the driver cannot do as it is —
  // the same rule as the red row (missingInfo: flight, time / pick-up time, phone, vehicle). It holds «without time».
  const noInfoTrip = t => isAirport(t) && counts(t) && !t.missing_since && !isDone(t) && !t.payment_entry_id && missingInfo(t).length > 0;
  const FILTER_TEXT = { resend: 'changed — resend', tosend: 'to send (next 48 h)', missing: 'not in the latest Bookinglayer file', notime: 'without time',
    noinfo: 'missing info', paidnotdone: 'paid, not done', blcheck: 'to check in Bookinglayer', onhold: 'on hold — did the driver go?' };
  const onHoldTrips = () => TR.trips.filter(t => reconcileStatus(t) === 'on_hold');
  const paidNotDone = () => TR.trips.filter(t => reconcileStatus(t) === 'paid_not_done');
  const toCheck = () => LOCAL ? [] : allLinks().filter(l => l.state === 'review');
  function attentionStrip() {
    const now = colomboNow(); const in48 = addHours(now, 48);
    const resend = TR.trips.filter(t => isAirport(t) && t.needs_resend && t.status !== 'done').length;
    const toSend = TR.trips.filter(t => isAirport(t) && t.status === 'planned' && `${t.trip_date}T${t.trip_time || '23:59'}` >= now && `${t.trip_date}T${t.trip_time || '00:00'}` <= in48).length;
    const missing = TR.trips.filter(t => t.missing_since && !['cancelled', 'done', 'no_show'].includes(t.status) && !isDone(t)).length;
    const review = toCheck().length;
    const pnd = paidNotDone().length;
    const noinfo = TR.trips.filter(noInfoTrip).length;
    const chips = [];
    // Runs not sent yet (or changed since) for today and tomorrow: one chip per day, it opens where they are sent.
    [cToday(), GT.addDaysIso(cToday(), 1)].forEach(d => {
      const ids = [...new Set(TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === d).map(t => t.driver_id || ''))];
      const P = ids.flatMap(id => pendingOf(d, id)); if (!P.length) return;
      const chg = P.some(x => x.key === 'changed');
      const n = P.reduce((a, x) => a + (x.key === 'changed' ? x.fresh.length + x.chg.length + x.tomb.length : x.members.length), 0);
      chips.push(`<button class="health-chip" data-chip="order" data-day="${d}" onclick="TransportUI.openPlan('${d}')">${chg ? `${RUN.plural} for ${dayWord(d)} changed — send the update` : `${n} ${RUN.lower} run${n === 1 ? '' : 's'} for ${dayWord(d)} — send the order`}</button>`);
    });
    if (review) chips.push(`<button class="health-chip" data-chip="check" onclick="TransportUI.openChecks()">${review} payment${review === 1 ? '' : 's'} to check</button>`);
    if (pnd) chips.push(`<button class="health-chip" data-chip="paidnotdone" onclick="TransportUI.setView('trips','paidnotdone')">${pnd} paid, not done</button>`);
    const strip = () => chips.length ? `<div class="health-strip tr-strip"><span class="health-lbl">To do</span>${chips.join('')}</div>` : '';
    if (LOCAL) return strip();   // the airport chips are Francisco's
    const bl = blList().length;
    if (bl) chips.push(`<button class="health-chip" data-chip="blcheck" onclick="TransportUI.setView('trips','blcheck')">${bl} transfer${bl === 1 ? '' : 's'} to check in Bookinglayer</button>`);
    if (resend) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','resend')">${resend} changed — resend</button>`);
    if (toSend) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','tosend')">${toSend} to send (next 48 h)</button>`);
    if (noinfo) chips.push(`<button class="health-chip" data-chip="noinfo" onclick="TransportUI.setView('trips','noinfo')">${noinfo} missing info</button>`);
    if (missing) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','missing')">${missing} not in the latest Bookinglayer file</button>`);
    return strip();
  }
  function addHours(stamp, n) {
    const d = stamp.slice(0, 10); let hh = Number(stamp.slice(11, 13)) + n; let day = d;
    while (hh >= 24) { hh -= 24; day = GT.addDaysIso(day, 1); }
    return `${day}T${String(hh).padStart(2, '0')}${stamp.slice(13, 16)}`;
  }

  // ── Trips view: the week as one sheet (Miguel, 16 Nov 2026: «a lista dos transferes… adicionar e ver
  // por dia quase como se fosse um excel… dividido tipo tuk tuks e aeroporto no Sri e em Marrocos surf
  // vans, tours e aeroporto»). Sat–Fri, every day shown (an empty day has its own «+ Add»), one row per
  // transfer or run with the columns Time | What | People | Driver | Price | Status, and one footer line
  // per category with Paid / Owed / Planned. Identical runs are one row «× N» that opens on tap.
  // Categories: Sri Lanka Airport · Tuk-tuks; Morocco Airport · Surf vans (every van run that is not a
  // tour: surf spot, Imsouane, party…) · Tours (van runs with purpose 'tour').
  const TABS = CC.transportTabs || (IS_SL ? [{ key: 'airport', label: 'Airport' }, { key: 'tuktuk', label: 'Tuk-tuks', add: 'Add tuk-tuk runs', sheet: 'Tuk-tuk runs' }]
    : [{ key: 'airport', label: 'Airport' }, { key: 'vans', label: 'Surf vans', add: 'Add surf vans', sheet: 'Surf vans' }, { key: 'tours', label: 'Tours', add: 'Add tour vans', sheet: 'Tour vans' }]);
  const CATS = TABS.map(x => [x.key, x.label]);
  const tabOf = k => TABS.find(x => x.key === k) || null;
  const catOf = t => isAirport(t) ? 'airport' : IS_SL ? 'tuktuk' : (t.purpose === 'tour' ? 'tours' : 'vans');
  const catLabel = k => (CATS.find(c => c[0] === k) || [k, k])[1];
  // A pill → the trips it shows. 'tuktuk' on Morocco (older links) = every van run.
  const inCat = (t, f) => f === 'all' || !f ? true : f === 'airport' ? isAirport(t) : f === 'tuktuk' ? !isAirport(t) : catOf(t) === f;
  const runNoun = t => IS_SL ? 'tuk-tuk run' : (t && t.purpose === 'tour' ? 'tour van' : 'surf van');
  TR.openGroups = TR.openGroups || new Set();
  TR.openOff = TR.openOff || new Set();
  function weekDays(ws) { return Array.from({ length: 7 }, (_, i) => GT.addDaysIso(ws, i)); }
  function renderTrips() {
    const ws = TR.week, we = GT.addDaysIso(ws, 6);
    const f = TR.filter;
    let list = TR.trips.filter(t => inWeek(t, ws));
    const special = SPECIAL_FILTERS.includes(f);
    const count = special || LOCAL || (f && f !== 'all' && f !== 'airport') ? '' : weekCountHtml(list, ws);
    if (special) list = f === 'paidnotdone' ? paidNotDone() : f === 'blcheck' ? blList() : f === 'onhold' ? onHoldTrips() : TR.trips.filter(t => t.trip_date >= cToday() || f === 'resend');
    if (f === 'resend') list = list.filter(t => isAirport(t) && t.needs_resend);
    else if (f === 'tosend') list = list.filter(t => isAirport(t) && t.status === 'planned');
    else if (f === 'missing') list = list.filter(t => t.missing_since && !['cancelled', 'no_show'].includes(t.status));
    else if (f === 'notime') list = list.filter(noTimeTrip);
    else if (f === 'noinfo') list = list.filter(noInfoTrip);
    else if (!special) list = list.filter(t => inCat(t, f));
    // The week bar: the week, then the one blue button of the pill — Airport / All: send the week to the driver
    // contact; a runs pill: add today's runs (+ «Plan the day»: Sri Lanka today, Morocco tomorrow). Nadith: add and plan runs.
    const tab = tabOf(f);
    const runTab = tab && tab.key !== 'airport' ? tab : (LOCAL && (f === 'all' || !f) ? TABS.find(x => x.key !== 'airport') : null);
    const acts = special ? '' : runTab
      ? `<button class="btn btn-p" data-add-runs="${runTab.key}" onclick="TransportUI.addOn('${cToday()}','${runTab.key}')">${ic('plus')} ${h(runTab.add || 'Add runs')}</button>
         <button class="btn btn-s" data-plan onclick="TransportUI.planOn('${runTab.key}')">${ic('calendar')} Plan the day</button>`
      : LOCAL ? '' : weekSendBtn(ws, true);
    const filters = special
      ? `<div class="tr-showing" data-showing="${f}"><span>Showing only: <b>${h(FILTER_TEXT[f] || f)}</b> · ${list.length} trip${list.length === 1 ? '' : 's'}</span>
          <button class="btn btn-s btn-sm" data-show-all onclick="TransportUI.setFilter('all')">${ic('x')} Show the week</button></div>`
      : `<div class="ov-filters tr-filters">
      <div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous week" onclick="TransportUI.shiftWeek(-7)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl tr-week">${fmtRange(ws, we)}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="TransportUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <div class="tr-weekacts">${acts}</div></div>`;
    // Special chips (resend, to send…) list only the days that have something; the week shows all seven.
    // The closing Saturday's departures belong to this week (inWeek): that day is added after Friday.
    const days = special ? [...new Set(list.map(t => t.trip_date))].sort() : [...new Set([...weekDays(ws), ...list.map(t => t.trip_date)])].sort();
    const empty = !special && !list.length && !TR.trips.some(t => inWeek(t, ws))
      ? `<div class="hint tr-sheet-empty">No trips this week yet. Airport transfers come from Bookinglayer's camp report every hour; add runs with «+ Add» on the day.${LOCAL ? '' : ` <button class="btn-link" onclick="TransportUI.toImport()">Import report by hand in Week</button>`}</div>` : '';
    const cols = `<div class="tr-srow tr-scols" aria-hidden="true"><span>Time</span><span>What</span><span>People</span><span>Driver</span><span class="tr-c-r">Price</span><span>Status</span></div>`;
    const c = contact();
    TR.runGroups = {};
    const showAir = special || f === 'all' || f === 'airport' || !f;
    const body = days.map(day => {
      const dayTrips = list.filter(t => t.trip_date === day).sort((a, b) => (a.trip_time || '99').localeCompare(b.trip_time || '99'));
      const air = dayTrips.filter(t => isAirport(t) && !['cancelled', 'no_show', 'merged'].includes(t.status));
      // Cancelled and merged transfers sit behind «Show N cancelled» (17 Nov 2026: next to the live rows they read as
      // repeated transfers). A no-show, or a cancelled trip with a payment linked, stays in view.
      // kept in view: a payment linked, a driver who still has it («changed, resend»), and every chip view (resend, to send…)
      const hidden = t => !special && ['cancelled', 'merged'].includes(t.status) && !t.payment_entry_id && !t.needs_resend;
      const airOffAll = dayTrips.filter(t => isAirport(t) && ['cancelled', 'no_show', 'merged'].includes(t.status));
      const offHidden = airOffAll.filter(hidden); const offOpen = TR.openOff.has(day);
      const airOff = airOffAll.filter(t => !hidden(t) || offOpen);
      // A run removed after its order went out stays as «cancelled» for the UPDATE message: not a run, not shown.
      const runs = dayTrips.filter(t => !isAirport(t) && !(runOff(t) && !t.payment_entry_id));
      const sum = dayTrips.filter(counts).reduce((s, t) => s + Number(t.expected_price || 0), 0);
      const parts = [];
      if (air.length) parts.push(`${air.length} transfer${air.length === 1 ? '' : 's'}`);
      if (runs.length) parts.push(`${runs.length} ${IS_SL ? 'tuk-tuk run' : 'run'}${runs.length === 1 ? '' : 's'}`);
      if (sum) parts.push(money(sum));
      const blN = dayTrips.filter(blToCheck).length;   // shown, never blocking «Send the whole day»
      if (blN) parts.push(`<span class="tr-amber" data-day-bl="${blN}">${blN} to check in Bookinglayer</span>`);
      const sendable = LOCAL || !showAir ? [] : GT.transfersTrips(dayScoped(day), { day, now: colomboNow() });   // = what «Send the whole day» sends (the card's own trips)
      const aSt = showAir && !special ? airState(day, ws) : null;
      const updBtn = aSt && aSt.key === 'changed';
      const dayBtns = !LOCAL && showAir && (sendable.length >= 1 || updBtn || air.filter(guestCan).length > 1) ? `<div class="row tr-day-btns">${updBtn
            ? `<button class="btn btn-s btn-sm" data-send-update="${day}" onclick="TransportUI.sendDayUpdate('${day}')" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with only what changed since it was sent">${ic('send')} Send the update</button>
            ${sendable.length >= 1 ? `<button class="btn btn-s btn-sm" onclick="TransportUI.sendDay('${day}')" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the day">${ic('send')} Send the whole day</button>` : ''}
            <button class="btn btn-s btn-sm" data-tick-day onclick="TransportUI.tickDay('${day}')">${ic('check')} Mark all sent ✓</button>`
            : sendable.length >= 1 ? `<button class="btn btn-s btn-sm" onclick="TransportUI.sendDay('${day}')" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the day">${ic('send')} Send the whole day</button>
            <button class="btn btn-s btn-sm" data-tick-day onclick="TransportUI.tickDay('${day}')">${ic('check')} Mark all sent ✓</button>` : ''}
            ${air.filter(guestCan).length > 1 ? `<button class="btn btn-s btn-sm" data-guest-day onclick="TransportUI.openGuestDay('${day}')" title="One WhatsApp per guest: the driver waits with a sign with their name">${ic('users')} Confirm with all guests of the day</button>` : ''}</div>` : '';
      const canAdd = !special && !(LOCAL && f === 'airport');
      // On the Airport pill the only trip added by hand is a free one (guests' transfers come from Bookinglayer): say so.
      const add = canAdd ? `<button class="btn-link tr-add" data-add="${day}" onclick="TransportUI.addOn('${day}')">${ic('plus')} ${f === 'airport' ? 'Free transfer' : 'Add'}</button>` : '';
      const offBtn = offHidden.length ? `<div class="tr-offtoggle"><button class="btn-link tr-show-off" data-show-off="${day}" data-n="${offHidden.length}" onclick="TransportUI.toggleOff('${day}')">${offOpen ? `Hide cancelled` : `Show ${offHidden.length} cancelled`}</button></div>` : '';
      const rows = air.map(tripRow).join('') + airOff.map(tripRow).join('') + offBtn + (runs.length ? runRows(runs, day) : '');
      const states = special ? '' : dayStateHtml(day, f, aSt);
      return `<div class="card tr-day${rows || states ? '' : ' tr-day-empty'}" id="trDay-${day}" data-day="${day}"><div class="card-hdr tr-dayhead"><div class="tr-dayttl"><div class="card-title">${fmtDay(day)}</div>
          <div class="card-hint">${rows ? parts.join(' · ') : 'Nothing on this day'}</div>${states}</div><div class="tr-dayact">${add}</div>${dayBtns}</div>
        ${rows ? `<div class="tr-rows">${rows}</div>` : ''}</div>`;
    }).join('');
    return filters + count + empty + `<div class="tr-sheet">${cols}${body}</div>` + catFooter(list, f, special);
  }
  // ── The day header: where the plan stands (17 Nov 2026) ────────────────────────────────────────────────────
  // Runs pills (Tuk-tuks · Surf vans · Tours; Nadith's «Drivers»): planState → «Not planned» / «Planned · not sent» /
  // «Sent 07:12 ✓ to Sampath» / «Changed after sending — send again» / «Logged ✓ · N runs», and one action: Plan, Send,
  // Send the update, Log runs. Airport (and All): airState → «Not sent» / «Sent 18:30 ✓ to Dilan» / «Changed after
  // sending — send again · N». Nadith sees the airport state without a button (Francisco sends those).
  const runsPill = f => f === 'tuktuk' || f === 'vans' || f === 'tours' || (LOCAL && (f === 'all' || !f));
  function dayStateHtml(day, f, aSt) {
    const out = [];
    if (runsPill(f)) {
      const st = planState(day); const past = day < cToday(); const cat = f === 'all' || !f ? (TABS.find(x => x.key !== 'airport') || {}).key : f;
      // The plan sheet on today / later; a past day opens «Log runs». Sri Lanka marks and sends from the run sheet.
      const open = past || SESSIONS ? `TransportUI.addOn('${day}','${cat}')` : `TransportUI.planOn('${cat}','${day}')`;
      const toLog = !SESSIONS && day <= cToday() && st.live.some(t => isDone(t) || day < cToday());
      const badge = (x, label) => `<button class="badge ${PLAN_CLS[x.key]} tr-dstate-b" data-plan-state="${x.key}"${x.batch && SESSIONS ? ` data-batch="${x.batch}"` : ''} onclick="${open}" title="${past ? 'Log runs' : 'Open the runs of the day'}">${h(label)}</button>`;
      if (SESSIONS) {
        // Sri Lanka: one badge per lesson session that has runs (Morning · Sent 07:12 ✓ to Sampath), today and later.
        const B = past ? [] : st.batches.filter(x => x.key !== 'none');
        if (B.length || day <= GT.addDaysIso(cToday(), 1) && !past) out.push(`<span class="tr-dstate" data-plan-state="${st.key}">${B.length ? B.map(x => badge(x, `${batchName(x)} · ${planBadgeText(x)}`)).join('') : badge(st, 'Not planned')}${
          st.batches.some(x => x.key === 'planned' || x.key === 'changed') && !past ? `<button class="btn-link" data-send-day="${day}" onclick="TransportUI.sendRunsDay('${day}')">${ic('send')} ${st.batches.some(x => x.key === 'changed') ? 'Send the update' : 'Send'}</button>`
          : ''}</span>`);   // nothing to send: the badge and the day's «+ Add» open the sheet (no second «add» link)
      } else if (st.key !== 'none' || (!past && day <= GT.addDaysIso(cToday(), 1))) {
        const act = toLog ? `<button class="btn-link" data-log-day="${day}" onclick="TransportUI.logDay('${day}','${cat}')">${ic('check')} Log runs</button>`
          : st.key === 'planned' ? `<button class="btn-link" data-plan-day="${day}" onclick="${open}">${ic('send')} Send</button>`
          : st.key === 'changed' ? `<button class="btn-link" data-plan-day="${day}" onclick="${open}">${ic('send')} Send the update</button>` : '';
        out.push(`<span class="tr-dstate" data-plan-state="${st.key}">${badge(st, planBadgeText(st))}${act}</span>`);
      }
    }
    if (aSt) out.push(`<span class="tr-dstate" data-air-state="${aSt.key}" data-n="${aSt.n}"><span class="badge ${AIR_CLS[aSt.key]}">${h(airBadgeText(aSt))}</span></span>`);
    return out.length ? `<div class="tr-dstates">${out.join('')}</div>` : '';
  }
  // The day header's «Send» (Sri Lanka): every driver with a batch to send that day, one WhatsApp each.
  async function sendRunsDay(day) {
    const ids = [...new Set(TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day).map(t => t.driver_id || ''))];
    let any = false; for (const id of ids) if (pendingOf(day, id).length) any = (await sendBatches(day, id)) || any;
    if (any) render();
  }
  // «Log runs» on a day header: the run sheet on that day, with the plan in it and «All went as planned».
  function logDay(day, cat) { openRunsOn(day, cat); if (TR.tuk.mode !== 'log') { TR.tuk.date = day; TR.tuk.mode = 'log'; renderTuktuk(); } }
  // Airport transfers of a day still to come, against what the transport contact was sent (sent_at / needs_resend /
  // sent_snapshot, the same columns «Mark all sent ✓» and the status select write).
  // ws: only the trips of that week (the closing Saturday's card shows its departures, not next week's arrivals).
  function airState(day, ws) {
    const now = colomboNow();
    const inW = t => !ws || inWeek(t, ws);
    const live = GT.transfersTrips(TR.trips, { day, now }).filter(inW);
    const U0 = GT.transfersUpdateTrips(TR.trips, { day, now });
    const U = { fresh: U0.fresh.filter(inW), changed: U0.changed.filter(inW), gone: U0.gone.filter(inW) }; U.n = U.fresh.length + U.changed.length + U.gone.length;
    if (!live.length && !U.gone.length) return null;
    const sent = live.filter(t => ['sent', 'confirmed'].includes(t.status));
    const stamps = sent.concat(U.gone).map(t => t.sent_at).filter(Boolean).sort();
    if (!sent.length && !U.gone.length) return { key: 'notsent', n: live.length, sentAt: '' };
    return { key: U.n ? 'changed' : 'sent', n: U.n, sentAt: stamps.pop() || '' };
  }
  const AIR_CLS = { notsent: 'badge-grey', sent: 'badge-green', changed: 'badge-amber' };
  function airBadgeText(a) {
    const c = contact();
    if (a.key === 'notsent') return 'Not sent';
    if (a.key === 'sent') return `Sent${a.sentAt ? ' ' + sentWhen(a.sentAt) : ''} ✓${c ? ` to ${c.name}` : ''}`;
    return `Changed after sending — send again · ${a.n}`;
  }
  // «Week sent 16 Nov 19:00 · 2 changed since»: the latest sent_at of the week's transfers (no separate week stamp is
  // stored) and the transfers an UPDATE would carry.
  function weekSentState(ws) {
    // The week's own trips (tripInWeek: Sat–Fri + the closing Saturday's departures, never next week's arrivals), as
    // «Send the whole week» and «Mark all sent ✓» see them. A day with something sent counts its new / changed /
    // cancelled transfers as «changed since»; a day with nothing sent yet counts as «not sent». No week stamp is stored:
    // the time shown is the latest sent_at of the week's transfers.
    const now = colomboNow();
    const live = GT.transfersTrips(TR.trips, { day: 'week', ws, now });
    const U = GT.transfersUpdateTrips(TR.trips, { day: 'week', ws, now });
    const sent = live.filter(t => ['sent', 'confirmed'].includes(t.status)).concat(U.gone);
    if (!sent.length) return live.length ? { key: 'notsent', n: 0, notsent: live.length, sentAt: '' } : null;
    const sentDays = new Set(sent.map(t => t.trip_date));
    const notsent = U.fresh.filter(t => !sentDays.has(t.trip_date)).length;
    const n = U.n - notsent;
    const stamp = sent.map(t => t.sent_at).filter(Boolean).sort().pop() || '';
    return { key: n ? 'changed' : 'sent', n, notsent, sentAt: stamp };
  }
  function weekSentSpan(ws) {
    const w = weekSentState(ws); if (!w) return '';
    const txt = w.key === 'notsent' ? 'Week not sent yet' : `Week sent${w.sentAt ? ' ' + stampText(w.sentAt) : ''}${w.n ? ` · ${w.n} changed since` : ' ✓'}${w.notsent ? ` · ${w.notsent} not sent` : ''}`;
    return `<span class="tr-weeksent${w.key === 'changed' ? ' tr-amber' : ''}" data-week-sent="${w.key}" data-n="${w.n}" data-notsent="${w.notsent}">${h(txt)}</span>`;
  }
  function weekSentHtml(ws) {
    const w = weekSentState(ws); if (!w) return '';
    const txt = w.key === 'notsent' ? 'Week not sent yet' : `Week sent${w.sentAt ? ' ' + stampText(w.sentAt) : ''}${w.n ? ` · ${w.n} changed since` : ' ✓'}${w.notsent ? ` · ${w.notsent} not sent` : ''}`;
    return `<div class="hint tr-weeksent${w.key === 'changed' ? ' tr-amber' : ''}" data-week-sent="${w.key}" data-n="${w.n}" data-notsent="${w.notsent}">${h(txt)}</div>`;
  }
  // One compact line per category for the week: Paid / Owed / Planned (cancelled and no-show never count).
  function catFooter(list, f, special) {
    const shown = special ? [] : CATS.filter(c => f === 'all' || !f || f === c[0] || (f === 'tuktuk' && c[0] !== 'airport'));
    if (!shown.length) return '';
    const line = ([k, label]) => {
      const xs = list.filter(t => counts(t) && catOf(t) === k);
      const g = { paid: 0, owed: 0, hold: 0, planned: 0, old: 0, sum: 0 };
      xs.forEach(t => { const amt = Number(t.expected_price || 0); const key = payState(t).key; g.sum += amt; if (key in g) g[key] += amt; });
      const n = k === 'airport' ? `${xs.length} transfer${xs.length === 1 ? '' : 's'}` : `${xs.length} run${xs.length === 1 ? '' : 's'}`;
      return `<div class="tr-foot-line" data-foot="${k}"><b>${h(label)}</b><span>${n} · ${money(g.sum)}</span><span class="tr-foot-split"><span class="tr-t-paid">Paid ${money(g.paid)}</span> · <span class="${g.owed ? 'tr-t-owed' : ''}">Owed ${money(g.owed)}</span> · Planned ${money(g.planned)}${g.hold ? ` · <span class="tr-t-owed">On hold ${money(g.hold)}</span>` : ''}${g.old ? ` · Before go-live ${money(g.old)}` : ''}</span></div>`;
    };
    return `<div class="card tr-catfoot">${shown.map(line).join('')}</div>`;
  }
  // Week totals (Miguel, 13 Nov: «total transfers in price per week, tuk-tuks and airport, and the
  // gifts too»). Same trips as the list below; cancelled and no-show never count. Amounts are the
  // drivers' prices (expected_price); paid = linked to a ledger payment.
  function weekTotals(list) {
    const blank = () => ({ n: 0, sum: 0, paid: 0, owed: 0, planned: 0, old: 0, free: [] });
    const T = { air: blank(), tuk: blank() };
    list.filter(counts).forEach(t => {
      const g = isAirport(t) ? T.air : T.tuk; const amt = Number(t.expected_price || 0); const k = payState(t).key;
      g.n++; g.sum += amt; if (k in g) g[k] += amt;
      if (isFree(t)) g.free.push(t);
    });
    return T;
  }
  function freeLine(free) {
    if (!free.length) return '';
    const by = new Map();
    free.forEach(t => { const k = FREE_SHORT[t.free_reason] || 'Free'; const who = isAirport(t) ? String(t.guest_names || 'Guest').split(',')[0].trim().split(/\s+/)[0] : (t.route || 'run'); if (!by.has(k)) by.set(k, []); by.get(k).push(who); });
    const rank = k => { const i = Object.values(FREE_SHORT).indexOf(k); return i < 0 ? 9 : i; };
    return `Free: ${free.length} · ${money(free.reduce((s, t) => s + Number(t.expected_price || 0), 0))} (${[...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ')})`;
  }
  function weekTotalsHtml(list) {
    const T = weekTotals(list); const A = T.air, K = T.tuk;
    const split = g => {
      const parts = [`<span class="tr-t-paid">Paid ${money(g.paid)}</span>`, `<span class="${g.owed ? 'tr-t-owed' : ''}">Owed ${money(g.owed)}</span>`];
      if (g.planned) parts.push(`Planned ${money(g.planned)}`);
      if (g.old) parts.push(`Before go-live ${money(g.old)}`);
      return parts.join(' · ');
    };
    const tile = (id, label, g, extra) => `<div class="kpi" data-total="${id}"><div class="kpi-label">${label}</div><div class="kpi-value">${money(g.sum)}</div><div class="kpi-sub">${split(g)}</div>${extra ? `<div class="kpi-sub tr-t-free">${h(extra)}</div>` : ''}</div>`;
    const all = { sum: A.sum + K.sum, paid: A.paid + K.paid, owed: A.owed + K.owed, planned: A.planned + K.planned, old: A.old + K.old };
    return `<div class="summary-grid tr-totals">${tile('airport', `Airport · ${A.n} transfer${A.n === 1 ? '' : 's'}`, A, freeLine(A.free))}${tile('tuktuk', `${RUN.label} · ${K.n} run${K.n === 1 ? '' : 's'}`, K, freeLine(K.free))}${tile('week', 'Week total', all, '')}</div>`;
  }
  // «Transfers booked» of the old Week tab, as one line (15 Nov 2026): arrivals and departures of the week, with
  // the persons — the same trips as the Airport tile (cancelled and no-show out), the Airport pill lists them.
  function weekCount(list) {
    const air = list.filter(t => counts(t) && isAirport(t));
    const side = k => { const xs = air.filter(t => t.kind === k); return { n: xs.length, pax: xs.reduce((s, t) => s + (Number(t.pax) || 1), 0) }; };
    return { arr: side('airport_arrival'), dep: side('airport_departure') };
  }
  // One line for the week (QA 17 Nov 2026: the count and the sent state merged): arrivals | departures | where the week
  // stands with the driver contact · «Mark all sent ✓».
  function weekCountHtml(list, ws) {
    const C = weekCount(list); const sent = weekSentSpan(ws); if (!C.arr.n && !C.dep.n && !sent) return '';
    const p = n => `${n} ${n === 1 ? 'person' : 'persons'}`;
    const todo = weekTickIds(ws).length;
    return `<div class="hint tr-count" data-week-count><span>Arrivals ${C.arr.n} · ${p(C.arr.pax)}</span><span class="tr-count-sep">|</span><span>Departures ${C.dep.n} · ${p(C.dep.pax)}</span>${sent ? `<span class="tr-count-sep">|</span>${sent}` : ''}${todo
      ? `<span class="tr-count-tick">${todo} not marked sent · <button class="btn-link" data-week-tick onclick="TransportUI.tickWeek()">Mark all sent ✓</button></span>` : ''}</div>`;
  }
  // «Send the whole week»: the whole-week message that Week → Transfers sent (GT.transfersText, day 'week'), byte for byte.
  const weekTrips = ws => GT.transfersTrips(TR.trips, { day: 'week', ws, now: colomboNow() });
  const weekTickIds = ws => weekTrips(ws).filter(t => !t.payment_entry_id && !isDone(t) && (t.status === 'planned' || t.needs_resend)).map(t => t.id)
    .concat(GT.transfersUpdateTrips(TR.trips, { day: 'week', ws, now: colomboNow() }).gone.map(t => t.id));
  function weekSendBtn(ws, primary) {
    const c = contact(); const w = weekSentState(ws);
    // The week was sent and changed since: the blue button sends only the changes.
    // The week was sent and changed since: the blue button sends only the changes; the whole week stays next to it.
    const upd = w && w.key === 'changed' ? `<button class="btn ${primary ? 'btn-p' : 'btn-s btn-sm'}" data-send-week-update onclick="TransportUI.sendWeekUpdate()" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with only what changed since the week was sent">${ic('send')} Send the week update</button>` : '';
    if (!weekTrips(ws).length) return upd;
    if (upd) return upd + `<button class="btn-link tr-week-all" data-send-week onclick="TransportUI.sendWeek()" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the week still to come">or the whole week</button>`;
    return `<button class="btn ${primary ? 'btn-p' : 'btn-s btn-sm'}" data-send-week onclick="TransportUI.sendWeek()" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the week still to come">${ic('send')} Send the whole week</button>`;
  }
  // One sheet row: Time | What | People | Driver | Price | Status. On a phone the row is two lines
  // (time · what · price, then people · driver · status — .tr-c-meta, hidden on a laptop).
  const pplCell = n => `${Number(n) || 1}`;
  // IN / OUT in two colours (Floriane, 16 Nov 2026): arrivals green, departures amber — the same tag as Week → Overview.
  const dirTag = t => t.kind === 'airport_departure' ? '<span class="badge tr-dir out" data-dir="out">Departure</span>' : '<span class="badge tr-dir in" data-dir="in">Arrival</span>';
  // The three steps of a transfer with the driver (camp_trips.status): planned → sent → confirmed.
  const STATUS_STEPS = [['planned', 'Pending'], ['sent', 'Message Sent'], ['confirmed', 'Confirmed']];
  const statusSelect = t => `<select class="select tr-status-sel" data-status-sel aria-label="Status with the driver" onclick="event.stopPropagation()" onchange="event.stopPropagation();TransportUI.setStep('${t.id}',this.value)">${STATUS_STEPS.map(([v, l]) => `<option value="${v}"${t.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  // What the driver needs and the trip does not have (Floriane, 16 Nov 2026: «missing information alert»), for a
  // transfer still to come. Arrival: flight, landing time, phone. Departure: the time the driver leaves the camp
  // (Morocco: pickup_time; Sri Lanka, whose message falls back on the flight time: either), phone. Both: a vehicle.
  function missingInfo(t) {
    if (!isAirport(t)) return [];
    const out = [];
    if (t.kind === 'airport_arrival') { if (!t.flight) out.push('flight'); if (!t.trip_time) out.push('time'); }
    else if (CC.depNeedsPickup ? !t.pickup_time : !(t.pickup_time || t.trip_time)) out.push(CC.depNeedsPickup ? 'pick-up time' : 'time');
    if (!t.guest_phone) out.push('phone');
    if (!t.vehicle) out.push('vehicle');
    return out;
  }
  const missText = miss => miss.map(m => 'no ' + m).join(' · ').replace(/^n/, 'N');   // «No flight · no time»
  // ── The checkpoints of one airport transfer, in one place (16 Nov 2026, Miguel: «ver a lista, poder ter check point
  // do que está certo»). One strip under the name, left to right:
  //   Booked     checked on the Bookinglayer booking page (bl_checked_at) — or amber «Check in Bookinglayer» with
  //              «Open booking» · «Booked ✓» · «Not booked» (was the amber line under the row)
  //   Info       what the driver needs (missingInfo: flight, time / pick-up time, phone, vehicle) — or red «No flight · …»
  //              with «Ask guest» when the flight or time is missing, and «Edit» to type it
  //   Driver     the status select Pending → Message Sent → Confirmed (Floriane, 16 Nov 2026), «Time changed, resend» + «Sent ✓»
  //   Guest      «Confirm with guest» → «Guest told ✓» → «Guest confirmed ✓» (only when the guest can be told)
  //   Paid       once the trip has happened: Paid / Owed / Cancelled / No-show (before, money is not the question)
  // Every step keeps the hooks and handlers it had as a separate line; ?view=local shows the same steps read-only.
  const stepTok = (key, state, html) => `<span class="tr-step-i is-${state}" data-step="${key}" data-state="${state}">${html}</span>`;
  const DRIVER_STEP = { planned: 'Pending', sent: 'Message Sent', confirmed: 'Confirmed' };
  function bookedStep(t, ro) {
    if (!blOn(t) || t.source !== 'bookinglayer') return '';
    // A cancelled (or merged) trip shows «Cancelled» only — never «Booked», even when the booking page was checked
    // (17 Nov 2026: Callum Downes / Lorena Marie Glas, cancelled after the 16 Nov check, read «✓ Booked · Cancelled»).
    if (['cancelled', 'merged'].includes(t.status)) return '';
    if (blToCheck(t)) {
      const ref = t.booking_ref || '';
      const open = ref && !ro ? `<a class="tr-bl-open" href="${h(blUrl(ref))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open booking</a>` : '';
      const btns = ro ? '' : `<button class="btn btn-s btn-sm" data-bl-booked onclick="event.stopPropagation();TransportUI.blBooked('${t.id}')" title="Both the date and the direction are on the booking page">Booked ✓</button>`
        + `<button class="btn btn-s btn-sm" data-bl-not onclick="event.stopPropagation();TransportUI.blNotBooked('${t.id}')" title="The booking page has no transfer on this date — cancel this trip">Not booked</button>`;
      return `<span class="tr-step-i is-todo tr-blline" data-step="booked" data-state="todo" data-blcheck><span class="tr-bl-t">${ic('alert')} Check in Bookinglayer</span>${ref ? `<span class="tr-bl-ref">${h(ref)}</span>` : ''}${open || btns ? `<span class="tr-bl-act">${open}${btns}</span>` : ''}</span>`;
    }
    // «Not booked in Bookinglayer: did the driver go?» still open: never «Booked ✓» (bl_checked_at is set by the check that raised it).
    if (blFlagged(t)) return stepTok('booked', 'todo', `${ic('alert')} Not booked?`);
    return t.bl_checked_at ? stepTok('booked', 'ok', `${ic('check')} Booked`) : '';
  }
  function stepsHtml(t, ro) {
    const live = !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show', 'merged'].includes(t.status);
    const out = [bookedStep(t, ro)];
    if (live) {
      const miss = missingInfo(t);
      if (miss.length) {
        out.push(`<span class="tr-step-i is-bad" data-step="info" data-state="bad"><span class="tr-missline" data-missline>${ic('alert')} ${h(missText(miss))}</span>${ro ? ''
          : `<button class="btn-link tr-step-edit" data-edit-info onclick="event.stopPropagation();TransportUI.openTrip('${t.id}')">Edit</button>`}</span>`);
        if (!ro && needsInfo(t)) out.push(`<span class="tr-resend tr-step-act"><button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.ask('${t.id}')">${ic('send')} Ask guest for ${!t.flight && !t.trip_time ? 'flight & time' : !t.flight ? 'flight' : 'time'}</button>${askedOn(t.id) ? ` <span class="hint">asked ${h(fmtDay(askedOn(t.id)))}</span>` : ''}</span>`);
      } else out.push(stepTok('info', 'ok', `${ic('check')} Info`));
      if (STATUS_STEPS.some(x => x[0] === t.status)) {
        const resend = t.needs_resend ? `<span class="badge badge-amber">Time changed, resend</span>${ro ? '' : `<button class="btn btn-s btn-sm" data-resent onclick="event.stopPropagation();TransportUI.tick('${t.id}','sent')" title="The new details are sent">Sent ✓</button>`}` : '';
        out.push(ro ? stepTok('driver', t.status === 'planned' ? 'todo' : 'ok', `${t.status === 'planned' ? '' : ic('check') + ' '}${DRIVER_STEP[t.status]}`) + (t.needs_resend ? '<span class="badge badge-amber">Time changed, resend</span>' : '')
          : `<span class="tr-step-i is-ctl tr-resend-wrap" data-step="driver" data-state="${t.status}">${statusSelect(t)}${resend}</span>`);
      }
      if (!ro && !needsInfo(t) && guestHtml(t)) out.push(`<span class="tr-step-g" data-step="guest">${guestHtml(t)}</span>`);
    } else {
      const ps = payState(t);
      const why = ['cancelled', 'merged'].includes(t.status) && t.cancel_reason ? ` title="${h(t.cancel_reason)}"` : '';
      out.push(`<span class="tr-step-i is-${ps.key === 'paid' ? 'ok' : ps.key === 'owed' || ps.key === 'hold' ? 'todo' : 'off'} tr-pay" data-step="paid" data-state="${ps.key}"${why}><span class="badge ${ps.cls}" data-pay="${ps.key}"${why}>${ps.label}</span>${ps.sub ? `<span class="cell-sub">${h(ps.sub)}</span>` : ''}</span>`);
    }
    return `<div class="tr-steps" data-steps>${out.filter(Boolean).join('')}</div>`;
  }
  // ── The camp report's questions on a trip (lib/bl-report.js, 17 Nov 2026) ─────────────────────────
  //   «Different times — coming together? …»  a guest at 0 € with another flight / time than the paid one:
  //                                            «Coming together» (the question goes, also on the next imports) or
  //                                            «Separate» (that guest gets a trip of their own, Camp Tab: the guest pays)
  //   «N transfers paid, same flight — confirm they come together»  «Confirmed»
  //   «Bookinglayer says: time 11:55 — use it?»  a value typed by hand that the report has differently: «Use it»
  const TOGETHER_RE = /^Different times — coming together\? If not, the guest at 0 € has to pay a transfer/;
  const PAID_TWICE_RE = /^\d+ transfers paid, same flight — confirm they come together$/;
  const BL_SAYS_RE = /^Bookinglayer says: (\w+) (.+) — use it\?$/;
  const SEP_FLAG = 'Separate from the paid transfer of this booking: the guest at 0 € has to pay a transfer';
  // What the guests paid vs /prices (lib/bl-report.js moneyCheck, 17 Nov 2026). Answered like «Coming together»:
  //   «OK — known»   the mark money_ok:<flag text> in edited_fields: that question never shows again — the next imports bring
  //                  the same text back (paid lines and prices unchanged) and it stays answered; a new count or price is a
  //                  new text, so a new question;
  //   «Charge guest» (underpaid / no transfer paid) money_charge:<flag text>: the guest pays the missing transfer(s) on the
  //                  Camp Tab, like «Separate» (a «no transfer paid» trip itself becomes charge Camp Tab, kept on re-import).
  //                  Nothing is written into the Camp Tab POS — the trip says what to charge.
  const UNDERPAID_RE = /^(\d+) people, (\d+) transfers? paid — one covers (\d+)$/;
  const NOPAID_RE = /^no transfer paid$/;
  const UNDERSOLD_RE = /^paid €[\d.,]+, \/prices €[\d.,]+ \(/;
  const isMoneyFlag = f => UNDERPAID_RE.test(f) || NOPAID_RE.test(f) || UNDERSOLD_RE.test(f);
  const moneyDone = (t, f) => edited(t, 'money_ok:' + f) || edited(t, 'money_charge:' + f);
  const openMoney = t => flagsOf(t).filter(f => isMoneyFlag(f) && !moneyDone(t, f));
  // The transfers the guest pays on the Camp Tab for a flag, and their € (the route's /prices guest price).
  function chargeOf(t, f) {
    const s2 = sellFor(t) || {}; const covers = s2.covers || Number(CC.transferCovers) || 3; const m = UNDERPAID_RE.exec(f);
    const n = m ? Math.max(1, Math.ceil(Number(m[1]) / Number(m[3] || covers)) - Number(m[2])) : Math.max(1, Math.ceil((Number(t.pax) || 1) / covers));
    return { n, eur: s2.eur > 0 ? n * s2.eur : null };
  }
  const SAYS_FIELD = { time: 'trip_time', flight: 'flight', date: 'trip_date', people: 'pax', airport: 'place', guests: 'guest_names', phone: 'guest_phone', vehicle: 'vehicle', price: 'expected_price' };
  const flagsOf = t => (t.import_flags || []).map(String);
  const edited = (t, k) => (t.edited_fields || []).includes(k);
  // «(Tsz Yin Scarlet Tang · LS1129 · 11:55; …)» → [{ name, flight, time }]
  function togetherGuests(flag) {
    const m = String(flag).match(/\(([^()]*)\)\s*$/); if (!m) return [];
    return m[1].split(/\s*;\s*/).filter(Boolean).map(x => { const p = x.split(/\s*·\s*/); return { name: p[0], flight: p.slice(1).find(v => !/^\d{2}:\d{2}$/.test(v)) || '', time: p.slice(1).find(v => /^\d{2}:\d{2}$/.test(v)) || '' }; });
  }
  function reportAsks(t) {
    if (LOCAL) return '';
    const F = flagsOf(t); const out = [];
    const tog = F.find(f => TOGETHER_RE.test(f));
    if (tog && !edited(t, 'together_ok') && !edited(t, 'together_split')) {
      const who = togetherGuests(tog).map(g => [g.name, g.flight, g.time].filter(Boolean).join(' ')).join(', ');
      out.push(`<div class="tr-flagline tr-together" data-together>${ic('alert')} Different times — coming together? If not, the guest at 0 € has to pay a transfer${who ? ` <span class="cell-sub">(${h(who)})</span>` : ''}</div>
        <div class="tr-went"><button class="btn btn-s btn-sm" data-together-yes onclick="event.stopPropagation();TransportUI.together('${t.id}', true)">${ic('check')} Coming together</button>
        <button class="btn btn-s btn-sm" data-together-sep onclick="event.stopPropagation();TransportUI.together('${t.id}', false)">Separate</button></div>`);
    }
    const two = F.find(f => PAID_TWICE_RE.test(f));
    if (two && !edited(t, 'paid_twice_ok')) out.push(`<div class="tr-flagline" data-paid-twice>${ic('alert')} ${h(two)}</div>
        <div class="tr-went"><button class="btn btn-s btn-sm" data-paid-twice-ok onclick="event.stopPropagation();TransportUI.paidTwiceOk('${t.id}')">${ic('check')} Confirmed</button></div>`);
    openMoney(t).forEach(f => {
      const i = F.indexOf(f); const canCharge = !UNDERSOLD_RE.test(f);
      out.push(`<div class="tr-flagline" data-money="${i}">${ic('alert')} ${h(f.charAt(0).toUpperCase() + f.slice(1))}</div>
        <div class="tr-went"><button class="btn btn-s btn-sm" data-money-ok="${i}" onclick="event.stopPropagation();TransportUI.moneyOk('${t.id}', ${i})">${ic('check')} OK — known</button>${canCharge ? `
        <button class="btn btn-s btn-sm" data-money-charge="${i}" onclick="event.stopPropagation();TransportUI.moneyCharge('${t.id}', ${i})">Charge guest</button>` : ''}</div>`);
    });
    (t.edited_fields || []).filter(k => String(k).startsWith('money_charge:')).forEach(k => {
      const c = chargeOf(t, String(k).slice(13));
      out.push(`<div class="tr-blsays cell-sub" data-money-charged>Camp Tab: the guest pays ${c.n} transfer${c.n === 1 ? '' : 's'}${c.eur ? ` (€${c.eur})` : ''}</div>`);
    });
    F.filter(f => BL_SAYS_RE.test(f)).forEach((f, i) => out.push(`<div class="tr-blsays cell-sub" data-blsays="${i}">${h(f.replace(/ — use it\?$/, ''))} — <button class="btn-link" data-blsays-use="${i}" onclick="event.stopPropagation();TransportUI.useBl('${t.id}', ${i})">use it?</button></div>`));
    return out.join('');
  }
  async function together(id, yes) {
    const t = TR.trips.find(x => x.id === id); if (!t || TR.busy.has('tg' + id)) return;
    const tog = flagsOf(t).find(f => TOGETHER_RE.test(f)); if (!tog) return;
    TR.busy.add('tg' + id);
    try {
      const rest = flagsOf(t).filter(f => f !== tog);
      if (yes) { if (await updateTrip(id, { import_flags: rest }, ['together_ok'])) { redrawAll(); say('Coming together — one trip'); } return; }
      const sep = togetherGuests(tog); if (!sep.length) { say('No guest named in the question — split it in the trip by hand', 'err'); return; }
      const names = String(t.guest_names || '').split(/\s*,\s*/).filter(Boolean);
      const key = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const out = new Set(sep.map(g => key(g.name)));
      const stay = names.filter(n => !out.has(key(n)));
      const pax = Math.max(1, (Number(t.pax) || names.length) - sep.length); const veh = keepOrPick(t.kind, t.place, pax, t.vehicle);
      const kPax = sep.length; const kVeh = pickAir(t.kind, t.place, kPax).label || t.vehicle;
      let ik = `${t.import_key || 'manual:' + t.id}:sep`; for (let n = 2; TR.trips.some(x => x.import_key === ik); n++) ik = `${t.import_key || 'manual:' + t.id}:sep${n}`;
      const row = { kind: t.kind, trip_date: t.trip_date, trip_time: sep[0].time || null, flight: (sep[0].flight || '').replace(/\s+/g, '') || null, place: t.place, route: t.route, purpose: 'guests',
        guest_names: sep.map(g => g.name).join(', '), guest_phone: null, booking_ref: t.booking_ref, booking_checkout: t.booking_checkout, pax: kPax, vehicle: kVeh, driver_id: t.driver_id,
        expected_price: presetPrice(t.kind, kVeh, t.place), status: 'planned', source: t.source || 'bookinglayer', charge: 'camp_tab', import_key: ik, import_flags: [SEP_FLAG],
        // checked and never written by an import: the import never regroups or flags it (camp-trips-bl-check.sql)
        bl_checked_at: new Date().toISOString(), bl_check_note: 'separated by hand from the paid transfer' };
      const made = await insertTrip(row); if (!made) return;
      // The price is the /prices price of the new vehicle: not «typed by hand» (camp_trips_reprice may follow /prices).
      if (await updateTrip(id, { guest_names: stay.join(', ') || t.guest_names, pax, vehicle: veh, expected_price: presetPrice(t.kind, veh, t.place), import_flags: rest }, ['pax', 'guest_names', 'vehicle', 'together_split'], ['expected_price'])) {
        redrawAll(); say(`Separate — ${row.guest_names} has a trip of their own (Camp Tab: the guest pays)`);
      }
    } finally { TR.busy.delete('tg' + id); }
  }
  async function moneyOk(id, i) {
    const t = TR.trips.find(x => x.id === id); const f = t && flagsOf(t)[i]; if (!f || !isMoneyFlag(f)) return;
    if (await updateTrip(id, {}, ['money_ok:' + f])) { redrawAll(); say('OK — known'); }
  }
  async function moneyCharge(id, i) {
    const t = TR.trips.find(x => x.id === id); const f = t && flagsOf(t)[i]; if (!f || !(UNDERPAID_RE.test(f) || NOPAID_RE.test(f))) return;
    const c = chargeOf(t, f);
    // no transfer paid at all: the trip itself is the guest's to pay (charge Camp Tab, as a «Separate» trip)
    const patch = NOPAID_RE.test(f) ? { charge: 'camp_tab' } : {};
    if (await updateTrip(id, patch, ['money_charge:' + f])) { redrawAll(); say(`Charge guest — ${c.n} transfer${c.n === 1 ? '' : 's'}${c.eur ? ` (€${c.eur})` : ''} on the Camp Tab`); }
  }
  async function paidTwiceOk(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (await updateTrip(id, { import_flags: flagsOf(t).filter(f => !PAID_TWICE_RE.test(f)) }, ['paid_twice_ok'])) { redrawAll(); say('Confirmed — they come together'); }
  }
  async function useBl(id, i) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const f = flagsOf(t).filter(x => BL_SAYS_RE.test(x))[i]; const m = f && BL_SAYS_RE.exec(f); if (!m) return;
    const field = SAYS_FIELD[m[1]] || m[1]; const v = ['pax', 'expected_price'].includes(field) ? Number(m[2]) : m[2];
    // the value is Bookinglayer's again: the next import may update it
    const patch = { [field]: v, import_flags: flagsOf(t).filter(x => x !== f), edited_fields: (t.edited_fields || []).filter(x => x !== field) };
    if (await updateTrip(id, patch)) { redrawAll(); say(`Updated from Bookinglayer: ${m[1]} ${m[2]}`); }
  }
  function toggleOff(day) { if (TR.openOff.has(day)) TR.openOff.delete(day); else TR.openOff.add(day); render(); }
  function tripRow(t) {
    const dep = t.kind === 'airport_departure';
    const time = t.trip_time ? `<b class="num">${h(t.trip_time)}</b>` : '<span class="badge badge-amber">time?</span>';
    const drv = h(driverById(t.driver_id)?.name || 'no driver');
    const line1 = `<div class="tr-line1">${dirTag(t)} <b>${h(t.guest_names || 'Guest')}</b>${isFree(t) ? ` <span class="badge badge-blue tr-free">${h(freeLabel(t))}</span>` : ''}</div>`;
    const meta = `<div class="tr-c-meta cell-sub">${ppl(t.pax)} · ${drv}</div>`;
    const sub = [h(t.flight || 'flight?'), h(t.vehicle || ''), t.charge && !isFree(t) ? h(CHARGE_LABEL[t.charge]) : '', t.added_by_local ? `added by ${LOCAL_MANAGER_NAME}` : ''].filter(Boolean).join(' · ');
    // ?view=local: airport rows are read-only — Francisco sends and confirms them; the same checkpoints, no buttons.
    if (LOCAL) return `<div class="tr-row tr-srow tr-row-ro" data-trip="${t.id}" data-cat="airport"><div class="tr-time tr-c-time">${time}</div>
      <div class="tr-main tr-c-what">${line1}<div class="cell-sub tr-c-sub">${sub}</div>${meta}${blFlagged(t) ? `<div class="tr-flagline" data-flag>${ic('alert')} ${h(rowFlag(t))}</div>` : ''}</div>
      <div class="tr-c-ppl num">${pplCell(t.pax)}</div><div class="tr-c-drv">${drv}</div><div class="tr-c-price num">${money(t.expected_price)}</div>
      <div class="tr-side tr-c-status"></div><div class="tr-c-steps">${stepsHtml(t, true)}</div></div>`;
    const live = !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show', 'merged'].includes(t.status);   // a merged trip is never sent or missing info
    const miss = live ? missingInfo(t) : [];
    return `<div class="tr-row tr-srow${miss.length ? ' tr-missing' : ''}${dep ? ' tr-out' : ' tr-in'}" data-trip="${t.id}" data-cat="airport"${miss.length ? ` data-missing="${h(miss.join('|'))}"` : ''} onclick="TransportUI.openTrip('${t.id}')">
      <div class="tr-time tr-c-time">${time}</div>
      <div class="tr-main tr-c-what">${line1}
        <div class="cell-sub tr-c-sub">${sub}</div>${meta}
        ${(live || blFlagged(t)) && rowFlag(t) ? `<div class="tr-flagline" data-flag>${ic('alert')} ${h(rowFlag(t))}</div>` : ''}
        ${live ? reportAsks(t) : ''}
        ${blFlagged(t) ? `<div class="tr-went" data-went-ask><button class="btn btn-s btn-sm" data-went onclick="event.stopPropagation();TransportUI.driverWent('${t.id}')">${ic('check')} Driver went (pay)</button>
          <button class="btn btn-s btn-sm" data-didnt onclick="event.stopPropagation();TransportUI.driverDidntGo('${t.id}')">${ic('x')} Didn't go (cancel)</button></div>` : ''}</div>
      <div class="tr-c-ppl num">${pplCell(t.pax)}</div><div class="tr-c-drv">${drv}</div><div class="tr-c-price num">${money(t.expected_price)}</div>
      <div class="tr-side tr-c-status"><div class="tr-btns">${live ? `<button class="btn btn-s btn-sm btn-icon" title="Send on WhatsApp" onclick="event.stopPropagation();TransportUI.send('${t.id}')">${ic('send')}</button>` : ''}<button class="btn btn-s btn-sm" data-edit="${t.id}" onclick="event.stopPropagation();TransportUI.openTrip('${t.id}')">${ic('edit')} Edit</button></div></div>
      <div class="tr-c-steps">${stepsHtml(t, false)}</div></div>`;
  }
  // Runs of a day: identical runs (route, driver, state; a planned run also by its time) are one row «× N».
  // Tap the row: one run → its edit sheet; several → the row opens to show each run (tap one to edit it),
  // the pencil edits them all at once.
  function runRows(runs, day) {
    const by = new Map();
    runs.forEach(t => {
      const ps = payState(t); const timed = ps.key === 'planned' && t.trip_time ? t.trip_time : '';
      const label = IS_SL ? (t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose) : runLabel(t);
      const veh = IS_SL ? '' : (t.vehicle || '');
      const k = [timed, label, veh, t.driver_id || '', ps.key, ps.label, ps.sub, isFree(t) ? freeLabel(t) : '', catOf(t)].join('|');
      const x = by.get(k) || { k, time: timed, label, veh, confirm: IS_SL ? flagsOf(t).some(f => /^no \/prices row for/.test(f)) : !!(vanRateOf(t) || {}).confirm, n: 0, sum: 0, pax: 0, driver: t.driver_id, ps, free: isFree(t) ? freeLabel(t) : '', cat: catOf(t), runs: [] };
      x.n++; x.pax += runPax(t) || 0; x.sum += Number(t.expected_price || 0); x.runs.push(t); by.set(k, x);
    });
    const order = { planned: 0, owed: 1, old: 2, paid: 3, off: 4 };
    const lines = [...by.values()].sort((a, b) => (order[a.ps.key] - order[b.ps.key]) || (a.time || '').localeCompare(b.time || '') || String(a.label).localeCompare(String(b.label)) || a.ps.label.localeCompare(b.ps.label));
    const pplTxt = n => IS_SL || !n ? '' : ppl(n);
    return lines.map((x, i) => {
      const key = `${day}#${i}`; TR.runGroups[key] = x.runs.map(t => t.id);
      const openKey = `${day}|${x.k}`; const open = x.n > 1 && TR.openGroups.has(openKey);
      const single = x.n === 1 ? x.runs[0] : null;
      const time = x.time ? `<b class="num">${h(x.time)}</b>` : single && single.trip_time ? `<span class="num hint">${h(single.trip_time)}</span>` : `<span class="tr-pin">${ic('map-pin')}</span>`;
      const drv = h(driverById(x.driver)?.name || 'no driver');
      const tap = x.n > 1 ? `TransportUI.toggleRuns('${h(openKey).replace(/'/g, '&#39;')}')` : `TransportUI.openRuns('${key}')`;
      const row = `<div class="tr-tuk-line tr-srow${open ? ' tr-open' : ''}" role="button" tabindex="0" data-run-group="${key}" data-cat="${x.cat}" data-n="${x.n}" onclick="${tap}">
        <div class="tr-c-time">${time}</div>
        <div class="tr-c-what tr-tuk-what"><span class="tr-what-l"><b>${h(x.label)}</b>${x.n > 1 ? ` <span class="tr-xn">× ${x.n}</span>` : ''}${x.free ? ` <span class="badge badge-blue tr-free">${h(x.free)}</span>` : ''}${x.confirm ? ' <span class="badge badge-amber tr-confirm">price to confirm</span>' : ''}${x.n > 1 ? ` <span class="tr-caret">${ic(open ? 'chevron-up' : 'chevron-down')}</span>` : ''}</span>
          <span class="tr-c-meta cell-sub">${[x.veh, pplTxt(x.pax), drv].filter(Boolean).join(' · ')}</span></div>
        <div class="tr-c-ppl num">${IS_SL || !x.pax ? '' : x.pax}</div><div class="tr-c-drv">${drv}${x.veh ? `<span class="cell-sub tr-veh">${h(x.veh)}</span>` : ''}</div><div class="tr-c-price num tr-tuk-amt">${money(x.sum)}</div>
        <div class="tr-c-status"><div class="tr-pay"><span class="badge ${x.ps.cls}" data-pay="${x.ps.key}">${x.ps.label}</span>${x.ps.sub ? `<span class="cell-sub">${h(x.ps.sub)}</span>` : ''}</div>
          ${x.n > 1 ? `<button class="btn btn-s btn-sm btn-icon tr-edit-all" data-run-edit="${key}" title="Edit these ${x.n} runs together" onclick="event.stopPropagation();TransportUI.openRuns('${key}')">${ic('edit')}</button>` : ''}</div></div>`;
      if (!open) return row;
      const kids = x.runs.slice().sort((a, b) => (a.trip_time || '').localeCompare(b.trip_time || '')).map((t, j) => {
        const kk = `${key}.${j}`; TR.runGroups[kk] = [t.id];
        return `<div class="tr-tuk-line tr-srow tr-kid" role="button" tabindex="0" data-run-one="${t.id}" onclick="TransportUI.openRuns('${kk}')">
          <div class="tr-c-time">${t.trip_time ? `<span class="num hint">${h(t.trip_time)}</span>` : ''}</div>
          <div class="tr-c-what"><span class="tr-what-l">${h(x.label)}</span><span class="tr-c-meta cell-sub">${[pplTxt(t.pax), drv].filter(Boolean).join(' · ')}</span></div>
          <div class="tr-c-ppl num">${IS_SL ? '' : (runPax(t) || '')}</div><div class="tr-c-drv">${drv}</div><div class="tr-c-price num">${money(t.expected_price)}</div><div class="tr-c-status"></div></div>`;
      }).join('');
      return row + `<div class="tr-kids">${kids}</div>`;
    }).join('');
  }
  function toggleRuns(k) { if (TR.openGroups.has(k)) TR.openGroups.delete(k); else TR.openGroups.add(k); render(); }
  // «+ Add» on a day: the add sheet of the category shown, on that day. «All» asks which one (one decision per screen).
  function addOn(day, cat) {
    const f = cat || TR.filter;
    if (f === 'airport') { if (LOCAL) return; openAddTransfer({ date: day }); return; }
    if (f === 'tuktuk' || f === 'vans' || f === 'tours') { openRunsOn(day, f); return; }
    if (LOCAL) { openRunsOn(day, 'tuktuk'); return; }
    const opts = [['airport', 'Free airport transfer (staff, gift…)', 'truck'], ...CATS.filter(c => c[0] !== 'airport').map(c => [c[0], IS_SL ? 'Tuk-tuk run' : c[0] === 'tours' ? 'Tour van' : 'Surf van', 'map-pin'])];
    modal(`Add on ${fmtDay(day)}`, 'What do you want to add?', `<div class="tr-picks">${opts.map(([k, label, icn]) => `<button class="tr-pick tr-pick-btn" data-add-cat="${k}" onclick="TransportUI.addOn('${day}','${k}')"><span>${ic(icn)} <b>${label}</b></span></button>`).join('')}</div>`, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button>`);
  }
  function openRunsOn(day, cat) {
    const d = defaultDriver(RUN.drv); TR.tuk.session = ''; TR.tuk.pickup = {}; spReset();   // the session follows the clock each time the sheet opens
    if (d) TR.tuk.driver = d.id;                    // vans and tours: Fathoune; tuk-tuks: Sampath (default_for)
    TR.tuk.cat = IS_SL ? '' : (cat === 'tours' || cat === 'vans' ? cat : '');
    // Sri Lanka marks the runs of any day in the run sheet (a later day: planned) and sends from there.
    if (day > cToday() && !SESSIONS) { setPlanDay(day); TR.tuk.planRoute = ''; TR.tuk.mode = 'plan'; renderTuktuk(); }
    else { TR.tuk.date = day; TR.tuk.mode = 'log'; renderTuktuk(); }
  }

  // ── WhatsApp ───────────────────────────────────────────────────────────
  function openWa(text) {
    const c = contact();
    const url = GT.whatsappUrl(c && c.phone || '', text);
    window.open(url, '_blank', 'noopener');
    return url;
  }
  function send(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    openWa(waText(t));
    const c = contact();
    say(`WhatsApp opened for ${c ? c.name : 'the transport contact'} — tick Sent ✓ once it is sent`);
  }
  // ── Ask the guest for the missing flight / time (Miguel, 13 Nov) ───────
  // Opens WhatsApp to the GUEST (not the driver) with a short question. The app
  // cannot see the reply: Francisco types the answer into the trip.
  const ASK_KEY = 'tr-asked-v1';
  // The browser's real storage (window.localStorage), as cash-count.js does: the hub page shadows the global
  // `localStorage` with an in-memory map, so the «asked <day>» mark was lost on every reload (audit CH-13).
  function askedMap() { try { return JSON.parse(window.localStorage.getItem(ASK_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function askedOn(id) { return askedMap()[id] || ''; }
  // Who signs the question to the guest (Miguel, 13 Nov). No emoji: WhatsApp's wa.me link shows
  // some of them as «?» on desktop.
  const ASK_SENDER = IS_SL ? 'Francisco' : CC.manager;
  const needsInfo = t => isAirport(t) && (!t.trip_time || !t.flight);
  function askText(t) {
    const first = String(t.guest_names || '').split(/[,+&]/)[0].trim().split(/\s+/)[0] || 'there';
    const hi = `Hi ${first}! I'm ${ASK_SENDER}, the manager of *${IS_SL ? 'Gota Dagua Surf Camp Sri Lanka' : CC.campFull}*.`;
    return t.kind === 'airport_departure'
      ? [hi, '', `To plan your *drop-off at ${airportCity(t.place)} airport*, could you send us:`, '', '- your *departure flight number*', '- the *date and time* it leaves', '', 'Thank you!'].join('\n')
      : [hi, '', "We're getting your *airport pick-up* ready. Could you send us:", '', '- your *flight number*', `- the *date and time* you land in ${airportCity(t.place)}`, '', 'Thank you, see you soon!'].join('\n');
  }
  function ask(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    window.open(GT.whatsappUrl(t.guest_phone || '', askText(t)), '_blank', 'noopener');
    try { const m = askedMap(); m[id] = cToday(); window.localStorage.setItem(ASK_KEY, JSON.stringify(m)); } catch (_) {}
    say(t.guest_phone ? `WhatsApp opened for ${t.guest_names || 'the guest'} — type the answer into the transfer` : 'No phone for this guest — pick the chat in WhatsApp');
    render();
    try { if (window.WeekUI && typeof window.WeekUI.render === 'function') window.WeekUI.render(); } catch (_) {}
  }
  // ── Confirm the transfer with the GUEST (Miguel, 13 Nov) ────────────────
  // The driver waits at the arrivals exit with a sign with the guest's name; the guest gets the
  // details on WhatsApp and replies that they are right. Only when flight and time are known —
  // otherwise «Ask guest». States on the trip: guest_notified_at («Guest told ✓»), then the manual
  // tick guest_confirmed_at («Guest confirmed ✓»); guest_told_snapshot = what he was told, so a
  // later change (edit or re-import) shows «Changed — tell guest again». No emoji (wa.me).
  const toldSnapshot = t => ({ trip_date: t.trip_date, trip_time: t.trip_time || null, flight: t.flight || null, pickup_time: t.pickup_time || null, pax: Number(t.pax) || 1 });
  const guestCan = t => isAirport(t) && !!t.guest_phone && !needsInfo(t) && !onHold(t) && !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show', 'merged'].includes(t.status);   // a held trip may be cancelled: nothing to confirm yet
  // '' (not told) | 'told' | 'confirmed' | 'changed'
  function guestState(t) {
    if (!t.guest_notified_at) return '';
    const was = t.guest_told_snapshot;
    if (was && JSON.stringify(toldSnapshot({ ...was })) !== JSON.stringify(toldSnapshot(t))) return 'changed';
    return t.guest_confirmed_at ? 'confirmed' : 'told';
  }
  // WhatsApp style (Miguel, 13 Nov): bold headings and labels, a blank line between blocks, no emoji.
  function confirmText(t) {
    const first = String(t.guest_names || '').split(/[,+&]/)[0].trim().split(/\s+/)[0] || 'there';
    const pax = Number(t.pax) || 1;
    const hi = `Hi ${first}! I'm ${ASK_SENDER}, the manager of *${IS_SL ? 'Gota Dagua Surf Camp Sri Lanka' : CC.campFull}*.`;
    if (t.kind === 'airport_departure') return [hi, '', `*Your drop-off at ${airportCity(t.place)} airport is booked*`, '',
      `*Date:* ${fmtDay(t.trip_date)}`, `*Flight:* ${t.flight}`, `*Flight time:* ${t.trip_time}`,
      ...(t.pickup_time ? [`*Pick-up at the camp:* ${t.pickup_time}`] : []), `*Persons:* ${pax}`, '',
      'Please reply to confirm these details are correct, or tell us what changed.', '', 'Thank you!'].join('\n');
    return [hi, '', '*Your airport pick-up is booked*', '',
      `*Date:* ${fmtDay(t.trip_date)}`, `*Flight:* ${t.flight}`, `*Landing:* ${t.trip_time}`, `*Persons:* ${pax}`, '',
      `Our driver will be waiting for you at the *arrivals exit* of ${airportCity(t.place)} airport, holding a *sign with your name*.`, '',
      'Please reply to confirm these details are correct, or tell us what changed.', '', 'See you soon!'].join('\n');
  }
  // The buttons and the state of one trip — used on the day list and in the day sheet.
  function guestHtml(t) {
    const st = guestState(t); const can = guestCan(t);
    if (!st && !can) return '';
    const btn = label => can ? `<button class="btn btn-s btn-sm" data-guest-send onclick="event.stopPropagation();TransportUI.confirmGuest('${t.id}')">${ic('send')} ${label}</button>` : '';
    if (st === 'confirmed') return `<span class="tr-guest" data-guest="confirmed"><span class="badge badge-green">Guest confirmed ✓</span>${can ? ` <button class="btn btn-s btn-sm" data-guest-undo onclick="event.stopPropagation();TransportUI.undoGuestConfirmed('${t.id}')" title="Remove the guest's confirmation">Undo</button>` : ''}</span>`;
    if (st === 'told') return `<span class="tr-guest" data-guest="told"><span class="badge badge-blue">Guest told ✓</span>${can ? ` <button class="btn btn-s btn-sm" data-guest-ok onclick="event.stopPropagation();TransportUI.guestConfirmed('${t.id}')" title="Tick when the guest replied that the details are right">${ic('check')} Mark guest confirmed</button>` : ''}</span>`;
    if (st === 'changed') return `<span class="tr-guest" data-guest="changed"><span class="badge badge-amber">Changed — tell guest again</span> ${btn('Confirm with guest')}</span>`;
    return `<span class="tr-guest" data-guest="">${btn('Confirm with guest')}</span>`;
  }
  const redrawAll = () => { render(); try { if (window.WeekUI && typeof window.WeekUI.render === 'function' && typeof activePage !== 'undefined' && activePage === 'week') window.WeekUI.render(); } catch (_) {} if (TR.guestDay && $('trOv') && $('trOv').classList.contains('open') && $('gd_list')) openGuestDay(TR.guestDay); };
  async function confirmGuest(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (needsInfo(t)) return ask(id);                         // flight or time missing: ask, never «confirm»
    if (!t.guest_phone) { say('No phone for this guest', 'err'); return; }
    window.open(GT.whatsappUrl(t.guest_phone, confirmText(t)), '_blank', 'noopener');
    if (await updateTrip(id, { guest_notified_at: new Date().toISOString(), guest_confirmed_at: null, guest_told_snapshot: toldSnapshot(t) })) { redrawAll(); say(`WhatsApp opened for ${t.guest_names || 'the guest'} — tick «Guest confirmed ✓» when they reply`); }
  }
  async function guestConfirmed(id) {
    if (await updateTrip(id, { guest_confirmed_at: new Date().toISOString() })) { redrawAll(); say('Guest confirmed'); }
  }
  // «Confirm with all guests of the day»: wa.me takes one person at a time, so a list with one Send per guest.
  const guestDayList = day => TR.trips.filter(t => t.trip_date === day && (guestCan(t) || (guestState(t) && isAirport(t) && !['cancelled', 'no_show', 'merged'].includes(t.status))))
    .sort((a, b) => (a.trip_time || '99').localeCompare(b.trip_time || '99'));
  function openGuestDay(day) {
    TR.guestDay = day;
    const list = guestDayList(day); const told = list.filter(t => ['told', 'confirmed'].includes(guestState(t))).length;
    const body = `<div class="tr-picks" id="gd_list">${list.length ? list.map(t => `<div class="tr-gd" data-gd="${t.id}"><div><b>${h(t.guest_names || 'Guest')}</b><span class="cell-sub">${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${h(t.trip_time || '')} · ${h(t.flight || '')} · ${h(t.guest_phone || '')}</span></div><div class="tr-gd-act">${guestHtml(t)}</div></div>`).join('')
      : '<div class="hint">No guest to confirm with this day (a phone, the flight and the time are needed).</div>'}</div>
      <div class="hint">WhatsApp opens one guest at a time. ${told} of ${list.length} told.</div>`;
    modal(`Confirm with guests · ${fmtDay(day)}`, 'The driver waits at the arrivals exit with a sign with their name', body, `<button class="btn btn-p" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>`);
  }
  // «Send the whole day»: the house-style day message (one builder with «Send the whole week», 15 Nov):
  // *TRANSFERS - SUN 15 NOV* (TODAY / TOMORROW), every transfer not yet happened, sent ones marked.
  // scoped: the day card's own trips (dayScoped: on the closing Saturday only that week's departures — next week's
  // Saturday arrivals go with next week, else they would be sent twice). Week and the goldens call it unscoped.
  function dayMessage(day, scoped) { return GT.dressTitles(GT.transfersText(scoped ? dayScoped(day) : TR.trips, { day, now: colomboNow(), cfg: GTC }), cToday()); }
  function sendDay(day) {
    if (!GT.transfersTrips(dayScoped(day), { day, now: colomboNow() }).length) return;
    openWa(dayMessage(day, true));
  }
  // The week (Sat–Fri + the closing Saturday's departures): *TRANSFERS - 14 TO 21 NOV*, a bold heading per day.
  function weekMessage(ws) { return GT.dressTitles(GT.transfersText(TR.trips, { day: 'week', ws: ws || TR.week, now: colomboNow(), cfg: GTC }), cToday()); }
  function sendWeek() {
    const ws = TR.week; if (!weekTrips(ws).length) return;
    openWa(weekMessage(ws));
    const c = contact();
    say(`WhatsApp opened for ${c ? c.name : 'the transport contact'} — tap «Mark all sent ✓» once it is sent`);
  }
  // Exactly the trips of the week message (never next week's Saturday arrivals).
  const tickWeek = () => tickIds(weekTickIds(TR.week));
  const snapshot = t => ({ trip_date: t.trip_date, trip_time: t.trip_time, flight: t.flight, pax: t.pax, place: t.place });
  async function tick(id, what) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const patch = what === 'sent'
      ? { status: 'sent', sent_at: new Date().toISOString(), sent_snapshot: snapshot(t), needs_resend: false }
      : { status: 'confirmed', confirmed_at: new Date().toISOString() };
    if (await updateTrip(id, patch)) { render(); say(what === 'sent' ? 'Marked as sent' : 'Marked as confirmed'); }
  }
  // The status control of a row: Pending / Message Sent / Confirmed. Forward steps write what the ticks wrote
  // (sent_at + the snapshot the «changed since sent» check reads, confirmed_at); a step back is undoTick's.
  async function setStep(id, to) {
    const t = TR.trips.find(x => x.id === id); if (!t || t.payment_entry_id || !STATUS_STEPS.some(x => x[0] === to) || t.status === to) return;
    const rank = v => STATUS_STEPS.findIndex(x => x[0] === v);
    const now = new Date().toISOString();
    const sent = { sent_at: now, sent_snapshot: snapshot(t), needs_resend: false };
    const patch = rank(to) < rank(t.status) ? { status: to }
      : to === 'sent' ? { status: 'sent', ...sent }
      : t.status === 'planned' ? { status: 'confirmed', confirmed_at: now, ...sent }   // straight to Confirmed: it was sent too
      : { status: 'confirmed', confirmed_at: now };
    if (await updateTrip(id, patch)) { render(); say(`Status: ${STATUS_STEPS[rank(to)][1]}`); } else render();
  }
  // The trips of the «Send the whole week» message, ticked Sent ✓ by id.
  // «Mark all sent ✓» clears exactly what the UPDATE carries: never-sent → Sent, changed → stamped again (a Confirmed one
  // stays Confirmed), cancelled after sending → told (needs_resend off, still cancelled).
  const tickPatch = t => {
    const now = new Date().toISOString();
    if (['cancelled', 'no_show', 'merged'].includes(t.status)) return { sent_at: now, needs_resend: false };
    return { status: t.status === 'confirmed' ? 'confirmed' : 'sent', sent_at: now, sent_snapshot: snapshot(t), needs_resend: false };
  };
  async function tickIds(ids) {
    const list = TR.trips.filter(t => (ids || []).includes(t.id) && isAirport(t) && !t.payment_entry_id && (
      (!isDone(t) && (t.status === 'planned' || t.needs_resend)) || (['cancelled', 'no_show', 'merged'].includes(t.status) && t.needs_resend)));
    for (const t of list) await updateTrip(t.id, tickPatch(t));
    render(); say(`${list.length} marked as sent`);
  }
  // The trips of a day card: on the closing Saturday only that week's departures (as the badge counts them).
  const dayScoped = day => TR.trips.filter(t => t.trip_date !== day || !isAirport(t) || !TR.week || inWeek(t, TR.week));
  async function tickDay(day) {
    const U = GT.transfersUpdateTrips(dayScoped(day), { day, now: colomboNow() });
    const list = dayScoped(day).filter(t => t.trip_date === day && isAirport(t) && !t.payment_entry_id && !isDone(t) && !onHold(t) && ['planned', 'sent', 'confirmed'].includes(t.status) && (t.status === 'planned' || t.needs_resend))
      .concat(U.gone.filter(t => !t.payment_entry_id));
    for (const t of list) await updateTrip(t.id, tickPatch(t));
    render(); say(`${list.length} marked as sent`);
  }
  // «Send the update»: only what changed since the day (or the week) was sent — «UPDATE:» in the title, no emoji.
  function dayUpdateMessage(day) { return GT.transfersUpdateText(dayScoped(day), { day, now: colomboNow(), cfg: GTC, today: cToday() }); }
  function weekUpdateMessage(ws) { return GT.transfersUpdateText(TR.trips, { day: 'week', ws: ws || TR.week, now: colomboNow(), cfg: GTC }); }
  function sendDayUpdate(day) {
    if (!GT.transfersUpdateTrips(dayScoped(day), { day, now: colomboNow() }).n) return;
    openWa(dayUpdateMessage(day));
    const c = contact();
    say(`WhatsApp opened for ${c ? c.name : 'the transport contact'} — tap «Mark all sent ✓» once it is sent`);
  }
  function sendWeekUpdate() {
    if (!GT.transfersUpdateTrips(TR.trips, { day: 'week', ws: TR.week, now: colomboNow() }).n) return;
    openWa(weekUpdateMessage(TR.week));
    const c = contact();
    say(`WhatsApp opened for ${c ? c.name : 'the transport contact'} — tap «Mark all sent ✓» once it is sent`);
  }

  // ── Overview (Miguel, 16 Nov 2026: «ver o overview por semana e mês e ano para os diferentes tipos de transportes
  // para poder analisar»; v2 the same day: «está muito confuso ainda… estão todos confusos no geral») ─────────────
  // Week | Month | Year with ‹ ›, default this month. The screen answers, top to bottom: what transport cost (and up or
  // down against the period before), what we owe right now, the cost per person → (year) cost by month, by kind →
  // by kind of transport (one bar each) → the drivers and suppliers. Every number shown once; MAD / LKR first, ≈ € second.
  // The numbers come from lib/transport-overview.js (trips from the go-live, the ledger's payments before it). Full view only.
  const TO = () => window.TransportOverview;
  TR.ov = TR.ov || { mode: 'month', anchor: '', measure: 'cost' };
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ovPill = active => LOCAL ? '' : `<button class="pill${active ? ' active' : ''}" data-view="overview" onclick="TransportUI.setView('overview')">${ic('bar-chart')} Overview</button>`;
  function ovAnchorFrom(mode, iso) { return mode === 'week' ? GT.weekStart(iso) : mode === 'year' ? iso.slice(0, 4) : iso.slice(0, 7); }
  function ovPeriod() {
    const ov = TR.ov; if (!ov.anchor) ov.anchor = ovAnchorFrom(ov.mode, cToday());
    return TO().period(ov.mode, ov.anchor);
  }
  function ovMode(m) { const P0 = ovPeriod(); const t = cToday(); const from = t >= P0.from && t <= P0.to ? t : P0.from; TR.ov.mode = ['week', 'month', 'year'].includes(m) ? m : 'month'; TR.ov.anchor = ovAnchorFrom(TR.ov.mode, from); TR.view = 'overview'; render(); }
  function ovShift(n) { const P = ovPeriod(); TR.ov.anchor = TO().shift(P.mode, P.anchor, n); render(); }
  function ovMonth(ym) { TR.ov.mode = 'month'; TR.ov.anchor = ym; TR.view = 'overview'; render(); }
  function ovMeasure(k) { TR.ov.measure = k === 'people' ? 'people' : 'cost'; render(); }
  const ovLedger = () => (typeof S !== 'undefined' && S.ledger) || [];
  // What the view shows, for the page, the CSV and the tests: V = the period (total, kinds, suppliers), Y = the year by
  // month (Year only), cmp = up or down, owed = what is owed right now (the «Owed to drivers» rule), fx = the € rate.
  function ovData() {
    const P = ovPeriod();
    // Payments linked to trips are those trips' «Paid» (a payment «to check» with no trips is not linked).
    const linked = new Set(TR.trips.map(t => t.payment_entry_id).filter(Boolean));
    const C = TO().collect({ trips: TR.trips, ledger: ovLedger(), drivers: TR.drivers, cfg: CC, goLive: goLive(), now: colomboNow(), linked, isOwed: t => reconcileStatus(t) === 'owed' });
    const fx = TO().eurRate({ ledger: ovLedger(), cur: CUR, from: P.from, to: P.to, fallback: (typeof LOCAL_PER_EUR !== 'undefined' ? LOCAL_PER_EUR : 0),
      defaultRate: (typeof FX_FALLBACK_THIS_LOC !== 'undefined' ? FX_FALLBACK_THIS_LOC : 0) });
    return { P, C, V: TO().view(C, P, CC), Y: P.mode === 'year' ? TO().yearView(C, P.anchor, CC) : null, cmp: TO().compare(C, P), owed: TO().owedNow(C), checks: toCheck().length, holds: onHoldTrips().length, fx,
      surf: ovSurf(C, P) };
  }
  // Surf vans per surfer-day (Morocco, 17 Nov 2026): surfers from the guests' Bookinglayer lessons (camp_week_guests),
  // read once per period; null until they are in (the row then shows nothing extra).
  const GONE = new Set(['cancelled', 'canceled', 'expired', 'not_here']);
  function ovSurf(C, P) {
    if (!CC.vanRates) return null;
    const G = TR.ovGuests;
    if (!G || G.key !== P.from + '|' + P.to) { loadOvGuests(P); return null; }
    if (!G.rows) return null;
    const sd = TO().surferDays(G.rows, P.from, P.to, { courseDays: CC.surfCourseDays, ok: g => !GONE.has(String(g.booking_status || '').toLowerCase()),
      hasCourse: g => !!(window.WeekUI && WeekUI.course && WeekUI.course(g)) });
    return { ...TO().perSurferDay(C, P, sd, { to: cToday() }), byDay: sd.byDay };
  }
  try { window.addEventListener('camp-week-imported', () => { TR.ovGuests = null; }); } catch (_) {}
  async function loadOvGuests(P) {
    const key = P.from + '|' + P.to; if (TR.ovGuests && TR.ovGuests.key === key) return;
    TR.ovGuests = { key, rows: null };
    try {
      const c = client(); const loc = await ensureHubLocationId();
      const { data, error } = await c.from('camp_week_guests').select('booking_ref,guest_key,guest_name,check_in,check_out,activities,packages,booking_status,raw')
        .eq('location_id', loc).lte('check_in', P.to).gte('check_out', P.from);
      if (error) throw error;
      if (TR.ovGuests.key === key) TR.ovGuests.rows = data || [];
    } catch (_) { if (TR.ovGuests.key === key) TR.ovGuests.rows = []; }
    if (TR.view === 'overview' && TR.ovGuests.key === key) render();
  }
  const ovLabel = P => P.mode === 'week' ? fmtRange(P.from, P.to) : P.mode === 'year' ? P.anchor : `${MONTH_LONG[+P.anchor.slice(5, 7) - 1]} ${P.anchor.slice(0, 4)}`;
  const fmtEur = n => '€' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const eurOf = (v, fx) => `≈ ${fmtEur(TO().eur(v, fx.rate))}`;
  // «MAD 21,050» with «≈ €1,950» under it — the Overview only (never on trip rows or forms).
  const twoCur = (v, fx) => `<span class="num">${money(v)}</span><span class="tr-eur">${eurOf(v, fx)}</span>`;
  const compact = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v));
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`;
  const kindCls = k => `tr-k-${['airport', 'vans', 'tuktuk', 'tours'].includes(k) ? k : 'other'}`;
  // A kind's people and per person are shown when at least half of its cost has a head count (a lump sum has none).
  const headcount = k => k.people > 0 && k.costP >= k.cost / 2;
  const andList = xs => xs.length < 2 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  function renderOverview() {
    const D = ovData(); const { P, V, Y, fx } = D; const ov = TR.ov;
    const seg = (k, label, cur) => `<button class="pill${cur === k ? ' active' : ''}" data-ov-mode="${k}" onclick="TransportUI.ovMode('${k}')">${label}</button>`;
    const filters = `<div class="ov-filters tr-filters tr-ov-filters">
      <div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous" onclick="TransportUI.ovShift(-1)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl tr-ov-period">${h(ovLabel(P))}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next" onclick="TransportUI.ovShift(1)">${ic('chevron-right')}</button></div>
      <div class="pills tr-ov-modes">${seg('week', 'Week', ov.mode)}${seg('month', 'Month', ov.mode)}${seg('year', 'Year', ov.mode)}</div>
      <button class="btn btn-s btn-sm" data-ov-export onclick="TransportUI.ovExport()">${ic('download')} Export</button></div>`;
    if (V.empty) {
      const t = cToday(); const now = t >= P.from && t <= P.to;
      const when = P.mode === 'week' ? (now ? 'this week' : `in the week of ${fmtRange(P.from, P.to)}`) : P.mode === 'month' ? (now ? 'this month' : `in ${ovLabel(P)}`) : (now ? 'this year' : `in ${P.anchor}`);
      return filters + ovTiles(D, true) + `<div class="card tr-ov-card" data-ov-empty><div class="empty-state">${ic('truck')}<div class="empty-title">No transport recorded ${h(when)}</div><p>No trips and no transport payments in the ledger for these dates.</p></div></div>`;
    }
    return filters + ovTiles(D) + (Y ? ovYearChart(Y, fx) : '') + ovKinds(V, fx, D.surf) + ovGuestMoney(D) + ovSuppliers(V, fx) + ovNote(D);
  }
  // Three numbers: what transport cost (up or down), what we owe right now, the cost per person.
  function ovTiles(D, owedOnly) {
    const { V, cmp, owed, checks, holds, fx } = D; const T = V.total;
    const tile = (k, label, value, sub, cls) => `<div class="kpi" data-ov-kpi="${k}"><div class="kpi-label">${label}</div><div class="kpi-value${cls ? ' ' + cls : ''}">${value}</div>${sub}</div>`;
    const delta = c => { if (!c) return ''; const p = c.pct; const r = (100 + p) / 100;
      const word = Math.abs(p) < 1 ? `about the same as ${h(c.name)}` : p >= 100 ? `${r >= 10 ? Math.round(r) : Math.round(r * 10) / 10} times ${h(c.name)}` : `${Math.abs(p)}% ${p > 0 ? 'more' : 'less'} than ${h(c.name)}`;
      return `<div class="kpi-sub tr-delta" data-ov-delta>${ic(Math.abs(p) < 1 ? 'minus' : p > 0 ? 'trending-up' : 'trending-down')}<span>${word}</span></div>`; };
    const cost = tile('cost', 'Transport cost', money(T.cost), `<div class="kpi-sub"><span class="tr-eur">${eurOf(T.cost, fx)}</span>${T.toCome ? ` · incl. ${money(T.toCome)} still to come` : ''}</div>${delta(cmp.prev)}${delta(cmp.lastYear)}`);
    // Owed now: every driver with done, unpaid trips (any period) — each a link to «Pay a driver»; then the payments to check.
    const pays = owed.rows.map(r => r.driverId ? `<button class="btn-link tr-ov-pay" data-ov-pay="${h(r.driverId)}" onclick="TransportUI.payPick('${h(r.driverId)}')">Pay ${h(r.label)} <span class="num">${money(r.amount)}</span></button>`
      : `<span class="tr-ov-nodrv">${money(r.amount)} on trips with no driver</span>`).join('');
    const chk = (checks ? `<button class="btn-link tr-ov-pay" data-ov-checks onclick="TransportUI.openChecks()">${plural(checks, 'payment')} to check</button>` : '')
      + (holds ? `<button class="btn-link tr-ov-pay" data-ov-holds onclick="TransportUI.setView('trips','onhold')">${plural(holds, 'trip')} on hold — did the driver go?</button>` : '');
    const owedTile = tile('owed', 'Owed now', money(owed.total), `<div class="kpi-sub">${owed.total ? `<span class="tr-eur">${eurOf(owed.total, fx)}</span>` : 'Nothing owed to drivers'}</div>${pays || chk ? `<div class="tr-ov-acts">${pays}${chk}</div>` : ''}`, owed.total ? 'kv-amber' : '');
    if (owedOnly) return owed.total || checks || holds ? `<div class="summary-grid tr-ov-kpis tr-ov-kpis-1">${owedTile}</div>` : '';
    // Per person: the cost of what has a head count ÷ the people. Old months: only the lines that say how many travelled.
    let pp = '';
    if (T.people) {
      // Only the kinds whose cost mostly has a head count, and only when they are most of the money (else no tile).
      const withP = V.kinds.filter(headcount); const people = withP.reduce((s, k) => s + k.people, 0); const costP = withP.reduce((s, k) => s + k.costP, 0);
      if (people && withP.reduce((s, k) => s + k.cost, 0) >= T.cost / 2) {
        const full = withP.length === V.kinds.length && withP.every(k => k.costP === k.cost);
        const sub = full ? [plural(people, 'person', 'people'), T.trips ? plural(T.trips, 'trip') : ''].filter(Boolean).join(' · ') : `${andList(withP.map(k => k.label))} · ${plural(people, 'person', 'people')}`;
        const v = Math.round(costP / people);
        pp = tile('pp', 'Per person', money(v), `<div class="kpi-sub"><span class="tr-eur">${eurOf(v, fx)}</span> · ${h(sub)}</div>`);
      }
    }
    return `<div class="summary-grid tr-ov-kpis${pp ? '' : ' tr-ov-kpis-2'}">${cost}${owedTile}${pp}</div>`;
  }
  // Year: one stacked bar per month, one colour per kind (the same colours as the kind bars below); a bar opens its month.
  function ovYearChart(Y, fx) {
    const max = Math.max(1, ...Y.totals.cost); const thisM = cToday().slice(0, 7);
    const legend = Y.rows.map(r => `<span class="tr-leg"><i class="tr-sw ${kindCls(r.kind)}"></i>${h(r.label)}</span>`).join('');
    const bars = Y.months.map((m, i) => {
      const v = Y.totals.cost[i]; const segs = Y.rows.filter(r => r.cost[i] > 0);
      const tip = `<span class="tr-tip" role="tooltip"><b>${MONTH_LONG[i]}</b><span class="num">${h(money(v))} ${h(eurOf(v, fx))}</span>${segs.map(r => `<span><i class="tr-sw ${kindCls(r.kind)}"></i>${h(r.label)} <span class="num">${h(money(r.cost[i]))}</span></span>`).join('')}</span>`;
      return `<button class="tr-bar${m === thisM ? ' tr-bar-now' : ''}" data-ov-month="${m}" onclick="TransportUI.ovMonth('${m}')" aria-label="${MONTH_LONG[i]}: ${h(money(v))}${segs.map(r => `, ${h(r.label)} ${h(money(r.cost[i]))}`).join('')}">
        <span class="tr-bar-v num">${v ? h(compact(v)) : ''}</span><span class="tr-bar-col"><span class="tr-bar-stack" style="height:${v ? Math.max(2, Math.round(v / max * 100)) : 0}%">${segs.map(r => `<span class="tr-seg ${kindCls(r.kind)}" style="flex-grow:${r.cost[i]}"></span>`).join('')}</span></span><span class="tr-bar-m">${TO().MON[i]}</span>${v ? tip : ''}</button>`;
    }).join('');
    return `<div class="card tr-ov-card tr-ov-chart" data-ov-bars><div class="card-hdr"><div><div class="card-title">Cost by month</div><div class="card-hint">${h(CUR)} · tap a month to open it</div></div><div class="tr-legend">${legend}</div></div>
      <div class="tr-bars">${bars}</div></div>`;
  }
  // One row per kind of transport (the page's pills): a bar for its share of the cost, then trips, people, per person.
  function ovKinds(V, fx, surf) {
    const T = V.total; const max = Math.max(1, ...V.kinds.map(k => k.cost)); const showT = T.trips > 0; const showP = V.kinds.some(headcount);
    const partsOf = k => {
      const xs = k.parts.length === 1 && k.parts[0].label === k.label ? [] : k.parts;
      // A count only when it is the whole part: trips for trips, people for payments (a part with both says its name only).
      const one = p => `${h(p.label)}${p.trips && !p.payments ? ` ${p.trips}` : p.people && !p.trips ? ` (${plural(p.people, 'person', 'people')})` : ''}`;
      return xs.length > 4 ? xs.slice(0, 3).map(one).join(' · ') + ` · +${xs.length - 3} more` : xs.map(one).join(' · ');
    };
    const sdOn = k => k.kind === 'vans' && surf && surf.per;   // the surfer-day figure replaces a typed head count
    const meta = k => [k.trips ? plural(k.trips, 'trip') : '', headcount(k) && !sdOn(k) ? plural(k.people, 'person', 'people') : '', headcount(k) && !sdOn(k) ? `${money(k.perPerson)} per person` : '',
      k.kind === 'vans' && surf && surf.per ? `<span data-ov-surfer-day title="Surf van cost on the days with surfers ÷ surfer-days (guests with a Bookinglayer lesson or course that day)">${money(surf.per)} per surfer-day <span class="tr-eur">${eurOf(surf.per, fx)}</span> · ${plural(surf.surferDays, 'surfer-day')} from Bookinglayer lessons${surf.uncovered ? ` · ${money(surf.uncovered)} on days with no lessons data left out` : ''}</span>` : ''].filter(Boolean).join(' · ');
    const rows = V.kinds.map(k => { const pct = Math.round(k.cost / (T.cost || 1) * 100);
      return `<div class="tr-kind" data-ov-row="${k.kind}">
        <div class="tr-kind-name"><span class="tr-kind-t"><i class="tr-sw ${kindCls(k.kind)}"></i><b>${h(k.label)}</b></span>${partsOf(k) ? `<span class="cell-sub tr-kind-parts">${partsOf(k)}</span>` : ''}${k.noShow ? `<span class="cell-sub">incl. ${plural(k.noShow, 'no-show')}</span>` : ''}</div>
        <div class="tr-kind-bar" aria-hidden="true"><span class="tr-kind-track"><span class="tr-kind-fill ${kindCls(k.kind)}" style="width:${Math.max(1, Math.round(k.cost / max * 100))}%"></span></span><span class="tr-kind-pct num">${pct}%</span></div>
        <div class="tr-kind-cost r">${twoCur(k.cost, fx)}</div>
        ${showT ? `<div class="tr-kind-n r num tr-ov-xs">${k.trips || ''}</div>` : ''}${showP ? `<div class="tr-kind-n r num tr-ov-xs">${headcount(k) && !sdOn(k) ? k.people.toLocaleString('en-US') : ''}</div><div class="tr-kind-n r num tr-ov-xs">${headcount(k) && !sdOn(k) ? money(k.perPerson) : ''}</div>` : ''}
        <div class="tr-kind-meta cell-sub">${meta(k)}</div></div>`; }).join('');
    const cols = `tr-kinds-c${3 + (showT ? 1 : 0) + (showP ? 2 : 0)}${showT ? ' tr-kinds-t' : ''}${showP ? ' tr-kinds-p' : ''}`;
    return `<div class="card tr-ov-card" data-ov-kinds><div class="card-hdr"><div><div class="card-title">By kind of transport</div></div></div>
      <div class="tr-kinds ${cols}" data-ov-table="summary"><div class="tr-kind tr-kind-head"><div>Kind</div><div>Share of cost</div><div class="r">Cost</div>${showT ? '<div class="r tr-ov-xs">Trips</div>' : ''}${showP ? '<div class="r tr-ov-xs">People</div><div class="r tr-ov-xs">Per person</div>' : ''}</div>${rows}</div></div>`;
  }
  // Airport transfers: guests' € against the drivers' € (17 Nov 2026). The guest price and covers_pax come from /prices
  // (the route's smallest vehicle, or the row whose bl_product the trip's product is); the report's prices when stored.
  function sellFor(t) {
    const vs = airVehicles(t.kind, t.place); if (!vs.length) return null;
    const prods = (t.products || []).map(x => String(x).toLowerCase().trim());
    const u = vs.find(v => v.blProduct && prods.includes(String(v.blProduct).toLowerCase().trim())) || vs[0];
    if (!(u.sell > 0) || String(u.sellCurrency || 'EUR').toUpperCase() !== 'EUR') return null;
    return { eur: Number(u.sell), covers: Number(u.coversPax) || Number(CC.transferCovers) || 1 };
  }
  function ovGuestMoney(D) {
    const { P, fx } = D;
    const G = TO().guestMoney(TR.trips.filter(t => t.trip_date >= goLive()), P, { rate: fx.rate, sellFor });
    if (!G.trips || G.trips === G.free) return '';
    const est = G.estimated || G.unknown;
    const tile = (k, label, v, sub, cls) => `<div class="kpi" data-ov-gm="${k}"><div class="kpi-label">${label}</div><div class="kpi-value${cls ? ' ' + cls : ''}">${v}</div><div class="kpi-sub">${sub}</div></div>`;
    const how = [G.fromReport ? `${plural(G.fromReport, 'trip')} at the report's prices` : '', G.estimated ? `${plural(G.estimated, 'trip')} estimated from /prices` : '',
      G.unknown ? `${plural(G.unknown, 'trip')} with no guest price in /prices` : '', G.free ? `${plural(G.free, 'trip')} free or on the Camp Tab` : ''].filter(Boolean).join(' · ');
    return `<div class="card tr-ov-card" data-ov-guest-money><div class="card-hdr"><div><div class="card-title">Airport transfers · guests and drivers</div>
      <div class="card-hint">What guests paid for their transfers against what the drivers cost, in €${est ? ' — partly estimated' : ''}</div></div></div>
      <div class="summary-grid tr-ov-kpis">${tile('revenue', est ? 'Guests paid (est.)' : 'Guests paid', fmtEur(G.revenue), h(how))}
        ${tile('cost', 'Drivers', fmtEur(G.costEur), `<span class="num">${money(G.cost)}</span>`)}
        ${tile('margin', 'Margin', fmtEur(G.margin), G.revenue > 0 ? `${Math.round(G.margin / G.revenue * 100)}% of what guests paid` : '', G.margin < 0 ? 'kv-red' : '')}</div></div>`;
  }
  // Who we pay: each driver / supplier with this period's cost and where it stands (paid, owed → Pay, still to come).
  function ovSuppliers(V, fx) {
    if (!V.suppliers.length) return '';
    const kl = k => (V.kinds.find(x => x.kind === k) || {}).label || '';
    const rows = V.suppliers.map(s => {
      const what = [s.kinds.map(kl).filter(x => x && x !== s.label).join(' + '), s.trips ? plural(s.trips, 'trip') : '', !s.trips && s.payments ? plural(s.payments, 'payment') : ''].filter(Boolean).join(' · ');
      const st = [];
      // Owed: the word and «Pay» only — the amount owed now is in the «Owed now» tile, once.
      if (s.owed) st.push(`<span class="tr-st tr-st-owed">Not paid yet</span>${s.driverId ? ` <button class="btn-link tr-ov-pay" data-ov-pay="${h(s.driverId)}" onclick="TransportUI.payPick('${h(s.driverId)}')">Pay</button>` : ''}`);
      if (s.toCome) st.push(`<span class="tr-st">${money(s.toCome)} still to come</span>`);
      const paidHere = s.paid - s.earlier;
      if (s.cost && !s.owed && !s.toCome && paidHere >= s.cost) st.push(`<span class="tr-st tr-st-paid">${ic('check')} Paid${!s.trips && s.lastPaid ? ` · last ${h(fmtShort(s.lastPaid))}` : ''}</span>`);
      else if (s.cost && paidHere && paidHere < s.cost && !s.owed) st.push(`<span class="tr-st">${money(paidHere)} paid</span>`);
      if (s.earlier) st.push(`<span class="tr-st">+ ${money(s.earlier)} paid for earlier trips</span>`);
      return `<div class="tr-sup" data-ov-driver="${h(s.label)}"><div class="tr-sup-name"><b>${h(s.label)}</b><span class="cell-sub">${h(what)}</span></div>
        <div class="tr-sup-st">${st.join('')}</div><div class="tr-sup-cost r">${s.cost ? twoCur(s.cost, fx) : ''}</div></div>`;
    }).join('');
    return `<div class="card tr-ov-card" data-ov-drivers><div class="card-hdr"><div><div class="card-title">Drivers and suppliers</div></div></div><div class="tr-sups" data-ov-table="drivers">${rows}</div></div>`;
  }
  // One quiet line: how the numbers are made, and the € rate.
  function ovNote(D) {
    const { V, C, fx } = D;
    const shown = fx.rate >= 100 ? Math.round(fx.rate) : Math.round(fx.rate * 10) / 10;   // 340 LKR, 10.8 MAD
    const how = [];
    if (V.total.trips) how.push('trips at their agreed price');
    if (V.total.fromPayments) {
      const here = new Set(V.kinds.filter(k => k.fromPayments).map(k => k.kind));
      const starts = Object.entries(C.start || {}).filter(([k, d]) => d && here.has(k)).map(([k, d]) => `${TO().kindLabel(k, CC)} ${fmtShort(d)}`);
      const none = [...here].filter(k => k !== 'other' && !(C.start || {})[k]).map(k => TO().kindLabel(k, CC));
      how.push(`before the trip list${starts.length ? ` (it starts: ${andList(starts)})` : ''}, the transport payments in the ledger${none.length ? ` (${andList(none)}: no trip list yet)` : ''}, airport invoices in the month they cover${CC.legacyPerPerson && V.kinds.some(k => CC.legacyPerPerson.kinds.includes(k.kind) && k.fromPayments) ? `, people = van lines ÷ ${CC.legacyPerPerson.rate}` : ''}`);
    }
    return `<div class="hint tr-ov-note" data-ov-note>How this is calculated: ${how.join('; ') || 'nothing in this period'}. € ≈ at ${shown.toLocaleString('en-US')} ${h(CUR)} per €.</div>`;
  }
  function ovTable() {
    const { P, V, Y, fx } = ovData();
    return { P, rows: Y ? TO().yearTable(Y, TR.ov.measure, CUR, fx.rate) : TO().viewTable(V, CUR, fx.rate) };
  }
  function ovExport() {
    const { P, rows } = ovTable();
    const name = `transport-overview-${SLUG || 'camp'}-${P.mode}-${P.anchor}${P.mode === 'year' ? '-' + TR.ov.measure : ''}.csv`;
    downloadCsv(name, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
  }
  function downloadCsv(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ── Export a month (Floriane, 16 Nov 2026: «monthly export to cross-check the camp transfer logs against the
  // transport provider's monthly invoice») ─────────────────────────────────
  // One CSV row per trip of the month (by trip date): airport transfers and runs, cancelled and no-show included
  // with their status (a provider may still bill a no-show); merged trips (a duplicate folded into another) left out.
  // UTF-8 with a BOM and comma separators, every field quoted, so Excel opens the names and accents right.
  const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const EXPORT_FROM = TRIPS_LOAD_FROM.slice(0, 7);   // the page loads trips from here
  function tripStatusLabel(t) {
    if (t.status === 'cancelled') return 'Cancelled';
    if (t.status === 'no_show') return 'No-show';
    if (isDone(t)) return 'Done';
    return (STATUS_STEPS.find(x => x[0] === t.status) || [t.status, t.status || ''])[1];
  }
  function monthCsv(month) {
    const city = p => (CC.airportCity || {})[p] || p || 'Airport';
    // QA 16 Nov 2026: a cancelled trip is listed (the provider may ask) at price 0 and «Billable: no»; a duplicate split off
    // another trip (cancel_reason 'split') and a merged one are left out. A no-show stays billable (providers bill it).
    const head = ['Date', 'Time', 'Direction', 'Route / what', 'Guest names', 'People', 'Flight', 'Vehicle', 'Driver / supplier', `Price (${CUR})`, 'Billable', 'Status', 'Paid', 'Paid on'];
    const rows = TR.trips.filter(t => String(t.trip_date || '').slice(0, 7) === month && t.status !== 'merged' && !(t.status === 'cancelled' && t.cancel_reason === 'split'))
      .sort((a, b) => (a.trip_date + (a.trip_time || '99')).localeCompare(b.trip_date + (b.trip_time || '99')) || String(a.id).localeCompare(String(b.id)))
      .map(t => {
        const dep = t.kind === 'airport_departure', air = isAirport(t);
        const e = t.payment_entry_id ? ledgerById(t.payment_entry_id) : null;
        return [t.trip_date, t.trip_time || '', air ? (dep ? 'OUT' : 'IN') : 'run',
          air ? (dep ? `Surfcamp → ${city(t.place)} airport` : `${city(t.place)} airport → Surfcamp`) : runLabel(t),
          t.guest_names || '', air ? (Number(t.pax) || 1) : (runPax(t) == null ? '' : runPax(t)), air ? (t.flight || '') : '', t.vehicle || (air ? '' : RUN.veh), driverById(t.driver_id)?.name || '',
          t.status === 'cancelled' ? 0 : Number(t.expected_price || 0), t.status === 'cancelled' ? 'No' : 'Yes', tripStatusLabel(t), t.payment_entry_id ? 'yes' : 'no', e && e.date ? e.date : ''];
      });
    return '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function openExport() {
    const now = cToday().slice(0, 7);
    modal('Export month', 'Every transfer and run of the month in a spreadsheet (CSV), to check against the driver\'s invoice',
      `<div class="mfield"><label for="tr_exm">Month</label><input type="month" id="tr_exm" value="${now}" min="${EXPORT_FROM}"></div>`,
      `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" data-export-go onclick="TransportUI.downloadMonth()">${ic('download')} Download CSV</button>`);
  }
  function downloadMonth(month) {
    const m = month || ($('tr_exm') && $('tr_exm').value) || cToday().slice(0, 7);
    if (!/^\d{4}-\d\d$/.test(m)) { say('Pick a month', 'err'); return; }
    if (m < EXPORT_FROM) { say(`Trips are kept in the app from ${fmtShort(TRIPS_LOAD_FROM)}`, 'err'); return; }
    downloadCsv(`transport-${SLUG || 'camp'}-${m}.csv`, monthCsv(m));
    closeModal();
  }

  // ── Trip detail (edit, no-show, cancel) ────────────────────────────────
  function driverOptions(sel, kind) {
    const list = kind ? driversFor(kind) : TR.drivers.filter(d => !(d.kinds || []).every(k => k === 'contact'));
    return `<option value="">—</option>` + list.map(d => `<option value="${d.id}"${d.id === sel ? ' selected' : ''}>${h(d.name)}${d.label ? ' · ' + h(d.label) : ''}</option>`).join('');
  }
  // «Who pays us?» + why it is free. Used by the trip sheet, Add transfer and the tuk-tuk run sheet.
  // opts.options = [[value, label]…] for the first row; the reason chips show only with Free.
  function chargeBlock(px, charge, reason, opts) {
    const o = opts || {}; const options = o.options || [['bookinglayer', 'In booking'], ['camp_tab', 'Camp Tab'], ['free', 'Free']];
    const cur = charge === 'free' || reason ? 'free' : (charge || '');   // no pill lit = leave «who pays» as it is
    return `<div class="mfield"><label>${h(o.label || 'Who pays us?')}</label><div class="pills tr-seg" id="${px}_ch">${options.map(([v, l]) => `<button type="button" class="pill${v === cur ? ' active' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="mfield tr-free-why" id="${px}_fr_wrap" style="${cur === 'free' ? '' : 'display:none'}"><label>Why is it free?</label><div class="pills tr-seg" id="${px}_fr">${FREE_REASONS.map(([v, l]) => `<button type="button" class="pill${v === (reason || (o.defaultReason || '')) ? ' active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
        <div class="hint">Nobody pays us for it. The driver is still paid, so it stays in what is owed.</div></div>`;
  }
  function wireCharge(px) {
    wireSeg(px + '_ch', () => { const w = $(px + '_fr_wrap'); if (w) w.style.display = segVal(px + '_ch') === 'free' ? '' : 'none'; });
    wireSeg(px + '_fr');
  }
  // → { charge, free_reason } (a free trip with no chip picked is «Other»).
  function readCharge(px) {
    const ch = segVal(px + '_ch') || null;
    return ch === 'free' ? { charge: 'free', free_reason: segVal(px + '_fr') || 'other' } : { charge: ch, free_reason: null };
  }
  function paidNote(t) {
    const ps = payState(t);
    return `<div class="status-msg status-info tr-paid-note">Paid${ps.sub ? ' ' + h(ps.sub) : ''} — unlink the payment first to change the date, price or driver, or to delete it.${LOCAL ? '' : ` <button class="btn btn-s btn-sm" data-unlink onclick="TransportUI.unlinkTrip('${t.id}')">Unlink payment</button>`}</div>`;
  }
  function openTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (!isAirport(t)) return openRuns([t.id]);
    const paid = !!t.payment_entry_id;
    const flags = (t.import_flags || []).map(f => `<div class="status-msg status-warn tr-flag">${h(f)}</div>`).join('');
    const body = `${flags}
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="tr_d" value="${h(t.trip_date)}" ${paid ? 'disabled' : ''}></div>
      <div class="mfield"><label>${t.kind === 'airport_departure' ? 'Flight time' : 'Lands at'}</label>${timeSelect('tr_t', t.trip_time, '', true)}</div></div>
      ${t.kind === 'airport_departure' ? `<div class="mfield"><label>Pick up at camp</label>${timeSelect('tr_pu', t.pickup_time, '', true)}</div>` : ''}
      <div class="g2"><div class="mfield"><label>Flight</label><input id="tr_f" value="${h(t.flight || '')}"></div>
      <div class="mfield"><label>Persons</label><input type="number" min="1" id="tr_p" value="${t.pax}"></div></div>
      <div class="mfield"><label>Guest</label><input id="tr_g" value="${h(t.guest_names || '')}"></div>
      <div class="mfield"><label>Guest phone</label><input id="tr_ph" value="${h(t.guest_phone || '')}"></div>
      <div class="g2"><div class="mfield"><label>Vehicle</label><select id="tr_v" ${paid ? 'disabled' : ''}>${airLabels(t.kind, t.place, t.vehicle).map(v => `<option${v === t.vehicle ? ' selected' : ''}>${h(v)}</option>`).join('') || '<option value="">no /prices vehicles</option>'}</select></div>
      <div class="mfield"><label>Price (${CUR})</label><input type="number" id="tr_pr" value="${Number(t.expected_price || 0)}" ${paid ? 'disabled' : ''}></div></div>
      <div class="mfield"><label>Driver</label><select id="tr_dr" ${paid ? 'disabled' : ''}>${driverOptions(t.driver_id, 'airport')}</select></div>
      ${t.source === 'manual' && isFree(t) ? chargeBlock('tr', 'free', t.free_reason, { options: [['free', 'Free (added by hand)']] }) : chargeBlock('tr', t.charge, t.free_reason)}
      <div class="mfield"><label>Notes</label><input id="tr_n" value="${h(t.notes || '')}"></div>
      ${t.source === 'bookinglayer' ? '<div class="hint">What you change here stays: the next Guests import does not overwrite it.</div>' : ''}
      ${t.booking_ref || t.added_by_local ? `<div class="hint">${[t.booking_ref ? 'Bookinglayer ' + h(t.booking_ref) : '', t.added_by_local ? `Added by ${LOCAL_MANAGER_NAME} when paying the driver` : ''].filter(Boolean).join(' · ')}</div>` : ''}
      ${paid ? paidNote(t) : ''}`;
    const live = !paid && !['cancelled', 'no_show'].includes(t.status);
    const held = live && onHold(t);
    const footer = `${live ? `<button class="btn btn-s" onclick="TransportUI.setStatus('${id}','no_show')">No-show</button>
      ${t.source === 'manual' ? '' : `<button class="btn btn-danger" onclick="TransportUI.setStatus('${id}','cancelled')">Cancel trip</button>`}` : ''}
      ${t.status === 'cancelled' || t.status === 'no_show' ? `<button class="btn btn-s" onclick="TransportUI.setStatus('${id}','planned')">Restore</button>` : ''}
      ${live && (t.status === 'confirmed' || t.status === 'sent') ? `<button class="btn btn-s" data-undo onclick="TransportUI.undoTick('${id}')">${t.status === 'confirmed' ? 'Back to Sent' : 'Back to Planned'}</button>` : ''}
      ${held ? `<button class="btn btn-s" id="tr_keep" onclick="TransportUI.keepTrip('${id}')">Still needed</button>` : ''}
      ${!paid && t.source === 'manual' ? `<button class="btn btn-danger" id="tr_del" onclick="TransportUI.removeTrip('${id}')">${ic('trash')} Delete</button>` : ''}
      <button class="btn btn-s" onclick="TransportUI.send('${id}')">${ic('send')} WhatsApp</button>
      <button class="btn btn-p" onclick="TransportUI.saveTrip('${id}')">Save</button>`;
    modal(`Edit ${t.kind === 'airport_departure' ? 'departure' : 'arrival'} · ${fmtDay(t.trip_date)}`, h(t.guest_names || ''), body, footer);
    const v = $('tr_v'), pr = $('tr_pr');
    if (v && pr) v.addEventListener('change', () => { const p = presetPrice(t.kind, v.value, t.place); if (p) pr.value = p; });
    wireCharge('tr');
  }
  // «Still needed»: Francisco checked — the flag goes and the trip is back in the day message.
  async function keepTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const gone = (t.import_flags || []).some(f => GONE_FLAG.test(f));
    if (await updateTrip(id, { missing_since: null, import_flags: (t.import_flags || []).filter(f => !REMOVED_FLAG.test(f) && !GONE_FLAG.test(f)) }, gone ? [GONE_KEPT] : undefined)) { closeModal(); render(); say('Kept — it will go out with the day again'); }
  }
  async function removeTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || t.payment_entry_id || t.source !== 'manual') return;
    if (!window.confirm(`Delete this transfer (${t.guest_names || 'Guest'}, ${fmtDay(t.trip_date)})? It was added by hand and is not paid.`)) return;
    if (await deleteTrip(id)) { closeModal(); render(); say('Transfer deleted'); }
  }
  async function saveTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const val = k => ($(k) ? $(k).value : undefined);
    const next = {
      trip_date: val('tr_d') || t.trip_date, trip_time: val('tr_t') || null, flight: (val('tr_f') || '').toUpperCase().replace(/\s+/g, '') || null,
      pax: Math.max(1, parseInt(val('tr_p'), 10) || 1), guest_names: val('tr_g') || null, guest_phone: (val('tr_ph') || '').replace(/\s+/g, '') || null,
      vehicle: val('tr_v') || t.vehicle, expected_price: Number(val('tr_pr') || 0), driver_id: val('tr_dr') || null, notes: val('tr_n') || null,
      ...readCharge('tr'),
    };
    if (!('free_reason' in t) && !next.free_reason) delete next.free_reason;   // column not there yet and nothing to store
    if ($('tr_pu')) next.pickup_time = val('tr_pu') || null;
    if (t.payment_entry_id) { delete next.trip_date; delete next.vehicle; delete next.expected_price; delete next.driver_id; }
    const edited = Object.keys(next).filter(k => String(next[k] ?? '') !== String(t[k] ?? ''));
    if (!edited.length) { closeModal(); return; }
    const patch = {}; edited.forEach(k => { patch[k] = next[k]; });
    const moved = ['trip_date', 'trip_time', 'flight', 'pax', 'pickup_time'].some(k => edited.includes(k));
    if (moved && (t.status === 'sent' || t.status === 'confirmed')) patch.needs_resend = true;
    // charge / free_reason are not import fields: «Free» is kept by the database, not by edited_fields.
    // The price is «typed by hand» only when it is not the /prices price of the vehicle (17 Nov 2026): a vehicle change
    // that takes the catalog price keeps following /prices (camp_trips_reprice, the import).
    const catalogPrice = presetPrice(t.kind, next.vehicle, next.trip_date ? t.place : t.place);
    const onCatalog = catalogPrice > 0 && Number(next.expected_price) === catalogPrice;
    const marks = edited.filter(k => k !== 'charge' && k !== 'free_reason' && !(k === 'expected_price' && onCatalog));
    if (await updateTrip(id, patch, marks, onCatalog && !t.payment_entry_id ? ['expected_price'] : [])) { closeModal(); render(); say('Saved'); }
  }
  // One step back: Confirmed → Sent, Sent → Planned. Only for unpaid trips that haven't happened.
  async function undoTick(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || t.payment_entry_id) return;
    const back = t.status === 'confirmed' ? 'sent' : t.status === 'sent' ? 'planned' : null; if (!back) return;
    if (await updateTrip(id, { status: back })) { closeModal(); render(); try { if (window.WeekUI && typeof activePage !== 'undefined' && activePage === 'week') WeekUI.render(); } catch (_) {} say(back === 'sent' ? 'Back to Sent' : 'Back to Planned'); }
  }
  async function undoGuestConfirmed(id) {
    if (await updateTrip(id, { guest_confirmed_at: null })) { redrawAll(); say('Guest confirmation removed'); }
  }
  // «Booked ✓» / «Not booked» after looking at the booking page (the same columns camp_trips_bl_verify writes).
  async function myId() { try { const { data } = await client().auth.getSession(); return (data && data.session && data.session.user && data.session.user.id) || null; } catch (_) { return null; } }
  const blRedraw = () => { redrawAll(); try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {} };
  async function blBooked(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || TR.busy.has('bl' + id)) return;
    TR.busy.add('bl' + id);
    try {
      if (await updateTrip(id, { bl_checked_at: new Date().toISOString(), bl_checked_by: await myId(), bl_check_note: 'checked by hand' })) { blRedraw(); say('Checked in Bookinglayer'); }
    } finally { TR.busy.delete('bl' + id); }
  }
  async function blNotBooked(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || TR.busy.has('bl' + id)) return;
    const dir = t.kind === 'airport_departure' ? 'departure' : 'arrival';
    // Already happened (= camp_trips_bl_verify): never cancelled from here — the question «did the driver go?» instead.
    if (isDone(t)) {
      TR.busy.add('bl' + id);
      try {
        const flags = (t.import_flags || []).filter(f => f !== BL_NOT_BOOKED_FLAG).concat(BL_NOT_BOOKED_FLAG);
        if (await updateTrip(id, { import_flags: flags, bl_checked_at: new Date().toISOString(), bl_checked_by: await myId(), bl_check_note: 'not booked (checked by hand) — trip already happened' })) { blRedraw(); say('Not booked — did the driver go? Answer on the trip'); }
      } finally { TR.busy.delete('bl' + id); }
      return;
    }
    if (!window.confirm(`Cancel the ${dir} of ${t.guest_names || 'this guest'} on ${fmtDay(t.trip_date)}? It is not booked in Bookinglayer.${['sent', 'confirmed'].includes(t.status) ? ' The driver already has it: tell him.' : ''}`)) return;
    TR.busy.add('bl' + id);
    try {
      const patch = { status: 'cancelled', cancel_reason: 'Not booked in Bookinglayer (checked by hand)', needs_resend: ['sent', 'confirmed'].includes(t.status),
        bl_checked_at: new Date().toISOString(), bl_checked_by: await myId(), bl_check_note: 'not booked (checked by hand)' };
      if (await updateTrip(id, patch)) { blRedraw(); say('Trip cancelled — not booked in Bookinglayer'); }
    } finally { TR.busy.delete('bl' + id); }
  }
  // The answer to «did the driver go?»: he went → the question goes (the trip stays owed, Pay ticks it again);
  // he did not → the trip is cancelled with that reason (never paid).
  async function driverWent(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || TR.busy.has('went' + id)) return;
    TR.busy.add('went' + id);
    try {
      if (await updateTrip(id, { import_flags: (t.import_flags || []).filter(f => !QUESTION_FLAG.test(String(f))), bl_checked_at: new Date().toISOString(), bl_checked_by: await myId(), bl_check_note: 'driver went (checked by hand)' })) { blRedraw(); say('Kept — the driver went, it is owed'); }
    } finally { TR.busy.delete('went' + id); }
  }
  async function driverDidntGo(id) {
    const t = TR.trips.find(x => x.id === id); if (!t || t.payment_entry_id) return;
    if (!window.confirm(`Cancel the ${t.kind === 'airport_departure' ? 'departure' : 'arrival'} of ${t.guest_names || 'this guest'} on ${fmtDay(t.trip_date)}? The driver did not go, so nothing is owed for it.`)) return;
    if (await updateTrip(id, { status: 'cancelled', cancel_reason: 'Driver did not go (checked by hand)', import_flags: (t.import_flags || []).filter(f => !QUESTION_FLAG.test(String(f))) })) { blRedraw(); say('Trip cancelled — the driver did not go'); }
  }
  // Transport → Trips with only the transfers still to check (the chip, Week → To check, the hub's checks).
  function showBlCheck() {
    TR.view = 'trips'; TR.filter = 'blcheck';
    if (typeof showPage === 'function' && (typeof activePage === 'undefined' || activePage !== 'transport')) showPage('transport'); else render();
  }
  async function setStatus(id, status) {
    const patch = { status, cancel_reason: status === 'cancelled' ? 'manual' : null };
    // Cancelled after the transport contact got it: the day shows «Changed after sending» and the UPDATE says CANCELLED.
    const t0 = TR.trips.find(x => x.id === id);
    if (t0 && isAirport(t0) && (status === 'cancelled' || status === 'no_show') && ['sent', 'confirmed'].includes(t0.status) && t0.sent_at && !isDone(t0)) patch.needs_resend = true;
    if (t0 && status === 'planned' && t0.needs_resend && ['cancelled', 'no_show'].includes(t0.status)) patch.needs_resend = false;
    if (status === 'planned') patch.cancel_reason = null;
    if (await updateTrip(id, patch)) { closeModal(); render(); say(status === 'no_show' ? 'Marked as no-show' : status === 'cancelled' ? 'Trip cancelled' : 'Trip restored'); }
  }

  // ── Add a free airport transfer (one screen) ───────────────────────────
  // Miguel, 16 Nov 2026: a guest's airport transfer is ALWAYS sold in Bookinglayer and arrives only through the Guests
  // import — nobody adds a paid guest transfer here. The only airport trip added by hand is one nobody pays us for:
  // staff, a guest's free extra, a compensation… So the sheet asks the name and why it is free (the free_reason values of
  // supabase/camp-trips-v2.sql), and the price is what WE pay the driver (from /prices, editable), never a charge.
  function openAddTransfer(opts) {
    const d = defaultDriver('airport');      // Morocco: Let Us Tours (default_for 'airport'); Sri Lanka: Dilan
    const onDay = opts && opts.date && /^\d{4}-\d\d-\d\d$/.test(opts.date) ? opts.date : cToday();
    const body = `<div class="status-msg status-info tr-free-rule">Guests' airport transfers come from Bookinglayer (the camp report) — never add them here. Add only a transfer nobody pays us for.</div>
      <div class="mfield"><label>Why is it free?</label><div class="pills tr-seg" id="at_fr">${FREE_REASONS.map(([v, l]) => `<button type="button" class="pill" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="pills tr-seg" id="at_kind"><button class="pill active" data-v="airport_arrival">Airport to Camp</button><button class="pill" data-v="airport_departure">Camp to Airport</button></div>
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="at_d" value="${onDay}"></div><div class="mfield"><label>Time</label>${timeSelect('at_t', '', '', true)}</div></div>
      <div class="g2"><div class="mfield"><label>Flight</label><input id="at_f" placeholder="QR658"></div><div class="mfield"><label>Persons</label><input type="number" min="1" id="at_p" value="1"></div></div>
      <div class="mfield"><label>Name</label><input id="at_g" placeholder="Who travels"></div>
      <div class="mfield"><label>Phone</label><input id="at_ph" placeholder="${h(IS_SL ? '+49…' : CC.phoneExample)}"></div>
      <div class="g2"><div class="mfield"><label>Vehicle</label><select id="at_v">${airLabels('airport_arrival').map(v => `<option>${h(v)}</option>`).join('')}</select></div>
      <div class="mfield"><label>What we pay the driver (${CUR})</label><input type="number" min="0" id="at_pr" value="${presetPrice('airport_arrival', airLabels('airport_arrival')[0])}"></div></div>
      <div class="hint tr-at-over" id="at_over"></div>
      ${IS_SL ? '' : `<div class="mfield"><label>Airport</label><select id="at_pl">${CC.airports.map(a => `<option value="${a}">${h(CC.airportCity[a])} (${a})</option>`).join('')}</select></div>`}
      <div class="mfield"><label>Driver</label><select id="at_dr">${driverOptions(d && d.id, 'airport')}</select></div>
      <div class="mfield"><label>Note</label><input id="at_n" placeholder="Optional"></div>
      <div class="hint">Nobody pays us for it. The driver is still paid, so it counts in «Owed to drivers».</div>`;
    modal('Add a free airport transfer', 'Staff, a gift to a guest, a compensation…', body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="at_save" onclick="TransportUI.saveTransfer()">Save</button>`);
    const place = () => $('at_pl') ? $('at_pl').value : undefined;
    const reprice = () => { $('at_pr').value = presetPrice(segVal('at_kind'), $('at_v').value, place()); };
    // The vehicle list is the route's /prices rows; the people pick the smallest that holds them (over → largest + a note).
    const repick = () => {
      const pk = pickAir(segVal('at_kind'), place(), $('at_p').value);
      const ls = airLabels(segVal('at_kind'), place()); const cur = $('at_v').value;
      $('at_v').innerHTML = ls.map(v => `<option>${h(v)}</option>`).join('');
      $('at_v').value = pk.label || (ls.includes(cur) ? cur : ls[0] || '');
      $('at_over').textContent = pk.over ? pk.flag : ''; reprice();
    };
    if ($('at_pl')) $('at_pl').addEventListener('change', repick);
    wireSeg('at_kind', repick); wireSeg('at_fr'); $('at_v').addEventListener('change', reprice);
    $('at_p').addEventListener('change', repick);
  }
  function wireSeg(id, cb) { const el = $(id); if (!el) return; el.querySelectorAll('.pill').forEach(b => b.addEventListener('click', () => { el.querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x === b)); if (cb) cb(); })); }
  const segVal = id => { const b = $(id) && $(id).querySelector('.pill.active'); return b ? b.dataset.v : ''; };
  async function saveTransfer() {
    if (TR.busy.has('at')) return; TR.busy.add('at');
    try {
      const kind = segVal('at_kind'); const reason = segVal('at_fr');
      const row = {
        kind, trip_date: $('at_d').value || cToday(), trip_time: $('at_t').value || null, flight: ($('at_f').value || '').toUpperCase().replace(/\s+/g, '') || null,
        pax: Math.max(1, parseInt($('at_p').value, 10) || 1), guest_names: $('at_g').value.trim() || null, guest_phone: ($('at_ph').value || '').replace(/\s+/g, '') || null,
        vehicle: $('at_v').value, expected_price: Math.max(0, Number($('at_pr').value || 0)), driver_id: $('at_dr').value || null, charge: 'free', free_reason: reason || null,
        route: kind === 'airport_departure' ? 'Surfcamp → Airport' : 'Airport → Surfcamp', purpose: reason === 'staff' ? 'staff' : 'guests', place: IS_SL ? 'CMB' : (($('at_pl') && $('at_pl').value) || CC.airportDefault), source: 'manual', status: 'planned',
        notes: ($('at_n') && $('at_n').value.trim()) || null,
      };
      if (!reason) { say('Pick why it is free (staff, gift, compensation or other)', 'err'); return; }
      if (pricesError() || !row.vehicle) { say('The transfer prices have not loaded from /prices — nothing saved. Check the connection and try again.', 'err'); return; }
      if (!row.guest_names) { say('Type the name', 'err'); return; }
      if (await insertTrip(row)) { closeModal(); TR.week = GT.weekStart(row.trip_date); TR.view = 'trips'; render(); say('Free transfer added'); }
    } finally { TR.busy.delete('at'); }
  }

  // ── Tuk-tuk day sheet: one tap = one run ───────────────────────────────
  // Morocco's van runs tapped by hand carry no head count (Miguel, 17 Nov 2026): day, driver, vehicle, then where it went.
  // The surf spots also take the PEOPLE going (19 Nov 2026): the vans / tuk-tuks are worked out, see «People per surf spot».
  TR.tuk = { date: null, driver: null, mode: 'log', planDate: null, planTime: PLAN_DEFAULT_TIME, planRoute: '', planCount: 1, vehicle: '', planVehicle: '' };
  const tukVehicle = () => (TR.tuk.vehicle && vanLabels().includes(TR.tuk.vehicle) ? TR.tuk.vehicle : '') || vanDefaultVehicle(null);
  const planVehicle = () => (TR.tuk.planVehicle && vanLabels().includes(TR.tuk.planVehicle) ? TR.tuk.planVehicle : '') || vanDefaultVehicle(null);
  // Morocco: the vehicle's price, «MAD 900 · Big Van» (and «price to confirm» without a /prices row).
  const priceText = (r, vehicle) => { if (IS_SL) return r.confirm ? 'price to confirm' : money(r.price); const v = vehicle || vanDefaultVehicle(r); const p = vanPrice(r, v); return `${money(p.price)} · ${v}${p.confirm ? ' · price to confirm' : ''}`; };
  const vehiclePick = (id, cur, onchange) => `<select id="${id}" onchange="${onchange}">${vanLabels(cur).map(v => `<option${v === cur ? ' selected' : ''}>${h(v)}</option>`).join('')}</select>`;
  function tukRoutes() {
    if (!IS_SL) {
      // The tour(s) of a van run reach Tours by product: «Paradise + Souk» = both tours (16 Nov 2026).
      const list = (CC.vanRates || []).map(r => ({ key: 'van|' + r.key, label: r.label, route: r.route, purpose: r.purpose, tour: (r.tours || []).length ? r.tours.join(' + ') : (r.tour || null), catalog: r.catalog || null, catalogs: r.catalogs || null, confirm: !!r.confirm }));
      return { surf: list.filter(r => r.purpose === 'surf'), camp: [], tour: list.filter(r => r.purpose !== 'surf') };
    }
    const P = (typeof transportPresets !== 'undefined' && transportPresets) || {};
    const catalogTuk = new Map((P.tuktuk || []).map(p => [p.name.toLowerCase(), Number(p.unitPrice) || 0]));
    return {
      surf: (P.surf || []).map(p => ({ key: 'surf|' + p.name, label: 'Camp → ' + p.name, route: p.name, purpose: 'surf', price: Number(p.unitPrice) || 0 })),
      camp: TUKTUK_CAMP_RUNS.map(r => { const has = catalogTuk.has(r.label.toLowerCase());
        return { key: 'camp|' + r.label, label: r.label, route: r.label, purpose: r.purpose, price: has ? catalogTuk.get(r.label.toLowerCase()) : 0, confirm: !has }; }),
      tour: (P.tours || []).map(p => ({ key: 'tour|' + p.name, label: p.linkedTour || p.name, route: p.name, purpose: 'tour', tour: p.linkedTour || p.name, price: Number(p.unitPrice) || 0 })),
    };
  }
  const allRoutes = () => { const R = tukRoutes(); return [...R.surf, ...R.camp, ...R.tour]; };
  // «+ Add» on a day of the Tours / Surf vans pill opens the run sheet with that category's routes only.
  const routeInCat = r => !TR.tuk.cat ? true : TR.tuk.cat === 'tours' ? r.purpose === 'tour' : r.purpose !== 'tour';
  // The «Add a run» route list of «Plan the day»: only the areas you may run.
  function planRoutes() { const R = catRoutes(); return { surf: R.surf.filter(canRun), camp: R.camp.filter(canRun), tour: R.tour.filter(canRun) }; }
  function catRoutes() { const R = tukRoutes(); return { surf: R.surf.filter(routeInCat), camp: R.camp.filter(routeInCat), tour: R.tour.filter(routeInCat) }; }
  const mineRoutes = () => { const R = tukRoutes(); return { surf: R.surf.filter(canRun), camp: R.camp.filter(canRun), tour: R.tour.filter(canRun) }; };
  const routeOptions = (sel, byCat, vehicle) => { const R = byCat === 'plan' ? planRoutes() : byCat === 'mine' ? mineRoutes() : byCat ? catRoutes() : tukRoutes(); const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(r => `<option value="${h(r.key)}"${r.key === sel ? ' selected' : ''}>${h(r.label)} · ${priceText(r, vehicle)}</option>`).join('')}</optgroup>` : ''; return grp('Surf', R.surf) + grp('Camp runs', R.camp) + grp(IS_SL ? 'Tour' : 'Tours and trips', R.tour); };

  // ── Plan the day (17 Nov 2026, Miguel: «o dia é organizado primeiro, depois a mensagem é enviada ao motorista») ──
  // Sri Lanka plans the tuk-tuks in the MORNING for the SAME day and sends at once; Morocco plans the surf vans and
  // tours the DAY BEFORE and sends to Fathoune that evening (CampConfig.planDay). The sheet has a day chip
  // «Today / Tomorrow» that starts on the camp's day; the other one is a tap away.
  const PLAN_DAY = CC.planDay === 'tomorrow' ? 'tomorrow' : 'today';
  const planDefaultDay = () => PLAN_DAY === 'tomorrow' ? GT.addDaysIso(cToday(), 1) : cToday();
  // The time a new run starts on: the camp's (07:30); planning today after it, the next quarter hour from now.
  function planTimeFor(day) {
    const base = CC.planTime || PLAN_DEFAULT_TIME;
    if (day !== cToday() || base > cTime()) return base;
    const [hh, mm] = cTime().split(':').map(Number); const q = Math.min(23 * 60 + 45, Math.ceil((hh * 60 + mm + 1) / 15) * 15);
    return `${String(Math.floor(q / 60)).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`;
  }
  const dayWord = day => day === cToday() ? 'today' : day === GT.addDaysIso(cToday(), 1) ? 'tomorrow' : fmtDay(day);
  function openTuktuk(mode) {
    const d = defaultDriver(RUN.drv); TR.tuk.session = ''; TR.tuk.pickup = {}; spReset();
    TR.tuk.cat = '';                         // the header button: every route (a day's «+ Add» narrows it, openRunsOn)
    TR.tuk.date = TR.tuk.date || cToday(); TR.tuk.driver = TR.tuk.driver || (d && d.id) || '';
    TR.tuk.mode = mode === 'plan' ? 'plan' : 'log';
    if (TR.tuk.mode === 'plan' && !TR.tuk.planDate) setPlanDay(planDefaultDay());
    renderTuktuk();
  }
  function setPlanDay(day) { TR.tuk.planDate = day; TR.tuk.planTime = planTimeFor(day); }
  // The chip «N runs for today — send the order» and the day header open the sheet on that day.
  const openPlan = day => {
    const d = /^\d{4}-\d\d-\d\d$/.test(String(day || '')) ? day : planDefaultDay();
    if (SESSIONS) { openRunsOn(d, 'tuktuk'); return; }   // Sri Lanka marks and sends in the run sheet
    setPlanDay(d); openTuktuk('plan');
  };
  // «Plan the day» on a runs pill: the order sheet on the camp's day, on that pill's routes.
  function planOn(cat, day) {
    const d = defaultDriver(RUN.drv); if (d) TR.tuk.driver = d.id; spReset();
    TR.tuk.cat = IS_SL ? '' : (cat === 'tours' || cat === 'vans' ? cat : '');
    setPlanDay(/^\d{4}-\d\d-\d\d$/.test(String(day || '')) ? day : planDefaultDay()); TR.tuk.planRoute = ''; TR.tuk.mode = 'plan'; renderTuktuk();
  }
  // The run sheet's title says what it is for: «Surf vans», «Tour vans», «Tuk-tuk runs» (CampConfig.transportTabs).
  const sheetTitle = () => { const t = tabOf(TR.tuk.cat); return t && t.sheet ? t.sheet : IS_SL ? ((tabOf('tuktuk') || {}).sheet || 'Tuk-tuk runs') : 'Surf vans and tours'; };
  // A run still on the plan (not logged, not removed): planned / sent / confirmed.
  const LIVE_RUN = ['planned', 'sent', 'confirmed'];
  // ── Who may run which area (CampConfig.runAreas, 17 Nov 2026) ── surf / tours / camp runs. A view ('manager' = the full
  // camp hub, 'local' = ?view=local) or a login email; no runAreas (Morocco) = everybody who has the page. A run in an
  // area you may not run is shown read-only (no tap, plan, edit, delete) and is left out of your «Send».
  const areaOf = x => x && (x.purpose === 'tour' || x.tour_name || x.tour) ? 'tours' : x && x.purpose === 'surf' ? 'surf' : 'camp';
  const VIEW_ROLE = LOCAL ? 'local' : 'manager';
  function canArea(area) {
    const A = CC.runAreas; if (!A || !A[area]) return true;
    return A[area].includes(VIEW_ROLE) || (!!TR.me && A[area].map(x => String(x).toLowerCase()).includes(TR.me));
  }
  const canRun = x => canArea(areaOf(x));
  const runOff = t => ['cancelled', 'no_show', 'merged'].includes(t.status);
  function renderTuktuk() {
    const plan = TR.tuk.mode === 'plan';
    const seg = `<div class="pills tr-seg" id="tk_mode"><button type="button" class="pill${plan ? '' : ' active'}" onclick="TransportUI.tukMode('log')">Log runs</button><button type="button" class="pill${plan ? ' active' : ''}" onclick="TransportUI.tukMode('plan')">Plan the day</button></div>`;
    if (plan) return renderPlan(seg);
    const R = catRoutes(); const day = TR.tuk.date; const drv = TR.tuk.driver;
    // A removed run (cancelled after the order went out) is not a run: never counted, never tapped away again.
    const runs = TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day && (t.driver_id || '') === drv && !runOff(t));
    // Sri Lanka: the runs are marked per lesson session (Morning / Afternoon) with its pickup time; the counts are the session's.
    const ses = SESSIONS ? tukSession() : null;
    const inSes = t => !ses || batchOf(t.trip_time) === ses.key;
    const of = r => runs.filter(t => t.route === r.route && t.purpose === r.purpose && inSes(t));
    // The number is what was logged (done); the runs still only planned for the day sit next to it («+2 planned»):
    // a tap logs one of those first — the same trip, never a second one.
    const count = r => of(r).filter(t => !LIVE_RUN.includes(t.status)).length;
    const plannedN = r => of(r).filter(t => LIVE_RUN.includes(t.status)).length;
    const btn = r => !canRun(r) ? `<div class="tr-tap tr-tap-ro" data-ro="${areaOf(r)}"><div class="tr-tap-main" data-key="${h(r.key)}" aria-disabled="true"><span>${h(r.label)}${plannedN(r) ? ` <span class="badge badge-grey tr-tap-plan">+${plannedN(r)} planned</span>` : ''}</span><span class="hint">by the camp manager</span><b class="tr-tap-n num">${count(r)}</b></div><span></span></div>`
      : `<div class="tr-tap"><button class="tr-tap-main" data-key="${h(r.key)}" onclick="TransportUI.tap('${h(r.key)}')"><span>${h(r.label)}${plannedN(r) ? ` <span class="badge badge-grey tr-tap-plan" data-planned="${plannedN(r)}">+${plannedN(r)} planned</span>` : ''}</span><span class="hint num">${priceText(r, IS_SL ? '' : tukVehicle())}</span><b class="tr-tap-n num">${count(r)}</b></button>
      <button class="btn btn-s btn-icon tr-tap-minus" title="One run less (it did not happen)" onclick="TransportUI.untap('${h(r.key)}')" ${of(r).some(t => !t.payment_entry_id) ? '' : 'disabled'}>${ic('minus')}</button></div>`;
    const total = runs.reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const live = runs.filter(t => LIVE_RUN.includes(t.status) && (day <= cToday()) && canRun(t));
    const pend = pendingOf(day, drv); const c = tukContact(); const who = c ? c.name : `the ${RUN.lower} contact`;
    const today = cToday(), tm = GT.addDaysIso(today, 1);
    const dchip = (d, label) => `<button type="button" class="pill${day === d ? ' active' : ''}" data-day="${d}" onclick="TransportUI.tukSet('date','${d}')">${label}</button>`;
    const sesBox = SESSIONS ? `<div class="mfield tr-ses"><label>Lesson</label><div class="tr-ses-row"><div class="pills tr-seg" id="tk_ses">${SESSIONS.map(x => `<button type="button" class="pill${x.key === ses.key ? ' active' : ''}" data-ses="${x.key}" onclick="TransportUI.tukSession('${x.key}')">${h(x.label)}</button>`).join('')}</div>
        <span class="tr-ses-t"><span class="hint">Pickup</span>${timeSelect('tk_st', ses.time, 'onchange="TransportUI.tukPickup(this.value)"')}</span></div></div>`
      : CC.runDepartTime ? `<div class="mfield tr-ses"><label>${TR.tuk.cat === 'tours' ? 'Tour leaves at' : 'Leaves at'}</label><div class="tr-ses-row"><span class="tr-ses-t">${timeSelect('tk_st', departTime(), 'onchange="TransportUI.tukPickup(this.value)"')}</span>
        <span class="hint">${TR.tuk.cat === 'tours' ? 'Each tour keeps its own time.' : 'One departure for the day; the vans come back in the afternoon.'}</span></div></div>` : '';
    const planBox = live.length ? `<div class="status-msg status-info tr-planlog" id="tk_planlog" data-n="${live.length}"><div><b>Planned for ${h(dayWord(day))}: ${live.length} run${live.length === 1 ? '' : 's'}</b>
        <div class="hint">${planLines(live).map(x => h(planLineText(x))).join(' · ')}</div>
        <div class="hint">Went as planned? One tap logs them all. Otherwise tap + / − on each route.</div></div></div>` : '';
    const body = `${seg}${SESSIONS ? sendBox(day, drv) : ''}<div class="g2 tr-tuk-head"><div class="mfield"><label>Day</label>${SESSIONS ? `<div class="pills tr-seg tr-dayseg" id="tk_dday">${dchip(today, 'Today')}${dchip(tm, 'Tomorrow')}</div>` : ''}<input type="date" id="tk_d" value="${h(day)}" onchange="TransportUI.tukSet('date', this.value)"></div>
      <div class="mfield"><label>Driver</label><select id="tk_dr" onchange="TransportUI.tukSet('driver', this.value)">${driverOptions(drv)}</select></div></div>
      ${sesBox}${planBox}
      ${IS_SL || !(R.tour.length || R.surf.some(r => !spCan(r))) ? '' : pricesError() || !vanLabels().length ? `<div class="status-msg status-warn" data-prices-not-loaded>Van prices not loaded from /prices${pricesError() ? ` (${h(pricesError())})` : ''} — a run would be saved without a price.</div>`
        : `<div class="mfield"><label>Vehicle</label><div class="pills tr-seg" id="tk_veh">${vanLabels().map(v => `<button type="button" class="pill${v === tukVehicle() ? ' active' : ''}" data-v="${h(v)}" onclick="TransportUI.tukVehicle('${h(v).replace(/'/g, '&#39;')}')">${h(v)}</button>`).join('')}</div><div class="hint">The price is the vehicle's (/prices). Then tap where the van went.</div></div>`}
      ${(() => { const SP = spList();
        // each surf spot: ONE row — the people going → the vans / tuk-tuks (19–20 Nov 2026). The tap line («one tap = one
        // run») only where there are no people to type: no seats in /prices (said under it), or an area you may not run
        // (Nadith: read-only). Camp runs and tours keep their tap lines.
        const spot = r => { const i = SP.findIndex(x => x.key === r.key);
          return i >= 0 ? spRow(r, i) : btn(r) + (!IS_SL && canRun(r) && vanVehicles(r).length ? `<div class="hint tr-sp-none" data-sp-none="${h(r.key)}">${h(GT.SEATS_UNKNOWN)}</div>` : ''); };
        const surfH = R.surf.length ? `<div class="section-lbl">Surf</div>${R.surf.map(spot).join('')}${SP.length ? spBarHtml() : ''}` : '';
        const campH = R.camp.length || IS_SL ? `<div class="section-lbl">Camp runs</div>${R.camp.map(btn).join('')}` : '';
        const tourH = R.tour.length ? `<div class="section-lbl">${IS_SL ? 'Tour' : 'Tours and trips'}</div>${R.tour.map(btn).join('')}` : '';
        // the areas you run first (Nadith: the camp runs; surf and tours below, read-only)
        return canArea('surf') ? surfH + campH + tourH : campH + surfH + tourH; })()}
      <div class="tr-tuk-total"><span>${fmtDay(day)} · ${runs.length} run${runs.length === 1 ? '' : 's'}</span><b class="num">${money(total)}</b></div>
      <div class="hint">To change or delete a run later, tap its line in the Trips list.</div>`;
    // One blue button: Sri Lanka «Send to Sampath on WhatsApp» while a batch of the day is not sent (or changed) — tap the
    // runs, then send; else «All went as planned» while runs planned ahead wait to be logged; else «Done».
    const sendP = SESSIONS && pend.length;
    const footer = `<button class="btn ${sendP || live.length ? 'btn-s' : 'btn-p'}" id="tk_done" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>`
      + (live.length ? `<button class="btn ${sendP ? 'btn-s' : 'btn-p'}" id="tk_allplan" onclick="TransportUI.allAsPlanned()">${ic('check')} All went as planned</button>` : '')
      + (sendP ? `<button class="btn btn-p" id="tk_send" onclick="TransportUI.sendOrder()">${ic('send')} ${pend.some(x => x.key === 'changed') ? `Send the update to ${h(who)} on WhatsApp` : `Send to ${h(who)} on WhatsApp`}</button>` : '');
    const ppl0 = spList().length;   // Nadith (surf read-only) keeps the old words
    const ov = modal(sheetTitle(), SESSIONS ? (ppl0 ? 'Type the people per surf spot or tap each run, then send them to the driver' : 'Tap each run (saved at once), then send them to the driver')
      : (ppl0 ? 'Type the people per surf spot, or tap a run (each tap is saved at once)' : 'Runs done: each tap is saved at once — no Save button'), body, footer);
    const mf = ov && ov.querySelector('.mfooter'); if (mf) mf.classList.add('tr-foot1');
    spPaint(-1);
  }
  function tukSet(k, v) {
    TR.tuk[k] = v;
    // Morocco plan: the prices in the route list follow the vehicle picked — updated in place: this runs on «change»,
    // i.e. on blur, and a redraw then would swallow the next click.
    if (!IS_SL && k === 'planVehicle') {
      const veh = planVehicle();
      document.querySelectorAll('#tk_pr option').forEach(o => { const r = tukRoute(o.value); if (r) o.textContent = `${r.label} · ${priceText(r, veh)}`; });
      return;
    }
    if (k === 'planDate') { setPlanDay(v); renderTuktuk(); return; }
    if (k === 'planTime' && $('tk_spt') && /^\d\d:\d\d$/.test(String(v || ''))) $('tk_spt').value = v;   // one time for the order being written
    if (k !== 'planTime' && k !== 'planRoute' && k !== 'planCount') renderTuktuk();
  }
  // Morocco run sheet: vehicle changed → the active vehicle and every price, in place
  // (re-drawing the sheet under the tapped button broke the next tap).
  function vanSheetRefresh() {
    const v = tukVehicle();
    document.querySelectorAll('#tk_veh .pill').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    document.querySelectorAll('#trOv .tr-tap-main[data-key]').forEach(b => { const r = tukRoute(b.dataset.key); const hint = b.querySelector('.hint'); if (r && hint) hint.textContent = priceText(r, v); });
  }
  function tukMode(m) { TR.tuk.mode = m === 'plan' ? 'plan' : 'log'; if (m === 'plan' && !TR.tuk.planDate) setPlanDay(planDefaultDay()); renderTuktuk(); }
  function tukRoute(key) { return allRoutes().find(r => r.key === key); }
  // Sri Lanka's lesson session in the run sheet: picked by hand, else by the time now (before the split = Morning).
  // TR.tuk.pickup holds a pickup time typed for a session (else the session's time from CampConfig.runSessions).
  function tukSession() {
    const key = TR.tuk.session || (cTime() < SESSION_SPLIT ? SESSIONS[0].key : SESSIONS[1].key);
    const base = sessionOf(key) || SESSIONS[0];
    const typed = (TR.tuk.pickup || {})[key];
    return { ...base, time: typed && batchOf(typed) === base.key ? typed : base.time };
  }
  function setSession(k) { if (sessionOf(k)) { TR.tuk.session = k; renderTuktuk(); } }
  // The time picker of the run sheet (17 Nov 2026: «each run's time is editable»). Sri Lanka: the pickup of the session
  // (a time on the other side of runSessionSplit moves to that session); Morocco: the time the van leaves (one per day,
  // CampConfig.runDepartTime; the Tours pill keeps its own). The runs tapped next take this time.
  function setPickup(v) {
    if (!/^\d\d:\d\d$/.test(String(v || ''))) return;
    if (!SESSIONS) { TR.tuk.depart = { ...(TR.tuk.depart || {}), [TR.tuk.cat || 'all']: v }; renderTuktuk(); return; }
    const key = batchOf(v);
    TR.tuk.session = key; TR.tuk.pickup = { ...(TR.tuk.pickup || {}), [key]: v }; renderTuktuk();
  }
  const departTime = () => ((TR.tuk.depart || {})[TR.tuk.cat || 'all']) || CC.runDepartTime || PLAN_DEFAULT_TIME;
  // One new run row — the same fields from a tap, «Plan the day» and «people per surf spot».
  const runRow = (r, o) => ({ kind: RUN.kind, trip_date: o.day, trip_time: o.time, route: r.route, purpose: r.purpose, tour_name: r.tour || null,
    driver_id: TR.tuk.driver, expected_price: o.price, vehicle: o.vehicle, status: o.status, source: 'manual', pax: o.pax, ...(r.confirm && IS_SL ? { import_flags: [NO_ROW_FLAG(r.label)] } : {}) });
  // «Log runs»: the time and state of a run logged now. Sri Lanka: the session's pickup, a later day = planned (done by
  // itself on the day); Morocco: the day's departure (CampConfig.runDepartTime), done.
  const logWhen = ses => ({ time: ses ? ses.time : CC.runDepartTime ? departTime() : TR.tuk.date === cToday() ? cTime() : null, status: ses && TR.tuk.date > cToday() ? 'planned' : 'done' });
  // The runs planned for this day on this route that a run logged now IS (the same trip, never a second row): Morocco
  // the same vehicle first, then by time.
  const plannedRunsFor = (r, veh, ses) => TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === TR.tuk.date && (t.driver_id || '') === TR.tuk.driver && t.route === r.route && t.purpose === r.purpose
    && LIVE_RUN.includes(t.status) && !t.payment_entry_id && (!ses || batchOf(t.trip_time) === ses.key) && TR.tuk.date <= cToday())
    .sort((a, b) => (IS_SL ? 0 : ((a.vehicle === veh ? 0 : 1) - (b.vehicle === veh ? 0 : 1))) || String(a.trip_time || '').localeCompare(String(b.trip_time || '')));
  async function tap(key) {
    if (TR.busy.has('tap|' + key)) return;            // a double tap saves one run
    const r = tukRoute(key); if (!r || !canRun(r)) return;
    if (!TR.tuk.driver) { say('Pick the driver first', 'err'); return; }
    if (!IS_SL && pricesError()) { say('The van prices have not loaded from /prices — nothing saved. Check the connection and try again.', 'err'); return; }
    TR.busy.add('tap|' + key);
    try {
      const pax = IS_SL ? 1 : null; const veh = IS_SL ? RUN.veh : tukVehicle(); const price = runPrice(r, veh);
      // A run planned for this day on this route is the same trip: log it (done), never a second row next to it.
      // Morocco: the same vehicle first; another vehicle → that run takes the vehicle tapped and its price.
      const ses = SESSIONS ? tukSession() : null;
      const planned = plannedRunsFor(r, veh, ses)[0];
      if (planned) {
        const patch = { status: 'done', needs_resend: false };
        if (!IS_SL && planned.vehicle !== veh) Object.assign(patch, { vehicle: veh, expected_price: price });
        if (await updateTrip(planned.id, patch)) { say(`Logged the planned run · ${r.label}${IS_SL ? '' : ' · ' + veh} · ${money(patch.expected_price != null ? patch.expected_price : planned.expected_price)}`); renderTuktuk(); }
        return;
      }
      // No planned run left: a run removed after sending and tapped again before the update went comes back (the same row,
      // nothing to tell). One tap = one run.
      const tomb = TR.trips.find(t => t.kind === RUN.kind && t.trip_date === TR.tuk.date && (t.driver_id || '') === TR.tuk.driver && t.route === r.route && t.purpose === r.purpose
        && tombOf(t) && (!ses || batchOf(t.trip_time) === ses.key) && (IS_SL || t.vehicle === veh));
      if (tomb) {
        if (await updateTrip(tomb.id, { status: TR.tuk.date > cToday() ? 'sent' : 'done', cancel_reason: null, needs_resend: false })) { say(`Back · ${r.label}`); renderTuktuk(); }
        return;
      }
      // Sri Lanka: the run's time is the session's pickup; a run marked for a later day is planned (done by itself on the day).
      const row = runRow(r, { day: TR.tuk.date, ...logWhen(ses), price, vehicle: veh, pax });
      if (await insertTrip(row)) { say(`Saved · ${r.label}${IS_SL ? '' : ' · ' + veh} · ${money(price)}`); renderTuktuk(); }
    } finally { setTimeout(() => TR.busy.delete('tap|' + key), 300); }
  }
  // «−»: one run of this route did not happen — the last one logged, else one still planned.
  async function untap(key) {
    const r = tukRoute(key); if (!r || !canRun(r) || TR.busy.has('untap')) return;
    const ses = SESSIONS ? tukSession() : null;
    const mine = TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === TR.tuk.date && (t.driver_id || '') === TR.tuk.driver && t.route === r.route && t.purpose === r.purpose && !t.payment_entry_id && !runOff(t)
      && (!ses || batchOf(t.trip_time) === ses.key));
    const last = mine.sort((a, b) => ((LIVE_RUN.includes(a.status) ? 1 : 0) - (LIVE_RUN.includes(b.status) ? 1 : 0)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    if (!last) return;
    TR.busy.add('untap');
    try { if (await dropRun(last)) { say(`Removed one ${r.label}`); renderTuktuk(); } } finally { TR.busy.delete('untap'); }
  }
  // «All went as planned»: every run still planned for the day (this driver) is marked done — the same rows, so they
  // count once in «Owed to drivers» and Pay. A second tap finds nothing left to mark.
  async function allAsPlanned() {
    if (TR.busy.has('allplan')) return;
    const day = TR.tuk.date; const drv = TR.tuk.driver;
    const list = TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day && (t.driver_id || '') === drv && LIVE_RUN.includes(t.status) && !t.payment_entry_id && canRun(t));
    if (!list.length) return;
    TR.busy.add('allplan');
    try {
      let n = 0; for (const t of list) if (await updateTrip(t.id, { status: 'done', needs_resend: false })) n++;
      for (const t of staleTombs(day, drv)) await deleteTrip(t.id);
      say(`${n} run${n === 1 ? '' : 's'} logged as planned`); renderTuktuk();
    } finally { TR.busy.delete('allplan'); }
  }
  // Removing a run the driver already has and that is still to come: kept as «cancelled» (needs_resend) so the next
  // message says CANCELLED — the row is deleted once that UPDATE is sent. Any other unpaid run is deleted, as before
  // (a run that did not happen, taken out afterwards, tells nobody anything).
  const driverHas = t => !!t.sent_at && !runOff(t) && !t.payment_entry_id && `${t.trip_date}T${t.trip_time || '23:59'}` >= colomboNow();
  async function dropRun(t) {
    if (!t || t.payment_entry_id || !canRun(t)) return false;
    if (driverHas(t)) return !!(await updateTrip(t.id, { status: 'cancelled', cancel_reason: 'removed after the order was sent', needs_resend: true }));
    return deleteTrip(t.id);
  }

  // ── People per surf spot → vans / tuk-tuks (19 Nov 2026) ────────────────────────────────────────────────────
  // Miguel: «quando marcamos uns transporte de surf, meter o numero de pessoas que vao para cada local de surf e faz o
  // calculo automatico de quantas carrinhas ou tuk tuks (tuk tuks leva 3 pessoas)». Every surf spot of the run sheet
  // («Log runs» under its tap line, «Plan the day» in its own list) gets a people stepper. The answer is one line —
  // «7 people → 3 tuk-tuks», «20 people → 1 Big Van + 1 Minivan» — from the seats and prices in /prices
  // (GuestsTrips.planVehicles: the cheapest vehicles that seat everybody). A tap on that line changes it (another
  // vehicle, one tuk-tuk more or less) before saving. Save writes one run per vehicle, exactly as a tap / «Add to the
  // order» does (runRow: same price, driver, state, batch and WhatsApp order), with the people in that vehicle in pax
  // (7 → 3 + 2 + 2). A spot whose vehicles have no seats in /prices gets no stepper: the vehicle is chosen by hand, as before.
  // The tap lines stay: one tap = one run, the manual way.
  TR.tuk.sp = { pax: {}, over: {}, open: '' };
  const spReset = () => { TR.tuk.sp = { pax: {}, over: {}, open: '' }; };
  // Seats of a Sri Lanka tuk-tuk: the /prices row's capacity, else CampConfig.SL.runs.seats (3, Miguel 19 Nov 2026).
  const tukSeats = r => Number(r && r.capacity) > 0 ? Math.round(Number(r.capacity)) : (Number((CC.runs || {}).seats) || 3);
  // The vehicles a surf spot can take, with seats and the driver's price: Sri Lanka the tuk-tuk at the route's price,
  // Morocco the route's /prices vehicles (Car · Minivan · Big Van).
  function spVehicles(r) {
    if (!r) return [];
    const vs = IS_SL ? (r.confirm ? [] : [{ label: RUN.veh, capacity: tukSeats(r), price: Number(r.price) || 0 }])
      : vanVehicles(r).map(v => ({ label: v.label, capacity: v.capacity, price: v.price }));
    return vs.filter(v => Number(v.capacity) > 0 && Number(v.price) > 0);
  }
  const spCan = r => !!r && r.purpose === 'surf' && canRun(r) && spVehicles(r).length > 0;
  const spN = r => Number(TR.tuk.sp.pax[r.key]) || 0;
  // The plan for a spot: the automatic one, or the one changed by hand (TR.tuk.sp.over[key] = { label: count }).
  function spPlan(r) {
    const n = spN(r); const vs = spVehicles(r); const over = TR.tuk.sp.over[r.key];
    if (!over) return { ...GT.planVehicles(n, vs), n, changed: false, vs };
    const plan = vs.map(v => ({ ...v, count: Number(over[v.label]) || 0 })).filter(x => x.count > 0)
      .sort((a, b) => b.capacity - a.capacity);
    return { plan, count: plan.reduce((s, x) => s + x.count, 0), seats: plan.reduce((s, x) => s + x.count * x.capacity, 0), total: plan.reduce((s, x) => s + x.count * x.price, 0), flag: '', n, changed: true, vs };
  }
  const spWords = P => !P.count ? `no ${IS_SL ? 'tuk-tuk' : 'van'}` : IS_SL ? plural(P.count, 'tuk-tuk') : P.plan.map(x => plural(x.count, x.label)).join(' + ');
  // The units to save, largest first, each with its people (more vehicles than people → the extra ones are not saved).
  function spUnits(P) {
    const units = P.plan.flatMap(x => Array.from({ length: x.count }, () => x));
    const split = GT.splitPax(P.n, units.map(u => u.capacity));
    return units.map((u, i) => ({ ...u, pax: split[i] })).filter(u => u.pax > 0);
  }
  // The spots of the open sheet that take people, in screen order (the handlers get the index).
  const spList = () => (TR.tuk.mode === 'plan' ? planRoutes() : catRoutes()).surf.filter(spCan);
  // What this spot already has, so the row can say it (20 Nov 2026, Miguel: «está um bocado estranho» — one row per
  // spot, never two counters): «Log runs» = this day, driver and session, logged / still planned; «Plan the day» = the
  // runs of the spot already in the order. data-logged / data-planned carry the counts (as the old tap line did).
  function spHas(r) {
    const plan = TR.tuk.mode === 'plan'; const ses = !plan && SESSIONS ? tukSession() : null;
    const day = plan ? TR.tuk.planDate : TR.tuk.date;
    const rs = TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day && (t.driver_id || '') === TR.tuk.driver && t.route === r.route && t.purpose === r.purpose && !runOff(t)
      && (plan ? inDay(t) : (!ses || batchOf(t.trip_time) === ses.key)));
    const logged = plan ? [] : rs.filter(t => !LIVE_RUN.includes(t.status)); const planned = plan ? rs : rs.filter(t => LIVE_RUN.includes(t.status));
    const words = list => { if (IS_SL) return plural(list.length, 'tuk-tuk'); const by = new Map(); list.forEach(t => by.set(t.vehicle || 'van', (by.get(t.vehicle || 'van') || 0) + 1));
      return [...by.entries()].sort((a, b) => vehRank(b[0]) - vehRank(a[0])).map(([v, n]) => plural(n, v)).join(' + '); };
    const people = list => { const p = list.reduce((a, t) => a + (runPax(t) || 0), 0); return list.length && !list.some(t => runPax(t) == null) && !(IS_SL && p <= list.length) ? p : 0; };
    const bit = (list, what) => list.length ? `${words(list)} ${what}${people(list) ? ` · ${ppl(people(list))}` : ''}` : '';
    const text = [bit(logged, 'already logged'), bit(planned, plan ? 'already in the order' : 'planned')].filter(Boolean).join(' · ');
    return { logged: logged.length, planned: planned.length, text };
  }
  // The unit price under the spot's name: «LKR 500 per tuk-tuk» / Morocco the cheapest vehicle, «from MAD 300».
  const spPrice = r => IS_SL ? `${money(Number(r.price) || 0)} per tuk-tuk` : `from ${money(Math.min(...spVehicles(r).map(v => v.price)))}`;
  function spOut(r, i) {
    const n = spN(r); if (!n) return '';
    const P = spPlan(r); const open = TR.tuk.sp.open === r.key;
    const short = P.count && P.seats < n ? `<div class="hint tr-sp-warn" data-sp-short>Only ${P.seats} seats for ${ppl(n)} — add a vehicle</div>` : '';
    const edit = !open ? '' : `<div class="tr-sp-edit" data-sp-edit>${P.vs.map((v, j) => { const c = (P.plan.find(x => x.label === v.label) || {}).count || 0;
      return `<div class="tr-sp-vrow" data-v="${h(v.label)}"><span class="tr-sp-vl">${h(v.label)}<span class="hint"> · ${v.capacity} seats · ${money(v.price)}</span></span>
        <span class="tr-step"><button type="button" class="btn btn-s btn-icon" title="One less" onclick="TransportUI.spVeh(${i},${j},-1)" ${c ? '' : 'disabled'}>${ic('minus')}</button><b class="num">${c}</b><button type="button" class="btn btn-s btn-icon" title="One more" onclick="TransportUI.spVeh(${i},${j},1)">${ic('plus')}</button></span></div>`; }).join('')}
      ${P.changed ? `<button type="button" class="btn-link tr-sp-auto" onclick="TransportUI.spAuto(${i})">Back to the automatic choice</button>` : ''}</div>`;
    // a thin line under the row: «→ 2 tuk-tuks · LKR 1,000» (tap = change the vehicles)
    return `<button type="button" class="tr-sp-ans" data-sp-ans aria-expanded="${open}" title="Change the vehicles" onclick="TransportUI.spOpen(${i})"><span class="tr-sp-what">${h(ppl(n))} → <b>${h(spWords(P))}</b> · <span class="tr-sp-amt num">${money(P.total)}</span>${P.changed ? ' <span class="hint">· changed</span>' : ''}</span>${ic(open ? 'chevron-up' : 'chevron-down')}</button>${short}${edit}`;
  }
  // One row per surf spot: the name and its price on the left, the people stepper on the right (the only input).
  function spRow(r, i) {
    const n = spN(r); const has = spHas(r);
    return `<div class="tr-sp" data-sp="${i}" data-key="${h(r.key)}" data-logged="${has.logged}" data-planned="${has.planned}"><div class="tr-sp-row"><span class="tr-sp-l"><b class="tr-sp-name">${h(spotName(r.label))}</b><span class="hint tr-sp-price">${h(spPrice(r))}</span>${has.text ? `<span class="hint tr-sp-had">${h(has.text)}</span>` : ''}</span>
      <span class="tr-step tr-sp-step"><button type="button" class="btn btn-s btn-icon" title="One person less" onclick="TransportUI.spStep(${i},-1)">${ic('minus')}</button><input type="number" inputmode="numeric" min="0" max="99" class="tr-sp-n num" id="tk_spn${i}" value="${n}" aria-label="People to ${h(spotName(r.label))}" onfocus="this.select()" oninput="TransportUI.spInput(${i}, this.value)"><button type="button" class="btn btn-s btn-icon" title="One person more" onclick="TransportUI.spStep(${i},1)">${ic('plus')}</button><span class="tr-sp-unit">people</span></span></div>
      <div class="tr-sp-out" id="tk_spo${i}">${spOut(r, i)}</div></div>`;
  }
  // The one save for every spot typed: «Save 3 tuk-tuks» / «Add 2 vans to the order» — in the sheet's footer (always in
  // sight on a phone). While people are typed it is the one blue button and the footer's other steps («All went as
  // planned», «Send to …») wait: one decision at a time; they come back once the runs are saved or the people cleared.
  const spUnitsTyped = () => spList().map(spPlan).filter(P => P.n > 0).reduce((s, P) => s + spUnits(P).length, 0);
  function spSaveBtn() {
    const units = spUnitsTyped(); if (!units) return '';
    const noun = n => IS_SL ? plural(n, 'tuk-tuk') : plural(n, 'van');
    const text = TR.tuk.mode === 'plan' ? `Add ${noun(units)} to the order` : `Save ${noun(units)}`;
    return `<button type="button" class="btn btn-p" id="tk_spsave" data-units="${units}" onclick="TransportUI.spSave()">${ic(TR.tuk.mode === 'plan' ? 'plus' : 'check')} ${text}</button>`;
  }
  const spBarHtml = () => `<div class="hint tr-sp-bar" id="tk_spbar">Type how many people go to each spot — the ${IS_SL ? 'tuk-tuks' : 'vans'} are worked out from the seats in /prices.</div>`;
  // Repaint one spot's answer and the footer in place (the input keeps its focus and caret).
  function spPaint(i) {
    const r = spList()[i]; const o = $('tk_spo' + i); if (r && o) o.innerHTML = spOut(r, i);
    const foot = document.querySelector('#trOv .mfooter'); if (!foot || !$('tk_spbar')) return;
    let slot = $('tk_spfoot'); if (!slot) { slot = document.createElement('span'); slot.id = 'tk_spfoot'; slot.className = 'tr-sp-foot'; foot.appendChild(slot); }
    slot.innerHTML = spSaveBtn();
    const typed = !!$('tk_spsave');
    foot.querySelectorAll(':scope > .btn').forEach(b => {
      if (b.id === 'tk_done') { if (b.classList.contains('btn-p')) b.dataset.p = '1'; if (b.dataset.p) { b.classList.toggle('btn-p', !typed); b.classList.toggle('btn-s', typed); } }
      else b.style.display = typed ? 'none' : '';
    });
  }
  function spSet(i, v) {
    const r = spList()[i]; if (!r) return 0;
    const n = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
    TR.tuk.sp.pax[r.key] = n; delete TR.tuk.sp.over[r.key];        // new people → the automatic choice again
    if (!n && TR.tuk.sp.open === r.key) TR.tuk.sp.open = '';
    return n;
  }
  function spStep(i, d) { const r = spList()[i]; if (!r) return; const n = spSet(i, spN(r) + d); const el = $('tk_spn' + i); if (el) el.value = n; spPaint(i); }
  function spInput(i, v) { spSet(i, v); spPaint(i); }
  function spOpen(i) { const r = spList()[i]; if (!r) return; const was = TR.tuk.sp.open; TR.tuk.sp.open = was === r.key ? '' : r.key;
    spList().forEach((x, j) => { if (x.key === was || x.key === r.key) spPaint(j); }); }
  function spVeh(i, j, d) {
    const r = spList()[i]; if (!r) return; const P = spPlan(r); const v = P.vs[j]; if (!v) return;
    const over = {}; P.vs.forEach(x => { over[x.label] = (P.plan.find(p => p.label === x.label) || {}).count || 0; });
    over[v.label] = Math.max(0, Math.min(20, over[v.label] + d));
    TR.tuk.sp.over[r.key] = over; spPaint(i);
  }
  function spAuto(i) { const r = spList()[i]; if (!r) return; delete TR.tuk.sp.over[r.key]; spPaint(i); }
  async function spSave() {
    if (TR.busy.has('spsave')) return;
    const plan = TR.tuk.mode === 'plan';
    if (!TR.tuk.driver) { say('Pick the driver first', 'err'); return; }
    if (!IS_SL && pricesError()) { say('The van prices have not loaded from /prices — nothing saved. Check the connection and try again.', 'err'); return; }
    const day = plan ? TR.tuk.planDate : TR.tuk.date;
    const ses = !plan && SESSIONS ? tukSession() : null;
    const time = plan ? (($('tk_spt') && $('tk_spt').value) || TR.tuk.planTime) : logWhen(ses).time;
    if (plan && !/^\d\d:\d\d$/.test(String(time || ''))) { say('Type the time, e.g. 07:30', 'err'); return; }
    const status = plan ? planStatus(day) : logWhen(ses).status;
    const todo = spList().map(r => ({ r, P: spPlan(r) })).filter(x => x.P.n > 0 && spUnits(x.P).length);
    if (!todo.length) return;
    TR.busy.add('spsave');
    try {
      if (plan) TR.tuk.planTime = time;
      const done = []; const used = new Set();
      for (const { r, P } of todo) {
        let k = 0; const units = spUnits(P);
        for (const u of units) {
          const veh = IS_SL ? RUN.veh : u.label; const price = runPrice(r, veh);
          // «Log runs»: a run already planned for this spot is this one (logged, with its people) — never a second row.
          const pl = plan ? null : plannedRunsFor(r, veh, ses).find(t => !used.has(t.id));
          if (pl) {
            used.add(pl.id);
            const patch = { status: 'done', needs_resend: false, pax: u.pax };
            if (!IS_SL && pl.vehicle !== veh) Object.assign(patch, { vehicle: veh, expected_price: price });
            if (!await updateTrip(pl.id, patch)) break;
          } else if (!await insertTrip(runRow(r, { day, time, status, price, vehicle: veh, pax: u.pax }))) break;
          k++;
        }
        if (k) { done.push(`${r.label} · ${spWords(P)} (${ppl(P.n)})`); delete TR.tuk.sp.pax[r.key]; delete TR.tuk.sp.over[r.key]; }
        if (k < units.length) break;                                          // a save failed: the toast says why, the rest waits
      }
      TR.tuk.sp.open = '';
      if (done.length) say(`${plan ? 'Added to the order' : 'Saved'} · ${done.join(' · ')}`);
      renderTuktuk();
    } finally { TR.busy.delete('spsave'); }
  }
  // «Plan the day»: the time of the people list is the time of «Add a run» (one time for the order being written).
  function spSetTime(v) { if (/^\d\d:\d\d$/.test(String(v || ''))) { TR.tuk.planTime = v; const pt = $('tk_pt'); if (pt) pt.value = v; } }

  // ── Batches: what goes to the driver, and where each one stands ────────────────────────────────────────────
  // Miguel, 17 Nov 2026 (Sri Lanka): «preciso de mandar quando marco — normalmente marco de manhã a aula da manhã e à
  // tarde antes da aula da tarde». So the runs go out in BATCHES:
  //   Sri Lanka  one batch per lesson session of the day — Morning / Afternoon (CampConfig.runSessions, split at
  //              runSessionSplit): every run of the day he marks (done) or plans, today or later. The afternoon message
  //              never repeats the morning runs already sent.
  //   Morocco    one batch per day, the runs planned ahead (Plan the day, tomorrow) — logged runs are not in it.
  // A row's state is decided when it is written (as the airport transfers): new = in the batch, no sent_at; changed =
  // needs_resend (an edit while the driver still has it to come); cancelled = the tombstone dropRun leaves. Sending
  // stamps every row of the batch sent_at + sent_snapshot { trip_date, trip_time, label, vehicle, to, batch } (the
  // snapshot only words the UPDATE: «×3 (was ×2)»), turns 'planned' into 'sent' (a done run stays done: it is still
  // owed), and deletes the tombstones. Everything comes from those columns, so a reload shows the same.
  const SESSIONS = IS_SL ? (CC.runSessions || [{ key: 'morning', label: 'Morning', time: '07:30' }, { key: 'afternoon', label: 'Afternoon', time: '14:00' }]) : null;
  const SESSION_SPLIT = CC.runSessionSplit || '12:00';
  const batchOf = time => !SESSIONS ? 'day' : (!time || time < SESSION_SPLIT) ? SESSIONS[0].key : SESSIONS[1].key;
  const sessionOf = key => (SESSIONS || []).find(x => x.key === key) || null;
  const batchKeys = () => SESSIONS ? SESSIONS.map(x => x.key) : ['day'];
  const snapOf = t => t.sent_snapshot || {};
  const fromPay = t => t.notes === 'Added when paying';     // «Run not in the list» in Pay: it happened, nothing to send
  // In a batch: Sri Lanka every run of the day (not removed, not added in Pay); Morocco the runs planned ahead, and the
  // ones logged out of an order he got.
  const inBatch = t => canRun(t) && inDay(t);
  // On the plan of the day (shown to everybody, read-only for the areas you may not run).
  const inDay = t => !runOff(t) && !fromPay(t) && (IS_SL ? true : (LIVE_RUN.includes(t.status) && !!t.trip_time) || (t.status === 'done' && !!t.sent_at));
  // Only while the run is still to come: once its time has passed there is nothing left to tell the driver.
  const ahead = t => `${t.trip_date}T${t.trip_time || '23:59'}` >= colomboNow();
  const tombOf = t => t.status === 'cancelled' && t.needs_resend && !!t.sent_at && !t.payment_entry_id && ahead(t);
  // A tombstone whose time has passed (removed, never told, too late now): deleted the next time the day is sent or logged.
  const staleTombs = (day, drv) => dayRunsOf(day, drv).filter(t => t.status === 'cancelled' && t.needs_resend && !!t.sent_at && !t.payment_entry_id && !ahead(t) && t.source === 'manual');
  const dayRunsOf = (day, drv) => TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day && (t.driver_id || '') === (drv || ''));
  // Sri Lanka's batches are for today and later (yesterday's runs are history, nothing to send).
  const sendableDay = day => !IS_SL || day >= cToday();
  function batchState(day, drv, b) {
    const rows = dayRunsOf(day, drv);
    const members = rows.filter(t => inBatch(t) && batchOf(t.trip_time) === b);
    const tomb = rows.filter(t => tombOf(t) && canRun(t) && batchOf(snapOf(t).trip_time || t.trip_time) === b);   // never someone else's area
    const base = { day, driver: drv || '', batch: b, members, tomb, fresh: [], chg: [], sentAt: '', to: '' };
    if (!members.length && !tomb.length) return { ...base, key: 'none' };
    const sent = members.filter(t => !!t.sent_at);
    // A run with no sent_at in a batch already sent is NEW whatever its time (marked late: he still has to know).
    const fresh = members.filter(t => !t.sent_at); const chg = sent.filter(t => t.needs_resend && ahead(t));
    const last = sent.concat(tomb).sort((a, b2) => String(b2.sent_at).localeCompare(String(a.sent_at)))[0];
    const x = { ...base, fresh, chg, sentAt: last ? last.sent_at : '', to: last ? (snapOf(last).to || '') : '' };
    if (!IS_SL && !tomb.length && members.every(t => t.status === 'done')) return { ...x, key: 'logged' };
    if (!sent.length && !tomb.length) return { ...x, key: 'planned' };
    if (!sendableDay(day)) return { ...x, key: 'sent' };
    if (!(fresh.length || chg.length || tomb.length)) return { ...x, key: 'sent' };
    // Removed and added back the same before sending (a tombstone and a new row on the same line): nothing to tell him.
    return { ...x, key: batchChanges({ ...x, key: 'changed' }).length ? 'changed' : 'sent' };
  }
  // Every batch of a day for one driver (Sri Lanka: Morning, Afternoon; Morocco: the day).
  const batchesOf = (day, drv) => batchKeys().map(b => batchState(day, drv, b));
  // A Morocco day: nothing in the order but runs logged → «Logged ✓ · N runs».
  const loggedOf = (day, drv) => dayRunsOf(day, drv).filter(t => t.status === 'done');
  const STATE_RANK = { changed: 5, planned: 4, sent: 3, logged: 2, none: 1 };
  // The day for one driver (or every driver with runs that day): the worst batch wins; its batches for the header.
  function planState(day, drv) {
    const ids = drv !== undefined ? [drv || ''] : [...new Set(TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day).map(t => t.driver_id || ''))];
    if (!ids.length) ids.push((defaultDriver(RUN.drv) || {}).id || '');
    const batches = ids.flatMap(id => batchesOf(day, id));
    let worst = batches.slice().sort((a, b) => STATE_RANK[b.key] - STATE_RANK[a.key])[0];
    const logged = ids.flatMap(id => loggedOf(day, id));
    if (!IS_SL && worst.key === 'none' && logged.length) worst = { ...worst, key: 'logged' };
    return { ...worst, batches, logged, live: batches.flatMap(x => x.members.filter(t => LIVE_RUN.includes(t.status))) };
  }
  const pendingOf = (day, drv) => sendableDay(day) ? batchesOf(day, drv).filter(x => x.key === 'planned' || x.key === 'changed') : [];
  // «07:12» when it went out today, «16 Nov 19:00» otherwise (the camp's time zone).
  function sentWhen(iso) { const p = stampParts(iso); return p && p.day === cToday() ? p.time : stampText(iso); }
  const batchName = x => SESSIONS ? (sessionOf(x.batch) || {}).label || '' : '';
  const planBadgeText = s => s.key === 'none' ? 'Not planned' : s.key === 'planned' ? (IS_SL ? 'Not sent' : 'Planned · not sent')
    : s.key === 'sent' ? `Sent ${s.sentAt ? sentWhen(s.sentAt) + ' ' : ''}✓${s.to ? ` to ${s.to}` : ''}` : s.key === 'changed' ? 'Changed after sending — send again'
    : `Logged ✓ · ${(s.logged || []).length} run${(s.logged || []).length === 1 ? '' : 's'}`;
  const PLAN_CLS = { none: 'badge-grey', planned: 'badge-grey', sent: 'badge-green', changed: 'badge-amber', logged: 'badge-green' };

  // ── The messages (house style, no emoji) ─────────────────────────────────────────────────────────────────
  // A planned run is one camp_trips row with a time; it counts as done by itself once that time passes (isDone /
  // camp_trip_is_done), like an airport trip — «All went as planned» / a tap in «Log runs» writes it down ('done').
  const planRuns = (day, drv) => TR.trips.filter(t => t.kind === RUN.kind && t.trip_date === day && (drv === undefined || (t.driver_id || '') === (drv || '')) && inDay(t) && t.trip_time
    && (IS_SL || LIVE_RUN.includes(t.status))).sort((a, b) => (a.trip_time + runLabel(a)).localeCompare(b.trip_time + runLabel(b)));
  const lineKey = x => [x.time, x.label, IS_SL ? '' : (x.vehicle || '')].join('|');
  function planLines(runs) {
    const by = new Map();
    runs.forEach(t => { const k = t.trip_time + '|' + runLabel(t) + (IS_SL ? '' : '|' + (t.vehicle || '')); const x = by.get(k) || { time: t.trip_time, label: runLabel(t), vehicle: IS_SL ? '' : (t.vehicle || ''), n: 0, sum: 0, pax: 0, ids: [], sample: t }; x.n++; x.sum += Number(t.expected_price || 0); x.ids.push(t.id); by.set(k, x); });
    return [...by.values()].sort((a, b) => (a.time + a.label).localeCompare(b.time + b.label));
  }
  // The driver's words for a run (19 Nov 2026, Miguel: one line per spot with its vehicles and people): the spot's name —
  // Sri Lanka «Camp → Ahangama» → «Ahangama», Morocco «Surf Taghazout» → «Taghazout»; camp runs and tours as they are.
  const spotName = label => String(label || '').replace(/^Camp → /, '').replace(IS_SL ? /^(?!)/ : /^Surf\s+/i, '');
  const vehNoun = (n, v) => IS_SL ? plural(n, 'tuk-tuk') : plural(n, v || 'van');
  // «08:00 Taghazout: 2 Minivans» — the sheet's «Planned for today» hint and the UPDATE lines (one vehicle kind per line).
  const planLineText = x => `${x.time} ${spotName(x.label)}: ${vehNoun(x.n, x.vehicle)}`;
  // The order itself: one line per spot and time with every vehicle and the people typed —
  // «- Ahangama: 3 tuk-tuks (7 people)», «- Imsouane: 1 Big Van + 1 Minivan (20 people)». The people show for surf runs
  // that all carry a count (Sri Lanka: only when typed — a tapped tuk-tuk carries 1, so a line of 1s says nothing).
  const vehRank = v => { const i = vanLabels().indexOf(v); return i < 0 ? -1 : i; };
  function spotLines(runs) {
    const by = new Map();
    (runs || []).forEach(t => { const label = runLabel(t); const k = (t.trip_time || '') + '|' + label;
      const x = by.get(k) || { time: t.trip_time || '', label, spot: spotName(label), veh: new Map(), runs: [] };
      const v = IS_SL ? RUN.veh : (t.vehicle || 'van'); x.veh.set(v, (x.veh.get(v) || 0) + 1); x.runs.push(t); by.set(k, x); });
    return [...by.values()].sort((a, b) => (a.time + a.spot).localeCompare(b.time + b.spot)).map(x => {
      const ps = x.runs.map(runPax); const sum = ps.reduce((s, p) => s + (p || 0), 0);
      const people = x.runs.every(t => t.purpose === 'surf') && ps.every(p => p != null) && !(IS_SL && sum <= x.runs.length) ? sum : 0;
      const vehicles = [...x.veh.entries()].sort((a, b) => vehRank(b[0]) - vehRank(a[0])).map(([v, n]) => vehNoun(n, v)).join(' + ');
      return { ...x, people, text: `- ${x.spot}: ${vehicles}${people ? ` (${ppl(people)})` : ''}` };
    });
  }
  // «*TUK TUKS - AFTERNOON SAT 14 NOV · PICKUP 14:00*» (Sri Lanka) · «*VANS - SAT 14 NOV*» (Morocco, as before).
  function batchTitle(day, b, rows) {
    if (!SESSIONS) return `VANS - ${fmtDay(day).toUpperCase()}`;
    const first = (rows || []).map(t => t.trip_time).filter(Boolean).sort()[0] || (sessionOf(b) || {}).time || '';
    return `TUK TUKS - ${String((sessionOf(b) || {}).label || '').toUpperCase()} ${fmtDay(day).toUpperCase()}${first ? ` · PICKUP ${first}` : ''}`;
  }
  // The body under the title: a blank line, then the spot lines. A time line heads each departure — always in Morocco
  // (the title has the day only), in Sri Lanka only when a session has more than one pickup (the title gives the first).
  function orderBody(runs) {
    const lines = spotLines(runs); const times = [...new Set(lines.map(x => x.time))];
    const heads = !SESSIONS || times.length > 1;
    const out = []; let last = null;
    lines.forEach(x => { if (x.time !== last) { out.push(''); if (heads && x.time) out.push(x.time); last = x.time; } out.push(x.text); });
    return out;
  }
  // The whole order of these runs, one section per batch (Morocco: one).
  function orderText(day, runs) {
    return batchKeys().map(b => { const rs = (runs || []).filter(t => batchOf(t.trip_time) === b); return rs.length ? [`*${batchTitle(day, b, rs)}*`, ...orderBody(rs)].join('\n') : ''; })
      .filter(Boolean).join('\n\n');
  }
  // What changed in a batch since it was sent, line by line: what he had (each row's snapshot, the tombstones) against
  // what it is now — «- 07:30 Ahangama: 3 tuk-tuks (was 2)», «… NEW», «… CANCELLED».
  function batchChanges(x) {
    const keyNow = t => lineKey({ time: t.trip_time, label: runLabel(t), vehicle: t.vehicle || '' });
    const keyHad = t => { const s = snapOf(t); return s.label ? lineKey({ time: s.trip_time, label: s.label, vehicle: s.vehicle || '' }) : keyNow(t); };
    const had = new Map(), now = new Map(), info = new Map();
    const add = (m, k, t, lbl) => { m.set(k, (m.get(k) || 0) + 1); if (!info.has(k)) info.set(k, lbl); };
    x.members.filter(t => t.sent_at).forEach(t => { const s = snapOf(t); add(had, keyHad(t), t, s.label ? { time: s.trip_time, label: s.label, vehicle: s.vehicle || '' } : { time: t.trip_time, label: runLabel(t), vehicle: t.vehicle || '' }); });
    x.tomb.forEach(t => { const s = snapOf(t); add(had, keyHad(t), t, s.label ? { time: s.trip_time, label: s.label, vehicle: s.vehicle || '' } : { time: t.trip_time, label: runLabel(t), vehicle: t.vehicle || '' }); });
    x.members.forEach(t => add(now, keyNow(t), t, { time: t.trip_time, label: runLabel(t), vehicle: t.vehicle || '' }));
    const out = [];
    [...new Set([...had.keys(), ...now.keys()])].sort().forEach(k => {
      const a = had.get(k) || 0, n = now.get(k) || 0; if (a === n) return; const l = info.get(k);
      out.push(n === 0 ? `- ${planLineText({ ...l, n: a })} CANCELLED` : a === 0 ? `- ${planLineText({ ...l, n })} NEW` : `- ${planLineText({ ...l, n })} (was ${a})`);
    });
    if (!out.length) x.chg.forEach(t => out.push(`- ${planLineText({ time: t.trip_time, label: runLabel(t), vehicle: t.vehicle || '', n: 1 })} (changed)`));
    return out;
  }
  // The section a pending batch sends: the whole batch the first time, only the changes after that («UPDATE:»).
  function batchMessage(x) {
    const title = batchTitle(x.day, x.batch, x.members.length ? x.members : x.tomb);
    if (x.key === 'changed') return [`*UPDATE: ${title}*`, '', ...batchChanges(x)].join('\n');
    return [`*${title}*`, ...orderBody(x.members)].join('\n');
  }
  // What «Send» sends for a day and driver: every batch not sent yet or changed since — never one he already has as it is.
  const planMessage = (day, drv) => pendingOf(day, drv).map(batchMessage).join('\n\n');
  // Send: WhatsApp to the run contact, then every row of each batch sent is stamped with what he now has.
  async function sendBatches(day, drv) {
    if (TR.busy.has('order')) return false;
    const pend = pendingOf(day, drv); if (!pend.length) return false;
    const c = tukContact();
    window.open(GT.whatsappUrl(c && c.phone || '', pend.map(batchMessage).join('\n\n')), '_blank', 'noopener');
    TR.busy.add('order');
    try {
      const now = new Date().toISOString();
      for (const x of pend) {
        for (const t of x.members) {
          const patch = { sent_at: now, sent_snapshot: { trip_date: t.trip_date, trip_time: t.trip_time, route: t.route, label: runLabel(t), vehicle: t.vehicle || null, to: c ? c.name : '', batch: x.batch }, needs_resend: false };
          if (t.status === 'planned' && !t.payment_entry_id) patch.status = 'sent';     // a done run stays done (owed)
          await updateTrip(t.id, patch);
        }
        for (const t of x.tomb) await deleteTrip(t.id);                                 // told: the tombstone goes
      }
      for (const t of staleTombs(day, drv)) await deleteTrip(t.id);
      say(`${pend.some(x => x.key === 'changed') ? 'Update' : 'Order'} opened in WhatsApp for ${c ? c.name : `the ${RUN.lower} contact`} · marked Sent ✓`);
      return true;
    } finally { TR.busy.delete('order'); }
  }
  // The block both sheets show: what goes out with «Send» (and what changed), or where the day stands.
  function sendBox(day, drv) {
    const B = batchesOf(day, drv).filter(x => x.key !== 'none' && x.key !== 'logged');
    if (!B.length) return '';
    const row = x => {
      const ch = x.key === 'changed' ? batchChanges(x) : [];
      return `<div class="tr-batch" data-batch="${x.batch}" data-batch-state="${x.key}"><span class="tr-batch-l">${batchName(x) ? `<b>${h(batchName(x))}</b> · ` : ''}${x.members.length} run${x.members.length === 1 ? '' : 's'}</span>
        ${SESSIONS ? `<span class="badge ${PLAN_CLS[x.key]}" data-plan-state="${x.key}">${h(planBadgeText(x))}</span>` : '<span class="hint">Changed since it was sent — the message lists only this:</span>'}${ch.length ? `<div class="hint tr-batch-ch">${ch.map(t => h(t)).join('<br>')}</div>` : ''}</div>`;
    };
    return `<div class="tr-batches" id="tk_batches">${B.map(row).join('')}</div>`;
  }
  function renderPlan(seg) {
    const day = TR.tuk.planDate; const drv = TR.tuk.driver; const c = tukContact(); const who = c ? c.name : `the ${RUN.lower} contact`;
    const runs = planRuns(day, drv); const lines = planLines(runs); const s = planState(day, drv); const pend = pendingOf(day, drv);
    if (!TR.tuk.planRoute || !tukRoute(TR.tuk.planRoute) || !routeInCat(tukRoute(TR.tuk.planRoute)) || !canRun(tukRoute(TR.tuk.planRoute))) { const C = planRoutes(); TR.tuk.planRoute = ([...C.surf, ...C.camp, ...C.tour][0] || {}).key || ''; }
    const today = cToday(), tm = GT.addDaysIso(today, 1);
    const chip = (d, label) => `<button type="button" class="pill${day === d ? ' active' : ''}" data-day="${d}" onclick="TransportUI.tukSet('planDate','${d}')">${label}</button>`;
    const days = `<div class="pills tr-seg tr-dayseg" id="tk_pday">${chip(today, 'Today')}${chip(tm, 'Tomorrow')}${day !== today && day !== tm ? chip(day, h(fmtDay(day))) : ''}</div>`;
    const state = `<span class="badge ${PLAN_CLS[s.key]}" id="tk_sent" data-plan-state="${s.key}">${h(planBadgeText(s))}</span>`;
    const body = `${seg}${SESSIONS ? sendBox(day, drv) : ''}<div class="g2 tr-tuk-head"><div class="mfield"><label>Day</label>${days}</div>
      <div class="mfield"><label>Driver</label><select id="tk_dr" onchange="TransportUI.tukSet('driver', this.value)">${driverOptions(drv)}</select></div></div>
      <div class="section-lbl">${fmtDay(day)} · the order</div>
      <div class="tr-plan" id="tk_plan">${lines.length ? lines.map((x, i) => `<div class="tr-plan-line" data-plan="${i}"><b class="num">${h(x.time)}</b><span>${h(x.label)}${IS_SL ? '' : ` <span class="hint">· ${h(x.vehicle || 'van')}</span>`}</span>
          ${canRun(x.sample) ? `<span class="tr-step"><button class="btn btn-s btn-icon" title="One run less" onclick="TransportUI.planStep(${i}, -1)">${ic('minus')}</button><b class="num">${x.n}</b><button class="btn btn-s btn-icon" title="One run more" onclick="TransportUI.planStep(${i}, 1)">${ic('plus')}</button></span>`
            : `<span class="tr-step tr-step-ro" data-ro="${areaOf(x.sample)}"><span class="hint">camp manager</span><b class="num">${x.n}</b></span>`}</div>`).join('')
        : `<div class="hint">No runs planned for ${h(dayWord(day))} yet. Add the first one below.</div>`}</div>
      ${runs.length || s.key !== 'none' ? `<div class="tr-tuk-total"><span>${runs.length} run${runs.length === 1 ? '' : 's'} · ${state}</span><b class="num">${money(runs.reduce((a, t) => a + Number(t.expected_price || 0), 0))}</b></div>` : ''}
      ${!SESSIONS && s.key === 'changed' ? sendBox(day, drv) : ''}
      ${(() => { const SP = spList(); if (!SP.length) return '';
        return `<div class="section-lbl">Surf · people per spot</div>
        <div class="mfield tr-sp-time"><label>${SESSIONS ? 'Pickup' : 'Leaves at'}</label>${timeSelect('tk_spt', TR.tuk.planTime, 'onchange="TransportUI.spSetTime(this.value)"')}</div>
        ${SP.map((r, i) => spRow(r, i)).join('')}${spBarHtml()}`; })()}
      <div class="section-lbl">Add a run</div>
      <div class="tr-plan-add"><div class="mfield"><label>Time</label>${timeSelect('tk_pt', TR.tuk.planTime, `onchange="TransportUI.tukSet('planTime', this.value)"`)}</div>
        <div class="mfield"><label>Route</label><select id="tk_pr" onchange="TransportUI.tukSet('planRoute', this.value)">${routeOptions(TR.tuk.planRoute, 'plan', IS_SL ? '' : planVehicle())}</select></div>
        <div class="mfield"><label>${IS_SL ? 'Tuk-tuks' : 'Vans'}</label><input type="number" min="1" max="20" id="tk_pn" value="${TR.tuk.planCount}" onchange="TransportUI.tukSet('planCount', this.value)"></div>
        ${IS_SL ? '' : `<div class="mfield"><label>Vehicle</label>${vehiclePick('tk_pv', planVehicle(), "TransportUI.tukSet('planVehicle', this.value)")}</div>`}
        <button class="btn btn-s" id="tk_padd" onclick="TransportUI.planAdd()">${ic('plus')} Add to the order</button></div>
      ${c && !c.phone ? `<div class="hint">No phone for ${h(c.name)} yet — WhatsApp will ask you to pick the chat. Add the number in Drivers.</div>` : ''}`;
    const anyChanged = pend.some(x => x.key === 'changed');
    const sendLbl = anyChanged ? `Send the update to ${h(who)} on WhatsApp` : `Send to ${h(who)} on WhatsApp`;
    // One blue button: the send while something is not sent (or changed); once all is sent, «Done».
    const sendBtn = pend.length ? `<button class="btn btn-p" id="tk_send" onclick="TransportUI.sendOrder()">${ic('send')} ${sendLbl}</button>` : '';
    const ov = modal(sheetTitle(), PLAN_DAY === 'today' ? 'Plan the runs, then send the order to the driver at once' : 'Plan the runs, then send the order to the driver the evening before', body,
      `<button class="btn ${pend.length ? 'btn-s' : 'btn-p'}" id="tk_done" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>${sendBtn}`);
    const mf = ov && ov.querySelector('.mfooter'); if (mf) mf.classList.add('tr-foot1');
    spPaint(-1);
  }
  // sent_at is a UTC stamp: show it in the camp's time zone.
  function stampParts(iso) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CC.tz || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
      return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    } catch (_) { return null; }
  }
  function stampText(iso) { const p = stampParts(iso); return p ? `${fmtShort(p.day)} ${p.time}` : ''; }
  // Sri Lanka: a run marked for today is done (as a tap in the run sheet); a later day's, and every Morocco plan, is planned.
  const planStatus = day => SESSIONS && day <= cToday() ? 'done' : 'planned';
  async function planAdd() {
    if (TR.busy.has('plan')) return;
    const r = tukRoute(($('tk_pr') && $('tk_pr').value) || TR.tuk.planRoute); const time = ($('tk_pt') && $('tk_pt').value) || '';
    const n = Math.min(20, Math.max(1, parseInt(($('tk_pn') && $('tk_pn').value) || '1', 10) || 1));
    if (!TR.tuk.driver) { say('Pick the driver first', 'err'); return; }
    if (!r || !canRun(r)) { say('Pick the route', 'err'); return; }
    if (!/^\d\d:\d\d$/.test(time)) { say('Type the time, e.g. 07:30', 'err'); return; }
    if (!IS_SL && pricesError()) { say('The van prices have not loaded from /prices — nothing saved. Check the connection and try again.', 'err'); return; }
    TR.busy.add('plan');
    try {
      TR.tuk.planTime = time; TR.tuk.planRoute = r.key; TR.tuk.planCount = 1;
      for (let i = 0; i < n; i++) {
        const pax = IS_SL ? 1 : null;
        const veh = IS_SL ? RUN.veh : (($('tk_pv') && $('tk_pv').value) || planVehicle());
        if (!await insertTrip(runRow(r, { day: TR.tuk.planDate, time, status: planStatus(TR.tuk.planDate), price: runPrice(r, veh), vehicle: veh, pax }))) break;
      }
      renderTuktuk();
    } finally { TR.busy.delete('plan'); }
  }
  async function planStep(i, d) {
    if (TR.busy.has('plan')) return;
    const x = planLines(planRuns(TR.tuk.planDate, TR.tuk.driver))[i]; if (!x || !canRun(x.sample)) return;
    TR.busy.add('plan');
    try {
      if (d > 0) {
        const t = x.sample;
        const tomb = TR.trips.find(o => tombOf(o) && o.kind === RUN.kind && o.trip_date === t.trip_date && (o.driver_id || '') === (t.driver_id || '') && o.trip_time === t.trip_time && runLabel(o) === runLabel(t) && (IS_SL || o.vehicle === t.vehicle));
        if (tomb) { await updateTrip(tomb.id, { status: tomb.trip_date > cToday() || !SESSIONS ? 'sent' : 'done', cancel_reason: null, needs_resend: false }); renderTuktuk(); return; }
        await insertTrip({ kind: RUN.kind, trip_date: t.trip_date, trip_time: t.trip_time, route: t.route, purpose: t.purpose, tour_name: t.tour_name || null,
          driver_id: t.driver_id, expected_price: t.expected_price, vehicle: t.vehicle || RUN.veh, status: planStatus(t.trip_date), source: 'manual', pax: IS_SL ? 1 : null });
      } else {
        // One less: a run added since the order first (he never had it), else the newest; one he has is kept as cancelled.
        const victim = TR.trips.filter(t => x.ids.includes(t.id) && !t.payment_entry_id)
          .sort((a, b) => ((driverHas(a) ? 1 : 0) - (driverHas(b) ? 1 : 0)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
        if (!victim) { say('These runs are paid — unlink the payment first', 'err'); return; }
        await dropRun(victim);
      }
      renderTuktuk();
    } finally { TR.busy.delete('plan'); }
  }
  // «Send to Sampath on WhatsApp» in either sheet: the batches of the day not sent yet, or changed since.
  async function sendOrder() {
    const day = TR.tuk.mode === 'plan' ? TR.tuk.planDate : TR.tuk.date;
    if (await sendBatches(day, TR.tuk.driver)) renderTuktuk();
  }

  // ── Edit / delete tuk-tuk runs (tap a line in the Trips list) ───────────
  // One sheet for one run or for the runs of a line (same route, driver and state): what is
  // typed applies to all of them. Paid runs are read-only — unlink the payment first.
  function openRuns(ref) {
    const ids = Array.isArray(ref) ? ref : ((TR.runGroups || {})[ref] || []);
    const runs = TR.trips.filter(t => ids.includes(t.id)); if (!runs.length) return;
    TR.runEdit = runs.map(t => t.id);
    // A run of an area you may not run (Nadith: surf, tours) opens read-only, like a paid one.
    const t = runs[0]; const n = runs.length; const notMine = runs.some(x => !canRun(x)); const paid = runs.some(x => x.payment_entry_id) || notMine; const dis = paid ? 'disabled' : '';
    const cur = allRoutes().find(r => r.route === t.route && r.purpose === t.purpose);
    const body = `${notMine ? '<div class="status-msg status-info tr-paid-note" data-ro-run>Surf runs and tours are the camp manager\'s — read-only here.</div>' : paid ? paidNote(t) : ''}${n > 1 ? `<div class="hint tr-run-n">${n} runs on this line${paid ? '' : ` — what you change applies to all ${n}`}.</div>` : ''}
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="rn_d" value="${h(t.trip_date)}" ${dis}></div>
      <div class="mfield"><label>Time</label>${timeSelect('rn_t', t.trip_time, dis, true)}</div></div>
      <div class="mfield"><label>Route / purpose</label><select id="rn_r" ${dis}>${cur ? '' : `<option value="" selected>${h(runLabel(t))}</option>`}${routeOptions(cur ? cur.key : '')}</select></div>
      ${!IS_SL ? `<div class="mfield"><label>Vehicle</label><select id="rn_v" ${dis}>${vanLabels(t.vehicle).map(v => `<option${v === (t.vehicle || vanDefaultVehicle(null)) ? ' selected' : ''}>${h(v)}</option>`).join('')}</select></div>` : ''}
      <div class="g2"><div class="mfield"><label>Driver</label><select id="rn_dr" ${dis}>${driverOptions(t.driver_id)}</select></div>
      <div class="mfield"><label>Price${n > 1 ? ' (each)' : ''} (LKR)</label><input type="number" id="rn_pr" value="${Number(t.expected_price || 0)}" ${dis || (LOCAL ? 'disabled title="The price comes from /prices"' : '')}></div></div>
      <div class="mfield"><label>Tour</label><input id="rn_tour" value="${h(t.tour_name || '')}" placeholder="Only when the run is for a tour" ${notMine ? 'disabled' : ''}></div>
      ${chargeBlock('rn', isFree(t) ? 'free' : '', t.free_reason, { label: 'Offered ride?', options: [['', 'No'], ['free', 'Free']] })}
      <div class="mfield"><label>Note</label><input id="rn_n" value="${h(t.notes || '')}" ${notMine ? 'disabled' : ''}></div>`;
    const footer = `${paid ? '' : `<button class="btn btn-danger" id="rn_del" onclick="TransportUI.deleteRuns()">${ic('trash')} Delete${n > 1 ? ` ${n} runs` : ''}</button>${n > 1 ? `<button class="btn btn-s" id="rn_one" onclick="TransportUI.deleteRuns(1)">Remove one</button>` : ''}`}
      ${notMine ? `<button class="btn btn-p" id="rn_close" onclick="TransportUI.closeModal()">Close</button>` : `<button class="btn btn-p" id="rn_save" onclick="TransportUI.saveRuns()">Save</button>`}`;
    modal(`Edit ${runNoun(t)}${n > 1 ? 's' : ''} · ${fmtDay(t.trip_date)}`, `${h(runLabel(t))}${n > 1 ? ` × ${n}` : ''} · ${payState(t).label}`, body, footer);
    wireCharge('rn');
    const curVeh = () => ($('rn_v') && $('rn_v').value) || '';
    const curRoute = () => tukRoute(sel && sel.value) || (vanRateOf(t) && allRoutes().find(x => x.route === t.route));
    const sel = $('rn_r'); if (sel) sel.addEventListener('change', () => { const r = tukRoute(sel.value); if (r) { $('rn_pr').value = runPrice(r, curVeh()); $('rn_tour').value = r.tour || ''; } });
    // Morocco: the price is the vehicle's — it follows the vehicle, never the people.
    if ($('rn_v')) $('rn_v').addEventListener('change', () => { const r = curRoute(); if (r) $('rn_pr').value = runPrice(r, curVeh()); });
  }
  async function saveRuns() {
    const runs = TR.trips.filter(t => (TR.runEdit || []).includes(t.id)); if (!runs.length || TR.busy.has('runs') || runs.some(t => !canRun(t))) return;
    TR.busy.add('runs');
    try {
      const paid = runs.some(x => x.payment_entry_id); const r = tukRoute($('rn_r').value);
      const fr = readCharge('rn');
      const base = { tour_name: $('rn_tour').value.trim() || null, notes: $('rn_n').value.trim() || null, charge: fr.charge || null, free_reason: fr.free_reason };
      if (!paid) Object.assign(base, { trip_date: $('rn_d').value || runs[0].trip_date, trip_time: $('rn_t').value || null, driver_id: $('rn_dr').value || null, expected_price: Number($('rn_pr').value || 0) },
        r ? { route: r.route, purpose: r.purpose } : {}, $('rn_v') ? { vehicle: $('rn_v').value } : {});
      let n = 0;
      for (const t of runs) {
        const next = { ...base };
        if (!('free_reason' in t) && !next.free_reason) delete next.free_reason;
        const patch = {}; Object.keys(next).forEach(k => { if (String(next[k] ?? '') !== String(t[k] ?? '')) patch[k] = next[k]; });
        if (!Object.keys(patch).length) continue;
        if (!paid) {
          const when = `${next.trip_date}T${next.trip_time || '23:59'}`;
          // A run the driver already has, moved to another day or driver: that order loses it (kept as cancelled, so the
          // UPDATE says so) and the new day / driver gets it as a new planned run (17 Nov 2026).
          const batchMoved = 'trip_time' in patch && batchOf(patch.trip_time) !== batchOf(t.trip_time);
          if (driverHas(t) && ('trip_date' in patch || 'driver_id' in patch || batchMoved)) {
            const copy = { kind: t.kind, trip_date: t.trip_date, trip_time: t.trip_time, route: t.route, purpose: t.purpose, tour_name: t.tour_name || null, driver_id: t.driver_id,
              expected_price: t.expected_price, vehicle: t.vehicle || RUN.veh, status: 'planned', source: 'manual', pax: t.pax == null ? null : t.pax, charge: t.charge || null, notes: t.notes || null,
              ...('free_reason' in t ? { free_reason: t.free_reason || null } : {}), ...patch };
            // done when it has happened, or (Sri Lanka) marked for today; a later day → planned (never owed before it happens)
            if (`${copy.trip_date}T${copy.trip_time || '23:59'}` < colomboNow() || (SESSIONS && t.status === 'done' && copy.trip_date <= cToday())) copy.status = 'done';
            if (!await insertTrip(copy)) return;
            if (!await updateTrip(t.id, { status: 'cancelled', cancel_reason: 'moved after the order was sent', needs_resend: true })) return;
            n++; continue;
          }
          // A logged run moved into the future is a planned run again; an order already sent is now out of date.
          // (Sri Lanka marks runs as they are ordered, often before the pickup: a marked run stays done.)
          if (t.status === 'done' && when >= colomboNow() && ('trip_date' in patch || 'trip_time' in patch) && (!SESSIONS || next.trip_date > cToday())) patch.status = 'planned';
          if (driverHas(t) && ['trip_time', 'route', 'vehicle'].some(k => k in patch)) patch.needs_resend = true;
        }
        if (!await updateTrip(t.id, patch)) return;
        n++;
      }
      closeModal(); render(); say(n ? (runs.length > 1 ? `${runs.length} runs saved` : 'Run saved') : 'Nothing changed');
    } finally { TR.busy.delete('runs'); }
  }
  async function deleteRuns(one) {
    let runs = TR.trips.filter(t => (TR.runEdit || []).includes(t.id) && !t.payment_entry_id && canRun(t)); if (!runs.length) return;
    if (one) runs = runs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 1);
    else if (runs.length > 1 && !window.confirm(`Delete these ${runs.length} ${RUN.lower} runs? They are not paid.`)) return;
    let n = 0; for (const t of runs) if (await dropRun(t)) n++;
    closeModal(); render(); say(n === 1 ? 'Run deleted' : `${n} runs deleted`);
  }
  async function removeRun(id) { const t = TR.trips.find(x => x.id === id); if (t && await dropRun(t)) { closeModal(); render(); } }

  // ── The Monday Guests import (shown in Week: TransportUI.importHtml) ───
  function nextWeekStart() { return GT.addDaysIso(GT.weekStart(cToday()), 7); }
  // The camp report's window (check-out −3..+32 around the day it was downloaded, never before the file's first check-out).
  function reportFileWindow(parsed) {
    if (!parsed || !parsed.report || !window.BlIngest) return null;
    const w = BlIngest.reportWindow(parsed.export_date || cToday());
    const minCo = (parsed.bookings || []).reduce((m, b) => b.co && (!m || b.co < m) ? b.co : m, '');
    if (minCo > w.from) w.from = minCo;
    return w;
  }
  // Bookings that left the report: their future trips are put on hold with a question when the report is saved — never
  // cancelled (the rule of the hourly import, lib/bl-ingest.js). Only a report downloaded today: an older file does not
  // have the bookings made since. Many at once = a broken file: nothing held.
  // A trip an import already saw today (last_import_at today) is left to the next hourly import: a file downloaded this
  // morning does not have a booking made since, and «cancel this trip?» on a real booking would be a wrong question.
  function reportHolds(parsed) {
    const w = reportFileWindow(parsed); if (!w || !BlIngest.vanished || (parsed.export_date || '') < cToday()) return [];
    const seenToday = a => !!a.last_import_at && BlIngest.localNow(CC.tz || 'Asia/Colombo', a.last_import_at).slice(0, 10) >= cToday();
    const v = BlIngest.vanished(TR.trips, parsed.refs_active, BlIngest.judgeWindow ? BlIngest.judgeWindow(w) : w, colomboNow()).inside.filter(a => !seenToday(a));
    if (new Set(v.map(a => a.booking_ref)).size > BlIngest.vanishCap((parsed.refs_active || []).length)) return [];
    return BlIngest.vanishHolds(v, cToday());
  }
  function renderNext(opts) {
    const ws = nextWeekStart(), we = GT.addDaysIso(ws, 6);
    const I = TR.imp;
    let out = `<div class="card tr-import"><div class="card-hdr"><div><div class="card-title">${opts && opts.title ? h(opts.title) : `Next week · ${fmtRange(ws, we)}`}</div>
      <div class="card-hint">Bookinglayer's camp report is imported automatically every hour. To import by hand, drop the camp report here (the Guests export with the «${h(IS_SL ? 'Semana Sri Lanka' : CC.preset)}» preset still works, but it cannot tell one transfer leg from two). Importing again updates the trips — nothing is duplicated.</div></div></div>
      <div class="card-body"><label class="btn ${I && (I.stage === 'preview' || I.stage === 'done') ? 'btn-s' : 'btn-p'}">${ic('upload')} Choose report file<input type="file" accept=".csv,.xlsx,.xls" id="trGuestsFile" style="display:none" onchange="TransportUI.pickFile(this)"></label>
      ${I && I.needDate ? `<div class="mfield tr-date-ask"><label>When did you download this file?</label><input type="date" id="trExportDate" value="${cToday()}"><button class="btn btn-s btn-sm" onclick="TransportUI.setExportDate()">Continue</button></div>` : ''}
      </div></div>`;
    if (!I || I.needDate) return out;
    if (I.error) return out + `<div class="status-msg status-err">${h(I.error)}</div>`;
    if (I.stage === 'done') {
      const r = I.result || {};
      out += `<div class="status-msg status-ok">${ic('check-circle')} Saved: ${r.inserted || 0} new · ${r.updated || 0} updated${r.resend ? ` · ${r.resend} time changed, resend` : ''}${r.cancelled ? ` · ${r.cancelled} cancelled` : ''}${r.missing ? ` · ${r.missing} not in this file — check them` : ''}${r.replaced ? ` · ${r.replaced} regrouped` : ''}${r.held ? ` · ${r.held} on hold (booking no longer in the report)` : ''} · ${r.guests || 0} guests stored for the weekly lists.</div>`;
    }
    const P = I.parsed;
    const groups = I.groups;
    out += `<div class="hint tr-file">${h(P.file)} · exported ${fmtShort(P.export_date)} · ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'} confirmed, deposit paid or paid${P.counts['other location'] ? ` · ${P.counts['other location']} from other camps left out` : ''}</div>`;
    out += auditHtml(groups);
    if (groups.plan) out += reportPlanHtml(groups.plan, groups.guestPlan, groups.holds);
    // Morocco: what changed on the Bookinglayer side (missing column, unknown room, product or package) — one line each.
    if ((groups.warnings || []).length) out += `<div class="status-msg status-warn tr-impwarn"><b>Check before using the lists:</b>${groups.warnings.map(w => `<div class="tr-impwarn-l" data-kind="${w.kind}">${h(w.text)}</div>`).join('')}</div>`;
    out += `<div class="card"><div class="card-hdr"><div><div class="card-title">Airport trips from this file · ${groups.trips.length}</div><div class="card-hint">From the Bookinglayer file (the source for upcoming weeks).</div></div></div>
      <div class="tr-rows">${groups.trips.length ? groups.trips.map(t => impRow(t)).join('') : '<div class="card-body hint">No transfer booked in this file.</div>'}</div>
      ${I.stage === 'preview' && noPrice(groups.trips).length ? `<div class="status-msg status-warn tr-noprice">${noPrice(groups.trips).length} transfer${noPrice(groups.trips).length === 1 ? ' has' : 's have'} no price yet (the prices are still loading, or /prices has no price for that car). Saving will try again and refuses if a price is still missing.</div>` : ''}
      ${noAirportPrice(groups.trips).length ? `<div class="status-msg status-warn tr-noairprice">${noAirportPrice(groups.trips).map(t => `${h(t.guests.join(', '))} (${h(CC.airportCity[t.place] || t.place)})`).join(', ')}: no price for this airport in /prices — saved at 0, type the price in the trip.</div>` : ''}
      ${I.stage === 'preview' ? `<div class="card-body"><button class="btn btn-p" id="trImportSave" onclick="TransportUI.saveImport()" ${groups.trips.length || groups.guests.length ? '' : 'disabled'}>Save ${groups.trips.length} trip${groups.trips.length === 1 ? '' : 's'} and ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'}</button></div>` : ''}</div>`;
    const dirty = P.dirty_no_transfer;
    if (dirty.length) out += `<div class="card"><div class="card-hdr"><div><div class="card-title">To check (no trip made)</div></div></div><div class="tr-rows">${dirty.map(d => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(d[1])}</b><div class="cell-sub">${h(d[3].join(' · '))}</div></div></div>`).join('')}</div></div>`;
    return out;
  }
  // The camp report: what saving would change, before anything is saved (the rules of camp_trips_import).
  function reportPlanHtml(P, GP, holds) {
    const d = k => k === 'airport_departure' ? 'Departure' : 'Arrival';
    const trip = (t, extra) => `<div class="tr-row tr-static"><div class="tr-main"><b>${h((t.guests || []).join(', ') || t.guest_names || '')}</b><div class="cell-sub">${d(t.kind)} · ${fmtDay(t.date || t.trip_date)} · ${t.pax} ${Number(t.pax) === 1 ? 'person' : 'persons'} · ${h(t.booking_ref)}${extra ? ' · ' + extra : ''}</div></div></div>`;
    const chg = c => c.map(x => `${h(x.field.replace('_', ' '))} ${h(String(x.app || '–'))} → ${h(String(x.report || '–'))}${x.kept ? ' (typed by hand, kept)' : ''}`).join(' · ');
    const block = (title, hint, items) => items.length ? `<div class="card tr-plan"><div class="card-hdr"><div><div class="card-title">${h(title)} · ${items.length}</div>${hint ? `<div class="card-hint">${h(hint)}</div>` : ''}</div></div><div class="tr-rows">${items.join('')}</div></div>` : '';
    let out = `<div class="status-msg status-info tr-plan-sum" data-plan="${P.create.length}|${P.update.length}|${P.regroupCancel.length}|${P.flagRemoved.length}">Camp report: ${P.create.length} new trip${P.create.length === 1 ? '' : 's'} · ${P.update.length} changed · ${P.same.length} unchanged${P.revive.length ? ` · ${P.revive.length} back` : ''}${P.regroupCancel.length ? ` · ${P.regroupCancel.length} replaced` : ''}${P.flagRemoved.length ? ` · ${P.flagRemoved.length} not in the report (asked, never cancelled)` : ''} — not sent: ${P.untouched.length} paid / done / past, ${P.covered.length} already in the app, ${P.past.length} past legs.</div>`;
    out += block('New trips', 'From today on, not in the app yet', P.create.map(x => trip(x.trip)));
    out += block('Trips that change', '', P.update.map(x => trip(x.trip, chg(x.changes))));
    out += block('Brought back', 'Cancelled by an earlier import, booked again', P.revive.map(x => trip(x.trip)));
    out += block('Replaced', 'Same booking and direction, grouped another way in the report: cancelled and replaced', P.regroupCancel.map(a => trip(a)));
    out += block('Held back', 'Saving these would cancel a trip of an earlier day: not sent — change them in Transport', (P.withheld || []).map(x => trip(x.trip, h(x.why))));
    out += block('One transfer, now one trip', 'Kept as one trip per guest in the app; the others become «merged — same transfer» (never paid twice)', (P.merge || []).map(m => trip(m.trip, `keeps ${h(m.survivor.import_key || '')}, merges ${m.others.map(o => h(o.guest_names || o.import_key || '')).join(', ')}`)));
    out += block('Filled from the report', 'Empty in the app, now filled', (P.fills || []).map(x => trip(x.trip, x.fills.map(c => `${h(c.field.replace('_', ' '))} ${h(String(c.report))}`).join(' · '))));
    out += block('Typed by hand — kept', 'The report says something else: the trip shows «Bookinglayer says … use it?»', (P.conflicts || []).map(x => trip(x.trip, x.conflicts.map(c => `${h(c.field.replace('_', ' '))}: app ${h(String(c.app))}, Bookinglayer ${h(String(c.report))}`).join(' · '))));
    out += block('Not in the report — cancel?', 'The booking is in the report without this transfer. Saving only marks it; cancel it in Transport if it is right.', P.flagRemoved.map(a => trip(a)));
    const held = new Set((holds || []).map(x => x.id));
    out += block('Booking no longer in the report — on hold', 'Cancelled in Bookinglayer? Saving holds these trips out of «Send the whole day» and asks «cancel this trip?» in Transport. Nothing is cancelled.', (holds || []).map(x => trip(x.trip)));
    out += block('Booking not in the report', 'Future trips of bookings that are not in this report (cancelled in Bookinglayer?). Nothing changes.', P.notInReport.filter(a => !held.has(a.id)).map(a => trip(a)));
    out += block('Not changed (paid, done or past)', 'The report differs from the app here; the app is kept', P.untouched.filter(x => x.diffs.length).map(x => trip(x.trip, `${h(x.why)} · ${chg(x.diffs)}`)));
    if (GP) {
      const gl = (x, extra) => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(x.guest_name)}</b><div class="cell-sub">${h(x.booking_ref)} · ${fmtShort(x.check_in)} → ${fmtShort(x.check_out)}${extra ? ' · ' + extra : ''}</div></div></div>`;
      out += `<div class="hint tr-plan-guests">Guests: ${GP.add.length} new · ${GP.change.length} changed · ${GP.same.length} unchanged${GP.wouldDrop.length ? ` · ${GP.wouldDrop.length} stored guests not in the report will show «cancelled?»` : ''}</div>`;
      out += block('Guests that change', '', GP.change.map(x => gl(x.g, x.changes.map(c => `${h(c.field)} ${h(c.app || '–')} → ${h(c.report || '–')}`).join(' · '))));
      out += block('Guests: filled from the report', 'Empty in the app, now filled', (GP.fills || []).map(x => gl(x.g, x.fields.map(c => `${h(c.field.replace('_', ' '))} ${h(c.report)}`).join(' · '))));
      out += block('Guests: kept (the report is empty)', 'Never blanked: the app keeps its value', (GP.kept || []).map(x => gl(x.g, x.fields.map(c => `${h(c.field.replace('_', ' '))} ${h(c.app)}`).join(' · '))));
      out += block('Guests: set by hand — kept', '', (GP.conflicts || []).map(x => gl(x.g, h(x.note))));
      out += block('Stored guests not in the report', 'Check-in inside this report but missing from it: Week will ask «cancelled?»', GP.wouldDrop.map(a => gl(a)));
    }
    return out;
  }
  function impRow(t) {
    const dep = t.kind === 'airport_departure';
    return `<div class="tr-row tr-static"><div class="tr-time">${t.time ? `<b class="num">${h(t.time)}</b>` : '<span class="badge badge-amber">time?</span>'}</div>
      <div class="tr-main"><div class="tr-line1"><span class="badge ${dep ? 'badge-navy' : 'badge-blue'}">${dep ? 'Departure' : 'Arrival'}</span> <b>${h(t.guests.join(', '))}</b> <span class="hint">· ${fmtDay(t.date)} · ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}</span></div>
      <div class="cell-sub">${h(t.flight || 'flight?')} · ${h(t.vehicle || 'no vehicle in /prices')} · ${money(t.expected_price)} · ${t.booking_ref}${t.partner ? ' · partner: ' + h(t.partner) + ', don\'t charge' : ''}</div>
      ${t.flags.filter(f => !/^no time yet/.test(f)).map(f => `<div class="cell-sub tr-amber">${h(f)}</div>`).join('')}</div></div>`;
  }
  // Bookinglayer's Guests export comes as .xlsx (13 Nov 2026) as well as .csv. The Excel file is
  // turned into the same CSV text (dates keep their «Sat 14 Nov 2026» format), so one parser serves both.
  const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) xlsxLoading = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = XLSX_CDN;
      s.onload = () => window.XLSX ? ok(window.XLSX) : no(new Error('Excel reader did not load'));
      s.onerror = () => { xlsxLoading = null; no(new Error('Excel reader could not be downloaded')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }
  async function guestsXlsxToCsv(file) {
    const X = await loadXlsx();
    const wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    return X.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: false });
  }
  async function pickFile(input) {
    const file = input.files && input.files[0]; if (!file) return;
    let text;
    try { text = /\.xlsx?$/i.test(file.name) ? await guestsXlsxToCsv(file) : await file.text(); }
    catch (err) { input.value = ''; TR.imp = { error: "Couldn't read this Excel file — " + (err && err.message || 'error') + '. Try again, or export it as CSV.' }; render(); return; }
    input.value = '';
    // The camp report (booking lines × guests, 16 Nov 2026) is read by lib/bl-report.js; the Guests export as before.
    const isReport = !!(window.BlReport && BlReport.isReportHeader(text));
    if (!isReport && !GT.isGuestsExportHeader(text)) { TR.imp = { error: 'This is not a Bookinglayer Guests export (no «Has transfer» column) nor the camp report (no «Booking line: Id» column). Use Guests → Export with the «' + (IS_SL ? 'Semana Sri Lanka' : CC.preset) + '» preset, or the camp report.' }; render(); return; }
    TR.imp = { text, name: file.name, report: isReport };
    // The vehicles come from /prices: read them first (a slow phone may still be loading them).
    if (!pricesReady()) { try { if (typeof loadTransportPresets === 'function') await loadTransportPresets(); } catch (_) {} }
    const parsed = IMP().parse(text, file.name, undefined, catCfg());
    if (!parsed.export_date) { TR.imp.needDate = true; render(); return; }
    await buildImport(parsed);
  }
  async function setExportDate() {
    const d = $('trExportDate') && $('trExportDate').value; if (!d || !TR.imp) return;
    TR.imp.needDate = false;
    await buildImport(IMP().parse(TR.imp.text, TR.imp.name, d, catCfg()));
  }
  // The parser of the file being imported: the camp report (lib/bl-report.js) or the Guests export (lib/guests-trips.js).
  const IMP = () => (TR.imp && TR.imp.report && window.BlReport) ? window.BlReport : GT;
  // Nobody lost at the import: rows in the file = guests imported + rows left out, each with its reason.
  // Other camps and cancelled bookings are expected; a status that is not live, a row without dates or
  // a repeated row is worth a look, so the block turns amber.
  function auditHtml(groups) {
    const A = groups.audit; if (!A) return '';
    const leftN = A.left.length;
    const unit = A.unit === 'guests' ? 'guest' : 'row';
    const sum = `${A.rows} ${unit}${A.rows === 1 ? '' : 's'} in the file = ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'} imported + ${leftN} left out`;
    const adds = A.rows === groups.guests.length + leftN;
    const look = A.left.filter(x => x.kind === 'status' || x.kind === 'no_dates' || x.kind === 'duplicate');
    let out = `<div class="${adds && !look.length ? 'hint' : 'status-msg status-warn'} tr-audit">${adds ? '' : 'The rows do not add up — tell Miguel before using the lists. '}${h(sum)}${look.length ? ` · ${look.length} to look at` : ''}</div>`;
    if (A.left.length) out += `<div class="card tr-leftout"><div class="card-hdr"><div><div class="card-title">Left out of the import · ${A.left.length}</div><div class="card-hint">Every row of the file that is not imported, with the reason.</div></div></div>
      <div class="tr-rows">${A.left.map(x => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(x.name)}</b><div class="cell-sub">${h(x.ref || 'no booking number')} · line ${x.line} · ${h(x.reason)}</div></div>${look.includes(x) ? '<span class="badge badge-amber">Check</span>' : ''}</div>`).join('')}</div></div>`;
    if (A.renamed.length) out += `<div class="status-msg status-info tr-soft">${A.renamed.length} guest${A.renamed.length === 1 ? '' : 's'} with no name or a repeated name on the booking, kept as separate people: ${h(A.renamed.map(x => x.name).join(', '))}</div>`;
    return out;
  }
  async function buildImport(parsed) {
    // Miguel, 13 Nov: the camp's file and HQ's bookings import are kept apart on purpose (managers import guests for
    // operations; Miguel imports bookings for partners/income), so nothing in one can change the other. The HQ
    // cross-check that was switched off since then is gone (audit WEEK-19).
    const allGuests = IMP().guestRows(TR.imp.text, parsed.file, GTC);
    const okGuests = allGuests.filter(g => GT.OK_STATUS.has(g.booking_status) && g.check_in && g.check_out);   // no dates = on no list: shown under «Left out»
    const partnerOf = r => { const g = okGuests.find(x => x.booking_ref === r && x.partner); return g ? g.partner : ''; };
    // Prices come from /prices and may still be loading on a slow phone: wait for them, never save a trip at 0.
    if (parsed.trips.length && !pricesReady()) { try { if (typeof loadTransportPresets === 'function') await loadTransportPresets(); } catch (_) {} }
    let trips = parsed.trips.map(t => ({ ...t, expected_price: presetPrice(t.kind, t.vehicle, t.place), hq_match: null, partner: partnerOf(t.booking_ref) || null }));
    // The camp report goes back weeks (check-out window): only what may change is sent — legs from the camp's today on,
    // and past legs the app already has under the same key (the import leaves those untouched). A past leg the app does not
    // have, or a leg it has under another key (Morocco's «hist2026» trips), is never sent: it would be a second, owed trip.
    let plan = null;
    if (parsed.report && window.BlReport) {
      const maxCo = (parsed.bookings || []).reduce((m, b) => b.co > m ? b.co : m, '');
      plan = BlReport.planTrips(trips, TR.trips, { today: cToday(), now: colomboNow(), exportDate: parsed.export_date, refsPresent: parsed.refs_active, window: maxCo ? { to: maxCo } : null,
        mergePast: !IS_SL });   // Sri Lanka: «só para os novos» — a trip of an earlier day is never changed
      trips = plan.send;
      // The camp's own decisions on a trip stand (vehicle changed by hand, «Separate», «Charge guest»): one shared rule
      // with the hourly import (lib/bl-report.js keepCampEdits, audit WEEK-09).
      trips = BlReport.keepCampEdits(trips, TR.trips, presetPrice);
    }
    const guests = okGuests.map(g => ({ ...g, hq_match: null, partner: partnerOf(g.booking_ref) || null }));
    let guestPlan = null;
    if (plan) try {
      const loc = await ensureHubLocationId();
      const { data, error } = await client().from('camp_week_guests').select('*').eq('location_id', loc);
      if (error) throw error;
      guestPlan = BlReport.planGuests(guests, data || []);
    } catch (_) { guestPlan = null; }
    TR.imp = { ...TR.imp, parsed, stage: 'preview',
      // merge, never blank: the guests sent are the report's values with the stored ones kept where the report is empty
      groups: { audit: IMP().guestAudit(TR.imp.text, parsed.file, GTC), warnings: IMP().importWarnings(TR.imp.text, parsed.file, GTC), trips, guests: guestPlan ? guestPlan.rows : guests, cancelRefs: [...new Set(parsed.cancel_refs)], plan, guestPlan,
        holds: plan ? reportHolds(parsed) : [] } };
    render();
  }
  // Ready = /prices loaded and both airport ways have a priced vehicle (the default airport for Morocco).
  const pricesReady = () => !pricesError() && ['airport_arrival', 'airport_departure'].every(k => airVehicles(k).some(v => Number(v.cost != null ? v.cost : v.price) > 0));
  // Morocco: an airport with no /prices row (Essaouira on 14 Nov) does not block the import — nothing is
  // linked automatically there, the trip is saved at 0 and flagged; only «prices not loaded» blocks.
  const noPrice = trips => (trips || []).filter(t => !(Number(t.expected_price) > 0) && (IS_SL || !pricesReady()));
  const noAirportPrice = trips => IS_SL ? [] : (trips || []).filter(t => !(Number(t.expected_price) > 0) && pricesReady());
  async function saveImport() {
    const I = TR.imp; if (!I || I.stage !== 'preview' || TR.busy.has('imp')) return;
    if (noPrice(I.groups.trips).length) {   // one more try, then refuse: a trip at 0 «fits» any payment
      try { if (typeof loadTransportPresets === 'function') await loadTransportPresets(); } catch (_) {}
      // the prices arrived: a trip parsed without them gets its /prices vehicle now, then its price
      I.groups.trips = I.groups.trips.map(t => { const v = t.vehicle || pickAir(t.kind, t.place, t.pax, t.boards, t.products).label || null; return { ...t, vehicle: v, expected_price: presetPrice(t.kind, v, t.place) }; });
      if (noPrice(I.groups.trips).length) { render(); say('The transfer prices have not loaded — nothing saved. Check the connection and try again.', 'err'); return; }
    }
    TR.busy.add('imp');
    try {
      const loc = await ensureHubLocationId();
      // The camp report: one transfer kept as per-guest trips is merged first (one survives with everyone, the others
      // «merged — same transfer», merged_into it), so the import below finds the survivor under the report's key.
      for (const m of ((I.groups.plan || {}).merge || [])) {
        if (!await updateTrip(m.survivor.id, m.patch)) { say('Merging the trips of ' + m.trip.booking_ref + ' failed — nothing imported', 'err'); return; }
        for (const o of m.others) {
          if (!await updateTrip(o.id, { status: 'merged', merged_into: m.survivor.id, cancel_reason: 'merged — same transfer', needs_resend: ['sent', 'confirmed'].includes(o.status) })) { say('Merging the trips of ' + m.trip.booking_ref + ' failed — nothing imported', 'err'); return; }
        }
      }
      const result = await rpc('camp_trips_import', {
        // the camp report: never a date before the camp's today, so the «transfer removed» pass leaves earlier days alone
        p_location: loc, p_export_date: I.parsed.report ? [I.parsed.export_date, cToday()].filter(Boolean).sort().pop() : I.parsed.export_date, p_is_preset: !!I.parsed.is_preset,
        p_refs_present: I.parsed.refs_active, p_cancel_refs: I.groups.cancelRefs,
        p_trips: I.groups.trips, p_guests: I.groups.guests,
      });
      I.stage = 'done'; I.result = result || {};
      // Logged beside the automatic imports (bl_report_runs, supabase/bl-report-ingest.sql): Week shows «Last import: … · by hand».
      // The camp report's window (check-out −3..+32, never before the file's first check-out) keeps Week from asking «cancelled?»
      // for guests the file could not hold. Never blocks: the import is saved either way.
      // Bookings no longer in the report: their trips on hold with the question (never cancelled). Never blocks the import.
      let held = 0;
      for (const x of (I.groups.holds || [])) if (await updateTrip(x.id, x.patch)) held++;
      if (held) I.result = { ...I.result, held };
      try {
        const w = reportFileWindow(I.parsed);
        await client().rpc('bl_report_log_manual', { p_location: loc, p_file: String(I.name || ''), p_rows: (I.groups.guests || []).length, p_result: result || {}, p_window_from: w ? w.from : null, p_window_to: w ? w.to : null });
      } catch (_) { /* not set up yet */ }
      try { window.dispatchEvent(new CustomEvent('camp-week-imported')); } catch (_) {}   // Week reloads its lists
      await load(true);
      render(); say('Import saved');
    } catch (_) { /* toasted */ } finally { TR.busy.delete('imp'); }
  }

  // ── Reconcile (same pattern as HQ → Month close → Reconcile) ────────────
  // Who linked a payment to its trips. A manual link with no reviewer is the local
  // manager's own pick when he paid (camp_transport_link_own: «Which transfers is this
  // for?»); Francisco's links and «Pay a driver» always carry reviewed_by.
  function linkedByLabel(l) {
    if (!l) return '';
    if (l.linked_by === 'auto') return 'linked automatically';
    if (l.linked_by === 'pay') return 'Pay a driver';
    if (l.linked_by === 'manual' && !l.reviewed_by) return `linked by ${LOCAL_MANAGER_NAME}`;
    return 'linked by hand';
  }
  // «N payments to check»: a Transport payment typed elsewhere (or brought by the statement) that is
  // not linked to its trips. Each one opens the same Link trips sheet (16 Nov 2026: Reconcile is gone).
  function openChecks() {
    const list = toCheck().slice().sort((a, b) => String((ledgerById(a.entry_id) || {}).date || '').localeCompare(String((ledgerById(b.entry_id) || {}).date || '')));
    if (list.length === 1) return openLink(list[0].entry_id);
    const body = list.length ? `<div class="tr-picks">${list.map(l => { const e = ledgerById(l.entry_id) || {}; const d = driverById(l.driver_id);
      return `<button class="tr-pick tr-pick-btn" data-check="${l.entry_id}" onclick="TransportUI.openLink('${l.entry_id}')"><span>${fmtShort(e.date)} · ${h(e.description || '')}<span class="cell-sub">${h(d ? d.name : 'no driver')} · ${l.trips_count ? `${l.trips_count} trip${l.trips_count === 1 ? '' : 's'} · ${money(l.trips_amount)}` : 'no trips linked'}</span></span><b class="num">${money(l.entry_amount)}</b></button>`; }).join('')}</div>`
      : '<div class="hint">Nothing to check.</div>';
    modal('Payments to check', 'Paid to a driver but not linked to the trips it pays', body, '');
  }
  async function afterLink(msg) { await load(true); closeModal(); render(); if (msg) say(msg); }
  // Link trips to one payment: the driver's unpaid done trips + those already linked.
  // QA 16 Nov 2026: a payment only pays trips dated on or before it, one month at a time — a «September · Let Us
  // Tours» transfer of 12 Oct must never tick October and November in one tap. The month shown first is the one the
  // payment names («September»), else the month before the payment when it has trips, else the payment's own month.
  const MONTH_WORDS = [/\bjan(uary|vier|eiro)?\b/, /\bfeb(ruary)?\b|\bfév|\bfev(ereiro)?\b/, /\bmar(ch|s|ço|co)?\b/, /\bapr(il)?\b|\bavr(il)?\b|\babr(il)?\b/, /\bmay\b|\bmai(o)?\b/, /\bjun(e|e?ho)?\b|\bjuin\b/,
    /\bjul(y|ho)?\b|\bjuil(let)?\b/, /\baug(ust)?\b|\baoût\b|\bago(sto)?\b/, /\bsep(t|tember|tembre|tembro)?\b|\bset(embro)?\b/, /\boct(ober|obre)?\b|\bout(ubro)?\b/, /\bnov(ember|embre|embro)?\b/, /\bdec(ember)?\b|\bdéc(embre)?\b|\bdez(embro)?\b/];
  function namedMonth(desc, payDate) {
    const t = String(desc || '').toLowerCase(); const i = MONTH_WORDS.findIndex(re => re.test(t)); if (i < 0 || !payDate) return '';
    let y = Number(payDate.slice(0, 4)); if (i + 1 > Number(payDate.slice(5, 7))) y--;   // «December» paid in January = last year
    return `${y}-${String(i + 1).padStart(2, '0')}`;
  }
  const monthBefore = ym => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; return m ? `${y}-${String(m).padStart(2, '0')}` : `${y - 1}-12`; };
  function linkCands(D) {
    const e = ledgerById(D.entryId) || {}; const upTo = String(e.date || '9999-12-31');
    return TR.trips.filter(t => (t.payment_entry_id === D.entryId) || (!t.payment_entry_id && (!D.driver || t.driver_id === D.driver) && ['owed', 'on_hold', 'before_go_live'].includes(reconcileStatus(t)) && t.trip_date <= upTo))
      .sort((a, b) => (a.trip_date + (a.trip_time || '')).localeCompare(b.trip_date + (b.trip_time || '')));
  }
  function openLink(entryId) {
    const l = linkOf(entryId) || allLinks().find(x => x.entry_id === entryId);   // Morocco: a bank line not linked yet
    const e = ledgerById(entryId) || {};
    TR.linkDraft = { entryId, driver: (l && l.driver_id) || '', picked: new Set(TR.trips.filter(t => t.payment_entry_id === entryId).map(t => t.id)), month: '' };
    const months = [...new Set(linkCands(TR.linkDraft).filter(t => t.payment_entry_id !== entryId).map(t => t.trip_date.slice(0, 7)))];
    const pay = String(e.date || '').slice(0, 7); const named = namedMonth(e.description, e.date);
    TR.linkDraft.month = months.includes(named) ? named : months.includes(monthBefore(pay || '2000-01')) ? monthBefore(pay) : months.includes(pay) ? pay : (months[months.length - 1] || '');
    renderLink();
  }
  function renderLink() {
    const D = TR.linkDraft; const e = ledgerById(D.entryId) || {}; const amount = Number(e.amountLocal || (linkOf(D.entryId) || {}).entry_amount || 0);
    const all = linkCands(D);
    const months = [...new Set(all.filter(t => t.payment_entry_id !== D.entryId).map(t => t.trip_date.slice(0, 7)))];
    const cands = all.filter(t => t.payment_entry_id === D.entryId || !D.month || months.length < 2 || t.trip_date.slice(0, 7) === D.month);
    const sum = all.filter(t => D.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const ml = ym => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
    const monthPills = months.length > 1 ? `<div class="mfield"><label>Trips of</label><div class="pills" id="lk_months">${months.map(m => `<button type="button" class="pill${m === D.month ? ' active' : ''}" data-lk-month="${m}" onclick="TransportUI.linkMonth('${m}')">${ml(m)}</button>`).join('')}</div>
      <div class="hint">One month at a time — a payment never pays trips of several months by one tap.</div></div>` : '';
    const open = cands.filter(t => t.payment_entry_id !== D.entryId);
    const body = `<div class="mfield"><label>Driver</label><select id="lk_dr" onchange="TransportUI.linkDriver(this.value)">${driverOptions(D.driver)}</select></div>
      ${monthPills}
      ${open.length > 3 ? `<div class="row tr-pick-all"><button class="btn btn-s btn-sm" id="lk_all" onclick="TransportUI.linkAll(true)">Tick all ${open.length}${months.length > 1 && D.month ? ' of ' + ml(D.month) : ''}</button><button class="btn btn-s btn-sm" id="lk_none" onclick="TransportUI.linkAll(false)">None</button></div>` : ''}
      <div class="tr-picks">${cands.length ? cands.map(t => `<label class="tr-pick"><input type="checkbox" data-id="${t.id}" ${D.picked.has(t.id) ? 'checked' : ''} onchange="TransportUI.linkPick('${t.id}', this.checked)">
        <span>${fmtShort(t.trip_date)} · ${h(isAirport(t) ? (t.guest_names || 'Guest') + (t.kind === 'airport_departure' ? ' · departure' : ' · arrival') : (t.tour_name ? 'Tour · ' + t.tour_name : t.route))}</span><b class="num">${money(t.expected_price)}</b></label>`).join('') : `<div class="hint">No unpaid trips of this driver on or before ${h(fmtShort(e.date || cToday()))}. If this payment is for older work (before the trip list), mark it explained.</div>`}</div>
      <div class="tr-sum ${sum === amount ? 'ok' : 'off'}" id="lk_sum">Ticked ${money(sum)} of ${money(amount)}${sum !== amount ? ` · difference ${money(amount - sum)}` : ''}</div>
      <div class="mfield"><label>Note (accepts a difference)</label><input id="lk_note" placeholder="e.g. waiting time"></div>`;
    modal('Link trips', `${h(e.description || '')} · ${money(amount)}${e.date ? ' · paid ' + h(fmtShort(e.date)) : ''}`, body,
      `<button class="btn btn-s" data-lk-explain onclick="TransportUI.openExplain('${D.entryId}')">Mark explained</button><button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="lk_save" onclick="TransportUI.saveLink()">Save</button>`);
  }
  // «Tick all»: the trips shown (one month), never every month at once.
  function linkAll(on) {
    const D = TR.linkDraft; if (!D) return;
    const all = linkCands(D); const months = [...new Set(all.filter(t => t.payment_entry_id !== D.entryId).map(t => t.trip_date.slice(0, 7)))];
    const shown = all.filter(t => t.payment_entry_id !== D.entryId && (!D.month || months.length < 2 || t.trip_date.slice(0, 7) === D.month));
    shown.forEach(t => on ? D.picked.add(t.id) : D.picked.delete(t.id));
    const note = $('lk_note') ? $('lk_note').value : ''; renderLink(); if ($('lk_note')) $('lk_note').value = note;
  }
  // Switching month drops the ticks of the other months (except trips already linked to this payment): one month per save.
  function linkMonth(m) { const D = TR.linkDraft; if (!D) return; D.month = m;
    D.picked = new Set([...D.picked].filter(id => { const t = TR.trips.find(x => x.id === id); return t && (t.payment_entry_id === D.entryId || t.trip_date.slice(0, 7) === m); }));
    const note = $('lk_note') ? $('lk_note').value : ''; renderLink(); if ($('lk_note')) $('lk_note').value = note; }
  function linkDriver(v) { TR.linkDraft.driver = v; TR.linkDraft.picked = new Set(TR.trips.filter(t => t.payment_entry_id === TR.linkDraft.entryId).map(t => t.id)); renderLink(); }
  function linkPick(id, on) { if (on) TR.linkDraft.picked.add(id); else TR.linkDraft.picked.delete(id); const note = $('lk_note') ? $('lk_note').value : ''; renderLink(); if ($('lk_note')) $('lk_note').value = note; }
  async function saveLink() {
    const D = TR.linkDraft; if (!D || TR.busy.has('link')) return; TR.busy.add('link');
    try {
      const r = await rpc('camp_transport_link_set', { p_entry: D.entryId, p_driver: D.driver || null, p_trip_ids: [...D.picked], p_note: ($('lk_note') && $('lk_note').value.trim()) || null });
      await afterLink(r && r.state === 'matched' ? 'Linked · matched' : r && r.state === 'explained' ? 'Linked · explained' : 'Linked · still to review');
    } catch (_) {} finally { TR.busy.delete('link'); }
  }
  async function unlinkPayment(entryId) {
    const l = linkOf(entryId);
    try { await rpc('camp_transport_link_set', { p_entry: entryId, p_driver: (l && l.driver_id) || null, p_trip_ids: [], p_note: null }); await afterLink('Unlinked'); } catch (_) {}
  }
  function openExplain(entryId) {
    const e = ledgerById(entryId) || {};
    modal('Mark explained', `${h(e.description || '')} · ${money(e.amountLocal || 0)}`, `<div class="mfield"><label>Why is this payment fine as it is?</label><input id="ex_note" placeholder="e.g. scooter fuel, not a driver"></div>`,
      `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" onclick="TransportUI.saveExplain('${entryId}')">Mark explained</button>`);
  }
  async function saveExplain(entryId) {
    const note = ($('ex_note') && $('ex_note').value.trim()) || '';
    if (!note) { say('Write a short reason', 'err'); return; }
    const l = linkOf(entryId);
    try { await rpc('camp_transport_link_set', { p_entry: entryId, p_driver: (l && l.driver_id) || null, p_trip_ids: TR.trips.filter(t => t.payment_entry_id === entryId).map(t => t.id), p_note: note }); await afterLink('Marked explained'); } catch (_) {}
  }
  async function unlinkTrip(tripId) {
    const t = TR.trips.find(x => x.id === tripId); if (!t || !t.payment_entry_id) return;
    const entryId = t.payment_entry_id; const l = linkOf(entryId);
    const ids = TR.trips.filter(x => x.payment_entry_id === entryId && x.id !== tripId).map(x => x.id);
    try { await rpc('camp_transport_link_set', { p_entry: entryId, p_driver: (l && l.driver_id) || t.driver_id || null, p_trip_ids: ids, p_note: null }); await afterLink('Unlinked'); } catch (_) {}
  }

  // ── Pay a driver — the one door (16 Nov 2026) ──────────────────────────
  // Everything done and unpaid for the driver since the last payment, grouped by day × route,
  // already ticked. Airport transfers may be paid up to 14 days ahead (13 Nov): listed, not ticked.
  // «+ Run not in the list» saves a run nobody logged (done, ticked); «−» removes a run that did
  // not happen; a difference that is left needs a reason. Sri Lanka: Cash rows split by item
  // (camp_trips_pay). Morocco: one Bank Transfer row — or the SG transfer already in the ledger
  // («Use SG transfer …», camp_transport_link_set), never a second line for the same money.
  const PAY_AHEAD_DAYS = 14;   // = camp_trips_pay (supabase/camp-trips-local-pay.sql)
  const payDrivers = () => TR.drivers.filter(d => d.active !== false && !(d.kinds || []).every(k => k === 'contact'));
  function owedBy(driverId) { return TR.trips.filter(t => t.driver_id === driverId && reconcileStatus(t) === 'owed'); }
  function aheadBy(driverId, date) {
    const upTo = GT.addDaysIso(date || cToday(), PAY_AHEAD_DAYS);
    return TR.trips.filter(t => t.driver_id === driverId && isAirport(t) && !t.payment_entry_id && reconcileStatus(t) === 'upcoming' && t.trip_date >= goLive() && t.trip_date <= upTo);
  }
  // On hold («did the driver go?» unanswered): not owed, but listed in Pay — never ticked by itself — so it can be paid once answered.
  const heldBy = driverId => TR.trips.filter(t => t.driver_id === driverId && reconcileStatus(t) === 'on_hold');
  const payPool = P => owedBy(P.driver).concat(heldBy(P.driver), aheadBy(P.driver, P.date));
  const dayDiff = (a, b) => { const u = x => { const [y, m, d] = String(x).split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((u(a) - u(b)) / 86400000); };
  // One line per day × route (a hundred tuk-tuk runs a week stay readable); an airport transfer is its own line.
  function payGroups(P) {
    const by = new Map();
    payPool(P).sort((a, b) => (a.trip_date + (a.trip_time || '99')).localeCompare(b.trip_date + (b.trip_time || '99'))).forEach(t => {
      const run = !isAirport(t); const ahead = reconcileStatus(t) === 'upcoming';
      const k = run ? [t.trip_date, runLabel(t), isFree(t) ? freeLabel(t) : ''].join('|') : t.id;
      const g = by.get(k) || { key: k, day: t.trip_date, run, ahead, label: run ? runLabel(t) : `${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${t.guest_names || 'Guest'}${blFlagged(t) ? ' · did the driver go?' : ''}`, free: isFree(t) ? freeLabel(t) : '', ids: [], sum: 0, pax: 0, manual: 0 };
      g.ids.push(t.id); g.sum += Number(t.expected_price || 0); g.pax += isAirport(t) ? (Number(t.pax) || 1) : (runPax(t) || 0); if (run && t.source === 'manual') g.manual++;
      by.set(k, g);
    });
    return [...by.values()];
  }
  function openPay() {
    const rows = payDrivers().map(d => { const o = owedBy(d.id); return { d, n: o.length, sum: o.reduce((s, t) => s + Number(t.expected_price || 0), 0) }; })
      .sort((a, b) => b.sum - a.sum || String(a.d.name).localeCompare(String(b.d.name)));
    const body = `<div class="tr-picks">${rows.map(r => `<button class="tr-pick tr-pick-btn" data-pay-driver="${r.d.id}" onclick="TransportUI.payPick('${r.d.id}')"><span><b>${h(r.d.name)}</b>${r.d.label ? ` · ${h(r.d.label)}` : ''}<span class="cell-sub">${r.n ? `owed ${r.n} trip${r.n === 1 ? '' : 's'}` : 'nothing owed'}</span></span><b class="num">${money(r.sum)}</b></button>`).join('') || '<div class="hint">No drivers yet.</div>'}</div>`;
    modal('Pay a driver', 'Who are you paying?', body, '');
  }
  function payPick(driverId) {
    if (!driverById(driverId)) return;
    TR.payDraft = { driver: driverId, picked: new Set(owedBy(driverId).filter(t => !blFlagged(t)).map(t => t.id)), amount: null, reason: '', note: '', date: cToday(), adding: false, bankEntry: null,
      add: { date: cToday(), route: (allRoutes().find(canRun) || {}).key || '', n: 1 } };
    renderPay();
  }
  // Morocco: unlinked SG transfers to this driver within 5 days of the payment date, closest amount first.
  function bankMatches(P) {
    if (!BANK_PAID || LOCAL) return [];
    const { sum } = payNumbers();
    return bankCandidates().map(l => ({ l, e: ledgerById(l.entry_id) })).filter(x => x.e && driverIn(x.e.description) === P.driver && Math.abs(dayDiff(x.e.date, P.date)) <= 5)
      .sort((a, b) => Math.abs(Number(a.e.amountLocal || 0) - sum) - Math.abs(Number(b.e.amountLocal || 0) - sum));
  }
  function renderPay() {
    const P = TR.payDraft; if (!P) return; const d = driverById(P.driver);
    const groups = payGroups(P);
    const { sum, amount } = payNumbers();
    const days = [...new Set(groups.map(g => g.day))].sort();
    const line = g => { const on = g.ids.every(id => P.picked.has(id)); const n = g.ids.length;
      return `<div class="tr-pick tr-pay-line" data-pay-group="${h(g.key)}"><label class="tr-pay-tick"><input type="checkbox" ${on ? 'checked' : ''} onchange="TransportUI.payTickGroup('${h(g.key)}', this.checked)">
        <span>${h(g.label)}${g.run && n > 1 ? ` <b class="num">× ${n}</b>` : ''}${g.free ? ` <span class="badge badge-blue tr-free">${h(g.free)}</span>` : ''}${g.ahead ? ' <i class="pl-later">(not yet)</i>' : ''}${!IS_SL && g.run && g.pax ? `<span class="cell-sub">${ppl(g.pax)}</span>` : ''}</span></label>
        ${g.run && g.manual && TR.trips.some(t => g.ids.includes(t.id) && canRun(t)) ? `<button class="btn btn-s btn-sm btn-icon" data-pay-minus title="Remove one run that did not happen" onclick="TransportUI.payMinus('${h(g.key)}')">${ic('minus')}</button>` : ''}<b class="num">${money(g.sum)}</b></div>`; };
    const list = days.map(day => `<div class="section-lbl">${fmtDay(day)}</div>${groups.filter(g => g.day === day).map(line).join('')}`).join('') || '<div class="hint">Nothing owed to this driver.</div>';
    const A = P.add;
    const addForm = P.adding ? `<div class="tr-pay-add" id="py_addform"><div class="g2"><div class="mfield"><label>Day</label><input type="date" id="py_ad" value="${h(A.date)}"></div>
        <div class="mfield"><label>${IS_SL ? 'Runs' : 'Vans'}</label><input type="number" min="1" max="30" id="py_an" value="${A.n}"></div></div>
        <div class="mfield"><label>Route</label><select id="py_ar">${routeOptions(A.route, 'mine')}</select></div>
        ${IS_SL ? '' : `<div class="mfield"><label>Vehicle</label>${vehiclePick('py_av', A.vehicle || vanDefaultVehicle(null), '')}</div>`}
        <div class="row"><button class="btn btn-s btn-sm" onclick="TransportUI.payAddToggle(false)">Cancel</button><button class="btn btn-s btn-sm" id="py_addok" onclick="TransportUI.payAddRun()">${ic('plus')} Add and tick</button></div></div>`
      : `<button class="btn btn-s btn-sm" id="py_add" onclick="TransportUI.payAddToggle(true)">${ic('plus')} Run not in the list</button>`;
    const bm = bankMatches(P);
    const bank = bm.length ? `<div class="mfield tr-pay-bank"><label>Already in from the bank?</label><div class="pills">${bm.map(x => `<button type="button" class="pill${P.bankEntry === x.l.entry_id ? ' active' : ''}" data-bank="${x.l.entry_id}" onclick="TransportUI.payBank('${x.l.entry_id}')">Use SG transfer ${fmtShort(x.e.date)} · ${money(x.e.amountLocal)}</button>`).join('')}</div>
        <div class="hint">${P.bankEntry ? 'The trips are linked to this bank line — no new line is written.' : 'Pick it when you already made this transfer and the statement brought it in.'}</div></div>` : '';
    const body = `${list}<div class="tr-pay-more">${addForm}</div>${bank}
      <div class="g2"><div class="mfield"><label>${PAY_METHOD === 'Cash' ? `Cash you are giving ${h(d ? d.name : '')}` : `Bank transfer to ${h(d ? d.name : '')}`}</label><input type="number" id="py_amt" value="${amount}" ${P.bankEntry ? 'disabled' : ''} oninput="TransportUI.payAmount(this.value)"></div>
      <div class="mfield"><label>Date</label><input type="date" id="py_date" value="${h(P.date)}" ${P.bankEntry ? 'disabled' : ''} onchange="TransportUI.payDate(this.value)"></div></div>
      <div id="py_diff">${diffBlock(sum, amount)}</div>`;
    modal(`Pay ${d ? d.name : 'driver'}`, `<span id="py_sub">${P.picked.size} trip${P.picked.size === 1 ? '' : 's'} ticked · ${money(sum)}</span>`, body,
      `<button class="btn btn-s" onclick="TransportUI.openPay()">Back</button><button class="btn btn-p" id="py_save" onclick="TransportUI.savePay()" ${payReady() ? '' : 'disabled'}>${P.bankEntry ? 'Link payment' : 'Save payment'}</button>`);
  }
  function diffBlock(sum, amount) {
    const diff = amount - sum; const P = TR.payDraft;
    if (!diff) return '';
    return `<div class="status-msg status-warn">You typed ${money(amount)} · the trips add up to ${money(sum)} · difference ${diff > 0 ? '+' : ''}${money(diff)}</div>
      <div class="hint">A run missing? Add it with «Run not in the list». A run that did not happen? Untick it or remove it with «−».</div>
      <div class="mfield"><label>Why?</label><div class="pills" id="py_reasons">${DIFF_REASONS.map(r => `<button class="pill${P.reason === r ? ' active' : ''}" onclick="TransportUI.payReason('${r}')">${r}</button>`).join('')}</div>
      <input id="py_note" placeholder="Short note" value="${h(P.note)}" oninput="TransportUI.payNote(this.value)"></div>`;
  }
  function payNumbers() {
    const P = TR.payDraft; const sum = payPool(P).filter(t => P.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const be = P.bankEntry ? ledgerById(P.bankEntry) : null;
    const amount = be ? Number(be.amountLocal || 0) : (P.amount == null ? sum : P.amount);
    return { sum, amount };
  }
  function payReady() { const P = TR.payDraft; const { sum, amount } = payNumbers(); return P.picked.size > 0 && amount > 0 && (amount === sum || !!P.reason); }
  function payRefresh() { const { sum, amount } = payNumbers(); if ($('py_diff')) $('py_diff').innerHTML = diffBlock(sum, amount); if ($('py_save')) $('py_save').disabled = !payReady(); }
  function payTick(id, on) { const P = TR.payDraft; if (on) P.picked.add(id); else P.picked.delete(id); P.amount = null; renderPay(); }
  function payTickGroup(key, on) { const P = TR.payDraft; const g = payGroups(P).find(x => x.key === key); if (!g) return; g.ids.forEach(id => on ? P.picked.add(id) : P.picked.delete(id)); P.amount = null; renderPay(); }
  async function payMinus(key) {
    const P = TR.payDraft; const g = payGroups(P).find(x => x.key === key); if (!g || TR.busy.has('payminus')) return;
    // Your areas only (runAreas); a run the driver has and that is still to come is kept as cancelled (dropRun), so the
    // next «Send» tells him CANCELLED — any other one is deleted, as before.
    const victim = TR.trips.filter(t => g.ids.includes(t.id) && t.source === 'manual' && !t.payment_entry_id && canRun(t)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    if (!victim) return;
    TR.busy.add('payminus');
    try { if (await dropRun(victim)) { P.picked.delete(victim.id); P.amount = null; say(`Removed one ${g.label}`); renderPay(); } } finally { TR.busy.delete('payminus'); }
  }
  function payAddToggle(on) { TR.payDraft.adding = !!on; renderPay(); }
  async function payAddRun() {
    const P = TR.payDraft; if (!P || TR.busy.has('payadd')) return;
    const r = tukRoute(($('py_ar') && $('py_ar').value) || P.add.route); const day = ($('py_ad') && $('py_ad').value) || cToday();
    const n = Math.min(30, Math.max(1, parseInt(($('py_an') && $('py_an').value) || '1', 10) || 1));
    const pax = IS_SL ? 1 : null;
    if (!r || !canRun(r)) { say('Pick the route', 'err'); return; }
    if (day > cToday()) { say('Only runs that already happened', 'err'); return; }
    if (!IS_SL && pricesError()) { say('The van prices have not loaded from /prices — nothing saved. Check the connection and try again.', 'err'); return; }
    TR.busy.add('payadd');
    try {
      const veh = IS_SL ? RUN.veh : (($('py_av') && $('py_av').value) || vanDefaultVehicle(r));
      P.add = { date: day, route: r.key, n: 1, pax, vehicle: IS_SL ? '' : veh };
      for (let i = 0; i < n; i++) {
        const t = await insertTrip({ kind: RUN.kind, trip_date: day, trip_time: null, route: r.route, purpose: r.purpose, tour_name: r.tour || null,
          driver_id: P.driver, expected_price: runPrice(r, veh), vehicle: veh, status: 'done', source: 'manual', pax, notes: 'Added when paying', ...(r.confirm && IS_SL ? { import_flags: [NO_ROW_FLAG(r.label)] } : {}) });
        if (!t) break;
        P.picked.add(t.id);
      }
      P.adding = false; P.amount = null; renderPay();
    } finally { TR.busy.delete('payadd'); }
  }
  function payBank(entryId) { const P = TR.payDraft; P.bankEntry = P.bankEntry === entryId ? null : entryId; if (P.bankEntry) { const e = ledgerById(entryId); if (e && e.date) P.date = e.date; } renderPay(); }
  function payAmount(v) { TR.payDraft.amount = Number(v || 0); payRefresh(); }
  function payDate(v) { TR.payDraft.date = v || cToday(); renderPay(); }
  function payReason(r) { TR.payDraft.reason = r; payRefresh(); if ($('py_reasons')) $('py_reasons').querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.textContent === r)); }
  function payNote(v) { TR.payDraft.note = v; }
  // Morocco: a van run's item is its route («Surf», «Dunes», «Paradise + Souk» = the van rate table).
  function linkedItemOf(t) { return isAirport(t) ? 'Airport' : !IS_SL ? (t.route || 'Van') : t.purpose === 'tour' ? (t.route || t.tour_name || 'Errand') : (LINKED_ITEM_BY_PURPOSE[t.purpose] || 'Errand'); }
  function describe(driver, trips) {
    const arr = trips.filter(t => t.kind === 'airport_arrival').length, dep = trips.filter(t => t.kind === 'airport_departure').length;
    const runs = trips.filter(t => !isAirport(t));
    const parts = [];
    if (arr) parts.push(`${arr} arrival${arr === 1 ? '' : 's'}`);
    if (dep) parts.push(`${dep} departure${dep === 1 ? '' : 's'}`);
    if (runs.length) { const tour = runs.find(t => t.purpose === 'tour'); parts.push(tour ? `${runs.length} tour run${runs.length === 1 ? '' : 's'} (${tour.tour_name || tour.route})` : `${runs.length} ${runs[0].purpose === 'surf' ? 'surf' : runs[0].purpose} run${runs.length === 1 ? '' : 's'}`); }
    const dates = trips.map(t => t.trip_date).sort();
    return `${driver} · ${parts.join(', ')} · ${dates[0] === dates[dates.length - 1] ? fmtShort(dates[0]) : fmtRange(dates[0], dates[dates.length - 1])}`;
  }
  async function savePay() {
    const P = TR.payDraft; if (!P || !payReady() || TR.busy.has('pay')) return;
    TR.busy.add('pay');
    try {
      const d = driverById(P.driver); const trips = payPool(P).filter(t => P.picked.has(t.id));
      const { sum, amount } = payNumbers(); const diff = amount - sum;
      const note = diff ? [P.reason, P.note].filter(Boolean).join(': ') : '';
      if (P.bankEntry) {
        // Morocco: the SG transfer is already in the ledger — link it, never a second line.
        const r = await rpc('camp_transport_link_set', { p_entry: P.bankEntry, p_driver: P.driver, p_trip_ids: trips.map(t => t.id), p_note: note || null });
        await load(true); closeModal(); render();
        try { renderExpenses(); renderOverview(); } catch (_) {}
        say(`Linked ${d ? d.name : 'driver'} · ${trips.length} trip${trips.length === 1 ? '' : 's'}${r && r.state === 'explained' ? ' · difference explained' : ''}`);
        return;
      }
      let fx = 0; try { fx = await fetchFxRateForDate(P.date); } catch (_) {}
      if (!(fx > 0)) fx = Number(LOCAL_PER_EUR || DEFAULT_LKR_PER_EUR) || 330;
      // Sri Lanka: one Cash row per linked item. Morocco: one bank movement = one row (the most common item).
      const groups = new Map();
      trips.forEach(t => { const k = IS_SL ? linkedItemOf(t) : '*'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
      const topItem = ts => { const c = new Map(); ts.forEach(t => c.set(linkedItemOf(t), (c.get(linkedItemOf(t)) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
      const entries = [...groups.entries()].map(([item, ts]) => ({ item: item === '*' ? topItem(ts) : item, ts, amount: ts.reduce((s, t) => s + Number(t.expected_price || 0), 0) }));
      const largest = entries.slice().sort((a, b) => b.amount - a.amount)[0];
      const rows = entries.map(g => {
        const amt = g === largest ? g.amount + diff : g.amount;
        const desc = describe(d ? d.name : 'Driver', g.ts) + (g === largest && diff ? ` · ${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('de-DE')} ${P.reason.toLowerCase()}` : '');
        const entry = normalizeLedgerEntry({ id: (crypto.randomUUID ? crypto.randomUUID() : undefined), date: P.date, type: 'expense', category: 'Transport', linkedItem: g.item, businessArea: 'Transport',
          paymentMethod: PAY_METHOD, currency: LOCAL_CURRENCY || CUR, fxRate: fx, amountLocal: amt, quantity: g.ts.length, description: desc, sourceKind: 'trip_payment', amount: Number((amt / fx).toFixed(2)) });
        return { ...ledgerEntryToDbRow(entry, HUB_SB_LOCATION_ID), payment_method: PAY_METHOD, trip_ids: g.ts.map(t => t.id) };
      });
      const r = await rpc('camp_trips_pay', { p_location: HUB_SB_LOCATION_ID, p_driver: P.driver, p_typed_amount: amount, p_diff_note: note || null, p_entries: rows });
      const fresh = ((r && r.rows) || []).map(dbRowToLedgerEntry).filter(Boolean);
      if (fresh.length) { const ids = new Set(fresh.map(e => e.id)); S.ledger = S.ledger.filter(e => !ids.has(e.id)).concat(fresh); save(); try { notifyLedgerChanged(); } catch (_) {} }
      await load(true); closeModal(); render();
      try { renderExpenses(); renderOverview(); } catch (_) {}
      say(`Paid ${d ? d.name : 'driver'} ${money(amount)} · ${trips.length} trip${trips.length === 1 ? '' : 's'} linked`);
    } catch (_) { /* toasted */ } finally { TR.busy.delete('pay'); }
  }

  // ── Drivers and the «Send transfers to» contact ────────────────────────
  function openDrivers() {
    const c = contact();
    const teamContact = d => (d.default_for || []).some(x => /^(cleaning|kitchen|surf)_contact$/.test(x));   // edited in Week → Contacts
    const list = TR.drivers.filter(d => !teamContact(d));
    const rows = list.map(d => `<div class="tr-driver" data-driver="${d.id}"><div class="g2"><div class="mfield"><label>Name</label><input data-f="name" value="${h(d.name)}"></div>
        <div class="mfield"><label>Phone (${IS_SL ? '+94' : CC.phoneExample.slice(0, 4)}…)</label><input data-f="phone" value="${h(d.phone || '')}" placeholder="${IS_SL ? '+94771234567' : CC.phoneExample}"></div></div>
        <div class="g2"><div class="mfield"><label>Label</label><input data-f="label" value="${h(d.label || '')}"></div>
        <div class="mfield"><label>Default vehicle</label><select data-f="default_vehicle"><option value=""></option>${[...new Set(airLabels('airport_arrival').concat(airLabels('airport_departure'), IS_SL ? [] : vanLabels(), RUN.veh, d.default_vehicle ? [d.default_vehicle] : []))].map(v => `<option${v === d.default_vehicle ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="mfield"><label>Named in payments as (comma separated)</label><input data-f="aliases" value="${h((d.aliases || []).join(', '))}"></div></div>`).join('');
    const body = `<div class="mfield"><label>Send transfers to</label><select id="dv_contact">${list.map(d => `<option value="${d.id}"${c && c.id === d.id ? ' selected' : ''}>${h(d.name)}${d.phone ? ' · ' + h(d.phone) : ' · no phone'}</option>`).join('')}</select>
        <div class="hint">WhatsApp messages go to this person, who passes them to the driver.</div></div>
      <div class="mfield"><label>${RUN.label} orders to</label><select id="dv_tuk"><option value="">Default ${RUN.lower} driver${defaultDriver(RUN.drv) ? ' (' + h(defaultDriver(RUN.drv).name) + ')' : ''}</option>${list.map(d => `<option value="${d.id}"${(d.default_for || []).includes(TUKTUK_CONTACT) ? ' selected' : ''}>${h(d.name)}${d.phone ? ' · ' + h(d.phone) : ' · no phone'}</option>`).join('')}</select>
        <div class="hint">Who gets the ${RUN.lower} orders on WhatsApp (${IS_SL ? '«Send» in the run sheet' : '«Plan the day»'} on the ${h(CATS.filter(c => c[0] !== 'airport').map(c => c[1]).join(' / '))} pill).</div></div>${rows}
      <button class="btn btn-s" onclick="TransportUI.addDriver()">${ic('plus')} Add driver</button>`;
    modal('Drivers', 'Name, phone and default vehicle', body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" onclick="TransportUI.saveDrivers()">Save</button>`);
  }
  async function addDriver() {
    const loc = await ensureHubLocationId();
    const { data, error } = await client().from('camp_drivers').insert({ location_id: loc, name: 'New driver ' + (TR.drivers.length + 1), kinds: ['airport'] }).select();
    if (error) { say(error.message, 'err'); return; }
    TR.drivers.push(...(data || [])); openDrivers();
  }
  async function saveDrivers() {
    const cId = $('dv_contact') && $('dv_contact').value;
    const tId = ($('dv_tuk') && $('dv_tuk').value) || '';
    for (const el of document.querySelectorAll('#trOv .tr-driver')) {
      const d = driverById(el.dataset.driver); if (!d) continue;
      const v = f => el.querySelector(`[data-f="${f}"]`).value;
      const phone = v('phone').replace(/[\s-]/g, '');
      if (phone && !/^\+[0-9]{8,15}$/.test(phone)) { say(`${d.name}: phone must look like ${IS_SL ? '+94771234567' : CC.phoneExample}`, 'err'); return; }
      let df = (d.default_for || []).filter(x => x !== 'transfers_contact' && x !== TUKTUK_CONTACT); if (d.id === cId) df = df.concat('transfers_contact');
      if (d.id === tId) df = df.concat(TUKTUK_CONTACT);
      let kinds = d.kinds || []; if ((d.id === cId || d.id === tId) && !kinds.length) kinds = ['contact'];
      const patch = { name: v('name').trim() || d.name, phone: phone || null, label: v('label').trim() || null, default_vehicle: v('default_vehicle') || null,
        aliases: v('aliases').split(',').map(s => s.trim()).filter(Boolean), default_for: df, kinds };
      if (JSON.stringify(patch) === JSON.stringify({ name: d.name, phone: d.phone || null, label: d.label || null, default_vehicle: d.default_vehicle || null, aliases: d.aliases || [], default_for: d.default_for || [], kinds: d.kinds || [] })) continue;
      const { data, error } = await client().from('camp_drivers').update(patch).eq('id', d.id).select();
      if (error) { say(error.message, 'err'); return; }
      TR.drivers = TR.drivers.map(x => x.id === d.id ? ((data && data[0]) || { ...x, ...patch }) : x);
    }
    closeModal(); render(); say('Drivers saved');
  }

  // ── Chip for the shared strip («Transport payment not linked to trips») ─
  // Synchronous; null until Transport data is loaded, always null in the local view.
  // Same gate as camp_transport__link(): a named driver or a driver-run linked item.
  // Fuel / scooter / delivery rows are not driver payments and never nag.
  const DRIVER_ITEMS = IS_SL ? ['Airport', 'Transport Surf Lesson', 'Food Supply', 'Laundry'] : ['Airport', ...(CC.vanRates || []).map(r => r.route)];
  // «Dylan» = Dilan: the same word with one letter changed, added or missing (= camp_transport__near).
  function nearWord(a, b) {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d === 1; }
    const [s2, g] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < g.length; i++) if (g.slice(0, i) + g.slice(i + 1) === s2) return true;
    return false;
  }
  function looksLikeDriverPayment(e) {
    if (DRIVER_ITEMS.includes(String(e.linkedItem || ''))) return true;
    const text = String(e.description || '').toLowerCase();
    const words = text.split(/[^a-z]+/).filter(w => w.length >= 4);
    return (TR.drivers || []).some(d => d && !((d.kinds || []).length === 1 && d.kinds[0] === 'contact') &&
      [d.name, ...(d.aliases || [])].some(a => { a = String(a || '').toLowerCase().trim(); if (!a) return false;
        const re = new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
        return re.test(text) || (/^[a-z]{5,}$/.test(a) && words.some(w => nearWord(a, w))); }));
  }
  const unlinkedCheck = {
    id: 'transport-payment-unlinked',
    run(ctx) {
      if (!ctx || ctx.isLocal || ctx.location !== 'sri-lanka' || !TR.loaded) return null;
      const linked = new Set(TR.links.map(l => l.entry_id));
      const review = TR.links.filter(l => l.state === 'review');
      const fresh = (ctx.ledger || []).filter(e => e && e.type === 'expense' && e.category === 'Transport' && e.paymentMethod === 'Cash'
        && String(e.date || '') >= goLive() && String(e.createdAt || '').slice(0, 10) >= goLive() && !linked.has(e.id)
        && looksLikeDriverPayment(e));
      const n = review.length + fresh.length;
      if (!n) return null;
      const lkrSum = review.reduce((s, l) => s + Math.max(0, Number(l.entry_amount || 0) - Number(l.trips_amount || 0)), 0) + fresh.reduce((s, e) => s + Number(e.amountLocal || 0), 0);
      return { text: `Transport payment not linked to trips · ${n}${lkrSum ? ' · ' + money(lkrSum) : ''}`, level: 'warn', onClick: () => { TR.view = 'trips'; showPage('transport'); openChecks(); } };
    },
  };
  // Morocco: a bank transfer to a driver that pays no trips yet (the same lines as Reconcile → Payments).
  const bankUnlinkedCheck = {
    id: 'transport-bank-unlinked',
    run(ctx) {
      if (!ctx || ctx.isLocal || !BANK_PAID || ctx.location !== SLUG || !TR.loaded) return null;
      const list = allLinks().filter(l => l.state === 'review');
      if (!list.length) return null;
      const sum = list.reduce((s, l) => s + Math.max(0, Number(l.entry_amount || 0) - Number(l.trips_amount || 0)), 0);
      return { text: `Bank transfer to a driver not linked to trips · ${list.length}${sum ? ' · ' + money(sum) : ''}`, level: 'warn', onClick: () => { TR.view = 'trips'; showPage('transport'); openChecks(); } };
    },
  };
  // Both camps: imported airport transfers not yet checked on their Bookinglayer booking page (= the Transport chip).
  const blCheck = {
    id: 'transport-bl-check',
    run(ctx) {
      if (!ctx || ctx.isLocal || ctx.location !== SLUG || !TR.loaded || !enabled()) return null;
      const n = blList().length;
      if (!n) return null;
      return { text: `${n} transfer${n === 1 ? '' : 's'} to check in Bookinglayer`, level: 'warn', onClick: showBlCheck };
    },
  };
  window.CAMP_CHECKS = window.CAMP_CHECKS || [];
  [blCheck, unlinkedCheck, bankUnlinkedCheck].forEach(ck => { if (!window.CAMP_CHECKS.some(c => c && c.id === ck.id)) window.CAMP_CHECKS.push(ck); });

  // ── Boot: show the tab (full view; Sri Lanka ?view=local as «Drivers»), load once the ledger is in ─
  function boot() {
    if (!enabled()) return;
    document.querySelectorAll('.ntab[data-page="transport"], .ntab-m[data-page="transport"]').forEach(b => {
      b.style.display = '';
      // ?view=local: the same page is Nadith's «Drivers» tab (16 Nov 2026).
      if (LOCAL) { const lbl = b.querySelector('.nav-btn-label > span:last-child'); if (lbl) lbl.textContent = 'Drivers'; else if (b.classList.contains('ntab-m')) b.textContent = 'Drivers'; }
    });
    if (LOCAL) return;   // Nadith's phone loads the trips only when he opens «Drivers» (renderTransportPage)
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      let ready = false; try { ready = HUB_LEDGER_HYDRATED === true; } catch (_) {}
      if (ready || tries > 120) { clearInterval(wait); load(); }
    }, 250);
  }

  window.renderTransportPage = renderTransportPage;
  window.TransportUI = {
    render, closeModal, retry, loadErrorHtml, setView(v, f) { if (v === 'next') return toImport(); TR.view = v; if (f) TR.filter = f; render(); }, setFilter(f) { TR.filter = f; TR.view = 'trips'; render(); },
    toImport, setWeek,
    shiftWeek(n) { TR.week = GT.addDaysIso(TR.week, n); TR.filter = SPECIAL_FILTERS.includes(TR.filter) ? 'all' : TR.filter; render(); },
    ovMode, ovShift, ovMonth, ovMeasure, ovExport, ovData,
    send, sendDay, dayMessage, weekMessage, sendWeek, tickWeek, weekCount, undoTick, setStep, missingInfo, monthCsv, openExport, downloadMonth, undoGuestConfirmed, ask, askText, askedOn, needsInfo, tick, tickDay, tickIds, openTrip, saveTrip, setStatus, openAddTransfer, saveTransfer,
    openTuktuk, openPlan, planOn, spStep, spInput, spOpen, spVeh, spAuto, spSave, spSetTime, spPlan: key => { const r = tukRoute(key); return r ? spPlan(r) : null; }, tukSet, tukVehicle(v) { TR.tuk.vehicle = v; vanSheetRefresh(); }, tukMode, tap, untap, removeRun, removeTrip, planAdd, planStep, sendOrder, orderText,
    tukSession: setSession, tukPickup: setPickup, allAsPlanned, logDay, sendRunsDay, planState, batchesOf, planMessage, airState, weekSentState, sendDayUpdate, sendWeekUpdate, dayUpdateMessage, weekUpdateMessage, PLAN_DAY,
    openRuns, saveRuns, deleteRuns, toggleRuns, addOn, catOf, payState, weekTotals, keepTrip, inWeek, presetPrice, pickAir, airVehicles, pricesReady, bankCandidates, camp: CC, RUN,
    confirmGuest, guestConfirmed, confirmText, guestState, guestHtml, openGuestDay, pickFile, setExportDate, saveImport,
    openChecks, openLink, linkDriver, linkPick, linkAll, linkMonth, namedMonth, saveLink, unlinkPayment, openExplain, saveExplain, unlinkTrip,
    openPay, payPick, payTick, payTickGroup, payMinus, payAddToggle, payAddRun, payBank, payAmount, payDate, payReason, payNote, savePay, payGroups, localDrivers: LOCAL,
    openDrivers, addDriver, saveDrivers,
    together, paidTwiceOk, moneyOk, moneyCharge, useBl, toggleOff,
    blBooked, blNotBooked, driverWent, driverDidntGo, showBlCheck, blToCheck, blList, blUrl, blCount: () => blList().length, blCheck,
    // for tests and the coordinator
    importHtml: renderNext,   // the Week tab renders the same import
    _state: TR, load, isDone, reconcileStatus, colomboNow, campNow: colomboNow, check: unlinkedCheck, bankCheck: bankUnlinkedCheck, TRIPS_GO_LIVE, goLive,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
