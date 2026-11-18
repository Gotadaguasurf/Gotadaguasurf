// CRM campaigns, inbox and bounces (audit 18 Nov 2026: crm-01, crm-02, crm-04, crm-06, UXC-01, UXC-02).
// Hermetic: tests/crm-stub.js answers every Supabase call from in-memory tables.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { stubCrm, openCrm, uuid, ME, days, company, baseTables, campaign, queueRows } = require('./crm-stub');

const SHOTS = process.env.CRM_SHOTS || '';        // folder for the 390 / 1280 screenshots (optional)
const SHOT_LABEL = process.env.CRM_SHOT_LABEL || 'after';

// Three campaigns: one finished with more queue rows than one PostgREST page, one that Gmail's quota paused
// (the dispatcher leaves «HTTP 403: …» on the row it was sending), one a person paused.
function campaignTables() {
  const done = campaign(1, { name: 'University clubs (EN) · 21 Oct · 1300 contacts', created_at: days(28) });
  const gmail = campaign(2, { name: 'Follow-up 1 (EN) · 01 Oct · 499 contacts', status: 'paused', template_name: 'Follow-up 1', created_at: days(48), updated_at: days(47) });
  const manual = campaign(3, { name: 'Surf schools (EN) · 07 Sept · 40 contacts', status: 'paused', created_at: days(72) });
  const gq = queueRows(gmail.id, 201, 'pending');
  gq[0].error = 'HTTP 429: {"error":{"code":429,"message":"Too many concurrent requests for user."}}'; gq[0].attempts = 1;
  gq[0].subject = 'Re: Surf trip for your club'; gq[0].body = 'Hi again,\n\nJust checking you saw my email about a surf week in October.\n\nTest Owner';
  return baseTables({
    email_campaigns: [done, gmail, manual],
    email_queue: [...queueRows(done.id, 1250, 'sent'), ...queueRows(done.id, 50, 'skipped'), ...queueRows(gmail.id, 94, 'sent'), ...gq,
      ...queueRows(manual.id, 30, 'sent'), ...queueRows(manual.id, 10, 'pending')],
    email_campaign_stats: [{ campaign_id: done.id, sent_count: 1250, replied_count: 25 }, { campaign_id: gmail.id, sent_count: 94, replied_count: 3 }, { campaign_id: manual.id, sent_count: 30, replied_count: 6 }],
  });
}
const openCampaigns = async page => {
  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="sequences"]').click());
  await page.waitForFunction(() => document.querySelectorAll('#campaignList .card').length > 0, null, { timeout: 5000 }).catch(() => {});
};

// A contact whose address bounced: the sync wrote the same line on every run.
function bouncedTables() {
  const t = baseTables();
  const c = t.outreach_contacts[0]; c.status = 'no_reply';
  t.outreach_activity = [
    { id: uuid(1, 'd'), contact_id: c.id, action: 'email_sent', meta: { template_name: 'First email', via: 'campaign' }, created_by: 'miguel@gotadaguasurf.com', created_at: days(42) },
    ...Array.from({ length: 60 }, (_, i) => ({ id: uuid(100 + i, 'd'), contact_id: c.id, action: 'email_bounced', meta: { email: c.email, subject: 'Delivery Status Notification (Failure)', via: 'gmail-sync-server' }, created_by: 'gmail-sync-server', created_at: new Date(Date.now() - 41 * 86400000 + i * 300000).toISOString() })),
    { id: uuid(2, 'd'), contact_id: c.id, action: 'unsubscribed', new_value: 'excluded', meta: { email: c.email, keyword: 'unsubscribe' }, created_by: 'gmail-sync-server', created_at: days(39) },
  ];
  return t;
}

