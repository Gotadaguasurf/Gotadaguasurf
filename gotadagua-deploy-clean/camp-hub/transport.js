// Camp hub · Transport (Sri Lanka, 13 Nov 2026)
//
// Airport transfers and tuk-tuk runs for the full view (Francisco, Miguel,
// HQ). Never in ?view=local or camp-tab-only: Nadith keeps paying drivers in
// the ledger as today and supabase/camp-trips.sql links his payment to the
// trips by itself.
//
//   Trips      list by day (Sat–Fri week), WhatsApp to the «Send transfers to»
//              contact, Sent ✓ / Confirmed ✓, «Time changed, resend».
//   Next week  the Monday Guests import: trips from the file (checked against
//              HQ bookings when the ref is there), cancelled in HQ, HQ transfer missing.
//   Reconcile  trips ↔ payments, like HQ → Month close → Reconcile.
//   + Tuk-tuk runs (one tap = one run today; «Plan tomorrow» + the WhatsApp order
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

  // ── Settings (kept as constants so Miguel can change them later) ────────
  const TRIPS_ENABLED_LOCATIONS = new Set(['sri-lanka']);
  const TRIPS_GO_LIVE = '2026-11-14';  // = camp_trips_go_live() in the SQL; start of the first camp week with trips (was 16 Nov)
  const goLive = () => window.TRIPS_GO_LIVE_OVERRIDE || TRIPS_GO_LIVE;   // tests move it into the past
  const TRIPS_LOAD_FROM = '2026-10-01';
  const TRIPS_BL_LOCATION_LABELS = ['Surf Camp Ahangama'];
  const HQ_LIVE_STATUSES = new Set(['confirmed', 'paid', 'deposit paid', 'deposit_paid']);
  const HQ_DEAD_STATUSES = new Set(['cancelled', 'canceled', 'expired']);   // only these cancel a trip; any other HQ status counts as there
  const VEHICLES = ['Car', 'Minivan', 'Large Van'];
  // Camp runs have no catalog price yet (Sampath's prices, open question Q2):
  // a /prices row with the same name (picker «tuktuk») replaces the price here.
  const TUKTUK_CAMP_RUNS = [
    { label: 'Market / food', purpose: 'food', price: 500 },
    { label: 'Laundry', purpose: 'laundry', price: 500 },
    { label: 'Staff', purpose: 'staff', price: 500 },
    { label: 'Errand', purpose: 'errand', price: 500 },
  ];
  const LINKED_ITEM_BY_PURPOSE = { surf: 'Transport Surf Lesson', food: 'Food Supply', laundry: 'Laundry', staff: 'Staff', errand: 'Errand', other: 'Errand' };
  const DIFF_REASONS = ['Waiting time', 'Extra stop', 'Tip', 'Price changed', 'Other'];
  const CHARGE_LABEL = { bookinglayer: 'In booking', camp_tab: 'Camp Tab', free: 'Free' };
  // A trip nobody pays us for (the driver is still paid). Stored as charge = 'free' + free_reason
  // (supabase/camp-trips-v2.sql); a free trip without a reason is an older row.
  const FREE_REASONS = [['staff', 'Staff'], ['gift', 'Gift to guest'], ['compensation', 'Compensation'], ['other', 'Other']];
  const FREE_SHORT = { staff: 'Staff', gift: 'Gift', compensation: 'Compensation', other: 'Other' };
  const TUKTUK_CONTACT = 'tuktuk_contact';         // default_for of the person who gets the tuk-tuk order
  const PLAN_DEFAULT_TIME = '07:30';
  const LOCAL_MANAGER_NAME = 'Nadith';             // who pays the drivers in ?view=local («linked by Nadith» in Reconcile)

  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const enabled = () => TRIPS_ENABLED_LOCATIONS.has(SLUG) && !LOCAL_MANAGER_MODE && !CAMP_TAB_ONLY_MODE;

  const TR = {
    loaded: false, loading: null, error: '', drivers: [], trips: [], links: [],
    view: 'trips', filter: 'all', week: null,
    recMode: 'week', recAnchor: null, recTab: 'airport', recFilter: 'all',
    imp: null, busy: new Set(),
  };

  // ── Time: Colombo, never the browser's zone. window.TRANSPORT_NOW pins it in tests.
  function colomboNow() {
    if (window.TRANSPORT_NOW) return String(window.TRANSPORT_NOW).slice(0, 16);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
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
  //   5 done, not paid, dated before go-live              → before_go_live «Before go-live»     neutral (paid in the old lumps)
  //   6 done, not paid                                    → owed           «Owed to driver»     to do
  //   7 done, paid, from Bookinglayer (or a tuk-tuk run)  → matched        «Matched»
  //   8 done, paid, added by hand (no booking)            → extra          «Extra»              neutral
  function reconcileStatus(t) {
    const paid = !!t.payment_entry_id;
    const done = isDone(t);
    if (paid && (t.status === 'cancelled' || t.status === 'no_show' || t.status === 'merged' || !done)) return 'paid_not_done';
    if (t.status === 'cancelled' || t.status === 'merged') return 'cancelled';
    if (t.status === 'no_show') return 'no_show';
    if (!done) return 'upcoming';
    if (!paid && t.trip_date < goLive()) return 'before_go_live';
    if (!paid) return 'owed';
    if (t.source === 'bookinglayer' || t.kind === 'tuktuk') return 'matched';
    return 'extra';
  }
  const REC_LABEL = {
    matched: ['Matched', 'badge-green'], owed: ['Owed to driver', 'badge-amber'], paid_not_done: ['Paid, not done', 'badge-red'],
    no_show: ['No-show', 'badge-grey'], before_go_live: ['Before go-live', 'badge-grey'], extra: ['Extra', 'badge-blue'], upcoming: ['Upcoming', 'badge-grey'], cancelled: ['Cancelled', 'badge-grey'],
  };
  const REC_TODO = new Set(['owed', 'paid_not_done']);
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
  function rowFlag(t) {
    const F = t.import_flags || [];
    const says = F.find(f => /^guest says:/.test(f));
    if (F.some(f => REMOVED_FLAG.test(f))) return 'Transfer removed in Bookinglayer — cancel it, or keep it if it is still needed';
    if (t.missing_since) return 'Not in the latest Bookinglayer file';
    if (says) { const m = says.match(/«([^»]*)»/); const q = m ? m[1].trim() : ''; return `Guest says: «${q.length > 60 ? q.slice(0, 57) + '…' : q}» — still needed?`; }
    if (F.some(f => /^night arrival/.test(f))) return `Night arrival — the driver leaves the evening before (${fmtDay(GT.addDaysIso(t.trip_date, -1))})`;
    return '';
  }
  // Held back from «Send the whole day» until Francisco has looked: the booking or its transfer left the file.
  const onHold = t => !!t.missing_since;
  const vehicleFor = GT.vehicleFor;
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
    if (s === 'before_go_live') return { key: 'old', label: 'Before go-live', cls: 'badge-grey', sub: `not tracked before ${fmtShort(goLive())}` };
    return { key: 'planned', label: t.status === 'confirmed' ? 'Confirmed' : t.status === 'sent' ? 'Sent' : 'Planned', cls: t.status === 'confirmed' ? 'badge-green' : t.status === 'sent' ? 'badge-blue' : 'badge-grey', sub: '' };
  }
  const payBadge = t => { const p = payState(t); return `<span class="badge ${p.cls}" data-pay="${p.key}">${p.label}</span>`; };
  const runLabel = t => t.tour_name ? 'Tour · ' + t.tour_name : t.purpose === 'surf' ? 'Camp → ' + (t.route || '') : (t.route || t.purpose || 'Run');

  function presetPrice(kind, vehicle) {
    const list = (typeof transportPresets !== 'undefined' && transportPresets && transportPresets.airport) || [];
    const dep = kind === 'airport_departure';
    const p = list.find(x => dep ? /→\s*airport/i.test(x.name) : /airport\s*→/i.test(x.name));
    const v = p && (p.vehicles || []).find(x => x.label === vehicle);
    return v ? Number(v.price) || 0 : 0;
  }
  const contact = () => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes('transfers_contact'));
  // Who gets the tuk-tuk order: the «Tuk-tuk orders to» person, else the default tuk-tuk driver (Sampath).
  const tukContact = () => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes(TUKTUK_CONTACT)) || defaultDriver('tuktuk');
  const driverById = id => TR.drivers.find(d => d.id === id);
  const HQ_CROSSCHECK = false; // see buildImport()
  const defaultDriver = kind => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes(kind));
  const driversFor = kind => TR.drivers.filter(d => d.active !== false && ((d.kinds || []).includes(kind) || (kind === 'airport' && (d.kinds || []).includes('other'))));
  const ledgerById = id => (typeof S !== 'undefined' && S.ledger || []).find(e => e.id === id);
  const linkOf = entryId => TR.links.find(l => l.entry_id === entryId);
  function waText(t) { return GT.whatsappText(t); }

  // ── Data ───────────────────────────────────────────────────────────────
  const client = () => (typeof getHubSupabaseClient === 'function') ? getHubSupabaseClient() : null;
  async function load(force) {
    if (!enabled()) return;
    if (TR.loading && !force) return TR.loading;
    TR.loading = (async () => {
      const c = client(); const loc = await ensureHubLocationId().catch(() => '');
      if (!c || !loc) { TR.error = 'Not connected'; return; }
      try { await c.rpc('camp_transport_autolink', { p_location: loc }); } catch (_) { /* table not set up yet */ }
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
        all(() => c.from('camp_transport_payments').select('*').eq('location_id', loc).order('entry_id')),
      ]);
      const err = d.error || t.error || l.error;
      if (err) { TR.error = err.message || String(err); TR.loaded = false; return; }
      TR.drivers = d.data || []; TR.trips = t.data || []; TR.links = l.data || [];
      TR.error = ''; TR.loaded = true;
    })();
    try { await TR.loading; } finally { TR.loading = null; }
    try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {}
    if (typeof activePage !== 'undefined' && (activePage === 'transport' || activePage === 'week')) render();
  }
  // free_reason / added_by_local arrive with supabase/camp-trips-v2.sql. Until it is run, a save
  // that carries them is repeated without them (charge = 'free' is still stored) — never a lost edit.
  const NEW_COLS = ['free_reason', 'added_by_local', 'guest_notified_at', 'guest_confirmed_at', 'guest_told_snapshot'];
  const newColMissing = error => !!error && /free_reason|added_by_local|guest_notified_at|guest_confirmed_at|guest_told_snapshot/.test(String(error.message || '') + String(error.details || ''));
  const withoutNew = row => { const r = { ...row }; NEW_COLS.forEach(k => delete r[k]); return r; };
  async function updateTrip(id, patch, edited) {
    const t = TR.trips.find(x => x.id === id); if (!t) return null;
    const row = { ...patch };
    if (edited && edited.length) row.edited_fields = [...new Set([...(t.edited_fields || []), ...edited])];
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
    let { data, error } = await client().from('camp_trips').insert({ location_id: loc, ...row }).select();
    if (newColMissing(error)) ({ data, error } = await client().from('camp_trips').insert({ location_id: loc, ...withoutNew(row) }).select());
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
  const $ = id => document.getElementById(id);

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
    const v = TR.view;
    const head = `<div class="section-head page-head"><div><div class="section-title">Transport</div><div class="section-sub tr-how">Transfers come from the Guests file (Week → Import). Tuk-tuks: plan tomorrow and send the order. Nadith pays in the Ledger (Transport · Airport) and ticks the guests, and they show as Paid here.</div></div>
      <div class="exp-top-actions tr-actions">
        <button class="btn ${v === 'trips' ? 'btn-p' : 'btn-s'}" onclick="TransportUI.openTuktuk()">${ic('plus')} Tuk-tuk runs</button>
        <button class="btn btn-s" onclick="TransportUI.openAddTransfer()">${ic('truck')} Add transfer</button>
        <button class="btn btn-s" onclick="TransportUI.openDrivers()">${ic('users')} Drivers</button>
      </div></div>`;
    if (TR.error) {
      root.innerHTML = head + `<div class="status-msg status-warn">Transport is not set up yet (${h(TR.error)}). Ask Miguel to run supabase/camp-trips.sql.</div>`;
      return;
    }
    if (!TR.loaded) { root.innerHTML = head + '<div class="loading">Loading trips…</div>'; return; }
    const review = TR.links.filter(l => l.state === 'review').length;
    const tabs = `<div class="pills tr-views">
      <button class="pill${v === 'trips' ? ' active' : ''}" onclick="TransportUI.setView('trips')">Trips</button>
      <button class="pill${v === 'next' ? ' active' : ''}" onclick="TransportUI.setView('next')">Next week</button>
      <button class="pill${v === 'reconcile' ? ' active' : ''}" onclick="TransportUI.setView('reconcile')">Reconcile${review ? ` <span class="count">${review}</span>` : ''}</button></div>`;
    const body = v === 'next' ? renderNext() : v === 'reconcile' ? renderReconcile() : renderTrips();
    root.innerHTML = head + attentionStrip() + owedLine() + tabs + body;
  }

  // What is owed to each driver right now (every done, unpaid trip since go-live), in one line.
  function owedLine() {
    const by = new Map();
    TR.trips.forEach(t => { if (reconcileStatus(t) !== 'owed') return; const k = t.driver_id || ''; by.set(k, (by.get(k) || 0) + Number(t.expected_price || 0)); });
    const review = TR.links.filter(l => l.state === 'review').length;
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, sum]) => `<span class="tr-owed-d">${h(driverById(id)?.name || 'No driver')} <b class="num">${money(sum)}</b></span>`);
    return `<button class="tr-owed" id="trOwed" onclick="TransportUI.setRec('${review && !parts.length ? 'payments' : 'airport'}')" title="Open Reconcile"><span class="tr-owed-l">Owed to drivers</span>${parts.length ? parts.join('') : '<span class="tr-owed-d">nothing</span>'}${review ? `<span class="tr-owed-d tr-owed-chk">${review} payment${review === 1 ? '' : 's'} to check</span>` : ''}</button>`;
  }
  function attentionStrip() {
    const now = colomboNow(); const in48 = addHours(now, 48);
    const resend = TR.trips.filter(t => isAirport(t) && t.needs_resend && t.status !== 'done').length;
    const toSend = TR.trips.filter(t => isAirport(t) && t.status === 'planned' && `${t.trip_date}T${t.trip_time || '23:59'}` >= now && `${t.trip_date}T${t.trip_time || '00:00'}` <= in48).length;
    const missing = TR.trips.filter(t => t.missing_since && !['cancelled', 'done', 'no_show'].includes(t.status) && !isDone(t)).length;
    const review = TR.links.filter(l => l.state === 'review').length;
    const chips = [];
    const tm = GT.addDaysIso(cToday(), 1);
    const order = TR.trips.filter(t => t.kind === 'tuktuk' && t.trip_date === tm && !t.payment_entry_id && (t.status === 'planned' || (t.status === 'sent' && t.needs_resend))).length;
    if (order) chips.push(`<button class="health-chip" onclick="TransportUI.openPlan()">${order} tuk-tuk run${order === 1 ? '' : 's'} for tomorrow — send the order</button>`);
    if (resend) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','resend')">${resend} time changed — resend</button>`);
    if (toSend) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','tosend')">${toSend} to send (next 48 h)</button>`);
    if (missing) chips.push(`<button class="health-chip" onclick="TransportUI.setView('trips','missing')">${missing} not in the latest Bookinglayer file</button>`);
    if (review) chips.push(`<button class="health-chip" onclick="TransportUI.setRec('payments')">${review} payment${review === 1 ? '' : 's'} to review</button>`);
    return chips.length ? `<div class="health-strip tr-strip">${chips.join('')}</div>` : '';
  }
  function addHours(stamp, n) {
    const d = stamp.slice(0, 10); let hh = Number(stamp.slice(11, 13)) + n; let day = d;
    while (hh >= 24) { hh -= 24; day = GT.addDaysIso(day, 1); }
    return `${day}T${String(hh).padStart(2, '0')}${stamp.slice(13, 16)}`;
  }

  // ── Trips view ─────────────────────────────────────────────────────────
  function tripState(t) {
    if (t.payment_entry_id) return ['Paid', 'badge-green'];
    if (t.status === 'cancelled') return ['Cancelled', 'badge-grey'];
    if (t.status === 'no_show') return ['No-show', 'badge-grey'];
    if (isDone(t)) return ['Done', 'badge-navy'];
    if (t.status === 'confirmed') return ['Confirmed', 'badge-green'];
    if (t.status === 'sent') return ['Sent', 'badge-blue'];
    return ['Planned', 'badge-grey'];
  }
  function renderTrips() {
    const ws = TR.week, we = GT.addDaysIso(ws, 6);
    const f = TR.filter;
    let list = TR.trips.filter(t => inWeek(t, ws));
    const special = ['resend', 'tosend', 'missing'].includes(f);
    const totals = special ? '' : weekTotalsHtml(list);   // the whole week, whatever the Airport / Tuk-tuk pill says
    if (['resend', 'tosend', 'missing'].includes(f)) list = TR.trips.filter(t => t.trip_date >= cToday() || f === 'resend');
    if (f === 'airport') list = list.filter(isAirport);
    else if (f === 'tuktuk') list = list.filter(t => !isAirport(t));
    else if (f === 'resend') list = list.filter(t => isAirport(t) && t.needs_resend);
    else if (f === 'tosend') list = list.filter(t => isAirport(t) && t.status === 'planned');
    else if (f === 'missing') list = list.filter(t => t.missing_since && !['cancelled', 'no_show'].includes(t.status));
    const pill = (k, label) => `<button class="pill${f === k ? ' active' : ''}" onclick="TransportUI.setFilter('${k}')">${label}</button>`;
    const filters = `<div class="ov-filters tr-filters">
      <div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous week" onclick="TransportUI.shiftWeek(-7)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl tr-week">${fmtRange(ws, we)}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="TransportUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <div class="pills">${pill('all', 'All')}${pill('airport', 'Airport')}${pill('tuktuk', 'Tuk-tuk')}</div></div>`;
    const days = [...new Set(list.map(t => t.trip_date))].sort();
    if (!days.length) return filters + totals + `<div class="empty-state">${ic('truck')}<div class="empty-title">No trips this week</div><p>Import the Guests export in Next week, or add a transfer.</p></div>`;
    const c = contact();
    TR.runGroups = {};
    return filters + totals + days.map(day => {
      const dayTrips = list.filter(t => t.trip_date === day).sort((a, b) => (a.trip_time || '99').localeCompare(b.trip_time || '99'));
      const air = dayTrips.filter(t => isAirport(t) && !['cancelled', 'no_show'].includes(t.status));
      const tuk = dayTrips.filter(t => !isAirport(t));
      const sendable = air.filter(t => !t.payment_entry_id && !isDone(t) && !onHold(t));
      return `<div class="card tr-day"><div class="card-hdr"><div><div class="card-title">${fmtDay(day)}</div>
          <div class="card-hint">${air.length} transfer${air.length === 1 ? '' : 's'}${tuk.length ? ` · ${tuk.length} tuk-tuk run${tuk.length === 1 ? '' : 's'} · ${money(tuk.reduce((s, t) => s + Number(t.expected_price || 0), 0))}` : ''}</div></div>
          ${sendable.length > 1 || air.filter(guestCan).length > 1 ? `<div class="row tr-day-btns">${sendable.length > 1 ? `<button class="btn btn-s btn-sm" onclick="TransportUI.sendDay('${day}')" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the day">${ic('send')} Send the whole day</button>
            <button class="btn btn-s btn-sm" onclick="TransportUI.tickDay('${day}')">${ic('check')} Sent ✓ all</button>` : ''}
            ${air.filter(guestCan).length > 1 ? `<button class="btn btn-s btn-sm" data-guest-day onclick="TransportUI.openGuestDay('${day}')" title="One WhatsApp per guest: the driver waits with a sign with their name">${ic('users')} Confirm with all guests of the day</button>` : ''}</div>` : ''}</div>
        <div class="tr-rows">${air.map(tripRow).join('')}${dayTrips.filter(t => isAirport(t) && ['cancelled', 'no_show'].includes(t.status)).map(tripRow).join('')}${tuk.length ? tuktukSummary(tuk, day) : ''}</div></div>`;
    }).join('');
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
    return `<div class="summary-grid tr-totals">${tile('airport', `Airport · ${A.n} transfer${A.n === 1 ? '' : 's'}`, A, freeLine(A.free))}${tile('tuktuk', `Tuk-tuk · ${K.n} run${K.n === 1 ? '' : 's'}`, K, freeLine(K.free))}${tile('week', 'Week total', all, '')}</div>`;
  }
  function tripRow(t) {
    const ps = payState(t);
    const dep = t.kind === 'airport_departure';
    const time = t.trip_time ? `<b class="num">${h(t.trip_time)}</b>` : '<span class="badge badge-amber">time?</span>';
    const live = !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show'].includes(t.status);
    const next = !live ? '' : t.status === 'planned' ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','sent')">Sent ✓</button>`
      : t.status === 'sent' && !t.needs_resend ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','confirmed')">Confirmed ✓</button>`
      : t.needs_resend ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','sent')">Sent ✓</button>`
      // Undo a tick (Miguel, 13 Nov: «if I want to take that it is confirmed?»): one step back.
      : t.status === 'confirmed' ? `<button class="btn btn-s btn-sm" data-undo onclick="event.stopPropagation();TransportUI.undoTick('${t.id}')" title="Back to Sent">Undo ✓</button>` : '';
    return `<div class="tr-row" data-trip="${t.id}" onclick="TransportUI.openTrip('${t.id}')">
      <div class="tr-time">${time}</div>
      <div class="tr-main"><div class="tr-line1"><span class="badge ${dep ? 'badge-navy' : 'badge-blue'}">${dep ? 'Departure' : 'Arrival'}</span> <b>${h(t.guest_names || 'Guest')}</b> <span class="hint">· ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}</span>${isFree(t) ? ` <span class="badge badge-blue tr-free">${h(freeLabel(t))}</span>` : ''}</div>
        <div class="cell-sub">${h(t.flight || 'flight?')} · ${h(t.vehicle || '')} · ${h(driverById(t.driver_id)?.name || 'no driver')} · ${money(t.expected_price)}${t.charge && !isFree(t) ? ' · ' + h(CHARGE_LABEL[t.charge]) : ''}${t.added_by_local ? ` · added by ${LOCAL_MANAGER_NAME}` : ''}</div>
        ${t.needs_resend ? `<div class="tr-resend"><span class="badge badge-amber">Time changed, resend</span></div>` : ''}
        ${live && rowFlag(t) ? `<div class="tr-flagline" data-flag>${ic('alert')} ${h(rowFlag(t))}</div>` : ''}
        ${live && !needsInfo(t) && guestHtml(t) ? `<div class="tr-resend">${guestHtml(t)}</div>` : ''}
        ${live && needsInfo(t) ? `<div class="tr-resend"><button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.ask('${t.id}')">${ic('send')} Ask guest for ${!t.flight && !t.trip_time ? 'flight & time' : !t.flight ? 'flight' : 'time'}</button>${askedOn(t.id) ? ` <span class="hint">asked ${h(fmtDay(askedOn(t.id)))}</span>` : ''}</div>` : ''}</div>
      <div class="tr-side"><div class="tr-pay"><span class="badge ${ps.cls}" data-pay="${ps.key}">${ps.label}</span>${ps.sub ? `<span class="cell-sub">${h(ps.sub)}</span>` : ''}</div>
        <div class="tr-btns">${live ? `<button class="btn btn-s btn-sm btn-icon" title="Send on WhatsApp" onclick="event.stopPropagation();TransportUI.send('${t.id}')">${ic('send')}</button>` : ''}${next}</div></div></div>`;
  }
  // One line per route + driver + state (a planned run also by its time). Tap a line to edit or delete its runs.
  function tuktukSummary(runs, day) {
    const by = new Map();
    runs.forEach(t => {
      const ps = payState(t); const timed = ps.key === 'planned' && t.trip_time ? t.trip_time : '';
      const k = [timed, t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose, t.driver_id || '', ps.key, ps.label, ps.sub, isFree(t) ? freeLabel(t) : ''].join('|');
      const x = by.get(k) || { time: timed, label: t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose, n: 0, sum: 0, driver: t.driver_id, ps, free: isFree(t) ? freeLabel(t) : '', ids: [] };
      x.n++; x.sum += Number(t.expected_price || 0); x.ids.push(t.id); by.set(k, x);
    });
    const order = { planned: 0, owed: 1, old: 2, paid: 3, off: 4 };
    const lines = [...by.values()].sort((a, b) => (order[a.ps.key] - order[b.ps.key]) || (a.time || '').localeCompare(b.time || '') || String(a.label).localeCompare(String(b.label)) || a.ps.label.localeCompare(b.ps.label));
    return `<div class="tr-tuk">${lines.map((x, i) => {
      const key = `${day}#${i}`; TR.runGroups[key] = x.ids;
      return `<button class="tr-tuk-line" data-run-group="${key}" onclick="TransportUI.openRuns('${key}')"><span class="tr-tuk-what">${x.time ? `<b class="num">${h(x.time)}</b> ` : ic('map-pin') + ' '}${h(x.label)} × ${x.n}${x.free ? ` <span class="badge badge-blue tr-free">${h(x.free)}</span>` : ''}<span class="cell-sub">${h(driverById(x.driver)?.name || 'no driver')}${x.ps.sub ? ' · ' + h(x.ps.sub) : ''}</span></span>
        <span class="badge ${x.ps.cls}" data-pay="${x.ps.key}">${x.ps.label}</span><span class="num tr-tuk-amt">${money(x.sum)}</span></button>`;
    }).join('')}</div>`;
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
  function askedMap() { try { return JSON.parse(localStorage.getItem(ASK_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function askedOn(id) { return askedMap()[id] || ''; }
  // Who signs the question to the guest (Miguel, 13 Nov). No emoji: WhatsApp's wa.me link shows
  // some of them as «?» on desktop.
  const ASK_SENDER = 'Francisco';
  const needsInfo = t => isAirport(t) && (!t.trip_time || !t.flight);
  function askText(t) {
    const first = String(t.guest_names || '').split(/[,+&]/)[0].trim().split(/\s+/)[0] || 'there';
    const hi = `Hi ${first}! I'm ${ASK_SENDER}, the manager of *Gota Dagua Surf Camp Sri Lanka*.`;
    return t.kind === 'airport_departure'
      ? [hi, '', 'To plan your *drop-off at Colombo airport*, could you send us:', '', '- your *departure flight number*', '- the *date and time* it leaves', '', 'Thank you!'].join('\n')
      : [hi, '', "We're getting your *airport pick-up* ready. Could you send us:", '', '- your *flight number*', '- the *date and time* you land in Colombo', '', 'Thank you, see you soon!'].join('\n');
  }
  function ask(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    window.open(GT.whatsappUrl(t.guest_phone || '', askText(t)), '_blank', 'noopener');
    try { const m = askedMap(); m[id] = cToday(); localStorage.setItem(ASK_KEY, JSON.stringify(m)); } catch (_) {}
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
    const hi = `Hi ${first}! I'm ${ASK_SENDER}, the manager of *Gota Dagua Surf Camp Sri Lanka*.`;
    if (t.kind === 'airport_departure') return [hi, '', '*Your drop-off at Colombo airport is booked*', '',
      `*Date:* ${fmtDay(t.trip_date)}`, `*Flight:* ${t.flight}`, `*Flight time:* ${t.trip_time}`,
      ...(t.pickup_time ? [`*Pick-up at the camp:* ${t.pickup_time}`] : []), `*Persons:* ${pax}`, '',
      'Please reply to confirm these details are correct, or tell us what changed.', '', 'Thank you!'].join('\n');
    return [hi, '', '*Your airport pick-up is booked*', '',
      `*Date:* ${fmtDay(t.trip_date)}`, `*Flight:* ${t.flight}`, `*Landing:* ${t.trip_time}`, `*Persons:* ${pax}`, '',
      'Our driver will be waiting for you at the *arrivals exit* of Colombo airport, holding a *sign with your name*.', '',
      'Please reply to confirm these details are correct, or tell us what changed.', '', 'See you soon!'].join('\n');
  }
  // The buttons and the state of one trip — used on the day list, in the day sheet and by the Week tab (WeekUI.askBtn).
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
  function sendDay(day) {
    const list = TR.trips.filter(t => t.trip_date === day && isAirport(t) && !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show'].includes(t.status) && !onHold(t))
      .sort((a, b) => (a.trip_time || '99').localeCompare(b.trip_time || '99'));
    if (!list.length) return;
    openWa(GT.whatsappDayText(list));
  }
  const snapshot = t => ({ trip_date: t.trip_date, trip_time: t.trip_time, flight: t.flight, pax: t.pax, place: t.place });
  async function tick(id, what) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const patch = what === 'sent'
      ? { status: 'sent', sent_at: new Date().toISOString(), sent_snapshot: snapshot(t), needs_resend: false }
      : { status: 'confirmed', confirmed_at: new Date().toISOString() };
    if (await updateTrip(id, patch)) { render(); say(what === 'sent' ? 'Marked as sent' : 'Marked as confirmed'); }
  }
  async function tickDay(day) {
    const list = TR.trips.filter(t => t.trip_date === day && isAirport(t) && !t.payment_entry_id && !isDone(t) && !onHold(t) && ['planned', 'sent'].includes(t.status) && (t.status === 'planned' || t.needs_resend));
    for (const t of list) await updateTrip(t.id, { status: 'sent', sent_at: new Date().toISOString(), sent_snapshot: snapshot(t), needs_resend: false });
    render(); say(`${list.length} marked as sent`);
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
    return `<div class="status-msg status-info tr-paid-note">Paid${ps.sub ? ' ' + h(ps.sub) : ''} — unlink the payment first to change the date, price or driver, or to delete it. <button class="btn btn-s btn-sm" onclick="TransportUI.closeModal();TransportUI.setRec('${isAirport(t) ? 'airport' : 'tuktuk'}')">Open Reconcile</button></div>`;
  }
  function openTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (!isAirport(t)) return openRuns([t.id]);
    const paid = !!t.payment_entry_id;
    const flags = (t.import_flags || []).map(f => `<div class="status-msg status-warn tr-flag">${h(f)}</div>`).join('');
    const body = `${flags}
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="tr_d" value="${h(t.trip_date)}" ${paid ? 'disabled' : ''}></div>
      <div class="mfield"><label>${t.kind === 'airport_departure' ? 'Flight time' : 'Lands at'}</label><input type="time" id="tr_t" value="${h(t.trip_time || '')}"></div></div>
      ${t.kind === 'airport_departure' ? `<div class="mfield"><label>Pick up at camp</label><input type="time" id="tr_pu" value="${h(t.pickup_time || '')}"></div>` : ''}
      <div class="g2"><div class="mfield"><label>Flight</label><input id="tr_f" value="${h(t.flight || '')}"></div>
      <div class="mfield"><label>Persons</label><input type="number" min="1" id="tr_p" value="${t.pax}"></div></div>
      <div class="mfield"><label>Guest</label><input id="tr_g" value="${h(t.guest_names || '')}"></div>
      <div class="mfield"><label>Guest phone</label><input id="tr_ph" value="${h(t.guest_phone || '')}"></div>
      <div class="g2"><div class="mfield"><label>Car</label><select id="tr_v" ${paid ? 'disabled' : ''}>${VEHICLES.map(v => `<option${v === t.vehicle ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="mfield"><label>Price (LKR)</label><input type="number" id="tr_pr" value="${Number(t.expected_price || 0)}" ${paid ? 'disabled' : ''}></div></div>
      <div class="mfield"><label>Driver</label><select id="tr_dr" ${paid ? 'disabled' : ''}>${driverOptions(t.driver_id, 'airport')}</select></div>
      ${chargeBlock('tr', t.charge, t.free_reason)}
      <div class="mfield"><label>Notes</label><input id="tr_n" value="${h(t.notes || '')}"></div>
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
    modal(`${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${fmtDay(t.trip_date)}`, h(t.guest_names || ''), body, footer);
    const v = $('tr_v'), pr = $('tr_pr');
    if (v && pr) v.addEventListener('change', () => { const p = presetPrice(t.kind, v.value); if (p) pr.value = p; });
    wireCharge('tr');
  }
  // «Still needed»: Francisco checked — the flag goes and the trip is back in the day message.
  async function keepTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (await updateTrip(id, { missing_since: null, import_flags: (t.import_flags || []).filter(f => !REMOVED_FLAG.test(f)) })) { closeModal(); render(); say('Kept — it will go out with the day again'); }
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
    if (await updateTrip(id, patch, edited.filter(k => k !== 'charge' && k !== 'free_reason'))) { closeModal(); render(); say('Saved'); }
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
  async function setStatus(id, status) {
    const patch = { status, cancel_reason: status === 'cancelled' ? 'manual' : null };
    if (status === 'planned') patch.cancel_reason = null;
    if (await updateTrip(id, patch)) { closeModal(); render(); say(status === 'no_show' ? 'Marked as no-show' : status === 'cancelled' ? 'Trip cancelled' : 'Trip restored'); }
  }

  // ── Add transfer (one screen) ──────────────────────────────────────────
  function openAddTransfer() {
    const d = defaultDriver('airport');
    const body = `<div class="mfield"><label>Who is it for?</label><div class="pills tr-seg" id="at_who"><button type="button" class="pill active" data-v="guest">Guest</button><button type="button" class="pill" data-v="staff">Staff</button></div></div>
      <div class="pills tr-seg" id="at_kind"><button class="pill active" data-v="airport_arrival">Airport to Camp</button><button class="pill" data-v="airport_departure">Camp to Airport</button></div>
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="at_d" value="${cToday()}"></div><div class="mfield"><label>Time</label><input type="time" id="at_t"></div></div>
      <div class="g2"><div class="mfield"><label>Flight</label><input id="at_f" placeholder="QR658"></div><div class="mfield"><label>Persons</label><input type="number" min="1" id="at_p" value="1"></div></div>
      <div class="mfield"><label id="at_g_lbl">Guest</label><input id="at_g"></div>
      <div class="mfield"><label id="at_ph_lbl">Guest phone</label><input id="at_ph" placeholder="+49…"></div>
      <div class="g2"><div class="mfield"><label>Car</label><select id="at_v">${VEHICLES.map(v => `<option>${v}</option>`).join('')}</select></div>
      <div class="mfield"><label>Price (LKR)</label><input type="number" id="at_pr" value="${presetPrice('airport_arrival', 'Car')}"></div></div>
      <div class="mfield"><label>Driver</label><select id="at_dr">${driverOptions(d && d.id, 'airport')}</select></div>
      ${chargeBlock('at', 'bookinglayer', null)}
      <div class="mfield"><label>Note</label><input id="at_n" placeholder="Optional"></div>`;
    modal('Add transfer', 'A transfer that is not in Bookinglayer — a guest, or staff / a gift', body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="at_save" onclick="TransportUI.saveTransfer()">Save</button>`);
    const reprice = () => { $('at_pr').value = presetPrice(segVal('at_kind'), $('at_v').value); };
    wireSeg('at_kind', reprice); wireCharge('at'); $('at_v').addEventListener('change', reprice);
    // Staff: nobody pays us → Free · Staff by default (he can still change it).
    wireSeg('at_who', () => {
      const staff = segVal('at_who') === 'staff';
      $('at_g_lbl').textContent = staff ? 'Name' : 'Guest'; $('at_ph_lbl').textContent = staff ? 'Phone' : 'Guest phone';
      const pickSeg = (id, v) => { const el = $(id); if (el) el.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b.dataset.v === v)); };
      pickSeg('at_ch', staff ? 'free' : 'bookinglayer'); pickSeg('at_fr', staff ? 'staff' : '');
      $('at_fr_wrap').style.display = staff ? '' : 'none';
    });
    $('at_p').addEventListener('change', () => { $('at_v').value = vehicleFor($('at_p').value, false); reprice(); });
  }
  function wireSeg(id, cb) { const el = $(id); if (!el) return; el.querySelectorAll('.pill').forEach(b => b.addEventListener('click', () => { el.querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x === b)); if (cb) cb(); })); }
  const segVal = id => { const b = $(id) && $(id).querySelector('.pill.active'); return b ? b.dataset.v : ''; };
  async function saveTransfer() {
    if (TR.busy.has('at')) return; TR.busy.add('at');
    try {
      const kind = segVal('at_kind');
      const row = {
        kind, trip_date: $('at_d').value || cToday(), trip_time: $('at_t').value || null, flight: ($('at_f').value || '').toUpperCase().replace(/\s+/g, '') || null,
        pax: Math.max(1, parseInt($('at_p').value, 10) || 1), guest_names: $('at_g').value.trim() || null, guest_phone: ($('at_ph').value || '').replace(/\s+/g, '') || null,
        vehicle: $('at_v').value, expected_price: Number($('at_pr').value || 0), driver_id: $('at_dr').value || null, ...readCharge('at'),
        route: kind === 'airport_departure' ? 'Surfcamp → Airport' : 'Airport → Surfcamp', purpose: segVal('at_who') === 'staff' ? 'staff' : 'guests', place: 'CMB', source: 'manual', status: 'planned',
        notes: ($('at_n') && $('at_n').value.trim()) || null,
      };
      if (!row.free_reason) delete row.free_reason;
      if (!row.guest_names) { say(segVal('at_who') === 'staff' ? 'Type the name' : 'Type the guest name', 'err'); return; }
      if (await insertTrip(row)) { closeModal(); TR.week = GT.weekStart(row.trip_date); TR.view = 'trips'; render(); say('Transfer added'); }
    } finally { TR.busy.delete('at'); }
  }

  // ── Tuk-tuk day sheet: one tap = one run ───────────────────────────────
  TR.tuk = { date: null, driver: null, mode: 'log', planDate: null, planTime: PLAN_DEFAULT_TIME, planRoute: '', planCount: 1 };
  function tukRoutes() {
    const P = (typeof transportPresets !== 'undefined' && transportPresets) || {};
    const catalogTuk = new Map((P.tuktuk || []).map(p => [p.name.toLowerCase(), Number(p.unitPrice) || 0]));
    return {
      surf: (P.surf || []).map(p => ({ key: 'surf|' + p.name, label: 'Camp → ' + p.name, route: p.name, purpose: 'surf', price: Number(p.unitPrice) || 0 })),
      camp: TUKTUK_CAMP_RUNS.map(r => ({ key: 'camp|' + r.label, label: r.label, route: r.label, purpose: r.purpose, price: catalogTuk.get(r.label.toLowerCase()) ?? r.price })),
      tour: (P.tours || []).map(p => ({ key: 'tour|' + p.name, label: p.linkedTour || p.name, route: p.name, purpose: 'tour', tour: p.linkedTour || p.name, price: Number(p.unitPrice) || 0 })),
    };
  }
  const allRoutes = () => { const R = tukRoutes(); return [...R.surf, ...R.camp, ...R.tour]; };
  const routeOptions = sel => { const R = tukRoutes(); const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(r => `<option value="${h(r.key)}"${r.key === sel ? ' selected' : ''}>${h(r.label)} · ${money(r.price)}</option>`).join('')}</optgroup>` : ''; return grp('Surf', R.surf) + grp('Camp runs', R.camp) + grp('Tour', R.tour); };
  function openTuktuk(mode) {
    const d = defaultDriver('tuktuk');
    TR.tuk.date = TR.tuk.date || cToday(); TR.tuk.driver = TR.tuk.driver || (d && d.id) || '';
    TR.tuk.mode = mode === 'plan' ? 'plan' : 'log';
    if (TR.tuk.mode === 'plan' && !TR.tuk.planDate) TR.tuk.planDate = GT.addDaysIso(cToday(), 1);
    renderTuktuk();
  }
  const openPlan = () => { TR.tuk.planDate = GT.addDaysIso(cToday(), 1); openTuktuk('plan'); };
  function renderTuktuk() {
    const plan = TR.tuk.mode === 'plan';
    const seg = `<div class="pills tr-seg" id="tk_mode"><button type="button" class="pill${plan ? '' : ' active'}" onclick="TransportUI.tukMode('log')">Log runs</button><button type="button" class="pill${plan ? ' active' : ''}" onclick="TransportUI.tukMode('plan')">Plan tomorrow</button></div>`;
    if (plan) return renderPlan(seg);
    const R = tukRoutes(); const day = TR.tuk.date; const drv = TR.tuk.driver;
    const runs = TR.trips.filter(t => t.kind === 'tuktuk' && t.trip_date === day && (t.driver_id || '') === drv);
    const count = r => runs.filter(t => t.route === r.route && t.purpose === r.purpose).length;
    const btn = r => `<div class="tr-tap"><button class="tr-tap-main" data-key="${h(r.key)}" onclick="TransportUI.tap('${h(r.key)}')"><span>${h(r.label)}</span><span class="hint num">${money(r.price)}</span><b class="tr-tap-n num">${count(r)}</b></button>
      <button class="btn btn-s btn-icon tr-tap-minus" title="Remove the last unpaid run" onclick="TransportUI.untap('${h(r.key)}')" ${count(r) ? '' : 'disabled'}>${ic('minus')}</button></div>`;
    const total = runs.reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const body = `${seg}<div class="g2 tr-tuk-head"><div class="mfield"><label>Day</label><input type="date" id="tk_d" value="${h(day)}" onchange="TransportUI.tukSet('date', this.value)"></div>
      <div class="mfield"><label>Driver</label><select id="tk_dr" onchange="TransportUI.tukSet('driver', this.value)">${driverOptions(drv, 'tuktuk')}</select></div></div>
      ${R.surf.length ? `<div class="section-lbl">Surf</div>${R.surf.map(btn).join('')}` : ''}
      <div class="section-lbl">Camp runs</div>${R.camp.map(btn).join('')}
      ${R.tour.length ? `<div class="section-lbl">Tour</div>${R.tour.map(btn).join('')}` : ''}
      <div class="tr-tuk-total"><span>${fmtDay(day)} · ${runs.length} run${runs.length === 1 ? '' : 's'}</span><b class="num">${money(total)}</b></div>
      <div class="hint">To change or delete a run later, tap its line in the Trips list.</div>`;
    modal('Tuk-tuk runs', 'Runs done: each tap is saved at once — no Save button', body, `<button class="btn btn-p" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>`);
  }
  function tukSet(k, v) { TR.tuk[k] = v; if (k !== 'planTime' && k !== 'planRoute' && k !== 'planCount') renderTuktuk(); }
  function tukMode(m) { TR.tuk.mode = m === 'plan' ? 'plan' : 'log'; if (m === 'plan' && !TR.tuk.planDate) TR.tuk.planDate = GT.addDaysIso(cToday(), 1); renderTuktuk(); }
  function tukRoute(key) { return allRoutes().find(r => r.key === key); }
  async function tap(key) {
    if (TR.busy.has('tap|' + key)) return;            // a double tap saves one run
    const r = tukRoute(key); if (!r) return;
    if (!TR.tuk.driver) { say('Pick the driver first', 'err'); return; }
    TR.busy.add('tap|' + key);
    try {
      const row = { kind: 'tuktuk', trip_date: TR.tuk.date, trip_time: TR.tuk.date === cToday() ? cTime() : null, route: r.route, purpose: r.purpose, tour_name: r.tour || null,
        driver_id: TR.tuk.driver, expected_price: r.price, vehicle: 'Tuk-tuk', status: 'done', source: 'manual', pax: 1 };
      if (await insertTrip(row)) { say(`Saved · ${r.label} · ${money(r.price)}`); renderTuktuk(); }
    } finally { setTimeout(() => TR.busy.delete('tap|' + key), 300); }
  }
  async function untap(key) {
    const r = tukRoute(key); if (!r) return;
    const last = TR.trips.filter(t => t.kind === 'tuktuk' && t.trip_date === TR.tuk.date && (t.driver_id || '') === TR.tuk.driver && t.route === r.route && t.purpose === r.purpose && !t.payment_entry_id)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    if (!last) return;
    if (await deleteTrip(last.id)) { say(`Removed one ${r.label}`); renderTuktuk(); }
  }

  // ── Plan tomorrow: the runs ordered the evening before + the WhatsApp order ─
  // A planned run is one camp_trips row with status 'planned' and a time; it counts as done by
  // itself once that time passes (isDone / camp_trip_is_done), like an airport trip. Sending the
  // order stamps the runs 'sent'; a run added or changed afterwards asks for the order again.
  const planRuns = (day, drv) => TR.trips.filter(t => t.kind === 'tuktuk' && t.trip_date === day && (t.driver_id || '') === (drv || '') && ['planned', 'sent', 'confirmed'].includes(t.status) && t.trip_time)
    .sort((a, b) => (a.trip_time + runLabel(a)).localeCompare(b.trip_time + runLabel(b)));
  function planLines(runs) {
    const by = new Map();
    runs.forEach(t => { const k = t.trip_time + '|' + runLabel(t); const x = by.get(k) || { time: t.trip_time, label: runLabel(t), n: 0, sum: 0, ids: [], sample: t }; x.n++; x.sum += Number(t.expected_price || 0); x.ids.push(t.id); by.set(k, x); });
    return [...by.values()];
  }
  // The camp's own message style: bold upper-case title, one line per run, a blank line between
  // times, no emoji (wa.me shows some as «?» on WhatsApp desktop).
  function orderText(day, runs) {
    const out = [`*TUK TUKS - ${fmtDay(day).toUpperCase()}*`]; let last = null;
    planLines(runs).forEach(x => { if (x.time !== last) { out.push(''); last = x.time; } out.push(`${x.time} ${x.label} ×${x.n}`); });
    return out.join('\n');
  }
  const orderPending = runs => runs.filter(t => !t.payment_entry_id && (t.status === 'planned' || t.needs_resend));
  function renderPlan(seg) {
    const day = TR.tuk.planDate; const drv = TR.tuk.driver; const c = tukContact();
    const runs = planRuns(day, drv); const lines = planLines(runs); const pending = orderPending(runs);
    const sentAt = runs.map(t => t.sent_at).filter(Boolean).sort().pop();
    if (!TR.tuk.planRoute || !tukRoute(TR.tuk.planRoute)) TR.tuk.planRoute = (allRoutes()[0] || {}).key || '';
    const state = !runs.length ? '' : !pending.length ? `<span class="badge badge-green" id="tk_sent">Sent ✓</span>${sentAt ? ` <span class="hint">${h(stampText(sentAt))} to ${h(c ? c.name : 'the tuk-tuk contact')}</span>` : ''}`
      : sentAt ? `<span class="badge badge-amber" id="tk_sent">Changed since sent</span> <span class="hint">send the order again</span>` : `<span class="badge badge-grey" id="tk_sent">Not sent yet</span>`;
    const body = `${seg}<div class="g2 tr-tuk-head"><div class="mfield"><label>Day</label><input type="date" id="tk_pd" value="${h(day)}" onchange="TransportUI.tukSet('planDate', this.value)"></div>
      <div class="mfield"><label>Driver</label><select id="tk_dr" onchange="TransportUI.tukSet('driver', this.value)">${driverOptions(drv, 'tuktuk')}</select></div></div>
      <div class="section-lbl">${fmtDay(day)} · the order</div>
      <div class="tr-plan" id="tk_plan">${lines.length ? lines.map((x, i) => `<div class="tr-plan-line" data-plan="${i}"><b class="num">${h(x.time)}</b><span>${h(x.label)}</span>
          <span class="tr-step"><button class="btn btn-s btn-icon" title="One run less" onclick="TransportUI.planStep(${i}, -1)">${ic('minus')}</button><b class="num">${x.n}</b><button class="btn btn-s btn-icon" title="One run more" onclick="TransportUI.planStep(${i}, 1)">${ic('plus')}</button></span></div>`).join('')
        : '<div class="hint">No runs planned for this day yet. Add the first one below.</div>'}</div>
      ${runs.length ? `<div class="tr-tuk-total"><span>${runs.length} run${runs.length === 1 ? '' : 's'} · ${state}</span><b class="num">${money(runs.reduce((s, t) => s + Number(t.expected_price || 0), 0))}</b></div>` : ''}
      <div class="section-lbl">Add a run</div>
      <div class="tr-plan-add"><div class="mfield"><label>Time</label><input type="time" id="tk_pt" value="${h(TR.tuk.planTime)}" onchange="TransportUI.tukSet('planTime', this.value)"></div>
        <div class="mfield"><label>Route</label><select id="tk_pr" onchange="TransportUI.tukSet('planRoute', this.value)">${routeOptions(TR.tuk.planRoute)}</select></div>
        <div class="mfield"><label>Tuk-tuks</label><input type="number" min="1" max="20" id="tk_pn" value="${TR.tuk.planCount}" onchange="TransportUI.tukSet('planCount', this.value)"></div>
        <button class="btn btn-s" id="tk_padd" onclick="TransportUI.planAdd()">${ic('plus')} Add to the order</button></div>
      ${c && !c.phone ? `<div class="hint">No phone for ${h(c.name)} yet — WhatsApp will ask you to pick the chat. Add the number in Drivers.</div>` : ''}`;
    modal('Tuk-tuk runs', 'Plan the runs and send the order the evening before', body,
      `<button class="btn btn-s" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>
       <button class="btn btn-p" id="tk_send" onclick="TransportUI.sendOrder()" ${runs.length ? '' : 'disabled'}>${ic('send')} ${sentAt && !pending.length ? 'Send again' : 'Send order'} to ${h(c ? c.name : 'tuk-tuk contact')}</button>`);
  }
  // sent_at is a UTC stamp: show it in Colombo time.
  function stampText(iso) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
      return `${fmtShort(`${p.year}-${p.month}-${p.day}`)} ${p.hour}:${p.minute}`;
    } catch (_) { return ''; }
  }
  async function planAdd() {
    if (TR.busy.has('plan')) return;
    const r = tukRoute(($('tk_pr') && $('tk_pr').value) || TR.tuk.planRoute); const time = ($('tk_pt') && $('tk_pt').value) || '';
    const n = Math.min(20, Math.max(1, parseInt(($('tk_pn') && $('tk_pn').value) || '1', 10) || 1));
    if (!TR.tuk.driver) { say('Pick the driver first', 'err'); return; }
    if (!r) { say('Pick the route', 'err'); return; }
    if (!/^\d\d:\d\d$/.test(time)) { say('Type the time, e.g. 07:30', 'err'); return; }
    TR.busy.add('plan');
    try {
      TR.tuk.planTime = time; TR.tuk.planRoute = r.key; TR.tuk.planCount = 1;
      for (let i = 0; i < n; i++) {
        if (!await insertTrip({ kind: 'tuktuk', trip_date: TR.tuk.planDate, trip_time: time, route: r.route, purpose: r.purpose, tour_name: r.tour || null,
          driver_id: TR.tuk.driver, expected_price: r.price, vehicle: 'Tuk-tuk', status: 'planned', source: 'manual', pax: 1 })) break;
      }
      renderTuktuk();
    } finally { TR.busy.delete('plan'); }
  }
  async function planStep(i, d) {
    if (TR.busy.has('plan')) return;
    const x = planLines(planRuns(TR.tuk.planDate, TR.tuk.driver))[i]; if (!x) return;
    TR.busy.add('plan');
    try {
      if (d > 0) {
        const t = x.sample;
        await insertTrip({ kind: 'tuktuk', trip_date: t.trip_date, trip_time: t.trip_time, route: t.route, purpose: t.purpose, tour_name: t.tour_name || null,
          driver_id: t.driver_id, expected_price: t.expected_price, vehicle: 'Tuk-tuk', status: 'planned', source: 'manual', pax: 1 });
      } else {
        const victim = TR.trips.filter(t => x.ids.includes(t.id) && !t.payment_entry_id).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
        if (!victim) { say('These runs are paid — unlink the payment first', 'err'); return; }
        const others = TR.trips.filter(t => x.ids.includes(t.id) && t.id !== victim.id && t.status === 'sent' && !t.needs_resend);
        if (await deleteTrip(victim.id)) for (const t of others.slice(0, 1)) await updateTrip(t.id, { needs_resend: true });   // the order he has is now wrong
      }
      renderTuktuk();
    } finally { TR.busy.delete('plan'); }
  }
  async function sendOrder() {
    if (TR.busy.has('order')) return;
    const day = TR.tuk.planDate; const runs = planRuns(day, TR.tuk.driver); if (!runs.length) return;
    const c = tukContact();
    window.open(GT.whatsappUrl(c && c.phone || '', orderText(day, runs)), '_blank', 'noopener');
    TR.busy.add('order');
    try {
      const now = new Date().toISOString();
      for (const t of runs.filter(t => !t.payment_entry_id)) await updateTrip(t.id, { status: 'sent', sent_at: now, needs_resend: false });
      renderTuktuk(); say(`Order opened in WhatsApp for ${c ? c.name : 'the tuk-tuk contact'} · marked Sent ✓`);
    } finally { TR.busy.delete('order'); }
  }

  // ── Edit / delete tuk-tuk runs (tap a line in the Trips list) ───────────
  // One sheet for one run or for the runs of a line (same route, driver and state): what is
  // typed applies to all of them. Paid runs are read-only — unlink the payment first.
  function openRuns(ref) {
    const ids = Array.isArray(ref) ? ref : ((TR.runGroups || {})[ref] || []);
    const runs = TR.trips.filter(t => ids.includes(t.id)); if (!runs.length) return;
    TR.runEdit = runs.map(t => t.id);
    const t = runs[0]; const n = runs.length; const paid = runs.some(x => x.payment_entry_id); const dis = paid ? 'disabled' : '';
    const cur = allRoutes().find(r => r.route === t.route && r.purpose === t.purpose);
    const body = `${paid ? paidNote(t) : ''}${n > 1 ? `<div class="hint tr-run-n">${n} runs on this line${paid ? '' : ` — what you change applies to all ${n}`}.</div>` : ''}
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="rn_d" value="${h(t.trip_date)}" ${dis}></div>
      <div class="mfield"><label>Time</label><input type="time" id="rn_t" value="${h(t.trip_time || '')}" ${dis}></div></div>
      <div class="mfield"><label>Route / purpose</label><select id="rn_r" ${dis}>${cur ? '' : `<option value="" selected>${h(runLabel(t))}</option>`}${routeOptions(cur ? cur.key : '')}</select></div>
      <div class="g2"><div class="mfield"><label>Driver</label><select id="rn_dr" ${dis}>${driverOptions(t.driver_id, 'tuktuk')}</select></div>
      <div class="mfield"><label>Price${n > 1 ? ' (each)' : ''} (LKR)</label><input type="number" id="rn_pr" value="${Number(t.expected_price || 0)}" ${dis}></div></div>
      <div class="mfield"><label>Tour</label><input id="rn_tour" value="${h(t.tour_name || '')}" placeholder="Only when the run is for a tour"></div>
      ${chargeBlock('rn', isFree(t) ? 'free' : '', t.free_reason, { label: 'Offered ride?', options: [['', 'No'], ['free', 'Free']] })}
      <div class="mfield"><label>Note</label><input id="rn_n" value="${h(t.notes || '')}"></div>`;
    const footer = `${paid ? '' : `<button class="btn btn-danger" id="rn_del" onclick="TransportUI.deleteRuns()">${ic('trash')} Delete${n > 1 ? ` ${n} runs` : ''}</button>${n > 1 ? `<button class="btn btn-s" id="rn_one" onclick="TransportUI.deleteRuns(1)">Remove one</button>` : ''}`}
      <button class="btn btn-p" id="rn_save" onclick="TransportUI.saveRuns()">Save</button>`;
    modal(`Tuk-tuk · ${fmtDay(t.trip_date)}`, `${h(runLabel(t))}${n > 1 ? ` × ${n}` : ''} · ${payState(t).label}`, body, footer);
    wireCharge('rn');
    const sel = $('rn_r'); if (sel) sel.addEventListener('change', () => { const r = tukRoute(sel.value); if (r) { $('rn_pr').value = r.price; $('rn_tour').value = r.tour || ''; } });
  }
  async function saveRuns() {
    const runs = TR.trips.filter(t => (TR.runEdit || []).includes(t.id)); if (!runs.length || TR.busy.has('runs')) return;
    TR.busy.add('runs');
    try {
      const paid = runs.some(x => x.payment_entry_id); const r = tukRoute($('rn_r').value);
      const fr = readCharge('rn');
      const base = { tour_name: $('rn_tour').value.trim() || null, notes: $('rn_n').value.trim() || null, charge: fr.charge || null, free_reason: fr.free_reason };
      if (!paid) Object.assign(base, { trip_date: $('rn_d').value || runs[0].trip_date, trip_time: $('rn_t').value || null, driver_id: $('rn_dr').value || null, expected_price: Number($('rn_pr').value || 0) },
        r ? { route: r.route, purpose: r.purpose } : {});
      let n = 0;
      for (const t of runs) {
        const next = { ...base };
        if (!('free_reason' in t) && !next.free_reason) delete next.free_reason;
        const patch = {}; Object.keys(next).forEach(k => { if (String(next[k] ?? '') !== String(t[k] ?? '')) patch[k] = next[k]; });
        if (!Object.keys(patch).length) continue;
        if (!paid) {
          const when = `${next.trip_date}T${next.trip_time || '23:59'}`;
          // A logged run moved into the future is a planned run again; an order already sent is now out of date.
          if (t.status === 'done' && when >= colomboNow() && ('trip_date' in patch || 'trip_time' in patch)) patch.status = 'planned';
          if (t.status === 'sent' && ['trip_date', 'trip_time', 'route'].some(k => k in patch)) patch.needs_resend = true;
        }
        if (!await updateTrip(t.id, patch)) return;
        n++;
      }
      closeModal(); render(); say(n ? (runs.length > 1 ? `${runs.length} runs saved` : 'Run saved') : 'Nothing changed');
    } finally { TR.busy.delete('runs'); }
  }
  async function deleteRuns(one) {
    let runs = TR.trips.filter(t => (TR.runEdit || []).includes(t.id) && !t.payment_entry_id); if (!runs.length) return;
    if (one) runs = runs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 1);
    else if (runs.length > 1 && !window.confirm(`Delete these ${runs.length} tuk-tuk runs? They are not paid.`)) return;
    let n = 0; for (const t of runs) if (await deleteTrip(t.id)) n++;
    closeModal(); render(); say(n === 1 ? 'Run deleted' : `${n} runs deleted`);
  }
  async function removeRun(id) { if (await deleteTrip(id)) { closeModal(); render(); } }

  // ── Next week: Monday Guests import ────────────────────────────────────
  function nextWeekStart() { return GT.addDaysIso(GT.weekStart(cToday()), 7); }
  function renderNext(opts) {
    const ws = nextWeekStart(), we = GT.addDaysIso(ws, 6);
    const I = TR.imp;
    let out = `<div class="card tr-import"><div class="card-hdr"><div><div class="card-title">${opts && opts.title ? h(opts.title) : `Next week · ${fmtRange(ws, we)}`}</div>
      <div class="card-hint">Download the Guests export with the «Semana Sri Lanka» preset and drop it here. Importing again during the week updates the trips — nothing is duplicated.</div></div></div>
      <div class="card-body"><label class="btn ${I && I.stage === 'preview' ? 'btn-s' : 'btn-p'}">${ic('upload')} Choose Guests file<input type="file" accept=".csv,.xlsx,.xls" id="trGuestsFile" style="display:none" onchange="TransportUI.pickFile(this)"></label>
      ${I && I.needDate ? `<div class="mfield tr-date-ask"><label>When did you download this file?</label><input type="date" id="trExportDate" value="${cToday()}"><button class="btn btn-s btn-sm" onclick="TransportUI.setExportDate()">Continue</button></div>` : ''}
      </div></div>`;
    if (!I || I.needDate) return out;
    if (I.error) return out + `<div class="status-msg status-err">${h(I.error)}</div>`;
    if (I.stage === 'done') {
      const r = I.result || {};
      out += `<div class="status-msg status-ok">${ic('check-circle')} Saved: ${r.inserted || 0} new · ${r.updated || 0} updated${r.resend ? ` · ${r.resend} time changed, resend` : ''}${r.cancelled ? ` · ${r.cancelled} cancelled` : ''}${r.missing ? ` · ${r.missing} not in this file — check them` : ''}${r.replaced ? ` · ${r.replaced} regrouped` : ''} · ${r.guests || 0} guests stored for the weekly lists.</div>`;
    }
    const P = I.parsed;
    const groups = I.groups;
    out += `<div class="hint tr-file">${h(P.file)} · exported ${fmtShort(P.export_date)} · ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'} confirmed, deposit paid or paid${P.counts['other location'] ? ` · ${P.counts['other location']} from other camps left out` : ''}</div>`;
    out += auditHtml(groups);
    if (groups.missingRefs) out += `<div class="status-msg status-info tr-soft">${groups.missingRefs} booking${groups.missingRefs === 1 ? '' : 's'} not yet in HQ — import bookings</div>`;
    out += `<div class="card"><div class="card-hdr"><div><div class="card-title">Airport trips from this file · ${groups.trips.length}</div><div class="card-hint">From the Guests export (the source for upcoming weeks), checked against HQ bookings when the booking is there.</div></div></div>
      <div class="tr-rows">${groups.trips.length ? groups.trips.map(t => impRow(t)).join('') : '<div class="card-body hint">No transfer booked in this file.</div>'}</div>
      ${I.stage === 'preview' && noPrice(groups.trips).length ? `<div class="status-msg status-warn tr-noprice">${noPrice(groups.trips).length} transfer${noPrice(groups.trips).length === 1 ? ' has' : 's have'} no price yet (the prices are still loading, or /prices has no price for that car). Saving will try again and refuses if a price is still missing.</div>` : ''}
      ${I.stage === 'preview' ? `<div class="card-body"><button class="btn btn-p" id="trImportSave" onclick="TransportUI.saveImport()" ${groups.trips.length || groups.guests.length ? '' : 'disabled'}>Save ${groups.trips.length} trip${groups.trips.length === 1 ? '' : 's'} and ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'}</button></div>` : ''}</div>`;
    if (groups.hqCancelled.length) out += `<div class="card"><div class="card-hdr"><div><div class="card-title">Cancelled in HQ · ${groups.hqCancelled.length}</div><div class="card-hint">Live in Bookinglayer's Guests list but cancelled in HQ bookings: no trip, and a planned trip is cancelled.</div></div></div>
      <div class="tr-rows">${groups.hqCancelled.map(x => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(x.guest)}</b><div class="cell-sub">${h(x.ref)} · ${h(x.status)} in HQ${x.transfer ? ' · had a transfer' : ''}</div></div></div>`).join('')}</div></div>`;
    if (groups.hqMissing.length) out += `<div class="card"><div class="card-hdr"><div><div class="card-title">Transfer booked in HQ, not in this file · ${groups.hqMissing.length}</div></div></div>
      <div class="tr-rows">${groups.hqMissing.map(b => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(b.booker || '')}</b><div class="cell-sub">${h(b.booking_ref)} · check-in ${fmtShort(String(b.check_in_on))}</div></div></div>`).join('')}</div></div>`;
    const dirty = P.dirty_no_transfer.filter(d => !groups.cancelledRefs.has(d[2]));
    if (dirty.length) out += `<div class="card"><div class="card-hdr"><div><div class="card-title">To check (no transfer booked)</div></div></div><div class="tr-rows">${dirty.map(d => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(d[1])}</b><div class="cell-sub">${h(d[3].join(' · '))}</div></div></div>`).join('')}</div></div>`;
    return out;
  }
  function impRow(t) {
    const dep = t.kind === 'airport_departure';
    return `<div class="tr-row tr-static"><div class="tr-time">${t.time ? `<b class="num">${h(t.time)}</b>` : '<span class="badge badge-amber">time?</span>'}</div>
      <div class="tr-main"><div class="tr-line1"><span class="badge ${dep ? 'badge-navy' : 'badge-blue'}">${dep ? 'Departure' : 'Arrival'}</span> <b>${h(t.guests.join(', '))}</b> <span class="hint">· ${fmtDay(t.date)} · ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}</span></div>
      <div class="cell-sub">${h(t.flight || 'flight?')} · ${h(t.vehicle)} · ${money(t.expected_price)} · ${t.booking_ref}${t.hq_match === 'ok' ? ' · in HQ' : t.hq_match === 'missing' ? ' · not yet in HQ' : ''}${t.partner ? ' · partner: ' + h(t.partner) + ', don\'t charge' : ''}</div>
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
    if (!GT.isGuestsExportHeader(text)) { TR.imp = { error: 'This is not a Bookinglayer Guests export (no «Has transfer» column). Use Guests → Export with the «Semana Sri Lanka» preset.' }; render(); return; }
    TR.imp = { text, name: file.name };
    const parsed = GT.parse(text, file.name);
    if (!parsed.export_date) { TR.imp.needDate = true; render(); return; }
    await buildImport(parsed);
  }
  async function setExportDate() {
    const d = $('trExportDate') && $('trExportDate').value; if (!d || !TR.imp) return;
    TR.imp.needDate = false;
    await buildImport(GT.parse(TR.imp.text, TR.imp.name, d));
  }
  // Nobody lost at the import: rows in the file = guests imported + rows left out, each with its reason.
  // Other camps and cancelled bookings are expected; a status that is not live, a row without dates or
  // a repeated row is worth a look, so the block turns amber.
  function auditHtml(groups) {
    const A = groups.audit; if (!A) return '';
    const hq = groups.hqCancelled.length;
    const leftN = A.left.length + hq;
    const sum = `${A.rows} row${A.rows === 1 ? '' : 's'} in the file = ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'} imported + ${leftN} left out`;
    const adds = A.rows === groups.guests.length + leftN;
    const look = A.left.filter(x => x.kind === 'status' || x.kind === 'no_dates' || x.kind === 'duplicate');
    let out = `<div class="${adds && !look.length ? 'hint' : 'status-msg status-warn'} tr-audit">${adds ? '' : 'The rows do not add up — tell Miguel before using the lists. '}${h(sum)}${look.length ? ` · ${look.length} to look at` : ''}</div>`;
    if (A.left.length) out += `<div class="card tr-leftout"><div class="card-hdr"><div><div class="card-title">Left out of the import · ${A.left.length}</div><div class="card-hint">Every row of the file that is not imported, with the reason.</div></div></div>
      <div class="tr-rows">${A.left.map(x => `<div class="tr-row tr-static"><div class="tr-main"><b>${h(x.name)}</b><div class="cell-sub">${h(x.ref || 'no booking number')} · line ${x.line} · ${h(x.reason)}</div></div>${look.includes(x) ? '<span class="badge badge-amber">Check</span>' : ''}</div>`).join('')}</div></div>`;
    if (A.renamed.length) out += `<div class="status-msg status-info tr-soft">${A.renamed.length} guest${A.renamed.length === 1 ? '' : 's'} with no name or a repeated name on the booking, kept as separate people: ${h(A.renamed.map(x => x.name).join(', '))}</div>`;
    return out;
  }
  async function buildImport(parsed) {
    const c = client();
    const refs = [...new Set(parsed.trips.map(t => t.booking_ref).concat(parsed.refs_active).concat(parsed.cancel_refs))].filter(Boolean);
    let hq = [];
    // Miguel, 13 Nov: the camp's Guests file and HQ's bookings import are kept apart on purpose
    // (managers import guests for operations; Miguel imports bookings for partners/income), so
    // nothing in one can change the other. Flip to true to bring the HQ cross-check back.
    if (HQ_CROSSCHECK && refs.length) {
      const { data, error } = await c.from('bookings').select('booking_ref,booker,check_in_on,location,package,partner_name,raw_payload').in('booking_ref', refs);
      if (error) { TR.imp = { error: "Couldn't read HQ bookings — " + (error.message || 'error') }; render(); return; }
      hq = data || [];
    }
    const byRef = new Map(hq.map(b => [String(b.booking_ref), b]));
    const hqStatus = r => { const b = byRef.get(r); return b ? String((b.raw_payload || {}).status || '').trim().toLowerCase() : ''; };
    // The Guests file is the source for upcoming weeks (HQ bookings only hold past and current
    // stays). HQ is a cross-check when it has the ref: cancelled there → no trip; live → hq_match ok;
    // absent → hq_match missing (kept, one soft line).
    const cancelledRefs = new Set(refs.filter(r => byRef.has(r) && HQ_DEAD_STATUSES.has(hqStatus(r))));
    const matchOf = r => !HQ_CROSSCHECK ? null : (byRef.has(r) ? 'ok' : 'missing');
    const allGuests = GT.guestRows(TR.imp.text, parsed.file);
    const okGuests = allGuests.filter(g => GT.OK_STATUS.has(g.booking_status) && g.check_in && g.check_out);   // no dates = on no list: shown under «Left out»
    const partnerOf = r => { const b = byRef.get(r); if (b) { const p = String(b.partner_name || ''); return p && !/^direct/i.test(p) ? p : ''; } const g = okGuests.find(x => x.booking_ref === r && x.partner); return g ? g.partner : ''; };
    // Prices come from /prices and may still be loading on a slow phone: wait for them, never save a trip at 0.
    if (parsed.trips.length && !pricesReady()) { try { if (typeof loadTransportPresets === 'function') await loadTransportPresets(); } catch (_) {} }
    const trips = parsed.trips.filter(t => !cancelledRefs.has(t.booking_ref))
      .map(t => ({ ...t, expected_price: presetPrice(t.kind, t.vehicle), hq_match: matchOf(t.booking_ref), partner: partnerOf(t.booking_ref) || null }));
    const guests = okGuests.filter(g => !cancelledRefs.has(g.booking_ref)).map(g => ({ ...g, hq_match: matchOf(g.booking_ref), partner: partnerOf(g.booking_ref) || null }));
    const hqCancelled = okGuests.filter(g => cancelledRefs.has(g.booking_ref)).map(g => ({ guest: g.guest_name, ref: g.booking_ref, transfer: g.has_transfer, status: hqStatus(g.booking_ref) || 'not live' }));
    const missingRefs = new Set(guests.filter(g => g.hq_match === 'missing').map(g => g.booking_ref)).size;
    // HQ bookings of that week with a transfer product but no row in the file. The bookings
    // export carries no product list today (13 Nov 2026: 0 of 273 Sri Lanka bookings), so this
    // group stays empty until the bookings import stores the products.
    let hqMissing = [];
    if (HQ_CROSSCHECK) try {
      const ws = nextWeekStart(), we = GT.addDaysIso(ws, 6);
      const { data } = await c.from('bookings').select('booking_ref,booker,check_in_on,package,raw_payload').in('location', TRIPS_BL_LOCATION_LABELS).gte('check_in_on', ws).lte('check_in_on', we);
      const inFile = new Set(allGuests.map(g => g.booking_ref));
      hqMissing = (data || []).filter(b => HQ_LIVE_STATUSES.has(String((b.raw_payload || {}).status || '').toLowerCase()) && !inFile.has(String(b.booking_ref)) && /airport transfer/i.test(String(b.package || '') + ' ' + JSON.stringify(b.raw_payload || {})));
    } catch (_) {}
    TR.imp = { ...TR.imp, parsed, stage: 'preview',
      groups: { audit: GT.guestAudit(TR.imp.text, parsed.file), trips, guests, hqCancelled, hqMissing, missingRefs, cancelledRefs, cancelRefs: [...new Set(parsed.cancel_refs.concat([...cancelledRefs]))] } };
    render();
  }
  const pricesReady = () => presetPrice('airport_arrival', 'Car') > 0 && presetPrice('airport_departure', 'Car') > 0;
  const noPrice = trips => (trips || []).filter(t => !(Number(t.expected_price) > 0));
  async function saveImport() {
    const I = TR.imp; if (!I || I.stage !== 'preview' || TR.busy.has('imp')) return;
    if (noPrice(I.groups.trips).length) {   // one more try, then refuse: a trip at 0 «fits» any payment
      try { if (typeof loadTransportPresets === 'function') await loadTransportPresets(); } catch (_) {}
      I.groups.trips = I.groups.trips.map(t => ({ ...t, expected_price: presetPrice(t.kind, t.vehicle) }));
      if (noPrice(I.groups.trips).length) { render(); say('The transfer prices have not loaded — nothing saved. Check the connection and try again.', 'err'); return; }
    }
    TR.busy.add('imp');
    try {
      const loc = await ensureHubLocationId();
      const result = await rpc('camp_trips_import', {
        p_location: loc, p_export_date: I.parsed.export_date, p_is_preset: !!I.parsed.is_preset,
        p_refs_present: I.parsed.refs_active, p_cancel_refs: I.groups.cancelRefs,
        p_trips: I.groups.trips, p_guests: I.groups.guests,
      });
      I.stage = 'done'; I.result = result || {};
      try { window.dispatchEvent(new CustomEvent('camp-week-imported')); } catch (_) {}   // Week reloads its lists
      await load(true);
      render(); say('Import saved');
    } catch (_) { /* toasted */ } finally { TR.busy.delete('imp'); }
  }

  // ── Reconcile (same pattern as HQ → Month close → Reconcile) ────────────
  function recPeriod() {
    const a = TR.recAnchor || cToday();
    if (TR.recMode === 'month') { const s = a.slice(0, 8) + '01'; const e = GT.addDaysIso(GT.addDaysIso(s, 32).slice(0, 8) + '01', -1); return { s, e, label: `${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` }; }
    const s = GT.weekStart(a); const e = GT.addDaysIso(s, 6); return { s, e, label: fmtRange(s, e), week: s };
  }
  function recData() {
    const { s, e, week } = recPeriod();
    const inP = t => week ? inWeek(t, week) : (t.trip_date >= s && t.trip_date <= e);   // week mode = the same trips as the Trips list
    const air = TR.trips.filter(t => isAirport(t) && inP(t));
    const tuk = TR.trips.filter(t => !isAirport(t) && inP(t));
    const pays = TR.links.filter(l => { const en = ledgerById(l.entry_id); const d = en ? en.date : ''; return (d >= s && d <= e) || l.state === 'review'; });
    const st = t => reconcileStatus(t);
    const owed = [...air, ...tuk].filter(t => st(t) === 'owed');
    const totals = {
      booked: air.filter(t => t.source === 'bookinglayer' && t.status !== 'cancelled').length,
      done: [...air, ...tuk].filter(t => isDone(t) && !['cancelled', 'no_show'].includes(t.status)).length,
      paid: [...air, ...tuk].filter(t => t.payment_entry_id).length,
      owedLkr: owed.reduce((x, t) => x + Number(t.expected_price || 0), 0),
      unlinkedLkr: pays.filter(l => l.state === 'review').reduce((x, l) => x + Math.max(0, Number(l.entry_amount || 0) - Number(l.trips_amount || 0)), 0),
    };
    const todo = [...air, ...tuk].filter(t => REC_TODO.has(st(t))).length + pays.filter(l => l.state === 'review').length;
    return { air, tuk, pays, totals, todo };
  }
  function renderReconcile() {
    const P = recPeriod(); const D = recData(); const T = D.totals;
    const tab = TR.recTab, filter = TR.recFilter;
    const kpi = (label, value, sub, cls) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls || ''}">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
    const filters = `<div class="ov-filters tr-filters"><div class="pills"><button class="pill${TR.recMode === 'week' ? ' active' : ''}" onclick="TransportUI.recMode('week')">Week</button><button class="pill${TR.recMode === 'month' ? ' active' : ''}" onclick="TransportUI.recMode('month')">Month</button></div>
      <div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous" onclick="TransportUI.recShift(-1)">${ic('chevron-left')}</button><span class="period-picker-lbl">${P.label}</span><button class="btn btn-s btn-sm btn-icon" title="Next" onclick="TransportUI.recShift(1)">${ic('chevron-right')}</button></div></div>`;
    const kpis = `<div class="summary-grid tr-kpis">${kpi('Booked', T.booked, 'transfers from Bookinglayer')}${kpi('Done', T.done, 'trips and runs')}${kpi('Paid', T.paid, 'linked to a payment')}
      ${kpi('Owed to drivers', money(T.owedLkr), 'done, not paid', T.owedLkr ? 'kv-amber' : '')}${kpi('Paid without trips', money(T.unlinkedLkr), 'payments to review', T.unlinkedLkr ? 'neg' : '')}</div>`;
    const badge = (n, cls) => n ? ` <span class="badge ${cls || 'badge-red'}">${n}</span>` : '';
    const airTodo = D.air.filter(t => REC_TODO.has(reconcileStatus(t))).length;
    const tukTodo = D.tuk.filter(t => REC_TODO.has(reconcileStatus(t))).length;
    const payTodo = D.pays.filter(l => l.state === 'review').length;
    const pill = (on, label, js) => `<button class="pill${on ? ' active' : ''}" onclick="${js}">${label}</button>`;
    const viewPills = pill(tab === 'airport', `Airport · ${D.air.length}${badge(airTodo)}`, "TransportUI.setRec('airport')") + pill(tab === 'tuktuk', `Tuk-tuk · ${D.tuk.length}${badge(tukTodo)}`, "TransportUI.setRec('tuktuk')") + pill(tab === 'payments', `Payments · ${D.pays.length}${badge(payTodo)}`, "TransportUI.setRec('payments')");
    const right = pill(filter === 'all', 'All', "TransportUI.recFilter('all')") + pill(filter === 'todo', 'To do', "TransportUI.recFilter('todo')") + pill(filter === 'done', 'Done', "TransportUI.recFilter('done')");
    let table = '', hint = '';
    if (tab === 'payments') {
      hint = 'Every Transport cash payment the ledger has since go-live. Nadith enters them as today; they link to the driver\'s trips by themselves, or to the transfers he ticked when paying. ✓ = the trips add up · ✗ = to review.';
      let rows = D.pays.slice().sort((a, b) => String((ledgerById(a.entry_id) || {}).date || '').localeCompare(String((ledgerById(b.entry_id) || {}).date || '')));
      if (filter === 'todo') rows = rows.filter(l => l.state === 'review'); else if (filter === 'done') rows = rows.filter(l => l.state !== 'review');
      table = rows.length ? `<table class="tr-tbl"><thead><tr><th></th><th>Date</th><th>Payment</th><th class="r">Amount</th><th>Trips</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(payRow).join('')}</tbody></table>`
        : `<div class="card-body hint">${D.pays.length ? 'Nothing here with this filter.' : 'No Transport cash payment in this period.'}</div>`;
    } else {
      const list = (tab === 'airport' ? D.air : D.tuk).slice().sort((a, b) => (a.trip_date + (a.trip_time || '')).localeCompare(b.trip_date + (b.trip_time || '')));
      let rows = list;
      if (filter === 'todo') rows = rows.filter(t => REC_TODO.has(reconcileStatus(t))); else if (filter === 'done') rows = rows.filter(t => !REC_TODO.has(reconcileStatus(t)));
      hint = tab === 'airport' ? 'Every airport trip of the period: booked in Bookinglayer, done (automatic once the time passes) and paid (linked to a ledger payment).'
        : 'Every tuk-tuk run of the period and the payment that paid it, by driver.';
      table = rows.length ? `<table class="tr-tbl"><thead><tr><th></th><th>Date</th><th>Trip</th><th>Booked</th><th>Done</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(recRow).join('')}</tbody></table>`
        : `<div class="card-body hint">${list.length ? 'Nothing here with this filter.' : 'No trips in this period.'}</div>`;
    }
    const reconciled = !D.todo && (D.air.length + D.tuk.length + D.pays.length) > 0;
    return filters + kpis + (reconciled ? `<div class="status-msg status-ok tr-reconciled">${ic('check-circle')} ${TR.recMode === 'week' ? 'Week' : 'Month'} reconciled — every trip done is paid and every payment has its trips.</div>` : '') +
      `<div class="card tr-rec"><div class="card-hdr"><div><div class="card-title">Reconcile ${P.label}</div><div class="card-hint">${hint}</div></div>
        <button class="btn btn-s btn-sm" id="trPayBtn" onclick="TransportUI.openPay()" title="Nadith pays the drivers in the Ledger. Use this only when you pay a driver yourself.">${ic('euro')} Pay a driver</button></div>
      <div class="card-body hq-filters tr-rec-pills"><div class="pills">${viewPills}</div><div class="pills tr-rec-right">${right}</div></div>
      <div class="tbl-wrap">${table}</div></div>`;
  }
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
  function paidCell(t) {
    if (!t.payment_entry_id) return '<span class="hint">—</span>';
    const e = ledgerById(t.payment_entry_id); const by = linkedByLabel(linkOf(t.payment_entry_id));
    return e ? `${fmtShort(e.date)} · ${money(e.amountLocal)}<span class="cell-sub">${h(e.description || '')}${by ? ` · ${h(by)}` : ''}</span>` : `<span class="hint">payment${by ? ` · ${h(by)}` : ''}</span>`;
  }
  function recRow(t) {
    const s = reconcileStatus(t); const [label, cls] = REC_LABEL[s];
    const ok = !REC_TODO.has(s);
    const dep = t.kind === 'airport_departure';
    const tag = (isFree(t) ? ` · ${h(freeLabel(t))}` : '') + (t.added_by_local ? ` · added by ${LOCAL_MANAGER_NAME}` : '');
    const what = isAirport(t) ? `<b>${h(t.guest_names || 'Guest')}</b><span class="cell-sub">${dep ? 'Departure' : 'Arrival'} · ${h(driverById(t.driver_id)?.name || 'no driver')} · ${money(t.expected_price)}${tag}</span>`
      : `<b>${h(t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose)}</b><span class="cell-sub">${h(driverById(t.driver_id)?.name || '')} · ${money(t.expected_price)}${tag}</span>`;
    const booked = t.source === 'bookinglayer' ? `${h(t.booking_ref || 'Bookinglayer')}` : t.kind === 'tuktuk' ? '<span class="hint">—</span>' : `<span class="hint">by hand${t.charge && !isFree(t) ? ' · ' + h(CHARGE_LABEL[t.charge]) : ''}</span>`;
    const done = t.status === 'no_show' ? 'No-show' : t.status === 'cancelled' ? 'Cancelled' : isDone(t) ? (t.status === 'done' ? 'Done' : 'Done <span class="cell-sub">time passed</span>') : '<span class="hint">not yet</span>';
    const act = s === 'owed' ? `<button class="btn btn-s btn-sm" onclick="TransportUI.linkTrip('${t.id}')">${ic('link')} Link</button>`
      : t.payment_entry_id ? `<button class="btn btn-s btn-sm" onclick="TransportUI.unlinkTrip('${t.id}')">Unlink</button>` : '';
    return `<tr data-rec="${s}" data-trip="${t.id}"><td class="tr-ok">${ok ? `<span class="tr-ok-y">${ic('check-circle')}</span>` : `<span class="tr-ok-n">${ic('alert')}</span>`}</td>
      <td class="tr-nowrap tr-c-date">${fmtShort(t.trip_date)}</td><td class="tr-c-what">${what}</td><td class="tr-c-k" data-l="Booked">${booked}</td><td class="tr-c-k" data-l="Done">${done}</td><td class="tr-c-k" data-l="Paid">${paidCell(t)}</td>
      <td class="tr-c-st"><span class="badge ${cls}">${label}</span></td><td class="tr-act">${act}</td></tr>`;
  }
  function payRow(l) {
    const e = ledgerById(l.entry_id) || {};
    const d = driverById(l.driver_id);
    const ok = l.state !== 'review';
    const label = l.state === 'matched' ? ['Matched', 'badge-green'] : l.state === 'explained' ? ['Explained', 'badge-blue'] : ['To review', 'badge-amber'];
    const why = l.state === 'review' ? ({ 'no driver named': 'no driver named in the description', 'no unpaid trips': 'no unpaid trips of this driver', 'amounts differ': `trips ${money(l.trips_amount)} · difference ${money(Number(l.entry_amount) - Number(l.trips_amount))}`, unlinked: 'unlinked', 'no trips linked': 'no trips linked',
      'two drivers named': 'two drivers named in the description — link each driver\'s trips by hand', 'no exact match': 'the driver\'s unpaid trips do not add up to this amount — tick the right ones in Link trips',
      'no driver named': 'no driver named and no guests ticked' }[l.reason] || l.reason || '')
      : l.state === 'explained' ? (l.note || '') : '';
    return `<tr data-pay="${l.entry_id}" data-state="${l.state}"><td class="tr-ok">${ok ? `<span class="tr-ok-y">${ic('check-circle')}</span>` : `<span class="tr-ok-n">${ic('alert')}</span>`}</td>
      <td class="tr-nowrap tr-c-date">${fmtShort(e.date)}</td><td class="tr-c-what">${h(e.description || '')}<span class="cell-sub">${h(d ? d.name : 'no driver')} · ${h(l.trips_count ? linkedByLabel(l) : 'no trips linked')}</span></td>
      <td class="r tr-nowrap tr-c-k" data-l="Amount">${money(l.entry_amount)}</td><td class="tr-c-k" data-l="Trips">${l.trips_count} trip${l.trips_count === 1 ? '' : 's'} · ${money(l.trips_amount)}</td>
      <td class="tr-c-st"><span class="badge ${label[1]}">${label[0]}</span>${why ? `<span class="cell-sub">${h(why)}</span>` : ''}</td>
      <td class="tr-act"><div class="row"><button class="btn btn-s btn-sm" onclick="TransportUI.openLink('${l.entry_id}')">${ic('link')} Link trips</button>
        ${l.trips_count ? `<button class="btn btn-s btn-sm" onclick="TransportUI.unlinkPayment('${l.entry_id}')">Unlink</button>` : ''}
        ${l.state === 'review' ? `<button class="btn btn-s btn-sm" onclick="TransportUI.openExplain('${l.entry_id}')">Mark explained</button>` : ''}</div></td></tr>`;
  }
  async function afterLink(msg) { await load(true); closeModal(); render(); if (msg) say(msg); }
  // Link trips to one payment: the driver's unpaid done trips + those already linked.
  function openLink(entryId) {
    const l = linkOf(entryId); const e = ledgerById(entryId) || {};
    TR.linkDraft = { entryId, driver: (l && l.driver_id) || '', picked: new Set(TR.trips.filter(t => t.payment_entry_id === entryId).map(t => t.id)) };
    renderLink();
  }
  function renderLink() {
    const D = TR.linkDraft; const e = ledgerById(D.entryId) || {}; const amount = Number(e.amountLocal || (linkOf(D.entryId) || {}).entry_amount || 0);
    const cands = TR.trips.filter(t => (t.payment_entry_id === D.entryId) || (!t.payment_entry_id && (!D.driver || t.driver_id === D.driver) && ['owed', 'before_go_live'].includes(reconcileStatus(t))))
      .sort((a, b) => (a.trip_date + (a.trip_time || '')).localeCompare(b.trip_date + (b.trip_time || '')));
    const sum = cands.filter(t => D.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const body = `<div class="mfield"><label>Driver</label><select id="lk_dr" onchange="TransportUI.linkDriver(this.value)">${driverOptions(D.driver)}</select></div>
      ${cands.length > 3 ? `<div class="row tr-pick-all"><button class="btn btn-s btn-sm" id="lk_all" onclick="TransportUI.linkAll(true)">Tick all ${cands.length}</button><button class="btn btn-s btn-sm" id="lk_none" onclick="TransportUI.linkAll(false)">None</button></div>` : ''}
      <div class="tr-picks">${cands.length ? cands.map(t => `<label class="tr-pick"><input type="checkbox" data-id="${t.id}" ${D.picked.has(t.id) ? 'checked' : ''} onchange="TransportUI.linkPick('${t.id}', this.checked)">
        <span>${fmtShort(t.trip_date)} · ${h(isAirport(t) ? (t.guest_names || 'Guest') + (t.kind === 'airport_departure' ? ' · departure' : ' · arrival') : (t.tour_name ? 'Tour · ' + t.tour_name : t.route))}</span><b class="num">${money(t.expected_price)}</b></label>`).join('') : '<div class="hint">No unpaid trips for this driver.</div>'}</div>
      <div class="tr-sum ${sum === amount ? 'ok' : 'off'}" id="lk_sum">Ticked ${money(sum)} of ${money(amount)}${sum !== amount ? ` · difference ${money(amount - sum)}` : ''}</div>
      <div class="mfield"><label>Note (accepts a difference)</label><input id="lk_note" placeholder="e.g. waiting time"></div>`;
    modal('Link trips', `${h(e.description || '')} · ${money(amount)}`, body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="lk_save" onclick="TransportUI.saveLink()">Save</button>`);
  }
  // Sampath's weekly lump covers a hundred runs and is never an exact multiple of the prices: tick them in one tap, then the note.
  function linkAll(on) {
    const D = TR.linkDraft; if (!D) return;
    const cands = TR.trips.filter(t => (t.payment_entry_id === D.entryId) || (!t.payment_entry_id && (!D.driver || t.driver_id === D.driver) && ['owed', 'before_go_live'].includes(reconcileStatus(t))));
    D.picked = new Set(on ? cands.map(t => t.id) : []);
    const note = $('lk_note') ? $('lk_note').value : ''; renderLink(); if ($('lk_note')) $('lk_note').value = note;
  }
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
  // From a trip row: «Link» → pick the payment that paid it.
  function linkTrip(tripId) {
    const t = TR.trips.find(x => x.id === tripId); if (!t) return;
    const pays = TR.links.filter(l => l.state !== 'matched' && (!l.driver_id || !t.driver_id || l.driver_id === t.driver_id));
    const body = pays.length ? `<div class="tr-picks">${pays.map(l => { const e = ledgerById(l.entry_id) || {}; return `<button class="tr-pick tr-pick-btn" onclick="TransportUI.linkTripTo('${tripId}','${l.entry_id}')"><span>${fmtShort(e.date)} · ${h(e.description || '')}</span><b class="num">${money(l.entry_amount)}</b></button>`; }).join('')}</div>`
      : '<div class="hint">No payment to review for this driver. When Nadith enters the payment in the ledger it links by itself.</div>';
    modal('Which payment paid this trip?', `${h(t.guest_names || t.route || '')} · ${fmtShort(t.trip_date)} · ${money(t.expected_price)}`, body, '');
  }
  async function linkTripTo(tripId, entryId) {
    const t = TR.trips.find(x => x.id === tripId); const l = linkOf(entryId);
    const ids = TR.trips.filter(x => x.payment_entry_id === entryId).map(x => x.id).concat(tripId);
    try { await rpc('camp_transport_link_set', { p_entry: entryId, p_driver: (l && l.driver_id) || t.driver_id || null, p_trip_ids: ids, p_note: (l && l.note) || null }); await afterLink('Linked'); } catch (_) {}
  }
  async function unlinkTrip(tripId) {
    const t = TR.trips.find(x => x.id === tripId); if (!t || !t.payment_entry_id) return;
    const entryId = t.payment_entry_id; const l = linkOf(entryId);
    const ids = TR.trips.filter(x => x.payment_entry_id === entryId && x.id !== tripId).map(x => x.id);
    try { await rpc('camp_transport_link_set', { p_entry: entryId, p_driver: (l && l.driver_id) || t.driver_id || null, p_trip_ids: ids, p_note: null }); await afterLink('Unlinked'); } catch (_) {}
  }

  // ── Pay a driver (full view tool) ──────────────────────────────────────
  function owedBy(driverId) { return TR.trips.filter(t => t.driver_id === driverId && reconcileStatus(t) === 'owed'); }
  function openPay() {
    const rows = TR.drivers.filter(d => !(d.kinds || []).every(k => k === 'contact')).map(d => { const o = owedBy(d.id); return { d, n: o.length, sum: o.reduce((s, t) => s + Number(t.expected_price || 0), 0) }; });
    const body = `<div class="tr-picks">${rows.map(r => `<button class="tr-pick tr-pick-btn" onclick="TransportUI.payPick('${r.d.id}')"><span><b>${h(r.d.name)}</b>${r.d.label ? ` · ${h(r.d.label)}` : ''}<span class="cell-sub">${r.n ? `owes ${r.n} trip${r.n === 1 ? '' : 's'}` : 'nothing owed'}</span></span><b class="num">${money(r.sum)}</b></button>`).join('')}</div>`;
    modal('Pay a driver', 'Who are you paying?', body, '');
  }
  function payPick(driverId) {
    TR.payDraft = { driver: driverId, picked: new Set(owedBy(driverId).map(t => t.id)), amount: null, reason: '', note: '', date: cToday() };
    renderPay();
  }
  function renderPay() {
    const P = TR.payDraft; const d = driverById(P.driver); const owed = owedBy(P.driver);
    const sum = owed.filter(t => P.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const amount = P.amount == null ? sum : P.amount; const diff = amount - sum;
    const days = [...new Set(owed.map(t => t.trip_date))].sort();
    const body = `${days.map(day => `<div class="section-lbl">${fmtDay(day)}</div>${owed.filter(t => t.trip_date === day).map(t => `<label class="tr-pick"><input type="checkbox" ${P.picked.has(t.id) ? 'checked' : ''} onchange="TransportUI.payTick('${t.id}', this.checked)">
        <span>${h(isAirport(t) ? (t.guest_names || 'Guest') + (t.kind === 'airport_departure' ? ' · departure' : ' · arrival') : (t.tour_name ? 'Tour · ' + t.tour_name : t.route))}</span><b class="num">${money(t.expected_price)}</b></label>`).join('')}`).join('') || '<div class="hint">Nothing owed to this driver.</div>'}
      <div class="g2"><div class="mfield"><label>Cash you are giving ${h(d ? d.name : '')}</label><input type="number" id="py_amt" value="${amount}" oninput="TransportUI.payAmount(this.value)"></div>
      <div class="mfield"><label>Date</label><input type="date" id="py_date" value="${h(P.date)}" onchange="TransportUI.payDate(this.value)"></div></div>
      <div id="py_diff">${diffBlock(sum, amount)}</div>`;
    modal(`Pay ${d ? d.name : 'driver'}`, `${P.picked.size} trip${P.picked.size === 1 ? '' : 's'} ticked · ${money(sum)}`, body,
      `<button class="btn btn-s" onclick="TransportUI.openPay()">Back</button><button class="btn btn-p" id="py_save" onclick="TransportUI.savePay()" ${payReady() ? '' : 'disabled'}>Save payment</button>`);
  }
  function diffBlock(sum, amount) {
    const diff = amount - sum; const P = TR.payDraft;
    if (!diff) return '';
    return `<div class="status-msg status-warn">You typed ${money(amount)} · the trips add up to ${money(sum)} · difference ${diff > 0 ? '+' : ''}${money(diff)}</div>
      <div class="mfield"><label>Why?</label><div class="pills" id="py_reasons">${DIFF_REASONS.map(r => `<button class="pill${P.reason === r ? ' active' : ''}" onclick="TransportUI.payReason('${r}')">${r}</button>`).join('')}</div>
      <input id="py_note" placeholder="Short note" value="${h(P.note)}" oninput="TransportUI.payNote(this.value)"></div>`;
  }
  function payNumbers() { const P = TR.payDraft; const sum = owedBy(P.driver).filter(t => P.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0); const amount = P.amount == null ? sum : P.amount; return { sum, amount }; }
  function payReady() { const P = TR.payDraft; const { sum, amount } = payNumbers(); return P.picked.size > 0 && amount > 0 && (amount === sum || !!P.reason); }
  function payTick(id, on) { const P = TR.payDraft; if (on) P.picked.add(id); else P.picked.delete(id); P.amount = null; renderPay(); }
  function payAmount(v) { TR.payDraft.amount = Number(v || 0); const { sum, amount } = payNumbers(); $('py_diff').innerHTML = diffBlock(sum, amount); $('py_save').disabled = !payReady(); }
  function payDate(v) { TR.payDraft.date = v || cToday(); }
  function payReason(r) { TR.payDraft.reason = r; const { sum, amount } = payNumbers(); $('py_diff').innerHTML = diffBlock(sum, amount); $('py_save').disabled = !payReady(); }
  function payNote(v) { TR.payDraft.note = v; }
  function linkedItemOf(t) { return isAirport(t) ? 'Airport' : t.purpose === 'tour' ? (t.route || t.tour_name || 'Errand') : (LINKED_ITEM_BY_PURPOSE[t.purpose] || 'Errand'); }
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
      const d = driverById(P.driver); const trips = owedBy(P.driver).filter(t => P.picked.has(t.id));
      const { sum, amount } = payNumbers(); const diff = amount - sum;
      let fx = 0; try { fx = await fetchFxRateForDate(P.date); } catch (_) {}
      if (!(fx > 0)) fx = Number(LOCAL_PER_EUR || DEFAULT_LKR_PER_EUR) || 330;
      const groups = new Map();
      trips.forEach(t => { const k = linkedItemOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
      const entries = [...groups.entries()].map(([item, ts]) => ({ item, ts, amount: ts.reduce((s, t) => s + Number(t.expected_price || 0), 0) }));
      const largest = entries.slice().sort((a, b) => b.amount - a.amount)[0];
      const note = diff ? [P.reason, P.note].filter(Boolean).join(': ') : '';
      const rows = entries.map(g => {
        const amt = g === largest ? g.amount + diff : g.amount;
        const desc = describe(d ? d.name : 'Driver', g.ts) + (g === largest && diff ? ` · ${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('de-DE')} ${P.reason.toLowerCase()}` : '');
        const entry = normalizeLedgerEntry({ id: (crypto.randomUUID ? crypto.randomUUID() : undefined), date: P.date, type: 'expense', category: 'Transport', linkedItem: g.item, businessArea: 'Transport',
          paymentMethod: 'Cash', currency: LOCAL_CURRENCY || 'LKR', fxRate: fx, amountLocal: amt, quantity: g.ts.length, description: desc, sourceKind: 'trip_payment', amount: Number((amt / fx).toFixed(2)) });
        return { ...ledgerEntryToDbRow(entry, HUB_SB_LOCATION_ID), trip_ids: g.ts.map(t => t.id) };
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
        <div class="mfield"><label>Phone (+94…)</label><input data-f="phone" value="${h(d.phone || '')}" placeholder="+94771234567"></div></div>
        <div class="g2"><div class="mfield"><label>Label</label><input data-f="label" value="${h(d.label || '')}"></div>
        <div class="mfield"><label>Default vehicle</label><select data-f="default_vehicle"><option value=""></option>${VEHICLES.concat('Tuk-tuk').map(v => `<option${v === d.default_vehicle ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="mfield"><label>Named in payments as (comma separated)</label><input data-f="aliases" value="${h((d.aliases || []).join(', '))}"></div></div>`).join('');
    const body = `<div class="mfield"><label>Send transfers to</label><select id="dv_contact">${list.map(d => `<option value="${d.id}"${c && c.id === d.id ? ' selected' : ''}>${h(d.name)}${d.phone ? ' · ' + h(d.phone) : ' · no phone'}</option>`).join('')}</select>
        <div class="hint">WhatsApp messages go to this person, who passes them to the driver.</div></div>
      <div class="mfield"><label>Tuk-tuk orders to</label><select id="dv_tuk"><option value="">Default tuk-tuk driver${defaultDriver('tuktuk') ? ' (' + h(defaultDriver('tuktuk').name) + ')' : ''}</option>${list.map(d => `<option value="${d.id}"${(d.default_for || []).includes(TUKTUK_CONTACT) ? ' selected' : ''}>${h(d.name)}${d.phone ? ' · ' + h(d.phone) : ' · no phone'}</option>`).join('')}</select>
        <div class="hint">Who gets tomorrow's tuk-tuk order on WhatsApp (Tuk-tuk runs → Plan tomorrow).</div></div>${rows}
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
      if (phone && !/^\+[0-9]{8,15}$/.test(phone)) { say(`${d.name}: phone must look like +94771234567`, 'err'); return; }
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
  const DRIVER_ITEMS = ['Airport', 'Transport Surf Lesson', 'Food Supply', 'Laundry'];
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
      return { text: `Transport payment not linked to trips · ${n}${lkrSum ? ' · ' + money(lkrSum) : ''}`, level: 'warn', onClick: () => { TR.view = 'reconcile'; TR.recTab = 'payments'; TR.recFilter = 'todo'; showPage('transport'); } };
    },
  };
  window.CAMP_CHECKS = window.CAMP_CHECKS || [];
  if (!window.CAMP_CHECKS.some(c => c && c.id === unlinkedCheck.id)) window.CAMP_CHECKS.push(unlinkedCheck);

  // ── Boot: show the tab for full Sri Lanka users, load once the ledger is in ─
  function boot() {
    if (!enabled()) return;
    document.querySelectorAll('.ntab[data-page="transport"], .ntab-m[data-page="transport"]').forEach(b => { b.style.display = ''; });
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      let ready = false; try { ready = HUB_LEDGER_HYDRATED === true; } catch (_) {}
      if (ready || tries > 120) { clearInterval(wait); load(); }
    }, 250);
  }

  window.renderTransportPage = renderTransportPage;
  window.TransportUI = {
    render, closeModal, setView(v, f) { TR.view = v; if (f) TR.filter = f; render(); }, setFilter(f) { TR.filter = f; render(); },
    shiftWeek(n) { TR.week = GT.addDaysIso(TR.week, n); TR.filter = ['resend', 'tosend', 'missing'].includes(TR.filter) ? 'all' : TR.filter; render(); },
    send, sendDay, undoTick, undoGuestConfirmed, ask, askText, askedOn, needsInfo, tick, tickDay, openTrip, saveTrip, setStatus, openAddTransfer, saveTransfer,
    openTuktuk, openPlan, tukSet, tukMode, tap, untap, removeRun, removeTrip, planAdd, planStep, sendOrder, orderText,
    openRuns, saveRuns, deleteRuns, payState, weekTotals, keepTrip, inWeek,
    confirmGuest, guestConfirmed, confirmText, guestState, guestHtml, openGuestDay, pickFile, setExportDate, saveImport,
    setRec(tab) { TR.view = 'reconcile'; TR.recTab = tab; render(); }, recFilter(f) { TR.recFilter = f; render(); },
    recMode(m) { TR.recMode = m; render(); },
    recShift(n) { const P = recPeriod(); TR.recAnchor = TR.recMode === 'month' ? GT.addDaysIso(n > 0 ? GT.addDaysIso(P.e, 1) : GT.addDaysIso(P.s, -1), 0) : GT.addDaysIso(P.s, 7 * n); render(); },
    openLink, linkDriver, linkPick, linkAll, saveLink, unlinkPayment, openExplain, saveExplain, linkTrip, linkTripTo, unlinkTrip,
    openPay, payPick, payTick, payAmount, payDate, payReason, payNote, savePay,
    openDrivers, addDriver, saveDrivers,
    // for tests and the coordinator
    importHtml: renderNext,   // the Week tab renders the same import
    tripState,                // the Week tab shows the same status badge
    _state: TR, load, isDone, reconcileStatus, colomboNow, check: unlinkedCheck, TRIPS_GO_LIVE, goLive,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
