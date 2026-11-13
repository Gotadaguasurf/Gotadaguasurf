// Camp hub · «Which transfers is this for?» (Sri Lanka, 13 Nov 2026)
//
// Nadith (?view=local) pays the airport drivers with a normal Cash expense in
// Quick add. When the expense is Transport · Airport, this adds one compact
// checklist under the item: the camp's airport transfers that are done and not
// paid yet, dated go-live … entry date, oldest first. Ticking rows fills the
// amount with their sum (he can still change it). Ticking nothing = the form
// works exactly as before and the database links the payment by itself.
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

  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const P = { trips: null, drivers: [], loading: null, loadedAt: 0, error: '', picked: new Set(), prefill: null, visible: false };
  const $ = id => document.getElementById(id);
  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Dates are Colombo dates stored as text: read the parts, never through UTC.
  const fmtDay = iso => { const [y, m, d] = String(iso).split('-').map(Number); return `${DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`; };
  // One source for go-live and «now» (camp-hub/transport.js; tests pin both).
  const goLive = () => (window.TransportUI && TransportUI.goLive) ? TransportUI.goLive() : (window.TRIPS_GO_LIVE_OVERRIDE || '2026-11-16');
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
  function candidates() {
    const upTo = entryDate(); const from = goLive();
    return (P.trips || []).filter(t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !t.payment_entry_id
      && !['cancelled', 'no_show', 'merged'].includes(t.status) && isDone(t) && t.trip_date >= from && t.trip_date <= upTo)
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
    w.addEventListener('change', e => { const id = e.target && e.target.dataset && e.target.dataset.trip; if (id) pick(id, e.target.checked); });
    after.insertAdjacentElement('afterend', w);
    return w;
  }
  function render() {
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
          <span class="pl-txt">${h(fmtDay(t.trip_date))} · ${t.kind === 'airport_departure' ? 'Departure' : 'Arrival'} · ${h(who.join(' · '))}<span class="pl-sep"> · </span></span><b class="pl-amt">${num(t.expected_price)}</b></label>`;
      }).join('')}</div>` : `<div class="pl-note">No unpaid airport transfers up to ${h(fmtDay(entryDate()))}.</div>`;
    }
    const sum = pickedSum();
    w.innerHTML = `<label>Which transfers is this for?</label>${list}
      ${P.picked.size ? `<div class="pl-sum">${P.picked.size} ticked · ${num(sum)}</div>` : '<div class="pl-hint">Optional. Tick the guests you are paying for.</div>'}`;
  }
  function pickedSum() { return (P.trips || []).filter(t => P.picked.has(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0); }
  function applyAmount() {
    const el = $('qe_amount'); if (!el) return;
    const sum = pickedSum();
    if (P.picked.size && sum > 0) { el.value = String(sum); P.prefill = sum; }
    else if (P.prefill != null) { if (Number(el.value) === P.prefill) el.value = ''; P.prefill = null; }
    try { updateCurrencyUi('qe', 'expense'); } catch (_) {}
  }
  function pick(id, on) {
    if (on) P.picked.add(id); else P.picked.delete(id);
    applyAmount(); render();
  }
  function clearPicks() {
    if (!P.picked.size && P.prefill == null) return;
    P.picked.clear(); applyAmount();
  }

  // Called by the hub whenever the Quick add fields change (category, item, reset).
  function sync(prefix) {
    if (prefix !== 'qe') return;
    const on = wanted();
    if (!on) { if (P.visible) { clearPicks(); P.visible = false; render(); } return; }
    P.visible = true;
    // A tick no longer in the list (date moved back) is dropped.
    const keep = new Set(candidates().map(t => t.id));
    if ([...P.picked].some(id => !keep.has(id))) { P.picked = new Set([...P.picked].filter(id => keep.has(id))); applyAmount(); }
    if ((P.trips === null || Date.now() - P.loadedAt > PAYLINK_STALE_MS) && !P.loading) load();
    render();
  }
  document.addEventListener('change', e => { const id = e.target && e.target.id; if (id === 'qe_date' || id === 'qe_pay') sync('qe'); });

  // ── After the ledger row is saved ─────────────────────────────────────────
  // Returns null (nothing ticked → the hub's own «Entry added») or {ok, text}.
  // Never throws: the expense is already saved.
  async function afterSave(payload) {
    try {
      if (!P.visible || !P.picked.size) return null;
      const ids = [...P.picked];
      P.picked.clear(); P.prefill = null;
      if (!payload || payload.type !== 'expense' || payload.category !== 'Transport' || payload.linkedItem !== PAYLINK_ITEM) return null;
      const c = client(); if (!c) throw new Error('Not connected');
      const call = Promise.resolve(c.rpc('camp_transport_link_own', { p_entry: payload.id, p_trip_ids: ids }));
      const res = await Promise.race([call, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), PAYLINK_RPC_TIMEOUT_MS))]);
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

  window.CampPayLink = { sync, afterSave, toast: showToast, _state: P, FAIL_TEXT };
})();