// 14 conversations: 9 answered long ago (their replies are older than the newest 1000 outbound emails), 2 answered
// recently, 3 really waiting.
function inboxTables() {
  const t = baseTables({ outreach_contacts: Array.from({ length: 14 }, (_, i) => company(i + 1, { status: 'in_conversation' })) });
  const msgs = [];
  const inbound = (i, daysAgo) => msgs.push({ id: uuid(i, 'd'), company_id: uuid(i), direction: 'inbound', from_addr: `Club ${i} <club${i}@example.org>`, subject: `Re: Surf trip ${i}`,
    body: 'Hello, thanks for the email. Could you send prices?', thread_id: 'thr' + i, sent_at: days(daysAgo), created_at: days(daysAgo), read_at: days(daysAgo - 0.1), archived_at: null });
  const outbound = (k, thread, daysAgo) => msgs.push({ id: uuid(k, '7'), company_id: null, direction: 'outbound', from_addr: 'groups@example.org', to_addr: 'x@example.org', subject: 's', body: 'b', thread_id: thread, sent_at: days(daysAgo), created_at: days(daysAgo) });
  for (let i = 1; i <= 9; i++) { inbound(i, 70 - i); outbound(i, 'thr' + i, 69 - i); }       // answered in September
  for (let i = 10; i <= 11; i++) { inbound(i, 3); outbound(i, 'thr' + i, 2); }                // answered this week
  for (let i = 12; i <= 14; i++) inbound(i, 14 - i + 1);                                       // waiting
  for (let k = 0; k < 1100; k++) outbound(1000 + k, 'camp' + k, 20 + k / 100);                 // campaign sends since then
  t.email_messages = msgs;
  return t;
}

