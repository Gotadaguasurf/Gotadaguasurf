// /prices (public.pricing_catalog) → the transport vehicles every app uses. 17 Nov 2026.
//
// Miguel: «/prices is the ONE place for transport vehicles, capacities, driver cost and guest price; every app must
// follow it». Before this file the vehicle list and capacities were written in four places that disagreed
// (lib/camp-config.js, camp-hub/transport.js, camp-hub/index.html seeds, the SQL). Now:
//   · group(rows)            catalog rows → { airport, surf, tours, tuktuk } → routes → vehicles sorted by capacity
//   · capacityOf(row)        the `capacity` column; the old «capacity N» note only when the column is empty
//   · airportRoute / airportVehicles(P, cfg, kind, place)   the route of an airport trip: Sri Lanka by direction
//                            («Airport → Surfcamp» / «Surfcamp → Airport»), Morocco by airport city («Agadir Airport»)
//   · costOf(vehicles, label) the driver's price of one vehicle (0 = no such row: shown as «no price», never guessed)
//   · withCatalog(cfg, P)    the camp settings + transportVehicles(kind, place), what the parsers pick from
// The vehicle itself is picked by GuestsTrips.pickVehicle (lib/guests-trips.js). Pure: no DOM, no Supabase.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransportCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABS = ['airport', 'surf', 'tours', 'tuktuk'];
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  // Seats: the column; a row from before the column (notes «… capacity 8)») still reads; else unknown.
  function capacityOf(r) {
    const c = num(r && r.capacity);
    if (c && c > 0) return Math.round(c);
    const m = String((r && r.notes) || '').match(/capacity\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }
  const byCapacity = vs => (vs || []).slice().sort((a, b) => ((a.capacity == null) - (b.capacity == null)) || ((a.capacity || 0) - (b.capacity || 0))
    || ((a.sortOrder || 0) - (b.sortOrder || 0)) || String(a.label || '').localeCompare(String(b.label || '')));

  // Catalog Transport rows are named «<route> — <vehicle>» («Surfcamp → Airport — Car», «Dunes — Big Van»): split on the
  // LAST « — ». A row without a vehicle part is a single-price route (Sri Lanka tuk-tuk «Ahangama»).
  function group(rows, tourIdToName) {
    const byDest = new Map();
    for (const r of rows || []) {
      const fullName = String((r && r.name) || '').trim(); if (!fullName) continue;
      const tab = TABS.includes(r.picker_tab) ? r.picker_tab : 'airport';
      const i = fullName.lastIndexOf(' — ');
      const destName = i > 0 ? fullName.slice(0, i).trim() : fullName;
      const vehicleLabel = i > 0 ? fullName.slice(i + 3).trim() : '';
      const k = tab + '|' + destName;
      if (!byDest.has(k)) {
        const raw = r.linked_camp_tab_id || '';
        byDest.set(k, { id: r.linked_transport_preset_id || ('cat|' + r.id), name: destName, tab, unitPrice: 0,
          sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 100,
          linkedTour: (tourIdToName && raw && tourIdToName.has(raw)) ? tourIdToName.get(raw) : raw, vehicles: [] });
      }
      const p = byDest.get(k);
      if (vehicleLabel) {
        const cost = Number(r.cost_per_guest || 0);
        p.vehicles.push({ id: 'cat|' + r.id, rowId: r.id, rowName: fullName, label: vehicleLabel, capacity: capacityOf(r),
          price: cost, cost, currency: r.currency || null,
          sell: num(r.sell_price), sellCurrency: r.sell_currency || r.currency || null,
          coversPax: num(r.covers_pax), blProduct: String(r.bl_product || '').trim() || null,
          sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 100 });
      } else p.unitPrice = Number(r.cost_per_guest || 0);
    }
    const out = { airport: [], surf: [], tours: [], tuktuk: [] };
    [...byDest.values()].sort((a, b) => a.sortOrder - b.sortOrder).forEach(p => { p.vehicles = byCapacity(p.vehicles); out[p.tab].push(p); });
    return out;
  }
  const count = P => TABS.reduce((s, k) => s + ((P && P[k]) || []).length, 0);

  // The route of an airport trip. cfg.airportRoutes: 'direction' (Sri Lanka: one price per way) | 'airport' (Morocco:
  // one price per airport, both ways). null = the catalog has no such route (the import says so; never a guessed price).
  function airportRoute(P, cfg, kind, place) {
    const list = (P && P.airport) || []; cfg = cfg || {};
    if (cfg.airportRoutes === 'airport') {
      const city = String((cfg.airportCity || {})[place || cfg.airportDefault] || (cfg.airportCity || {})[cfg.airportDefault] || '').toLowerCase();
      return city ? list.find(x => String(x.name || '').toLowerCase().includes(city)) || null : null;
    }
    const dep = kind === 'airport_departure';
    return list.find(x => dep ? /→\s*airport/i.test(x.name) : /airport\s*→/i.test(x.name)) || null;
  }
  const airportVehicles = (P, cfg, kind, place) => { const r = airportRoute(P, cfg, kind, place); return r ? byCapacity(r.vehicles) : []; };
  // The vehicles to PICK from: the route's, or — an airport with no /prices route yet (Morocco's Essaouira) — the camp's
  // default airport's (the same vans drive there). The PRICE always comes from the trip's own route (costOf on
  // airportVehicles): no route → 0 and «no price», never another airport's price.
  function vehicleChoices(P, cfg, kind, place) {
    const own = airportVehicles(P, cfg, kind, place); if (own.length) return own;
    return (cfg && cfg.airportRoutes === 'airport' && place && place !== cfg.airportDefault) ? airportVehicles(P, cfg, kind, cfg.airportDefault) : [];
  }
  function costOf(vehicles, label) { const v = (vehicles || []).find(x => x.label === label); return v ? Number(v.cost != null ? v.cost : v.price) || 0 : 0; }
  // The camp settings with the catalog's vehicles: what lib/guests-trips.js and lib/bl-report.js pick from.
  function withCatalog(cfg, P) { const c = Object.assign({}, cfg); c.transportVehicles = (kind, place) => vehicleChoices(P, cfg, kind, place); return c; }

  // What the camp reads, for tests and the hub's «prices not loaded» block.
  return { TABS, capacityOf, byCapacity, group, count, airportRoute, airportVehicles, vehicleChoices, costOf, withCatalog };
});
