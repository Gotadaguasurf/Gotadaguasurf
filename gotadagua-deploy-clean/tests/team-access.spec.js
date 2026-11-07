// ════════════════════════════════════════════════════════════════════════════
//  Settings → Team Access and the invite link that does not expire (6 Nov 2026).
//  Every Supabase call (REST, RPC, Edge Functions, auth) is answered here —
//  nothing reaches the real project.
// ════════════════════════════════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');

const MIGUEL = '00000000-0000-4000-8000-000000000001';
const WS = [
  { id: 'ws-sl', slug: 'sri-lanka', name: 'Sri Lanka' },
  { id: 'ws-pt', slug: 'portugal', name: 'Portugal' },
  { id: 'ws-settings', slug: 'settings', name: 'Settings' },
];
const TOKEN = '3f1c2b9e-8d7a-4c5b-9e6f-112233445566';

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const jwtFor = (sub, email) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, email, role: 'authenticated', exp: 9_999_999_999 })}.test`;

// A small fake of the tables the hub reads for a signed-in user.
function mockHub(page, { self, members, invites = [], inviteAccess = [], people, calls }) {
  return page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    if (url.includes('/auth/v1/user')) return json(route, { id: self.id, email: self.email, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/team_access_people')) return json(route, people);
    if (url.includes('/rest/v1/platform_profiles')) {
      if (method !== 'GET') { calls.push({ table: 'platform_profiles', method, url, body: req.postData() }); return json(route, [{ id: 'x' }]); }
      if (url.includes(`id=eq.${self.id}`)) return json(route, [self]);
      return json(route, people.map(p => ({ id: p.user_id, ...p })));
    }
    if (url.includes('/rest/v1/workspace_memberships')) {
      if (method !== 'GET') { calls.push({ table: 'workspace_memberships', method, url, body: req.postData() }); return json(route, []); }
      if (url.includes(`user_id=eq.${self.id}`)) return json(route, members.filter(m => m.user_id === self.id));
      return json(route, members);
    }
    if (url.includes('/rest/v1/workspaces')) return json(route, WS);
    if (url.includes('/rest/v1/workspace_invitations')) {
      if (method !== 'GET') { calls.push({ table: 'workspace_invitations', method, url, body: req.postData() }); return json(route, [{ id: 'x' }]); }
      if (url.includes('email=eq.')) return json(route, []);
      return json(route, invites);
    }
    if (url.includes('/rest/v1/invitation_workspace_access')) return json(route, inviteAccess);
    if (url.includes('/functions/v1/create-platform-invite')) {
      calls.push({ fn: 'create-platform-invite', body: JSON.parse(req.postData() || '{}') });
      return json(route, { ok: true, reused: false, email_sent: true, invite: { id: 'new-inv' } });
    }
    return json(route, []);
  });
}

const selfProfile = { id: MIGUEL, email: 'miguel@gotadaguasurf.com', full_name: 'Miguel', platform_role: 'super_admin', active: true, password_set_at: '2026-05-09T10:00:00Z' };
const member = (user_id, email, full_name, ws, role, can_edit = true) => ({ user_id, workspace_id: ws, member_role: role, can_view: true, can_edit, can_manage_team: role === 'super_admin', platform_profiles: { email, full_name } });

test('team access: one list with Active / Invited / Never signed in, the right buttons, and Resend invite sends the current access', async ({ page }) => {
  const calls = [];
  const members = [
    member(MIGUEL, 'miguel@gotadaguasurf.com', 'Miguel', 'ws-pt', 'super_admin'),
    member(MIGUEL, 'miguel@gotadaguasurf.com', 'Miguel', 'ws-settings', 'super_admin'),
    member('u-fra', 'francisco@example.com', 'Francisco Guimarães', 'ws-pt', 'location_manager'),
    member('u-nad', 'nadith@example.com', 'Nadith', 'ws-sl', 'local_manager'),
    member('u-lot', 'lotte@example.com', 'Lotte', 'ws-pt', 'viewer', false),
  ];
  const people = [
    { user_id: MIGUEL, email: 'miguel@gotadaguasurf.com', full_name: 'Miguel', active: true, password_set_at: '2026-05-09T10:00:00Z', last_sign_in_at: '2026-11-05T09:00:00Z' },
    { user_id: 'u-fra', email: 'francisco@example.com', full_name: 'Francisco Guimarães', active: true, password_set_at: null, last_sign_in_at: null },
    { user_id: 'u-nad', email: 'nadith@example.com', full_name: 'Nadith', active: true, password_set_at: null, last_sign_in_at: null },
    { user_id: 'u-lot', email: 'lotte@example.com', full_name: 'Lotte', active: true, password_set_at: '2026-09-10T10:00:00Z', last_sign_in_at: '2026-11-04T18:00:00Z' },
  ];
  const invites = [{ id: 'inv-nad', email: 'nadith@example.com', full_name: 'Nadith', platform_role: 'local_manager', status: 'sent', invitation_token: TOKEN, created_at: '2026-11-06T08:00:00Z', last_sent_at: '2026-11-06T08:00:00Z', expires_at: '2027-01-05T08:00:00Z' }];
  await mockHub(page, { self: selfProfile, members, invites, inviteAccess: [{ invitation_id: 'inv-nad', workspace_id: 'ws-sl', can_edit: true }], people, calls });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/#settings', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#accessUserList [data-status]').length === 4, null, { timeout: 15000 });

  const rows = await page.evaluate(() => [...document.querySelectorAll('#accessUserList [data-person]')].map(r => ({
    email: r.dataset.person, status: r.dataset.status,
    statusText: [...r.querySelector('.access-status').children].map(c => c.textContent.trim()).join(' '),
    buttons: [...r.querySelectorAll('.access-actions button')].map(b => b.textContent.trim()),
    chips: [...r.querySelectorAll('.access-tags .badge')].map(b => b.textContent.trim()),
  })));
  const by = Object.fromEntries(rows.map(r => [r.email, r]));
  expect(rows.map(r => r.status)).toEqual(['invited', 'never', 'active', 'active']); // waiting people first
  expect(by['nadith@example.com'].statusText).toBe('Invited Not accepted yet · invite sent 6 Nov');
  expect(by['nadith@example.com'].buttons).toEqual(['Resend invite', 'Copy link', 'Edit', 'Cancel invite']);
  expect(by['francisco@example.com'].statusText).toContain('Never signed in');
  expect(by['francisco@example.com'].buttons).toEqual(['Resend invite', 'Edit', 'Cancel invite']);
  expect(by['lotte@example.com'].statusText).toBe('Active Last sign-in 4 Nov');
  expect(by['lotte@example.com'].buttons).toEqual(['View as', 'Edit', 'Deactivate']);
  expect(by['lotte@example.com'].chips).toEqual(['Portugal · Camp Tab']);
  expect(by['miguel@gotadaguasurf.com'].buttons).not.toContain('Deactivate'); // never yourself
  expect(await page.textContent('#teamListSub')).toContain('4 people · 2 without a password yet');

  // the role hint says what Local Manager means
  await page.selectOption('#accessRole', 'Local Manager');
  expect(await page.textContent('#accessRoleHint')).toContain('without the lines HQ pays');

  // Resend invite to Francisco: same role and areas as he has now, our link base
  await page.click('[data-person="francisco@example.com"] button:has-text("Resend invite")');
  await page.waitForFunction(() => /Invite sent to francisco@example.com/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 10000 });
  const sent = calls.find(c => c.fn === 'create-platform-invite').body;
  expect(sent.email).toBe('francisco@example.com');
  expect(sent.fullName).toBe('Francisco Guimarães');
  expect(sent.role).toBe('location_manager');
  expect(sent.accessRows.map(r => [r.workspace_id, r.can_edit])).toEqual([['ws-pt', true]]);
  expect(sent.siteUrl).toBe('http://127.0.0.1:8788/');
  expect(await page.textContent('#toast')).toContain('works until they create their password');
  expect(errs).toEqual([]);
});

test('team access: Cancel invite closes the link and switches the access off, without deleting anything', async ({ page }) => {
  const calls = [];
  const members = [member(MIGUEL, 'miguel@gotadaguasurf.com', 'Miguel', 'ws-pt', 'super_admin'), member('u-nad', 'nadith@example.com', 'Nadith', 'ws-sl', 'local_manager')];
  const people = [
    { user_id: MIGUEL, email: 'miguel@gotadaguasurf.com', full_name: 'Miguel', active: true, password_set_at: '2026-05-09T10:00:00Z', last_sign_in_at: '2026-11-05T09:00:00Z' },
    { user_id: 'u-nad', email: 'nadith@example.com', full_name: 'Nadith', active: true, password_set_at: null, last_sign_in_at: null },
  ];
  const invites = [{ id: 'inv-nad', email: 'nadith@example.com', full_name: 'Nadith', platform_role: 'local_manager', status: 'sent', invitation_token: TOKEN, created_at: '2026-11-06T08:00:00Z' }];
  await mockHub(page, { self: selfProfile, members, invites, people, calls });
  await fakeOwnerSession(page);
  page.on('dialog', d => d.accept());
  await page.goto('/#settings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-person="nadith@example.com"]', { timeout: 15000 });
  await page.click('[data-person="nadith@example.com"] button:has-text("Cancel invite")');
  await page.waitForFunction(() => /Invite cancelled for Nadith/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 10000 });
  const inv = calls.find(c => c.table === 'workspace_invitations');
  expect(inv.method).toBe('PATCH');
  expect(JSON.parse(inv.body).status).toBe('canceled');
  expect(inv.url).toContain('email=eq.nadith@example.com');
  expect(JSON.parse(calls.find(c => c.table === 'workspace_memberships').body).active).toBe(false);
  expect(JSON.parse(calls.find(c => c.table === 'platform_profiles').body).active).toBe(false);
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
});

test('invite link /?accept=<token>: create the password, then the person is logged in', async ({ page }) => {
  const acceptCalls = []; let passwordLogin = null; let signedIn = false;
  const NAD = '00000000-0000-4000-8000-0000000000aa';
  await page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url());
    if (url.includes('/functions/v1/accept-invite')) {
      const body = JSON.parse(req.postData() || '{}'); acceptCalls.push(body);
      if (body.action === 'check') return json(route, { ok: true, email: 'nadith@example.com', full_name: 'Nadith' });
      return json(route, { ok: true, email: 'nadith@example.com' });
    }
    if (url.includes('/auth/v1/token')) {
      passwordLogin = JSON.parse(req.postData() || '{}'); signedIn = true;
      return json(route, { access_token: jwtFor(NAD, 'nadith@example.com'), token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'r',
        user: { id: NAD, aud: 'authenticated', role: 'authenticated', email: 'nadith@example.com', app_metadata: {}, user_metadata: {} } });
    }
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/auth/v1/user')) return json(route, { id: NAD, email: 'nadith@example.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return json(route, [{ id: NAD, email: 'nadith@example.com', full_name: 'Nadith', platform_role: 'local_manager', active: true, password_set_at: '2026-11-06T12:00:00Z' }]);
    if (url.includes('/rest/v1/workspace_memberships')) return json(route, [{ user_id: NAD, workspace_id: 'ws-sl', member_role: 'local_manager', can_view: true, can_edit: true, platform_profiles: { email: 'nadith@example.com', full_name: 'Nadith' } }]);
    if (url.includes('/rest/v1/workspaces')) return json(route, WS);
    return json(route, []);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`/?accept=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginTitle')).toHaveText('Create your password', { timeout: 10000 });
  await expect(page.locator('#passwordFlowBox')).toBeVisible();
  expect(await page.inputValue('#loginEmail')).toBe('nadith@example.com');
  expect(await page.inputValue('#passwordFlowName')).toBe('Nadith');
  expect(await page.textContent('#loginNoteSecondary')).toContain('keeps working until you create your password');

  await page.fill('#passwordFlowPassword', 'test-only-pass-123');
  await page.fill('#passwordFlowPassword2', 'test-only-pass-123');
  await page.click('#passwordFlowSaveButton');
  await page.waitForFunction(() => document.getElementById('appShell')?.classList.contains('visible'), null, { timeout: 15000 });

  expect(acceptCalls[0]).toEqual({ action: 'check', token: TOKEN });
  expect(acceptCalls[1]).toEqual({ action: 'accept', token: TOKEN, password: 'test-only-pass-123', full_name: 'Nadith' });
  expect(signedIn).toBe(true);
  expect(passwordLogin.email).toBe('nadith@example.com');
  expect(page.url()).not.toContain('accept=');
  // a Local Manager does not get the Team Access screen
  expect(await page.evaluate(() => document.getElementById('teamAccessCard').style.display)).toBe('none');
  expect(errs).toEqual([]);
});