// ── crm-01 + UXC-01: the list renders, with the right numbers ───────────────
test('campaigns: the list renders with Pause / Resume / Cancel, and counts every queue row past the 1000-row page', async ({ page }) => {
  const t = campaignTables();
  t.email_campaigns[0].name = 'University <b>clubs</b> · 21 Oct';   // a name is text, never markup
  const { calls } = await stubCrm(page, t);
  const errs = await openCrm(page);
  await openCampaigns(page);
  const cards = page.locator('#campaignList > .card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('University <b>clubs</b> · 21 Oct');
  await expect(cards.nth(0)).toContainText('1250/1300 sent · 0 pending · 50 skipped');
  await expect(cards.nth(0)).toContainText('25 replies · 2%');
  await expect(cards.nth(0).locator('button')).toHaveCount(0);                       // done: nothing to press
  await expect(cards.nth(1)).toContainText('94/295 sent · 201 pending');
  await expect(cards.nth(1).locator('button')).toHaveText(['Resume', 'Cancel']);
  await expect(cards.nth(2)).toContainText('30/40 sent · 10 pending');
  await expect(cards.nth(2).locator('button')).toHaveText(['Resume', 'Cancel']);
  // the queue was read in pages with a stable order
  const pages = calls.filter(c => c.table === 'email_queue' && /select=campaign_id,status/.test(c.query));
  expect(pages.length).toBeGreaterThanOrEqual(2);
  expect(pages.every(c => /order=id/.test(c.query))).toBe(true);
  expect(errs).toEqual([]);
  // no sideways scroll on the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('campaigns: a running campaign can be paused and cancelled from the list', async ({ page }) => {
  const run = campaign(1, { name: 'Running now', status: 'running', created_at: days(1) });
  const { calls, tables } = await stubCrm(page, baseTables({ email_campaigns: [run], email_queue: [...queueRows(run.id, 3, 'sent'), ...queueRows(run.id, 5, 'pending')] }));
  await openCrm(page); await openCampaigns(page);
  const card = page.locator('#campaignList > .card');
  await expect(card.locator('button')).toHaveText(['Pause', 'Cancel']);
  await card.locator('button', { hasText: 'Pause' }).click();
  await expect(card.locator('button')).toHaveText(['Resume', 'Cancel']);
  expect(tables.email_campaigns[0].status).toBe('paused');
  await expect(card.locator('.badge')).toHaveText(/paused/);                          // paused by a person: not the red chip
  await expect(page.locator('#campaignAlert')).toBeHidden();
  page.once('dialog', d => d.accept());
  await card.locator('button', { hasText: 'Cancel' }).click();
  await expect(card.locator('.badge')).toHaveText(/cancelled/);
  expect(tables.email_queue.filter(q => q.status === 'cancelled')).toHaveLength(5);
  expect(tables.email_queue.filter(q => q.status === 'sent')).toHaveLength(3);
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
});

test('campaigns: a paused campaign older than the latest 20 is still listed', async ({ page }) => {
  const recent = Array.from({ length: 22 }, (_, i) => campaign(i + 1, { name: `Recent ${i + 1}`, created_at: days(i + 1) }));
  const old = campaign(40, { name: 'Old paused one', status: 'paused', created_at: days(200) });
  await stubCrm(page, baseTables({ email_campaigns: [...recent, old], email_queue: queueRows(old.id, 4, 'pending') }));
  await openCrm(page); await openCampaigns(page);
  await expect(page.locator('#campaignList > .card')).toHaveCount(21);
  await expect(page.locator('#campaignList > .card').last()).toContainText('Old paused one');
  await expect(page.locator('#campaignList > .card').last().locator('button')).toHaveText(['Resume', 'Cancel']);
});

// ── crm-02: paused by Gmail is visible, and Resume shows what would be sent ──
test('paused by Gmail: red chip on the dashboard and in the list; Resume shows the stored email first', async ({ page }) => {
  const t = campaignTables();
  // 30 of the people waiting already got this subject from another campaign
  const waiting = t.email_queue.filter(q => q.campaign_id === uuid(2, 'e') && q.status === 'pending');
  waiting.slice(1, 31).forEach(q => t.email_queue.push({ ...q, id: q.id.replace(/^b/, '8'), campaign_id: uuid(1, 'e'), status: 'sent', sent_at: days(27), error: null }));
  const { calls, tables } = await stubCrm(page, t);
  await openCrm(page);
  // dashboard (390px): one red chip, which opens the campaigns
  const chip = page.locator('#campaignAlertChip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Paused by Gmail · 201 not sent');
  await chip.click();
  await expect(page.locator('.nav-tab[data-tab="sequences"]')).toHaveClass(/active/);
  const cards = page.locator('#campaignList > .card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator('.badge-red')).toHaveText('Paused by Gmail · 201 not sent');
  await expect(cards.nth(2).locator('.badge-red')).toHaveCount(0);                    // paused by a person
  await expect(cards.nth(2).locator('.badge-amber')).toHaveText(/paused/);

  // Resume does not send: it shows the first queued email as stored
  await cards.nth(1).locator('button', { hasText: 'Resume' }).click();
  const modal = page.locator('#resumeCampaignModal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Follow-up 1 (EN) · 01 Oct · 499 contacts');
  await expect(modal).toContainText(/201 emails not sent · written .* \(8 weeks ago\)/);
  await expect(modal).toContainText('Gmail stopped it on');
  await expect(modal.locator('#resumeRepeats')).toHaveText('30 of these people already received an email with this same subject.');
  await expect(modal.locator('#resumeSubject')).toHaveText('Re: Surf trip for your club');
  await expect(modal.locator('#resumeBody')).toContainText('Just checking you saw my email about a surf week in October.');
  await expect(modal.locator('.btn-p')).toHaveCount(1);
  expect(tables.email_campaigns[1].status).toBe('paused');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // «Keep paused» changes nothing
  await modal.locator('button', { hasText: 'Keep paused' }).click();
  await expect(modal).toHaveCount(0);
  expect(calls.filter(c => c.method !== 'GET' && c.method !== 'HEAD')).toEqual([]);
  expect(tables.email_campaigns[1].status).toBe('paused');

  // «Resume sending» sets it running and clears the Gmail error; the chip goes
  await cards.nth(1).locator('button', { hasText: 'Resume' }).click();
  await page.locator('#resumeCampaignGo').click();
  await expect(cards.nth(1).locator('button')).toHaveText(['Pause', 'Cancel']);
  expect(tables.email_campaigns[1].status).toBe('running');
  expect(tables.email_queue.filter(q => q.error)).toEqual([]);
  expect(tables.email_queue.filter(q => q.campaign_id === uuid(2, 'e') && q.status === 'pending')).toHaveLength(201);   // nothing cancelled or sent by the page
  await expect(cards.nth(1).locator('.badge-red')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="dashboard"]').click());
  await expect(page.locator('#campaignAlert')).toBeHidden();
});

test('paused by Gmail: no chip when nothing is paused by Gmail', async ({ page }) => {
  const t = campaignTables();
  t.email_queue.forEach(q => { q.error = null; });
  await stubCrm(page, t);
  await openCrm(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#campaignAlert')).toBeHidden();
});

// ── UXC-02: «Needs reply» ───────────────────────────────────────────────────
test('inbox: a conversation answered before the newest 1000 sent emails is not «Needs reply»', async ({ page }) => {
  await stubCrm(page, inboxTables());
  await openCrm(page);
  await expect(page.locator('#navInboxCountMob')).toHaveText('3');
  await page.evaluate(() => document.querySelector('.nav-tab[data-tab="inbox"]').click());
  const rows = page.locator('#inboxList .inbox-row');
  await expect(rows).toHaveCount(3);
  await expect(rows).toContainText(['Surf Club 14', 'Surf Club 13', 'Surf Club 12']);
  await page.locator('[data-inbox-filter="all"]').click();
  await expect(rows).toHaveCount(14);
});

// ── crm-06: one email per address ───────────────────────────────────────────
test('batch: two companies with the same address get one email, and the confirm says so', async ({ page }) => {
  const t = baseTables();
  t.outreach_contacts[6].email = ' CLUB1@example.org';                                // company 7 shares company 1's inbox
  t.outreach_contacts.forEach(c => { c.last_contacted_at = null; c.status = 'not_started'; });
  const other = campaign(9, { status: 'running', created_at: days(1) });
  t.email_campaigns = [other];
  t.email_queue = queueRows(other.id, 1, 'pending', { to_email: 'club3@example.org' });   // company 3 already waits in another campaign
  const { tables } = await stubCrm(page, t);
  await openCrm(page);
  let confirmText = '';
  page.once('dialog', d => { confirmText = d.message(); d.accept(); });
  await page.evaluate(async () => {
    CONTACTS.forEach(c => SELECTED.add(c.id));
    await openBatchSendModal();
    document.getElementById('batchTemplate').value = TEMPLATES[0].id;
    document.getElementById('batchSendAs').value = TEAM_USERS[0].id;
    document.getElementById('batchDryRun').checked = false;
    await runBatchSend();
  });
  expect(confirmText).toContain('Queue 7 emails as a drip campaign?');
  expect(confirmText).toContain('1 left out: same email address as another selected company');
  expect(confirmText).toContain('1 of these already have an email waiting in another campaign');
  const created = tables.email_campaigns.find(c => c.id !== other.id);
  expect(created.name).toMatch(/7 contacts$/);
  const queued = tables.email_queue.filter(q => q.campaign_id === created.id);
  expect(queued).toHaveLength(7);
  const addresses = queued.map(q => q.to_email.trim().toLowerCase());
  expect(new Set(addresses).size).toBe(7);
  expect(queued.find(q => /club1@/i.test(q.to_email)).company_id).toBe(uuid(1));     // the first company keeps it
});

test('batch: in a small instant batch the second row with the same address is skipped, not sent', async ({ page }) => {
  const t = baseTables({ outreach_contacts: [company(1), company(2, { email: 'club1@example.org' }), company(3)] });
  t.outreach_contacts.forEach(c => { c.last_contacted_at = null; c.status = 'not_started'; });
  const { fnCalls, calls } = await stubCrm(page, t, { functions: { 'gmail-send': { ok: true, message_id: 'm1', thread_id: 't1' } } });
  await openCrm(page);
  page.once('dialog', d => d.accept());
  const rows = await page.evaluate(async () => {
    CONTACTS.forEach(c => SELECTED.add(c.id));
    await openBatchSendModal();
    document.getElementById('batchTemplate').value = TEMPLATES[0].id;
    document.getElementById('batchSendAs').value = TEAM_USERS[0].id;
    document.getElementById('batchDryRun').checked = false;
    await runBatchSend();
    return BATCH_STATE.recipients.map(r => ({ company: r.contact.company, status: r.status, message: r.message }));
  });
  expect(rows).toEqual([
    { company: 'Surf Club 1', status: 'sent', message: '' },
    { company: 'Surf Club 2', status: 'skipped', message: 'same address as Surf Club 1' },
    { company: 'Surf Club 3', status: 'sent', message: '' },
  ]);
  expect(fnCalls.filter(f => f.name === 'gmail-send')).toHaveLength(2);
  expect(calls.filter(c => c.table === 'email_queue' && c.method === 'POST')).toEqual([]);
});

// ── crm-04: a bounce is one readable line ───────────────────────────────────
test('timeline: 60 repeated bounce rows show as one line in words, and the older history is still there', async ({ page }) => {
  const t = bouncedTables();
  await stubCrm(page, t);
  await openCrm(page);
  await page.evaluate(id => openContact(id), t.outreach_contacts[0].id);
  const items = page.locator('#activityList .activity-item');
  await expect(items.first()).toBeVisible();
  const text = await page.locator('#activityList').innerText();
  expect(text).not.toContain('email_bounced');
  expect(text).not.toContain('unsubscribed\n');
  expect(text.match(/Email bounced — club1@example\.org cannot receive mail/g)).toHaveLength(1);
  expect(text).toContain('Asked to unsubscribe — no more emails');
  expect(text).toContain('Sent "First email"');                                       // the line the 60 rows used to hide
  await expect(items).toHaveCount(3);
});

// ── crm-05: the sync button identifies the user ─────────────────────────────
test('get new replies: the call to gmail-sync carries the signed-in user\'s token', async ({ page }) => {
  const { fnCalls } = await stubCrm(page, baseTables());
  await openCrm(page);
  await page.evaluate(() => syncGmailInbox({ silent: true }));
  const call = fnCalls.find(f => f.name === 'gmail-sync');
  expect(call.headers.authorization).toMatch(/^Bearer ey/);
  expect(call.query).toBe('');                                                        // never ?debug or ?days from the page
});

// ── screenshots (only with CRM_SHOTS=<folder>) ──────────────────────────────
for (const vp of [{ w: 390, h: 844 }, { w: 1280, h: 800 }]) {
  test(`shots ${vp.w}px`, async ({ page }) => {
    test.skip(!SHOTS, 'set CRM_SHOTS=<folder> to save screenshots');
    const shot = name => page.screenshot({ path: path.join(SHOTS, `${SHOT_LABEL}-${vp.w}-${name}.png`) });
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await stubCrm(page, campaignTables()); await openCrm(page);
    await shot('dashboard');
    await openCampaigns(page); await page.waitForTimeout(400); await shot('campaigns');
    const resume = page.locator('#campaignList button', { hasText: 'Resume' }).first();
    if (await resume.count()) {
      page.once('dialog', d => d.dismiss().catch(() => {}));
      await resume.click(); await page.waitForTimeout(400); await shot('resume');
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await stubCrm(page, inboxTables()); await openCrm(page);
    await page.evaluate(() => document.querySelector('.nav-tab[data-tab="inbox"]').click()); await page.waitForTimeout(300); await shot('inbox');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const t = bouncedTables(); await stubCrm(page, t); await openCrm(page);
    await page.evaluate(id => openContact(id), t.outreach_contacts[0].id);
    await page.waitForSelector('#activityList .activity-item'); await page.locator('#activityList').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot('timeline');
  });
}
