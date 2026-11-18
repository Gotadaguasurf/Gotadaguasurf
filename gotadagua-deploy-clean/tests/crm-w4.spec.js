// CRM page, audit 18 Nov 2026 (W4): the dashboard leads with the day's real work (crm-15), errors stay
// readable (UXC-15), English everywhere (crm-24), Gmail links open the shared mailbox (crm-21), stored text is
// escaped (crm-22), a phone shows everything without sideways scroll (crm-16), one header row on a laptop
// (UXC-08), and «Select all» can take every contact the filters match (crm-20).
// Hermetic: tests/crm-stub.js answers every Supabase call; names and addresses are invented.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { stubCrm, openCrm, uuid, ME, days, company, baseTables } = require('./crm-stub');

const SHOTS = process.env.W4_SHOTS || '';

// 3 replies waiting (one company twice), 2 hot leads with no next step, 1 hot lead with a follow-up date,
// 1 with an open task, and a long «Silent 60+ days» list.
function dayTables() {
  const today = new Date().toISOString().slice(0, 10);
  const t = baseTables({ outreach_contacts: [
    company(1, { status: 'in_conversation', company: 'Riverside Rowing Club' }),
    company(2, { status: 'in_conversation', company: 'North Uni Surf Society' }),
    company(3, { status: 'meeting', company: 'Harbour Sports Union' }),
    company(4, { status: 'proposal_sent', company: 'Lakeside Students Association with a Very Long Name e.V.' }),
    company(5, { status: 'in_conversation', follow_up_at: today }),
    company(6, { status: 'meeting' }),
    ...Array.from({ length: 12 }, (_, i) => company(20 + i, { status: 'follow_up', last_interaction_at: days(90 + i), segment: 'Erasmus Student Network section', country: 'Netherlands', city: 'Rotterdam' })),
  ] });
  t.tasks = [{ id: uuid(1, '6'), company_id: uuid(6), title: 'Send the offer', type: 'follow_up', due_at: days(-3), done_at: null, owner_id: ME }];
  const inbound = (i, co, daysAgo, subject) => ({ id: uuid(i, 'd'), company_id: uuid(co), direction: 'inbound', from_addr: `Club <club${co}@example.org>`, subject,
    body: 'Thanks! Could you send prices for May?', thread_id: 'thr' + i, sent_at: days(daysAgo), created_at: days(daysAgo), read_at: null, archived_at: null });
  t.email_messages = [inbound(1, 1, 1, 'Re: Surf trip in May'), inbound(2, 1, 0.5, 'Re: Our questions'), inbound(3, 2, 2, 'Re: Surf week for the society')];
  return t;
}

test('dashboard: replies to answer and hot leads with no next step lead the hero (crm-15)', async ({ page }) => {
  await stubCrm(page, dayTables());
  const errs = await openCrm(page);
  const hero = await page.evaluate(() => ({
    title: document.getElementById('heroTodayTitle').textContent,
    sub: document.getElementById('heroTodaySub').textContent,
    rows: [...document.querySelectorAll('#heroTodayList .hero-task')].map(r => r.querySelector('.hero-task-name').textContent + ' | ' + r.querySelector('.hero-task-action').textContent),
  }));
  expect(hero.sub).toContain('2 replies to answer');
  expect(hero.sub).toContain('2 hot leads with no next step');
  expect(hero.rows.slice(0, 2)).toEqual(['Riverside Rowing Club | Reply', 'North Uni Surf Society | Reply']);
  expect(hero.rows).toContain('Harbour Sports Union | No next step');
  expect(hero.rows.join('\n')).not.toContain('Surf Club 6 | No next step');   // it has an open task
  expect(hero.title).not.toContain('🎉');
  expect(errs).toEqual([]);
});

test('toasts: an error is red and stays 6 s; a confirmation is not (UXC-15)', async ({ page }) => {
  await stubCrm(page, baseTables());
  await openCrm(page);
  const r = await page.evaluate(async () => {
    const el = document.getElementById('toast');
    toast('Could not save the note: permission denied');
    const err = el.classList.contains('err');
    await new Promise(res => setTimeout(res, 3000));
    const stillThere = el.classList.contains('show');
    toast('Saved');
    return { err, stillThere, okIsErr: el.classList.contains('err'), forced: (toast('Gmail paused', 'err'), el.classList.contains('err')) };
  });
  expect(r).toEqual({ err: true, stillThere: true, okIsErr: false, forced: true });
});