test('invite link: a cancelled invite says so and offers the login, no password form', async ({ page }) => {
  await page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    if (route.request().url().includes('/functions/v1/accept-invite')) {
      return json(route, { ok: false, code: 'canceled', email: 'old@example.com', error: 'This invite was cancelled. Ask Miguel to send you a new one if you still need access.' });
    }
    return json(route, []);
  });
  await page.goto(`/?accept=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginTitle')).toHaveText('This invite link is no longer active', { timeout: 10000 });
  expect(await page.textContent('#loginCopy')).toContain('This invite was cancelled');
  await expect(page.locator('#passwordFlowBox')).toBeHidden();
  await page.click('#forgotPasswordButton'); // «Back to login»
  await expect(page.locator('#loginPrimaryButton')).toHaveText('Log in');
});

test('invite link: a malformed token never calls the server and shows the normal login', async ({ page }) => {
  let called = false;
  await page.route(/supabase\.co\/functions\/v1\/.*/, route => { called = true; return json(route, {}); });
  await page.goto('/?accept=not-a-token', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginPrimaryButton')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  expect(called).toBe(false);
});

test('team access: teamMemberStatus and every role in the form has a one-line hint', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const out = await page.evaluate(() => ({
    active: teamMemberStatus({ passwordSetAt: '2026-01-01', lastSignInAt: '2026-11-05T10:00:00Z' }),
    activeNoSignIn: teamMemberStatus({ passwordSetAt: '2026-01-01' }).detail,
    invited: teamMemberStatus({ invite: { status: 'sent', createdAt: '2026-11-02T10:00:00Z' } }).key,
    acceptedInviteNoPassword: teamMemberStatus({ invite: { status: 'accepted' } }).key,
    cancelledInvite: teamMemberStatus({ invite: { status: 'canceled' } }).key,
    passwordWins: teamMemberStatus({ passwordSetAt: '2026-01-01', invite: { status: 'sent' } }).key,
    missingHints: [...document.querySelectorAll('#accessRole option')].map(o => o.value).filter(v => !roleHintText(v)),
    roundTrip: [...document.querySelectorAll('#accessRole option')].map(o => o.value).filter(v => platformRoleToLabel(roleLabelToPlatformRole(v)) !== v),
  }));
  expect(out.active).toEqual({ key: 'active', badge: 'Active', tone: 'green', detail: 'Last sign-in 5 Nov' });
  expect(out.activeNoSignIn).toBe('No sign-in yet');
  expect(out.invited).toBe('invited');
  expect(out.acceptedInviteNoPassword).toBe('never');
  expect(out.cancelledInvite).toBe('never');
  expect(out.passwordWins).toBe('active');
  expect(out.missingHints).toEqual([]);
  expect(out.roundTrip).toEqual([]);
});

test('invite server rules (supabase/functions/_shared/invite.ts): open until the password, our hosts only, one email', () => {
  const mod = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'invite.ts');
  const script = `
    globalThis.Deno = { env: { get: () => undefined } };
    const m = await import(${JSON.stringify('file://' + mod)});
    const day = 864e5, now = Date.parse('2026-11-06T12:00:00Z');
    const out = {
      open: m.inviteState({ status: 'sent', expires_at: new Date(now + day).toISOString() }, null, now),
      openNoProfile: m.inviteState({ status: 'pending' }, { password_set_at: null }, now),
      acceptedButNoPassword: m.inviteState({ status: 'accepted', expires_at: '2026-11-09T00:00:00Z' }, { password_set_at: null }, now),
      alreadySet: m.inviteState({ status: 'sent' }, { password_set_at: '2026-11-01' }, now),
      canceled: m.inviteState({ status: 'canceled' }, null, now),
      expired: m.inviteState({ status: 'sent', expires_at: new Date(now - day).toISOString() }, null, now),
      days: Math.round((Date.parse(m.inviteExpiry(now)) - now) / day),
      base: [m.inviteSiteBase('https://gotadaguasurf.vercel.app/?invite=1&email=x'), m.inviteSiteBase('https://evil.example.com/'), m.inviteSiteBase('http://gotadaguasurf.vercel.app/'), m.inviteSiteBase('http://127.0.0.1:8788/x')],
      link: m.acceptLink('https://gotadaguasurf.vercel.app/', '${TOKEN}'),
      uuid: [m.isUuid('${TOKEN}'), m.isUuid('x'), m.isUuid("' or 1=1")],
      mail: m.inviteEmailContent({ fullName: 'Francisco Guimarães', invitedBy: 'Miguel', link: 'https://gotadaguasurf.vercel.app/?accept=${TOKEN}' }),
    };
    console.log(JSON.stringify(out));`;
  const raw = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], { encoding: 'utf8' });
  const out = JSON.parse(raw.trim().split('\n').pop());
  expect([out.open, out.openNoProfile, out.acceptedButNoPassword]).toEqual(['open', 'open', 'open']);
  expect(out.alreadySet).toBe('already_set');
  expect(out.canceled).toBe('canceled');
  expect(out.expired).toBe('expired');
  expect(out.days).toBe(60);
  expect(out.base).toEqual(['https://gotadaguasurf.vercel.app/', 'https://gotadaguasurf.vercel.app/', 'https://gotadaguasurf.vercel.app/', 'http://127.0.0.1:8788/']);
  expect(out.link).toBe(`https://gotadaguasurf.vercel.app/?accept=${TOKEN}`);
  expect(out.uuid).toEqual([true, false, false]);
  expect(out.mail.subject).toBe('Your Gota Dagua access — create your password');
  expect(out.mail.text).toContain('Hi Francisco,');
  expect(out.mail.text).toContain(`?accept=${TOKEN}`);
  expect(out.mail.text).toContain('keeps working until you create your password');
  expect(out.mail.html).toContain('Create password');
  expect(out.mail.text + out.mail.html).not.toMatch(/expira|expires in|24 h|7 dias|d'Água|d&#39;Água/);
});

