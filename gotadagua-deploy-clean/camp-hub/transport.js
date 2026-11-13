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
//   + Log tuk-tuk run (one tap = one run), Add transfer, Pay a driver, Drivers.
//
// Loaded after the hub's main script: it reads the hub's globals (S,
// transportPresets, LOCAL_MANAGER_MODE, getHubSupabaseClient, …) and adds
// renderTransportPage() + one check to window.CAMP_CHECKS.
(function () {
  'use strict';
  const GT = window.GuestsTrips;

  // ── Settings (kept as constants so Miguel can change them later) ────────
  const TRIPS_ENABLED_LOCATIONS = new Set(['sri-lanka']);
  const TRIPS_GO_LIVE = '2026-11-16';             // = camp_trips_go_live() in the SQL
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
  const vehicleFor = GT.vehicleFor;

  function presetPrice(kind, vehicle) {
    const list = (typeof transportPresets !== 'undefined' && transportPresets && transportPresets.airport) || [];
    const dep = kind === 'airport_departure';
    const p = list.find(x => dep ? /→\s*airport/i.test(x.name) : /airport\s*→/i.test(x.name));
    const v = p && (p.vehicles || []).find(x => x.label === vehicle);
    return v ? Number(v.price) || 0 : 0;
  }
  const contact = () => TR.drivers.find(d => d.active !== false && (d.default_for || []).includes('transfers_contact'));
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
  async function updateTrip(id, patch, edited) {
    const t = TR.trips.find(x => x.id === id); if (!t) return null;
    const row = { ...patch };
    if (edited && edited.length) row.edited_fields = [...new Set([...(t.edited_fields || []), ...edited])];
    const { data, error } = await client().from('camp_trips').update(row).eq('id', id).select();
    if (error) { say("Couldn't save — " + (error.message || 'error'), 'err'); return null; }
    const fresh = (data && data[0]) || { ...t, ...row };
    TR.trips = TR.trips.map(x => x.id === id ? fresh : x);
    return fresh;
  }
  async function insertTrip(row) {
    const loc = await ensureHubLocationId();
    const { data, error } = await client().from('camp_trips').insert({ location_id: loc, ...row }).select();
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
    const head = `<div class="section-head page-head"><div><div class="section-title">Transport</div><div class="section-sub">Airport transfers and tuk-tuk runs · Sri Lanka</div></div>
      <div class="exp-top-actions tr-actions">
        <button class="btn ${v === 'trips' ? 'btn-p' : 'btn-s'}" onclick="TransportUI.openTuktuk()">${ic('plus')} Log tuk-tuk run</button>
        <button class="btn btn-s" onclick="TransportUI.openAddTransfer()">${ic('truck')} Add transfer</button>
        <button class="btn btn-s" onclick="TransportUI.openPay()">${ic('euro')} Pay a driver</button>
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
    root.innerHTML = head + attentionStrip() + tabs + body;
  }

  function attentionStrip() {
    const now = colomboNow(); const in48 = addHours(now, 48);
    const resend = TR.trips.filter(t => t.needs_resend && t.status !== 'done').length;
    const toSend = TR.trips.filter(t => isAirport(t) && t.status === 'planned' && `${t.trip_date}T${t.trip_time || '23:59'}` >= now && `${t.trip_date}T${t.trip_time || '00:00'}` <= in48).length;
    const missing = TR.trips.filter(t => t.missing_since && !['cancelled', 'done', 'no_show'].includes(t.status) && !isDone(t)).length;
    const review = TR.links.filter(l => l.state === 'review').length;
    const chips = [];
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
    let list = TR.trips.filter(t => t.trip_date >= ws && t.trip_date <= we);
    if (['resend', 'tosend', 'missing'].includes(f)) list = TR.trips.filter(t => t.trip_date >= cToday() || f === 'resend');
    if (f === 'airport') list = list.filter(isAirport);
    else if (f === 'tuktuk') list = list.filter(t => !isAirport(t));
    else if (f === 'resend') list = list.filter(t => t.needs_resend);
    else if (f === 'tosend') list = list.filter(t => isAirport(t) && t.status === 'planned');
    else if (f === 'missing') list = list.filter(t => t.missing_since && !['cancelled', 'no_show'].includes(t.status));
    const pill = (k, label) => `<button class="pill${f === k ? ' active' : ''}" onclick="TransportUI.setFilter('${k}')">${label}</button>`;
    const filters = `<div class="ov-filters tr-filters">
      <div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous week" onclick="TransportUI.shiftWeek(-7)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl tr-week">${fmtRange(ws, we)}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="TransportUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <div class="pills">${pill('all', 'All')}${pill('airport', 'Airport')}${pill('tuktuk', 'Tuk-tuk')}</div></div>`;
    const days = [...new Set(list.map(t => t.trip_date))].sort();
    if (!days.length) return filters + `<div class="empty-state">${ic('truck')}<div class="empty-title">No trips this week</div><p>Import the Guests export in Next week, or add a transfer.</p></div>`;
    const c = contact();
    return filters + days.map(day => {
      const dayTrips = list.filter(t => t.trip_date === day).sort((a, b) => (a.trip_time || '99').localeCompare(b.trip_time || '99'));
      const air = dayTrips.filter(t => isAirport(t) && !['cancelled', 'no_show'].includes(t.status));
      const tuk = dayTrips.filter(t => !isAirport(t));
      const sendable = air.filter(t => !t.payment_entry_id && !isDone(t));
      return `<div class="card tr-day"><div class="card-hdr"><div><div class="card-title">${fmtDay(day)}</div>
          <div class="card-hint">${air.length} transfer${air.length === 1 ? '' : 's'}${tuk.length ? ` · ${tuk.length} tuk-tuk run${tuk.length === 1 ? '' : 's'} · ${money(tuk.reduce((s, t) => s + Number(t.expected_price || 0), 0))}` : ''}</div></div>
          ${sendable.length > 1 ? `<div class="row"><button class="btn btn-s btn-sm" onclick="TransportUI.sendDay('${day}')" title="One WhatsApp to ${h(c ? c.name : 'the transport contact')} with every transfer of the day">${ic('send')} Send the whole day</button>
            <button class="btn btn-s btn-sm" onclick="TransportUI.tickDay('${day}')">${ic('check')} Sent ✓ all</button></div>` : ''}</div>
        <div class="tr-rows">${air.map(tripRow).join('')}${dayTrips.filter(t => isAirport(t) && ['cancelled', 'no_show'].includes(t.status)).map(tripRow).join('')}${tuk.length ? tuktukSummary(tuk) : ''}</div></div>`;
    }).join('');
  }
  function tripRow(t) {
    const [st, cls] = tripState(t);
    const dep = t.kind === 'airport_departure';
    const time = t.trip_time ? `<b class="num">${h(t.trip_time)}</b>` : '<span class="badge badge-amber">time?</span>';
    const live = !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show'].includes(t.status);
    const next = !live ? '' : t.status === 'planned' ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','sent')">Sent ✓</button>`
      : t.status === 'sent' && !t.needs_resend ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','confirmed')">Confirmed ✓</button>`
      : t.needs_resend ? `<button class="btn btn-s btn-sm" onclick="event.stopPropagation();TransportUI.tick('${t.id}','sent')">Sent ✓</button>` : '';
    return `<div class="tr-row" data-trip="${t.id}" onclick="TransportUI.openTrip('${t.id}')">
      <div class="tr-time">${time}</div>
      <div class="tr-main"><div class="tr-line1"><span class="badge ${dep ? 'badge-navy' : 'badge-blue'}">${dep ? 'Departure' : 'Arrival'}</span> <b>${h(t.guest_names || 'Guest')}</b> <span class="hint">· ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}</span></div>
        <div class="cell-sub">${h(t.flight || 'flight?')} · ${h(t.vehicle || '')} · ${h(driverById(t.driver_id)?.name || 'no driver')}${t.charge ? ' · ' + h(CHARGE_LABEL[t.charge]) : ''}</div>
        ${t.needs_resend ? `<div class="tr-resend"><span class="badge badge-amber">Time changed, resend</span></div>` : ''}
        ${t.missing_since ? `<div class="tr-resend"><span class="badge badge-amber">Not in the latest Bookinglayer file</span></div>` : ''}</div>
      <div class="tr-side"><span class="badge ${cls}">${st}</span>
        <div class="tr-btns">${live ? `<button class="btn btn-s btn-sm btn-icon" title="Send on WhatsApp" onclick="event.stopPropagation();TransportUI.send('${t.id}')">${ic('send')}</button>` : ''}${next}</div></div></div>`;
  }
  function tuktukSummary(runs) {
    const by = new Map();
    runs.forEach(t => { const k = (t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose) + '|' + (t.driver_id || ''); const x = by.get(k) || { label: k.split('|')[0], n: 0, sum: 0, paid: 0, driver: t.driver_id }; x.n++; x.sum += Number(t.expected_price || 0); if (t.payment_entry_id) x.paid++; by.set(k, x); });
    return `<div class="tr-tuk">${[...by.values()].map(x => `<div class="tr-tuk-line"><span>${ic('map-pin')} ${h(x.label)} × ${x.n}</span><span class="hint">${h(driverById(x.driver)?.name || '')}${x.paid ? ` · ${x.paid} paid` : ''}</span><span class="num">${money(x.sum)}</span></div>`).join('')}</div>`;
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
  function sendDay(day) {
    const list = TR.trips.filter(t => t.trip_date === day && isAirport(t) && !t.payment_entry_id && !isDone(t) && !['cancelled', 'no_show'].includes(t.status))
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
    const list = TR.trips.filter(t => t.trip_date === day && isAirport(t) && !t.payment_entry_id && !isDone(t) && ['planned', 'sent'].includes(t.status) && (t.status === 'planned' || t.needs_resend));
    for (const t of list) await updateTrip(t.id, { status: 'sent', sent_at: new Date().toISOString(), sent_snapshot: snapshot(t), needs_resend: false });
    render(); say(`${list.length} marked as sent`);
  }

  // ── Trip detail (edit, no-show, cancel) ────────────────────────────────
  function driverOptions(sel, kind) {
    const list = kind ? driversFor(kind) : TR.drivers.filter(d => !(d.kinds || []).every(k => k === 'contact'));
    return `<option value="">—</option>` + list.map(d => `<option value="${d.id}"${d.id === sel ? ' selected' : ''}>${h(d.name)}${d.label ? ' · ' + h(d.label) : ''}</option>`).join('');
  }
  function openTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    if (!isAirport(t)) return openRun(t);
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
      <div class="mfield"><label>Notes</label><input id="tr_n" value="${h(t.notes || '')}"></div>
      ${t.booking_ref ? `<div class="hint">Bookinglayer ${h(t.booking_ref)}${t.charge ? ' · ' + h(CHARGE_LABEL[t.charge]) : ''}</div>` : ''}
      ${paid ? `<div class="status-msg status-info">Paid — unlink the payment in Reconcile to change the date, car, price or driver.</div>` : ''}`;
    const live = !paid && !['cancelled', 'no_show'].includes(t.status);
    const footer = `${live ? `<button class="btn btn-s" onclick="TransportUI.setStatus('${id}','no_show')">No-show</button>
      <button class="btn btn-danger" onclick="TransportUI.setStatus('${id}','cancelled')">Cancel trip</button>` : ''}
      ${t.status === 'cancelled' || t.status === 'no_show' ? `<button class="btn btn-s" onclick="TransportUI.setStatus('${id}','planned')">Restore</button>` : ''}
      <button class="btn btn-s" onclick="TransportUI.send('${id}')">${ic('send')} WhatsApp</button>
      <button class="btn btn-p" onclick="TransportUI.saveTrip('${id}')">Save</button>`;
    modal(`${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${fmtDay(t.trip_date)}`, h(t.guest_names || ''), body, footer);
    const v = $('tr_v'), pr = $('tr_pr');
    if (v && pr) v.addEventListener('change', () => { const p = presetPrice(t.kind, v.value); if (p) pr.value = p; });
  }
  async function saveTrip(id) {
    const t = TR.trips.find(x => x.id === id); if (!t) return;
    const val = k => ($(k) ? $(k).value : undefined);
    const next = {
      trip_date: val('tr_d') || t.trip_date, trip_time: val('tr_t') || null, flight: (val('tr_f') || '').toUpperCase().replace(/\s+/g, '') || null,
      pax: Math.max(1, parseInt(val('tr_p'), 10) || 1), guest_names: val('tr_g') || null, guest_phone: (val('tr_ph') || '').replace(/\s+/g, '') || null,
      vehicle: val('tr_v') || t.vehicle, expected_price: Number(val('tr_pr') || 0), driver_id: val('tr_dr') || null, notes: val('tr_n') || null,
    };
    if ($('tr_pu')) next.pickup_time = val('tr_pu') || null;
    if (t.payment_entry_id) { delete next.trip_date; delete next.vehicle; delete next.expected_price; delete next.driver_id; }
    const edited = Object.keys(next).filter(k => String(next[k] ?? '') !== String(t[k] ?? ''));
    if (!edited.length) { closeModal(); return; }
    const patch = {}; edited.forEach(k => { patch[k] = next[k]; });
    const moved = ['trip_date', 'trip_time', 'flight', 'pax', 'pickup_time'].some(k => edited.includes(k));
    if (moved && (t.status === 'sent' || t.status === 'confirmed')) patch.needs_resend = true;
    if (await updateTrip(id, patch, edited)) { closeModal(); render(); say('Saved'); }
  }
  async function setStatus(id, status) {
    const patch = { status, cancel_reason: status === 'cancelled' ? 'manual' : null };
    if (status === 'planned') patch.cancel_reason = null;
    if (await updateTrip(id, patch)) { closeModal(); render(); say(status === 'no_show' ? 'Marked as no-show' : status === 'cancelled' ? 'Trip cancelled' : 'Trip restored'); }
  }

  // ── Add transfer (one screen) ──────────────────────────────────────────
  function openAddTransfer() {
    const d = defaultDriver('airport');
    const body = `<div class="pills tr-seg" id="at_kind"><button class="pill active" data-v="airport_arrival">Airport to Camp</button><button class="pill" data-v="airport_departure">Camp to Airport</button></div>
      <div class="g2"><div class="mfield"><label>Date</label><input type="date" id="at_d" value="${cToday()}"></div><div class="mfield"><label>Time</label><input type="time" id="at_t"></div></div>
      <div class="g2"><div class="mfield"><label>Flight</label><input id="at_f" placeholder="QR658"></div><div class="mfield"><label>Persons</label><input type="number" min="1" id="at_p" value="1"></div></div>
      <div class="mfield"><label>Guest</label><input id="at_g"></div>
      <div class="mfield"><label>Guest phone</label><input id="at_ph" placeholder="+49…"></div>
      <div class="g2"><div class="mfield"><label>Car</label><select id="at_v">${VEHICLES.map(v => `<option>${v}</option>`).join('')}</select></div>
      <div class="mfield"><label>Price (LKR)</label><input type="number" id="at_pr" value="${presetPrice('airport_arrival', 'Car')}"></div></div>
      <div class="mfield"><label>Driver</label><select id="at_dr">${driverOptions(d && d.id, 'airport')}</select></div>
      <div class="mfield"><label>Who pays?</label><div class="pills tr-seg" id="at_ch"><button class="pill active" data-v="bookinglayer">In booking</button><button class="pill" data-v="camp_tab">Camp Tab</button><button class="pill" data-v="free">Free</button></div></div>`;
    modal('Add transfer', 'A transfer that is not in Bookinglayer', body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="at_save" onclick="TransportUI.saveTransfer()">Save</button>`);
    const reprice = () => { $('at_pr').value = presetPrice(segVal('at_kind'), $('at_v').value); };
    wireSeg('at_kind', reprice); wireSeg('at_ch'); $('at_v').addEventListener('change', reprice);
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
        vehicle: $('at_v').value, expected_price: Number($('at_pr').value || 0), driver_id: $('at_dr').value || null, charge: segVal('at_ch'),
        route: kind === 'airport_departure' ? 'Surfcamp → Airport' : 'Airport → Surfcamp', purpose: 'guests', place: 'CMB', source: 'manual', status: 'planned',
      };
      if (!row.guest_names) { say('Type the guest name', 'err'); return; }
      if (await insertTrip(row)) { closeModal(); TR.week = GT.weekStart(row.trip_date); TR.view = 'trips'; render(); say('Transfer added'); }
    } finally { TR.busy.delete('at'); }
  }

  // ── Tuk-tuk day sheet: one tap = one run ───────────────────────────────
  TR.tuk = { date: null, driver: null };
  function tukRoutes() {
    const P = (typeof transportPresets !== 'undefined' && transportPresets) || {};
    const catalogTuk = new Map((P.tuktuk || []).map(p => [p.name.toLowerCase(), Number(p.unitPrice) || 0]));
    return {
      surf: (P.surf || []).map(p => ({ key: 'surf|' + p.name, label: 'Camp → ' + p.name, route: p.name, purpose: 'surf', price: Number(p.unitPrice) || 0 })),
      camp: TUKTUK_CAMP_RUNS.map(r => ({ key: 'camp|' + r.label, label: r.label, route: r.label, purpose: r.purpose, price: catalogTuk.get(r.label.toLowerCase()) ?? r.price })),
      tour: (P.tours || []).map(p => ({ key: 'tour|' + p.name, label: p.linkedTour || p.name, route: p.name, purpose: 'tour', tour: p.linkedTour || p.name, price: Number(p.unitPrice) || 0 })),
    };
  }
  function openTuktuk() {
    const d = defaultDriver('tuktuk');
    TR.tuk.date = TR.tuk.date || cToday(); TR.tuk.driver = TR.tuk.driver || (d && d.id) || '';
    renderTuktuk();
  }
  function renderTuktuk() {
    const R = tukRoutes(); const day = TR.tuk.date; const drv = TR.tuk.driver;
    const runs = TR.trips.filter(t => t.kind === 'tuktuk' && t.trip_date === day && (t.driver_id || '') === drv);
    const count = r => runs.filter(t => t.route === r.route && t.purpose === r.purpose).length;
    const btn = r => `<div class="tr-tap"><button class="tr-tap-main" data-key="${h(r.key)}" onclick="TransportUI.tap('${h(r.key)}')"><span>${h(r.label)}</span><span class="hint num">${money(r.price)}</span><b class="tr-tap-n num">${count(r)}</b></button>
      <button class="btn btn-s btn-icon tr-tap-minus" title="Remove the last unpaid run" onclick="TransportUI.untap('${h(r.key)}')" ${count(r) ? '' : 'disabled'}>${ic('minus')}</button></div>`;
    const total = runs.reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const body = `<div class="g2 tr-tuk-head"><div class="mfield"><label>Day</label><input type="date" id="tk_d" value="${h(day)}" onchange="TransportUI.tukSet('date', this.value)"></div>
      <div class="mfield"><label>Driver</label><select id="tk_dr" onchange="TransportUI.tukSet('driver', this.value)">${driverOptions(drv, 'tuktuk')}</select></div></div>
      ${R.surf.length ? `<div class="section-lbl">Surf</div>${R.surf.map(btn).join('')}` : ''}
      <div class="section-lbl">Camp runs</div>${R.camp.map(btn).join('')}
      ${R.tour.length ? `<div class="section-lbl">Tour</div>${R.tour.map(btn).join('')}` : ''}
      <div class="tr-tuk-total"><span>${fmtDay(day)} · ${runs.length} run${runs.length === 1 ? '' : 's'}</span><b class="num">${money(total)}</b></div>`;
    modal('Log tuk-tuk run', 'Each tap is saved at once — no Save button', body, `<button class="btn btn-p" onclick="TransportUI.closeModal();TransportUI.render()">Done</button>`);
  }
  function tukSet(k, v) { TR.tuk[k] = v; renderTuktuk(); }
  function tukRoute(key) { const R = tukRoutes(); return [...R.surf, ...R.camp, ...R.tour].find(r => r.key === key); }
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
  function openRun(t) {
    const paid = !!t.payment_entry_id;
    modal(`Tuk-tuk · ${fmtDay(t.trip_date)}`, h(t.tour_name ? 'Tour · ' + t.tour_name : t.route || ''), `<div class="hint">${h(driverById(t.driver_id)?.name || '')} · ${money(t.expected_price)}${paid ? ' · paid' : ''}</div>`,
      paid ? '' : `<button class="btn btn-danger" onclick="TransportUI.removeRun('${t.id}')">Remove run</button>`);
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
      out += `<div class="status-msg status-ok">${ic('check-circle')} Saved: ${r.inserted || 0} new · ${r.updated || 0} updated${r.resend ? ` · ${r.resend} time changed, resend` : ''}${r.cancelled ? ` · ${r.cancelled} cancelled` : ''}${r.missing ? ` · ${r.missing} not in this file` : ''} · ${r.guests || 0} guests stored for the weekly lists.</div>`;
    }
    const P = I.parsed;
    const groups = I.groups;
    out += `<div class="hint tr-file">${h(P.file)} · exported ${fmtShort(P.export_date)} · ${groups.guests.length} guest${groups.guests.length === 1 ? '' : 's'} confirmed, deposit paid or paid${P.counts['other location'] ? ` · ${P.counts['other location']} from other camps left out` : ''}</div>`;
    if (groups.missingRefs) out += `<div class="status-msg status-info tr-soft">${groups.missingRefs} booking${groups.missingRefs === 1 ? '' : 's'} not yet in HQ — import bookings</div>`;
    out += `<div class="card"><div class="card-hdr"><div><div class="card-title">Airport trips from this file · ${groups.trips.length}</div><div class="card-hint">From the Guests export (the source for upcoming weeks), checked against HQ bookings when the booking is there.</div></div></div>
      <div class="tr-rows">${groups.trips.length ? groups.trips.map(t => impRow(t)).join('') : '<div class="card-body hint">No transfer booked in this file.</div>'}</div>
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
    const okGuests = allGuests.filter(g => GT.OK_STATUS.has(g.booking_status));
    const partnerOf = r => { const b = byRef.get(r); if (b) { const p = String(b.partner_name || ''); return p && !/^direct/i.test(p) ? p : ''; } const g = okGuests.find(x => x.booking_ref === r && x.partner); return g ? g.partner : ''; };
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
      groups: { trips, guests, hqCancelled, hqMissing, missingRefs, cancelledRefs, cancelRefs: [...new Set(parsed.cancel_refs.concat([...cancelledRefs]))] } };
    render();
  }
  async function saveImport() {
    const I = TR.imp; if (!I || I.stage !== 'preview' || TR.busy.has('imp')) return;
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
    const s = GT.weekStart(a); const e = GT.addDaysIso(s, 6); return { s, e, label: fmtRange(s, e) };
  }
  function recData() {
    const { s, e } = recPeriod();
    const inP = t => t.trip_date >= s && t.trip_date <= e;
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
      hint = 'Every Transport cash payment the ledger has since go-live. Nadith enters them as today; they link to the driver\'s trips by themselves. ✓ = the trips add up · ✗ = to review.';
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
      `<div class="card tr-rec"><div class="card-hdr"><div><div class="card-title">Reconcile ${P.label}</div><div class="card-hint">${hint}</div></div></div>
      <div class="card-body hq-filters tr-rec-pills"><div class="pills">${viewPills}</div><div class="pills tr-rec-right">${right}</div></div>
      <div class="tbl-wrap">${table}</div></div>`;
  }
  function paidCell(t) {
    if (!t.payment_entry_id) return '<span class="hint">—</span>';
    const e = ledgerById(t.payment_entry_id);
    return e ? `${fmtShort(e.date)} · ${money(e.amountLocal)}<span class="cell-sub">${h(e.description || '')}</span>` : '<span class="hint">payment</span>';
  }
  function recRow(t) {
    const s = reconcileStatus(t); const [label, cls] = REC_LABEL[s];
    const ok = !REC_TODO.has(s);
    const dep = t.kind === 'airport_departure';
    const what = isAirport(t) ? `<b>${h(t.guest_names || 'Guest')}</b><span class="cell-sub">${dep ? 'Departure' : 'Arrival'} · ${h(driverById(t.driver_id)?.name || 'no driver')} · ${money(t.expected_price)}</span>`
      : `<b>${h(t.tour_name ? 'Tour · ' + t.tour_name : t.route || t.purpose)}</b><span class="cell-sub">${h(driverById(t.driver_id)?.name || '')} · ${money(t.expected_price)}</span>`;
    const booked = t.source === 'bookinglayer' ? `${h(t.booking_ref || 'Bookinglayer')}` : t.kind === 'tuktuk' ? '<span class="hint">—</span>' : `<span class="hint">by hand${t.charge ? ' · ' + h(CHARGE_LABEL[t.charge]) : ''}</span>`;
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
    const why = l.state === 'review' ? ({ 'no driver named': 'no driver named in the description', 'no unpaid trips': 'no unpaid trips of this driver', 'amounts differ': `trips ${money(l.trips_amount)} · difference ${money(Number(l.entry_amount) - Number(l.trips_amount))}`, unlinked: 'unlinked', 'no trips linked': 'no trips linked' }[l.reason] || l.reason || '')
      : l.state === 'explained' ? (l.note || '') : '';
    return `<tr data-pay="${l.entry_id}" data-state="${l.state}"><td class="tr-ok">${ok ? `<span class="tr-ok-y">${ic('check-circle')}</span>` : `<span class="tr-ok-n">${ic('alert')}</span>`}</td>
      <td class="tr-nowrap tr-c-date">${fmtShort(e.date)}</td><td class="tr-c-what">${h(e.description || '')}<span class="cell-sub">${h(d ? d.name : 'no driver')} · ${l.linked_by === 'auto' ? 'linked automatically' : l.linked_by === 'pay' ? 'Pay a driver' : 'linked by hand'}</span></td>
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
      <div class="tr-picks">${cands.length ? cands.map(t => `<label class="tr-pick"><input type="checkbox" data-id="${t.id}" ${D.picked.has(t.id) ? 'checked' : ''} onchange="TransportUI.linkPick('${t.id}', this.checked)">
        <span>${fmtShort(t.trip_date)} · ${h(isAirport(t) ? (t.guest_names || 'Guest') + (t.kind === 'airport_departure' ? ' · departure' : ' · arrival') : (t.tour_name ? 'Tour · ' + t.tour_name : t.route))}</span><b class="num">${money(t.expected_price)}</b></label>`).join('') : '<div class="hint">No unpaid trips for this driver.</div>'}</div>
      <div class="tr-sum ${sum === amount ? 'ok' : 'off'}" id="lk_sum">Ticked ${money(sum)} of ${money(amount)}${sum !== amount ? ` · difference ${money(amount - sum)}` : ''}</div>
      <div class="mfield"><label>Note (accepts a difference)</label><input id="lk_note" placeholder="e.g. waiting time"></div>`;
    modal('Link trips', `${h(e.description || '')} · ${money(amount)}`, body, `<button class="btn btn-s" onclick="TransportUI.closeModal()">Cancel</button><button class="btn btn-p" id="lk_save" onclick="TransportUI.saveLink()">Save</button>`);
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
        <div class="hint">WhatsApp messages go to this person, who passes them to the driver.</div></div>${rows}
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
    for (const el of document.querySelectorAll('#trOv .tr-driver')) {
      const d = driverById(el.dataset.driver); if (!d) continue;
      const v = f => el.querySelector(`[data-f="${f}"]`).value;
      const phone = v('phone').replace(/[\s-]/g, '');
      if (phone && !/^\+[0-9]{8,15}$/.test(phone)) { say(`${d.name}: phone must look like +94771234567`, 'err'); return; }
      let df = (d.default_for || []).filter(x => x !== 'transfers_contact'); if (d.id === cId) df = df.concat('transfers_contact');
      let kinds = d.kinds || []; if (d.id === cId && !kinds.length) kinds = ['contact'];
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
  function looksLikeDriverPayment(e) {
    if (DRIVER_ITEMS.includes(String(e.linkedItem || ''))) return true;
    const text = String(e.description || '').toLowerCase();
    return (TR.drivers || []).some(d => d && !((d.kinds || []).length === 1 && d.kinds[0] === 'contact') &&
      [d.name, ...(d.aliases || [])].some(a => { a = String(a || '').toLowerCase().trim(); if (!a) return false;
        const re = new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)'); return re.test(text); }));
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
    send, sendDay, tick, tickDay, openTrip, saveTrip, setStatus, openAddTransfer, saveTransfer,
    openTuktuk, tukSet, tap, untap, removeRun, pickFile, setExportDate, saveImport,
    setRec(tab) { TR.view = 'reconcile'; TR.recTab = tab; render(); }, recFilter(f) { TR.recFilter = f; render(); },
    recMode(m) { TR.recMode = m; render(); },
    recShift(n) { const P = recPeriod(); TR.recAnchor = TR.recMode === 'month' ? GT.addDaysIso(n > 0 ? GT.addDaysIso(P.e, 1) : GT.addDaysIso(P.s, -1), 0) : GT.addDaysIso(P.s, 7 * n); render(); },
    openLink, linkDriver, linkPick, saveLink, unlinkPayment, openExplain, saveExplain, linkTrip, linkTripTo, unlinkTrip,
    openPay, payPick, payTick, payAmount, payDate, payReason, payNote, savePay,
    openDrivers, addDriver, saveDrivers,
    // for tests and the coordinator
    importHtml: renderNext,   // the Week tab renders the same import
    _state: TR, load, isDone, reconcileStatus, colomboNow, check: unlinkedCheck, TRIPS_GO_LIVE, goLive,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
