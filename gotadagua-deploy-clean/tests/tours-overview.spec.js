// ════════════════════════════════════════════════════════════════════════════
//  TOURS — revenue, cost and profit in the camp hub Overview
//
//  11 Nov 2026 audit (Sri Lanka 2026): since the 22 Oct category rename
//  («Tours» → «Tours & activities» for expenses) the entry form no longer
//  offered the tour picker / Guests / «Staff / offered» box for a tour cost,
//  the «Tours» shortcut opened the form on «Food», rows imported with
//  business_area = 'Tours & activities' dropped out of every tour figure,
//  and revenue with no tour picked showed up as a fake tour called «Tours»
//  with a 100% margin while every unlinked cost sat in «General Tours».
//
//  Hermetic like the smoke suite: Supabase is stubbed, nothing is written.
// ════════════════════════════════════════════════════════════════════════════

const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const LOC = '83cda02b-0000-4000-8000-00000000c0de';
let n = 0;
const row = (o) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  location_id: LOC, week_id: null, qty: 1, currency: 'LKR', fx_rate: 400,
  payment_method: 'Cash', source_kind: 'manual', is_comp: false, zone_id: null,
  linked_item: null, paid_from: 'sri-lanka', attributed_location: 'sri-lanka',
  created_at: '2026-08-01T10:00:00Z', ...o,
  amount_eur: Number((o.amount_local / 400).toFixed(2)),
});
const ROWS = [
  // Camp Tab sales, one row per guest and tour
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', linked_item: 'Ice Bath', amount_local: 3000, entry_date: '2026-08-10', description: 'Camp Tab · A · Ice Bath', source_kind: 'camp_tab_per_item' }),
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', linked_item: 'Ice Bath', amount_local: 3000, entry_date: '2026-08-10', description: 'Camp Tab · B · Ice Bath', source_kind: 'camp_tab_per_item' }),
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', linked_item: 'River Safari', amount_local: 6000, entry_date: '2026-08-11', description: 'Camp Tab · A · River Safari', source_kind: 'camp_tab_per_item' }),
  // A weekly total with no tour picked (the Jan–May «Actividades» shape)
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', amount_local: 100000, entry_date: '2026-08-02', description: 'Actividades · semana' }),
  // Transfers sold — Transport revenue, not a tour
  row({ type: 'revenue', category: 'Transport', business_area: 'Transport', amount_local: 50000, entry_date: '2026-08-02', description: 'Transfers · semana' }),
  // Tour costs
  row({ type: 'expense', category: 'Tours & activities', business_area: 'Tours', linked_item: 'River Safari', amount_local: 8000, entry_date: '2026-08-11', description: 'River Cruise' }),
  row({ type: 'expense', category: 'Tours & activities', business_area: 'Tours', linked_item: 'Ice Bath', amount_local: 2000, entry_date: '2026-08-10', description: 'Ice — staff spot', is_comp: true }),
  // Legacy expense category «Tours» with no business_area
  row({ type: 'expense', category: 'Tours', business_area: null, linked_item: 'Ice Bath', amount_local: 1000, entry_date: '2026-08-10', description: 'Ice for ice bath' }),
  // Imported with business_area = category → used to drop out of every tour figure
  row({ type: 'expense', category: 'Tours & activities', business_area: 'Tours & activities', amount_local: 40000, entry_date: '2026-08-05', description: 'Yoga' }),
  // Van linked to a tour trip-by-trip ([TT:<tour>] marker)
  row({ type: 'expense', category: 'Transport', business_area: 'Transport', linked_item: 'River Cruise', amount_local: 1500, entry_date: '2026-08-11', description: '[TT:River Safari] Tuk tuk to the river' }),
  // Same import problem on another area: must count as Bar
  row({ type: 'expense', category: 'Drinks', business_area: 'Drinks', amount_local: 5000, entry_date: '2026-08-06', description: 'Beer stock' }),
];

async function bootSriLanka(page) {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      if (url.includes('/rest/v1/ledger_entries')) writes.push(req.method() + ' ' + url);
      return json([]);
    }
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka' });
    if (url.includes('/rest/v1/ledger_entries')) return json(ROWS);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof HUB_LEDGER_HYDRATED !== 'undefined' && HUB_LEDGER_HYDRATED === true, null, { timeout: 15000 });
  return { writes, errs };
}

