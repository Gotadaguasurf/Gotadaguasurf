// Camp hub · «Which transfers is this for?» (Sri Lanka, 13 Nov 2026)
//
// Nadith (?view=local) pays the airport drivers with a normal Cash expense in
// Quick add. When the expense is Transport · Airport, this adds one compact
// checklist under the item: the camp's unpaid airport transfers, dated go-live …
// entry date + 14 days, oldest first; the ones that have not happened yet say
// «(not yet)» (13 Nov: the form said «No unpaid airport transfers» while the
// 14 Nov trips existed). Ticking rows fills the amount with their sum (he can
// still change it). Ticking nothing = the form works exactly as before and the
// database links the payment by itself.
//
// «+ Not in the list (staff / gift)» adds a transfer nobody booked: name, date,
// arrival / departure and why it is free. It is kept in the form until the
// expense is saved, then created (RPC camp_trip_add_own — he cannot insert
// trips himself) and linked with the ticked ones. Francisco sees it in
// Transport as «Free · Staff · added by Nadith».
//
// A one-line hint under «Transport / tour item» tells him to pick Airport.
//
// After the ledger row is saved (the hub's own single-flight save), the hub
// calls CampPayLink.afterSave(payload) → RPC camp_transport_link_own
// (supabase/camp-trips-own-link.sql). That call can never fail the save: on any
// error the expense stays and he reads a calm message; Francisco sees the
// payment in Transport → Reconcile → Payments to review.
//
// Hooks in camp-hub/index.html: CampPayLink.sync(prefix) at the top of
// applyLinkedPrice() (runs on every category / item change and form reset) and
// CampPayLink.afterSave() in __saveQuickExpenseRun(). Styles in transport.css.
(function () {
  'use strict';

  // ── Settings ──────────────────────────────────────────────────────────────
  const PAYLINK_LOCATIONS = new Set(['sri-lanka']);
  const PAYLINK_ITEM = 'Airport';
  const PAYLINK_STALE_MS = 60 * 1000;      // re-read the trips when the picker reopens after a minute
  const PAYLINK_RPC_TIMEOUT_MS = 15 * 1000;
  const FAIL_TEXT = "Saved. Couldn't link the transfers — Francisco will see it in Payments to review.";
  const PAYLINK_AHEAD_DAYS = 14;           // = camp_transport_link_own / camp_trip_add_own (supabase/camp-trips-v2.sql)
  const FREE_REASONS = [['staff', 'Staff'], ['gift', 'Gift to guest'], ['compensation', 'Compensation'], ['other', 'Other']];
  const FREE_SHORT = { staff: 'Staff', gift: 'Gift', compensation: 'Compensation', other: 'Other' };
  const HINT_PICK = 'Paying airport transfers? Pick Airport to tick the guests.';
  const HINT_CASH = 'Paying the driver in cash? Set the payment to Cash to tick the guests.';

  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const P = { trips: null, drivers: [], loading: null, loadedAt: 0, error: '', picked: new Set(), prefill: null, visible: false,
    extra: [], adding: false, draft: null, seq: 0, autoDesc: null };   // extra = «not in the list» transfers waiting for the save
  const $ = id => document.getElementById(id);
  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Dates are Colombo dates stored as text: read the parts, never through UTC.
  const addDays = (iso, n) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const fmtDay = iso => { const [y, m, d] = String(iso).split('-').map(Number); return `${DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`; };
  // One source for go-live and «now» (camp-hub/transport.js; tests pin both).
  const goLive = () => (window.TransportUI && TransportUI.goLive) ? TransportUI.goLive() : (window.TRIPS_GO_LIVE_OVERRIDE || '2026-11-14');
  function colomboNow() {
    if (window.TransportUI && TransportUI.colomboNow) return TransportUI.colomboNow();
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const isDone = t => t.status === 'done' || (['planned', 'sent', 'confirmed'].includes(t.status) && `${t.trip_date}T${t.trip_time || '23:59'}` < colomboNow());
  const client = () => (typeof getHubSupabaseClient === 'function') ? getHubSupabaseClient() : null;
  const val = id => ($(id) && $(id).value) || '';

  // The picker shows only for Sri Lanka · Expense · Transport · Airport · Cash.
  function wanted() {
    if (!PAYLINK_LOCATIONS.has(SLUG)) return false;
    try { if (CAMP_TAB_ONLY_MODE) return false; } catch (_) {}
    return val('qe_type') === 'expense' && val('qe_cat') === 'Transport' && val('qe_linked') === PAYLINK_ITEM && val('qe_pay') === 'Cash';
  }
  const entryDate = () => val('qe_date') || colomboNow().slice(0, 10);
  const lastDate = () => addDays(entryDate(), PAYLINK_AHEAD_DAYS);
  function candidates() {
    const upTo = lastDate(); const from = goLive();
    return (P.trips || []).filter(t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !t.payment_entry_id
      && !['cancelled', 'no_show', 'merged'].includes(t.status) && t.trip_date >= from && t.trip_date <= upTo)   // done or not yet: Nadith may pay up to 14 days ahead (13 Nov)
      .sort((a, b) => (a.trip_date + (a.trip_time || '99') + a.id).localeCompare(b.trip_date + (b.trip_time || '99') + b.id));
  }

  // ── Data (read-only: the local manager may read his camp's trips) ──────────
  async function load() {
    if (P.loading) return P.loading;
    P.loading = (async () => {
      try {
        const c = client(); const loc = await ensureHubLocationId();
        if (!c || !loc) throw new Error('Not connected');
        const [t, d] = await Promise.all([
          c.from('camp_trips').select('id,kind,trip_date,trip_time,guest_names,expected_price,driver_id,status,payment_entry_id')
            .eq('location_id', loc).in('kind', ['airport_arrival', 'airport_departure']).is('payment_entry_id', null)
            .gte('trip_date', goLive()).order('trip_date').order('trip_time').order('id').limit(1000),
          c.from('camp_drivers').select('id,name,default_for,active').eq('location_id', loc),
        ]);
        if (t.error || d.error) throw (t.error || d.error);
        P.trips = t.data || []; P.drivers = d.data || []; P.error = ''; P.loadedAt = Date.now();
        // A tick on a trip paid meanwhile (another phone) is dropped.
        const open = new Set(P.trips.filter(x => !x.payment_entry_id).map(x => x.id));
        if ([...P.picked].some(id => !open.has(id))) { P.picked = new Set([...P.picked].filter(id => open.has(id))); applyAmount(); }
      } catch (e) {
        P.error = (e && e.message) || 'error'; P.trips = P.trips || null;
      }
    })();
    try { await P.loading; } finally { P.loading = null; }
    render();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function wrap() {
    let w = $('qe_paylink_wrap');
    if (w) return w;
    const after = $('qe_linked_wrap'); if (!after) return null;
    w = document.createElement('div');
    w.id = 'qe_paylink_wrap'; w.className = 'mfield exp-inline-full pl-wrap'; w.style.display = 'none';
    w.addEventListener('change', e => {
      const ds = (e.target && e.target.dataset) || {};
      if (ds.trip) pick(ds.trip, e.target.checked);
      else if (ds.extraId && !e.target.checked) { P.extra = P.extra.filter(x => x.id !== ds.extraId); applyAmount(); render(); }   // untick = take it out
      else if (ds.draft && P.draft) { P.draft[ds.draft] = e.target.value; e.stopPropagation(); }
    });
    w.addEventListener('input', e => { const k = e.target && e.target.dataset && e.target.dataset.draft; if (k && P.draft) P.draft[k] = e.target.value; });
    w.addEventListener('click', e => { const b = e.target && e.target.closest && e.target.closest('[data-act]'); if (b) { e.preventDefault(); act(b.dataset.act, b.dataset.v); } });
    w.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.draft) { e.preventDefault(); act('add'); } });
    after.insertAdjacentElement('afterend', w);
    return w;
  }
  // The /prices airport price for one person (Car) — what the driver gets for the extra transfer.
  function carPrice(kind) {
    try {
      const list = (transportPresets && transportPresets.airport) || [];
      const dep = kind === 'airport_departure';
      const p = list.find(x => dep ? /→\s*airport/i.test(x.name) : /airport\s*→/i.test(x.name));
      const v = p && (p.vehicles || []).find(x => x.label === 'Car');
      return v ? Number(v.price) || 0 : 0;
    } catch (_) { return 0; }
  }
  const newDraft = () => ({ name: '', date: entryDate() < goLive() ? goLive() : entryDate(), kind: 'airport_arrival', reason: 'staff' });   // never a date before go-live
  function addForm() {
    const d = P.draft || (P.draft = newDraft());
    const pills = (act, list, cur) => `<div class="pills">${list.map(([v, l]) => `<button type="button" class="pill${v === cur ? ' active' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return `<div class="pl-add" id="pl_add">
      <div class="pl-full"><div class="pl-lbl">Name</div><input id="pl_name" data-draft="name" value="${h(d.name)}" placeholder="Who was it for?" autocomplete="off"></div>
      <div class="pl-full"><div class="pl-lbl">Date</div><input type="date" id="pl_date" data-draft="date" value="${h(d.date)}"></div>
      <div class="pl-full"><div class="pl-lbl">Trip</div>${pills('kind', [['airport_arrival', 'Arrival'], ['airport_departure', 'Departure']], d.kind)}</div>
      <div class="pl-full"><div class="pl-lbl">Why is it free?</div>${pills('reason', FREE_REASONS, d.reason)}</div>
      <div class="pl-full pl-add-btns"><button type="button" class="btn btn-s btn-sm" data-act="cancel">Cancel</button><button type="button" class="btn btn-s btn-sm" id="pl_add_ok" data-act="add">Add to this payment</button></div></div>`;
  }
  function render() {
    hint();
    const w = wrap(); if (!w) return;
    if (!P.visible) { w.style.display = 'none'; w.innerHTML = ''; return; }
    w.style.display = '';
    const defaultDriver = (P.drivers.find(d => d.active !== false && (d.default_for || []).includes('airport')) || {}).id;
    const driverName = id => (P.drivers.find(d => d.id === id) || {}).name || '';
    let list;
    if (P.trips === null && !P.error) list = '<div class="pl-note">Loading transfers…</div>';
    else if (P.error && P.trips === null) list = '<div class="pl-note">Couldn\'t load the transfers. You can still save the payment.</div>';
    else {
      const rows = candidates();
      list = rows.length ? `<div class="pl-list">${rows.map(t => {
        const who = [t.guest_names || 'Guest'];
        if (t.driver_id && t.driver_id !== defaultDriver && driverName(t.driver_id)) who.push(driverName(t.driver_id));
        return `<label class="pl-row"><input type="checkbox" data-trip="${h(t.id)}"${P.picked.has(t.id) ? ' checked' : ''}>
          <span class="pl-txt">${h(fmtDay(t.trip_date))}${t.trip_time ? ' ' + h(t.trip_time) : ''} · ${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${h(who.join(' · '))}${isDone(t) ? '' : ' <i class="pl-later">(not yet)</i>'}<span class="pl-sep"> · </span></span><b class="pl-amt">${num(t.expected_price)}</b></label>`;
      }).join('')}</div>` : (P.extra.length ? '' : `<div class="pl-note">No unpaid airport transfers up to ${h(fmtDay(lastDate()))}.</div>`);
    }
    const extras = P.extra.length ? `<div class="pl-list pl-more">${P.extra.map(x => `<label class="pl-row pl-new" data-extra="${h(x.id)}"><input type="checkbox" checked data-extra-id="${h(x.id)}">
        <span class="pl-txt">${h(fmtDay(x.date))} · ${x.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${h(x.name)} · Free · ${FREE_SHORT[x.reason]}<span class="pl-sep"> · </span></span><b class="pl-amt">${num(x.price)}</b></label>`).join('')}</div>` : '';
    const n = P.picked.size + P.extra.length;
    const sum = pickedSum();
    const more = P.adding ? addForm() : `<div class="pl-more"><button type="button" class="btn btn-s btn-sm" id="pl_more" data-act="open">+ Not in the list (staff / gift)</button></div>`;
    w.innerHTML = `<label>Which transfers is this for?</label>${list}${extras}
      ${n ? `<div class="pl-sum">${n} ticked · ${num(sum)}</div>` : '<div class="pl-hint">Optional. Tick the guests you are paying for.</div>'}${more}`;
  }
  // One line under «Transport / tour item»: where the guest list is.
  function hint() {
    const host = $('qe_linked_wrap'); if (!host) return;
    let el = $('qe_paylink_hint');
    let text = '';
    if (PAYLINK_LOCATIONS.has(SLUG) && !campTabOnly() && val('qe_type') === 'expense' && val('qe_cat') === 'Transport') {
      if (val('qe_linked') !== PAYLINK_ITEM) text = HINT_PICK;
      else if (val('qe_pay') !== 'Cash') text = HINT_CASH;
    }
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'qe_paylink_hint'; el.className = 'pl-item-hint'; host.appendChild(el); }
    el.textContent = text;
  }
  function campTabOnly() { try { return !!CAMP_TAB_ONLY_MODE; } catch (_) { return false; } }
  function act(name, v) {
    if (name === 'open') { P.adding = true; P.draft = newDraft(); render(); const el = $('pl_name'); if (el) el.focus(); return; }
    if (name === 'cancel') { P.adding = false; P.draft = null; render(); return; }
    if (name === 'kind' || name === 'reason') { if (P.draft) P.draft[name] = v; render(); return; }
    if (name === 'add') {
      const d = P.draft || newDraft(); const name_ = String(d.name || '').trim();
      const say = m => { try { toast(m); } catch (_) {} };
      if (!name_) { say('Type the name'); const el = $('pl_name'); if (el) el.focus(); return; }
      if (!d.date || d.date < goLive() || d.date > lastDate()) { say(`The date must be between ${fmtDay(goLive())} and ${fmtDay(lastDate())}`); return; }
      P.extra.push({ id: 'new-' + (++P.seq), name: name_, date: d.date, kind: d.kind, reason: d.reason, price: carPrice(d.kind) });
      P.adding = false; P.draft = null;
      applyAmount(); render();
    }
  }
  function pickedSum() { return (P.trips || []).filter(t => P.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0) + P.extra.reduce((s, x) => s + Number(x.price || 0), 0); }
  // The description writes itself from the ticks — «Dilan · 3 arrivals · 14–16 Nov» — unless he
  // typed his own (Nadith used to type the name, the counts and the dates by hand).
  const fmtShort = iso => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${MON[m - 1]}`; };
  function autoDescription() {
    const rows = (P.trips || []).filter(t => P.picked.has(t.id)).map(t => ({ kind: t.kind, date: t.trip_date, driver: t.driver_id || '' }))
      .concat(P.extra.map(x => ({ kind: x.kind, date: x.date, driver: null })));
    if (!rows.length) return '';
    const fallback = (P.drivers.find(d => d.active !== false && (d.default_for || []).includes('airport')) || {}).id || '';
    const ids = [...new Set(rows.map(r => r.driver === null ? fallback : r.driver))];
    const who = ids.length === 1 && ids[0] ? ((P.drivers.find(d => d.id === ids[0]) || {}).name || 'Airport') : 'Airport';
    const arr = rows.filter(r => r.kind !== 'airport_departure').length, dep = rows.length - arr;
    const parts = []; if (arr) parts.push(`${arr} arrival${arr === 1 ? '' : 's'}`); if (dep) parts.push(`${dep} departure${dep === 1 ? '' : 's'}`);
    const dates = rows.map(r => r.date).sort(); const a = dates[0], b = dates[dates.length - 1];
    const range = a === b ? fmtShort(a) : (a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${fmtShort(b)}` : `${fmtShort(a)} – ${fmtShort(b)}`);
    return `${who} · ${parts.join(', ')} · ${range}`;
  }
  function applyDescription() {
    const el = $('qe_desc'); if (!el) return;
    if (el.value.trim() && el.value !== P.autoDesc) return;       // his own words stay
    const text = autoDescription();
    el.value = text; P.autoDesc = text || null;
  }
  function applyAmount() {
    applyDescription();
    const el = $('qe_amount'); if (!el) return;
    const sum = pickedSum();
    if ((P.picked.size || P.extra.length) && sum > 0) { el.value = String(sum); P.prefill = sum; }
    else if (P.prefill != null) { if (Number(el.value) === P.prefill) el.value = ''; P.prefill = null; }
    try { updateCurrencyUi('qe', 'expense'); } catch (_) {}
  }
  function pick(id, on) {
    if (on) P.picked.add(id); else P.picked.delete(id);
    applyAmount(); render();
  }
  function clearPicks() {
    P.adding = false; P.draft = null;
    if (!P.picked.size && !P.extra.length && P.prefill == null) return;
    P.picked.clear(); P.extra = []; applyAmount();
  }

  // Called by the hub whenever the Quick add fields change (category, item, reset).
  function sync(prefix) {
    if (prefix !== 'qe' || !PAYLINK_LOCATIONS.has(SLUG)) return;
    const on = wanted();
    if (!on) { if (P.visible) { clearPicks(); P.visible = false; } render(); return; }
    P.visible = true;
    // An extra transfer dated outside the window (the entry date moved) is dropped too.
    if (P.extra.some(x => x.date > lastDate())) { P.extra = P.extra.filter(x => x.date <= lastDate()); applyAmount(); }
    // A tick no longer in the list (date moved back) is dropped.
    const keep = new Set(candidates().map(t => t.id));
    if ([...P.picked].some(id => !keep.has(id))) { P.picked = new Set([...P.picked].filter(id => keep.has(id))); applyAmount(); }
    if ((P.trips === null || Date.now() - P.loadedAt > PAYLINK_STALE_MS) && !P.loading) load();
    render();
  }
  document.addEventListener('change', e => { const id = e.target && e.target.id; if (id === 'qe_date' || id === 'qe_pay' || id === 'qe_type') sync('qe'); });

  // ── After the ledger row is saved ─────────────────────────────────────────
  // Returns null (nothing ticked → the hub's own «Entry added») or {ok, text}.
  // Never throws: the expense is already saved.
  async function afterSave(payload) {
    try {
      if (!P.visible || (!P.picked.size && !P.extra.length)) return null;
      const ids = [...P.picked]; const extra = P.extra.slice(); const day = (payload && payload.date) || entryDate();
      P.picked.clear(); P.extra = []; P.adding = false; P.draft = null; P.prefill = null; P.autoDesc = null;
      if (!payload || payload.type !== 'expense' || payload.category !== 'Transport' || payload.linkedItem !== PAYLINK_ITEM) return null;
      const c = client(); if (!c) throw new Error('Not connected');
      const timed = call => Promise.race([Promise.resolve(call), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), PAYLINK_RPC_TIMEOUT_MS))]);
      // «Not in the list» transfers are created now that the expense exists, then linked with the ticked ones.
      if (extra.length) {
        const loc = await ensureHubLocationId();
        for (const x of extra) {
          const made = await timed(c.rpc('camp_trip_add_own', { p_location: loc, p_kind: x.kind, p_date: x.date, p_name: x.name, p_free_reason: x.reason, p_price: x.price, p_note: null, p_entry_date: day }));
          if (!made || made.error || !made.data || !made.data.id) throw (made && made.error) || new Error('transfer not added');
          ids.push(made.data.id);
          P.trips = (P.trips || []).concat({ ...made.data });
        }
      }
      const res = await timed(c.rpc('camp_transport_link_own', { p_entry: payload.id, p_trip_ids: ids }));
      if (!res || res.error) throw (res && res.error) || new Error('no answer');
      P.trips = (P.trips || []).map(t => ids.includes(t.id) ? { ...t, payment_entry_id: payload.id } : t);
      const n = ids.length; const differs = res.data && res.data.state === 'review';
      try { if (window.TransportUI && TransportUI._state && TransportUI._state.loaded) TransportUI.load(true); } catch (_) {}   // full view: Reconcile up to date
      return { ok: true, text: `Entry added · ${n} transfer${n === 1 ? '' : 's'} linked${differs ? ' · the amount differs, Francisco will check' : ''}` };
    } catch (e) {
      try { console.warn('[paylink] link failed — the expense is saved', e); } catch (_) {}
      P.loadedAt = 0; // re-read next time
      return { ok: false, text: FAIL_TEXT };
    }
  }
  // A calm toast (never red), kept a little longer when there is more to read.
  function showToast(r) {
    if (!r || typeof toast !== 'function') return;
    toast(r.text);
    const t = $('toast');
    if (t && !r.ok) { clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 6000); }
  }

  window.CampPayLink = { sync, afterSave, toast: showToast, _state: P, FAIL_TEXT, HINT_PICK, HINT_CASH };
})();
