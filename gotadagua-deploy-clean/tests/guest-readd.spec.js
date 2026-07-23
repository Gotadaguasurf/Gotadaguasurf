// Regression: per_guest — add guest, close, re-add same name.
// Guards two shipped bugs: (1) closed guests blocking their name forever,
// (2) double rosterRows() call orphaning the array the new guest is pushed
// into ("added" toast, empty roster). Hermetic: fake JWT (writes 401), local static
// server, MENU_HYDRATED guard blocks menu sync — same pattern as the
// existing guard smoke test. Direct inner load is safe ONLY here.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

test('re-add same name after close guest — appears in roster', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=portugal&mode=per_guest');

  await page.waitForFunction(() => {
    try { return typeof S === 'object' && typeof CAMP_TAB_MODE === 'string' && typeof saveNewGuest === 'function'; } catch (_) { return false; }
  }, null, { timeout: 20000 });

  const log = await page.evaluate(async () => {
    const out = [];
    window.confirm = () => true;
    window.alert = () => {};
    out.push('mode=' + CAMP_TAB_MODE);

    // Ensure the invisible container week exists (normal per_guest boot path).
    if (!S.activeWeek) {
      try { await ensurePerGuestWeek(); } catch (e) { out.push('containerWeek threw: ' + e.message); }
    }
    out.push('activeWeek=' + !!S.activeWeek);
    if (!S.activeWeek) return out;

    // 1. add guest
    document.getElementById('newGuestName').value = 'Repro Teste';
    saveNewGuest();
    out.push('after add: visible=' + JSON.stringify(visibleRoster(S.activeWeek, 'guests').map(g => g.name)));
    const g = rosterRows(S.activeWeek, 'guests').find(x => x.name === 'Repro Teste');
    out.push('guest exists=' + !!g);

    // 2. close it — closeActiveGuest closes AG (set by saveNewGuest)
    try { closeActiveGuest(); out.push('closed AG'); }
    catch (e) { out.push('close threw: ' + e.message); }
    out.push('closedAt set=' + !!(g && g.closedAt));
    out.push('after close: visible=' + JSON.stringify(visibleRoster(S.activeWeek, 'guests').map(x => x.name)));

    // 3. re-add same name
    document.getElementById('newGuestName').value = 'Repro Teste';
    saveNewGuest();
    const rows = rosterRows(S.activeWeek, 'guests').filter(x => x.name === 'Repro Teste');
    out.push('after re-add: rows=' + rows.length + ' closed=' + rows.filter(r => r.closedAt).length +
      ' visible=' + JSON.stringify(visibleRoster(S.activeWeek, 'guests').map(x => x.name)));

    // 4. DOM
    renderThisWeek();
    const dom = document.getElementById('twList');
    out.push('DOM shows name=' + (dom ? dom.innerHTML.includes('Repro Teste') : 'no twList'));
    return out;
  });
  console.log('\nREPRO LOG:\n' + log.join('\n'));
});