// ── Forgot password (7 Nov 2026): the reset link goes out through our Gmail
//    (send-password-reset) because Supabase's mailer only reaches team members.
async function openForgot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('#forgotPasswordButton');
  await page.fill('#loginEmail', 'Staff@Example.com');
  await page.click('#loginPrimaryButton');
}

test('forgot password: sends through send-password-reset (Gmail), not the Supabase mailer', async ({ page }) => {
  const calls = [];
  await page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    const url = route.request().url();
    if (url.includes('/functions/v1/send-password-reset')) { calls.push({ fn: JSON.parse(route.request().postData() || '{}') }); return json(route, { ok: true }); }
    if (url.includes('/auth/v1/recover')) { calls.push({ recover: true }); return json(route, {}); }
    return json(route, []);
  });
  await openForgot(page);
  await expect(page.locator('#authMessageBox')).toContainText('staff@example.com', { timeout: 10000 });
  expect(calls.length).toBe(1);
  expect(calls[0].fn.email).toBe('staff@example.com');
  expect(calls[0].fn.redirectTo).toMatch(/\?reset=1$/);
});

test('forgot password: if the function is not there, falls back to the Supabase email', async ({ page }) => {
  const calls = [];
  await page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    const url = route.request().url();
    if (url.includes('/functions/v1/send-password-reset')) { calls.push('fn'); return json(route, { error: 'not found' }, 404); }
    if (url.includes('/auth/v1/recover')) { calls.push('recover'); return json(route, {}); }
    return json(route, []);
  });
  await openForgot(page);
  await expect(page.locator('#authMessageBox')).toContainText('staff@example.com', { timeout: 10000 });
  expect(calls).toEqual(['fn', 'recover']);
});

test('forgot password: too many requests shows the message and does not fall back', async ({ page }) => {
  const calls = [];
  await page.route(/supabase\.co\/(auth|rest|functions)\/v1\/.*/, async route => {
    const url = route.request().url();
    if (url.includes('/functions/v1/send-password-reset')) { calls.push('fn'); return json(route, { ok: false, error: 'Too many reset emails — wait a few minutes and try again.' }, 429); }
    if (url.includes('/auth/v1/recover')) { calls.push('recover'); return json(route, {}); }
    return json(route, []);
  });
  await openForgot(page);
  await expect(page.locator('body')).toContainText('Too many reset emails', { timeout: 10000 });
  expect(calls).toEqual(['fn']);
});
