// Regression: dirty-row sync filter — a device only writes rows IT changed.
// Guards the Sri Lanka "paid guest reopens" clobber: device B adding an item
// must not rewrite device A's freshly-paid guest with stale paid=false.
// Hermetic: fake JWT, local static server; we drive the page's own
// buildCampTabSyncRows + _lastSyncedRowJson exactly like sync does.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

test('sync writes only rows this device changed since baseline', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=portugal&mode=per_guest');
  await page.waitForFunction(() => {
    try { return typeof S === 'object' && typeof buildCampTabSyncRows === 'function'; } catch (_) { return false; }
  }, null, { timeout: 20000 });

  const result = await page.evaluate(async () => {
    window.confirm = () => true; window.alert = () => {};
    if (!S.activeWeek) await ensurePerGuestWeek();

    // Two guests, one item each — the shared starting state.
    document.getElementById('newGuestName').value = 'Alice\nBruno';
    saveNewGuest();
    const roster = rosterRows(S.activeWeek, 'guests');
    const alice = roster.find(g => g.name === 'Alice');
    const bruno = roster.find(g => g.name === 'Bruno');
    alice.items.push({ id: makeUuid(), n: 'Beer', p: 3, c: 'Drinks', d: '2026-08-10', t: '12:00' });
    bruno.items.push({ id: makeUuid(), n: 'Coke', p: 2, c: 'Drinks', d: '2026-08-10', t: '12:00' });

    // Simulate a CONFIRMED sync: baseline = everything as it stands now.
    const LOC = 'test-loc';
    const base = buildCampTabSyncRows(LOC);
    _lastSyncedRowJson = { weeks: new Map(), guests: new Map(), items: new Map() };
    base.weekRows.forEach(r => _lastSyncedRowJson.weeks.set(r.id, JSON.stringify(r)));
    base.guestRows.forEach(r => _lastSyncedRowJson.guests.set(r.id, JSON.stringify(r)));
    base.itemRows.forEach(r => _lastSyncedRowJson.items.set(r.id, JSON.stringify(r)));

    // THIS device now changes ONLY Alice (marks her item paid). Re-resolve
    // the reference first: building rows re-normalizes the roster objects,
    // so the pre-baseline `alice` is a dead copy — exactly like the real
    // payItem path, which always resolves fresh via rosterRows.
    const aliceNow = rosterRows(S.activeWeek, 'guests').find(g => g.name === 'Alice');
    aliceNow.items[0].paidAt = '2026-08-10T12:30:00.000Z';

    // Recompute what sync would upsert.
    const next = buildCampTabSyncRows(LOC);
    const dirtyGuests = next.guestRows.filter(r => _lastSyncedRowJson.guests.get(r.id) !== JSON.stringify(r));
    const dirtyItems  = next.itemRows.filter(r => _lastSyncedRowJson.items.get(r.id)  !== JSON.stringify(r));
    const dirtyWeeks  = next.weekRows.filter(r => _lastSyncedRowJson.weeks.get(r.id)  !== JSON.stringify(r));

    return {
      dirtyGuestNames: dirtyGuests.map(r => r.name),
      dirtyItemNames: dirtyItems.map(r => r.item_name),
      dirtyWeekCount: dirtyWeeks.length,
      brunoRowUntouched: !dirtyGuests.some(r => r.name === 'Bruno')
        && !dirtyItems.some(r => r.item_name === 'Coke'),
    };
  });

  // Bruno (the guest this device did NOT touch) must not be written at all —
  // that's the clobber that reopened paid guests.
  expect(result.brunoRowUntouched).toBe(true);
  expect(result.dirtyItemNames).toEqual(['Beer']);
  // Alice's guest row itself didn't change (payment lives on the item in
  // per_guest mode) — item-only writes are exactly what we want here.
  expect(result.dirtyGuestNames).toEqual([]);
  expect(result.dirtyWeekCount).toBe(0);
});