test('tours overview: every tour row counts once, sold-tour profit apart from unlinked cost', async ({ page }) => {
  const { writes, errs } = await bootSriLanka(page);
  const out = await page.evaluate(() => {
    const area = (desc) => S.ledger.find(e => e.description === desc)?.businessArea;
    const revenue = S.ledger.filter(x => x.type === 'income');
    const expenses = S.ledger.filter(x => x.type === 'expense');
    const t = tourProfitRows(revenue, expenses);
    const byName = Object.fromEntries(t.rows.map(r => [r.name, { rev: r.revenueLocal, cost: r.costLocal, comp: r.compCostLocal, qty: r.qty }]));
    renderOverview();
    const panel = document.getElementById('ovCatPanels')?.innerText || '';
    return {
      areas: { yoga: area('Yoga'), beer: area('Beer stock'), legacyIce: area('Ice for ice bath') },
      legacyCat: S.ledger.find(e => e.description === 'Ice for ice bath')?.category,
      byName, sold: t.sold, unlinked: t.unlinked, last: t.rows[t.rows.length - 1]?.name,
      header: (document.getElementById('ovTourTotals')?.innerText || '').replace(/[\u00a0\u202f]/g, ' '),
      hasFakeTourCard: /\nTours\n/.test(panel), hasGeneralTours: panel.includes('General Tours'),
    };
  });
  // business_area values the hub doesn't know are re-derived from the category
  expect(out.areas).toEqual({ yoga: 'Tours', beer: 'Bar', legacyIce: 'Tours' });
  expect(out.legacyCat).toBe('Tours & activities');
  // per tour: linked revenue, linked cost (+ comp) and the van tagged [TT:River Safari]
  expect(out.byName['Ice Bath']).toEqual({ rev: 6000, cost: 3000, comp: 2000, qty: 2 });
  expect(out.byName['River Safari']).toEqual({ rev: 6000, cost: 9500, comp: 0, qty: 1 });
  // revenue with no tour picked is its own, honestly named card
  expect(out.byName['Tours (not split by tour)'].rev).toBe(100000);
  expect(out.byName['Tours (not split by tour)'].cost).toBe(0);
  // unlinked tour-area cost (incl. the row with business_area 'Tours & activities') is not dropped
  expect(out.byName['Not linked to a tour']).toEqual({ rev: 0, cost: 40000, comp: 0, qty: 0 });
  expect(out.last).toBe('Not linked to a tour');
  // sold tours = every tour revenue − cost attributed to a tour; transfers stay out
  expect(out.sold.revenueLocal).toBe(112000);
  expect(out.sold.costLocal).toBe(12500);
  expect(out.sold.profitLocal).toBe(99500);
  expect(out.sold.compCostLocal).toBe(2000);
  expect(out.unlinked.costLocal).toBe(40000);
  // total tour-area money reconciles with the raw rows: nothing lost, nothing doubled
  const rawTourRev = ROWS.filter(r => r.type === 'revenue' && r.business_area === 'Tours').reduce((s, r) => s + r.amount_local, 0);
  const rawTourCost = ROWS.filter(r => r.type === 'expense' && ['Tours', 'Tours & activities'].includes(r.category)).reduce((s, r) => s + r.amount_local, 0)
    + ROWS.filter(r => /^\[TT:/.test(r.description)).reduce((s, r) => s + r.amount_local, 0);
  expect(out.sold.revenueLocal).toBe(rawTourRev);
  expect(out.sold.costLocal + out.unlinked.costLocal).toBe(rawTourCost);
  // what Miguel reads
  expect(out.header).toContain('Sold tours: revenue LKR 112,000');
  expect(out.header).toContain('cost LKR 12,500');
  expect(out.header).toContain('profit LKR 99,500');
  expect(out.header).toContain('Not linked to a tour: cost LKR 40,000');
  expect(out.hasFakeTourCard).toBe(false);
  expect(out.hasGeneralTours).toBe(false);
  expect(writes).toEqual([]);
  expect(errs).toEqual([]);
});

test('tour cost entry: «Tours & activities» gets the tour picker, Guests and «Staff / offered» again', async ({ page }) => {
  const { writes, errs } = await bootSriLanka(page);
  const out = await page.evaluate(() => {
    // The «Tours» shortcut must land on «Tours & activities», not on the first category (Food)
    const btn = document.querySelector('#expQuickBar [data-cat^="Tours"]');
    startQuickExpense('expense', { category: 'Tours', paymentMethod: 'Cash' });
    const qe = {
      cat: document.getElementById('qe_cat').value,
      linkedVisible: document.getElementById('qe_linked_wrap').style.display !== 'none',
      linkedOpts: [...document.getElementById('qe_linked').options].map(o => o.value),
    };
    // Full modal: the comp box shows and persists
    fillEntryFields('em', 'expense', { category: 'Tours & activities' });
    const em = {
      cat: document.getElementById('em_cat').value,
      compVisible: document.getElementById('em_iscomp_wrap').style.display !== 'none',
      qtyLabel: document.querySelector('#em_qty_wrap label')?.textContent || '',
    };
    document.getElementById('em_date').value = '2026-08-12';
    document.getElementById('em_amount').value = '8000';
    const linked = document.getElementById('em_linked'); linked.value = 'River Safari';
    document.getElementById('em_iscomp').checked = true;
    const p = buildLedgerPayload('em', 'expense');
    return { onclick: btn?.getAttribute('onclick'), qe, em, payload: { category: p.category, area: p.businessArea, linked: p.linkedItem, isComp: p.isComp } };
  });
  expect(out.onclick).toBe("quickCategoryShortcut('Tours & activities')");
  expect(out.qe.cat).toBe('Tours & activities');
  expect(out.qe.linkedVisible).toBe(true);
  expect(out.qe.linkedOpts).toEqual(expect.arrayContaining(['', 'Ice Bath', 'River Safari']));
  expect(out.em.cat).toBe('Tours & activities');
  expect(out.em.compVisible).toBe(true);
  expect(out.payload).toEqual({ category: 'Tours & activities', area: 'Tours', linked: 'River Safari', isComp: true });
  expect(writes).toEqual([]);
  expect(errs).toEqual([]);
});
