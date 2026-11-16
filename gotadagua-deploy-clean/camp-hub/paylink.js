// Camp hub · Quick add → «Paying X? Pay in Drivers» (16 Nov 2026)
//
// Driver payments have one door: Transport → «Pay a driver» (Sri Lanka ?view=local: the
// «Drivers» tab). It shows what is owed since the last payment, run by run, and links the
// payment to its trips. The old checklist here («Which transfers is this for?», «+ Not in the
// list») is gone (Miguel 16 Nov 2026, «sim, avança com a proposta dos motoristas»).
//
// What is left: when a Quick add expense is Transport and its description names a driver
// (name or alias from camp_drivers), one line under the item says «Paying Dilan? Pay in Drivers
// → [Pay Dilan]». It only warns — saving the expense still works; such a line then shows in
// Transport as «payments to check».
//
// Hooks in camp-hub/index.html (unchanged): CampPayLink.sync(prefix) at the top of
// applyLinkedPrice() and CampPayLink.afterSave() in __saveQuickExpenseRun() (always null now).
(function () {
  'use strict';

  const PAYLINK_LOCATIONS = new Set(['sri-lanka', 'morocco']);
  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const P = { drivers: null, loading: null, shown: null };
  const $ = id => document.getElementById(id);
  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const val = id => ($(id) && $(id).value) || '';
  const client = () => (typeof getHubSupabaseClient === 'function') ? getHubSupabaseClient() : null;
  const campTabOnly = () => { try { return !!CAMP_TAB_ONLY_MODE; } catch (_) { return false; } };
  const isContact = d => (d.kinds || []).length > 0 && (d.kinds || []).every(k => k === 'contact');

  function drivers() {
    try { if (window.TransportUI && TransportUI._state && TransportUI._state.loaded) return TransportUI._state.drivers || []; } catch (_) {}
    if (P.drivers) return P.drivers;
    if (!P.loading) P.loading = (async () => {
      try {
        const c = client(); const loc = await ensureHubLocationId();
        const { data, error } = await c.from('camp_drivers').select('id,name,aliases,kinds,active').eq('location_id', loc);
        if (!error) P.drivers = data || [];
      } catch (_) { P.drivers = []; }
      P.loading = null; render();
    })();
    return [];
  }
  // The driver the description names (one only), by name or alias as a whole word.
  function namedDriver(text) {
    const t = String(text || '').toLowerCase(); if (!t.trim()) return null;
    const hits = drivers().filter(d => d && d.active !== false && !isContact(d) && [d.name, ...(d.aliases || [])].some(a => {
      a = String(a || '').toLowerCase().trim(); if (a.length < 3) return false;
      return new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(t);
    }));
    return hits.length === 1 ? hits[0] : null;
  }
  function wanted() {
    if (!PAYLINK_LOCATIONS.has(SLUG) || campTabOnly()) return null;
    if (val('qe_type') !== 'expense' || val('qe_cat') !== 'Transport') return null;
    return namedDriver(val('qe_desc'));
  }
  function render() {
    const host = $('qe_linked_wrap'); if (!host) return;
    const d = wanted();
    let el = $('qe_paylink_wrap');
    if (!d) { if (el) el.remove(); P.shown = null; return; }
    if (!el) { el = document.createElement('div'); el.id = 'qe_paylink_wrap'; el.className = 'mfield exp-inline-full pl-onedoor'; host.insertAdjacentElement('afterend', el); }
    if (P.shown === d.id && el.innerHTML) return;
    P.shown = d.id;
    el.innerHTML = `<div class="pl-item-hint">Paying ${h(d.name)}? Pay in Drivers — it shows what is owed since the last payment, run by run.
      <button type="button" class="btn btn-s btn-sm" id="pl_pay" data-driver="${h(d.id)}">Pay ${h(d.name)}</button></div>`;
    el.querySelector('#pl_pay').addEventListener('click', e => { e.preventDefault(); openPay(d.id); });
  }
  async function openPay(driverId) {
    if (typeof showPage === 'function') showPage('transport');
    const T = window.TransportUI; if (!T) return;
    try { if (!T._state.loaded) await T.load(true); } catch (_) {}
    T.payPick(driverId);
  }
  function sync(prefix) { if (prefix === 'qe') render(); }
  document.addEventListener('input', e => { if (e.target && e.target.id === 'qe_desc') render(); });
  document.addEventListener('change', e => { const id = e.target && e.target.id; if (id === 'qe_type' || id === 'qe_cat' || id === 'qe_desc') render(); });

  // Nothing is linked from Quick add any more: the hub shows its own «Entry added».
  async function afterSave() { P.shown = null; return null; }
  function showToast(r) { if (r && typeof toast === 'function') toast(r.text); }

  window.CampPayLink = { sync, afterSave, toast: showToast, namedDriver, _state: P };
})();
