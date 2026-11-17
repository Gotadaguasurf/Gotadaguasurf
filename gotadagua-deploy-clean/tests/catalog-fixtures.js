// /prices (pricing_catalog) transport rows for the tests — the production rows of 17 Nov 2026 WITH the capacity column,
// covers_pax and bl_product (supabase/transport-catalog-one-source.sql), and Car = 3 seats as Miguel sets it in /prices.
// Seats are read from the column only: the notes say nothing. One file for the Node tests and the stubbed pages.
const TC = require('../lib/transport-catalog.js');
const CC = require('../lib/camp-config.js');

const SURFBOARDS = 'Airport Transfer (with surfboards)';
const row = (o, i) => ({ id: o.id || `cat-${i}`, category: 'Transport', active: true, show_in_transport_picker: true, notes: '', linked_transport_preset_id: null, linked_camp_tab_id: null,
  picker_tab: 'airport', sort_order: i, covers_pax: null, bl_product: null, sell_price: null, sell_currency: 'EUR', ...o });

// Sri Lanka: per direction, no third vehicle in /prices. Guest prices: «€80 / 3 persons», «(with surfboards) €95 / 3 persons».
function slRows(o = {}) {
  const car = o.carCap == null ? 3 : o.carCap;
  return [
    ['Airport → Surfcamp — Car', car, 20500, 80, null], ['Airport → Surfcamp — Minivan', 8, 25500, 95, SURFBOARDS],
    ['Surfcamp → Airport — Car', car, 19000, 80, null], ['Surfcamp → Airport — Minivan', 8, 24000, 95, SURFBOARDS],
  ].map(([name, capacity, cost, sell, blp], i) => row({ id: `sl-${i}`, name, capacity, cost_per_guest: cost, currency: 'LKR', sell_price: sell, covers_pax: 3, bl_product: o.noProduct ? null : blp }, i));
}
// Morocco: per airport (both ways), and Fathoune's vans per vehicle on the surf / tours tabs.
function maRows(o = {}) {
  const car = o.carCap == null ? 3 : o.carCap;
  const air = [['Agadir Airport', 250, 300, 500, 30, 40, 65], ['Marrakech Airport', 1200, 1500, 2200, 120, 150, 220]]
    .flatMap(([dest, c1, c2, c3, s1, s2, s3], j) => [['Car', car, c1, s1], ['Minivan', 8, c2, s2], ['Big Van', 15, c3, s3]]
      .map(([v, capacity, cost, sell], k) => row({ id: `ma-a${j}${k}`, name: `${dest} — ${v}`, capacity, cost_per_guest: cost, currency: 'MAD', sell_price: sell, covers_pax: 3, linked_transport_preset_id: `p-${dest}` }, j * 3 + k)));
  const vans = [['Surf', 'surf', 300, 500, 700], ['Tamri / Anza', 'surf', 400, 600, 800], ['Imsouane', 'surf', 800, 900, 1200], ['Dunes', 'tours', 500, 700, 800], ['Paradise Valley', 'tours', 500, 700, 800], ['Souk', 'tours', 300, 400, 600]]
    .flatMap(([dest, tab, c1, c2, c3], j) => [['Car', 4, c1], ['Minivan', 8, c2], ['Big Van', 15, c3]]
      .map(([v, capacity, cost], k) => row({ id: `ma-v${j}${k}`, name: `${dest} — ${v}`, capacity, cost_per_guest: cost, currency: 'MAD', picker_tab: tab, linked_transport_preset_id: `p-${dest}`, sell_currency: null }, 20 + j * 3 + k)));
  return air.concat(vans);
}
const slCat = o => TC.group(slRows(o));
const maCat = o => TC.group(maRows(o));
const slCfg = o => TC.withCatalog(CC.SL, slCat(o));
const maCfg = o => TC.withCatalog(CC.MA, maCat(o));

module.exports = { SURFBOARDS, slRows, maRows, slCat, maCat, slCfg, maCfg };