test('words and links: English attachment notes, readable unknown actions, escaped stored text, Gmail links open groups@ (crm-24, crm-22, crm-21)', async ({ page }) => {
  await stubCrm(page, baseTables());
  await openCrm(page);
  const r = await page.evaluate(() => {
    CURRENT_TEAM_USER = { id: 'x', email: 'someone.else@example.org' };   // logged in as somebody who is not the shared mailbox
    PENDING_ATTACH.composePreview = [{ name: 'offer.pdf' }, { name: 'map.pdf' }];
    const note = attachNoteText('composePreview');
    PENDING_ATTACH.composePreview = [];
    const box = document.createElement('div');
    box.innerHTML = activityLabel({ action: 'email_sent', meta: { template_name: '<img src=x onerror="window.__xss=1">' } });
    const out = activityLabel({ action: 'email_outbound', meta: { subject: 'Surf trip', thread_id: 'abc123' } });
    return { note, imgs: box.querySelectorAll('img').length, unknown: activityLabel({ action: 'sequence_enrolled' }), gmail: (out.match(/authuser=([^#&"]+)/) || [])[1] };
  });
  expect(r.note).toBe('2 files attached: offer.pdf, map.pdf');
  expect(r.imgs).toBe(0);
  expect(r.unknown).toBe('Sequence enrolled');
  expect(decodeURIComponent(r.gmail)).toBe('groups@gotadaguasurf.com');
  expect(await page.locator('#signOutBtn').textContent()).toBe('Log out');
});

test('phone 390: no sideways scroll on the dashboard, contact cards and inbox rows readable (crm-16)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubCrm(page, dayTables());
  await openCrm(page);
  const dash = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  expect(dash.sw).toBeLessThanOrEqual(dash.w);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'crm-dashboard-390.png'), fullPage: true });

  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="contacts"]').click());
  await page.waitForSelector('#contactsBody tr[data-id]');
  const card = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#contactsBody tr[data-id]')].find(r => r.children[3].textContent.trim() && r.children[2].textContent.trim());
    const a = tr.children[2].getBoundingClientRect(), b = tr.children[3].getBoundingClientRect();
    return { overlap: !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left), sw: document.documentElement.scrollWidth, w: innerWidth };
  });
  expect(card.overlap).toBe(false);
  expect(card.sw).toBeLessThanOrEqual(card.w);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'crm-contacts-390.png') });

  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="inbox"]').click());
  await page.waitForSelector('.inbox-row');
  const subjW = await page.evaluate(() => document.querySelector('.inbox-row .inbox-main').getBoundingClientRect().width);
  expect(subjW).toBeGreaterThan(250);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'crm-inbox-390.png') });
});

test('laptop 1280: the seven tabs stay on one row; «Open in Gmail» is in the Inbox and the phone menu (UXC-08)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubCrm(page, dayTables());
  await openCrm(page);
  const tops = await page.evaluate(() => [...new Set([...document.querySelectorAll('#navTabs .nav-tab')].map(b => Math.round(b.getBoundingClientRect().top)))]);
  expect(tops).toHaveLength(1);
  await expect(page.locator('#checkInboxBtn')).toBeHidden();
  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="inbox"]').click());
  await expect(page.locator('#inboxOpenGmailBtn')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'crm-inbox-1280.png') });
});

test('contacts: past 500 rows, «Select all N that match» selects every match; typing waits for a pause (crm-20)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubCrm(page, baseTables({ outreach_contacts: Array.from({ length: 640 }, (_, i) => company(i + 1, { status: 'not_started' })) }));
  await openCrm(page);
  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="contacts"]').click());
  await page.waitForSelector('#contactsBody tr[data-id]');
  await page.locator('#selectAll').check();
  await expect(page.locator('#bulkCount')).toHaveText('500');
  await expect(page.locator('#bulkSelectAllMatch')).toHaveText('Select all 640 that match');
  await page.locator('#bulkSelectAllMatch').click();
  await expect(page.locator('#bulkCount')).toHaveText('640');
  await expect(page.locator('#bulkSelectAllMatch')).toBeHidden();
  // debounce: three quick letters → one redraw
  const redraws = await page.evaluate(async () => {
    let n = 0; const orig = window.renderContacts; window.renderContacts = (...a) => { n++; return orig(...a); };
    const box = document.getElementById('filterSearch');
    for (const v of ['c', 'cl', 'clu']) { box.value = v; box.dispatchEvent(new Event('input')); }
    await new Promise(r => setTimeout(r, 400));
    window.renderContacts = orig; return n;
  });
  expect(redraws).toBe(1);
});

test('batch email: a bounced address and an Excluded company start unticked with the reason (crm-09)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const t = baseTables({ outreach_contacts: [company(1), company(2), company(3, { status: 'excluded' }), company(4)] });
  t.email_suppression = [{ id: 's1', email: 'club2@example.org', reason: 'bounce' }];
  await stubCrm(page, t);
  await openCrm(page);
  await page.evaluate(() => { [1, 2, 3, 4].forEach(i => SELECTED.add(CONTACTS.find(c => c.company === 'Surf Club ' + i).id)); });
  await page.evaluate(() => openBatchSendModal());
  await expect(page.locator('#batchRecipientCount')).toHaveText('2 of 4 will send');
  const chips = await page.locator('#batchRecipientList').textContent();
  expect(chips).toContain('bounced');
  expect(chips).toContain('excluded');
});
