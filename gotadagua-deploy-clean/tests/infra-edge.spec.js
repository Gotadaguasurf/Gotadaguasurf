// Edge Functions of the security / automation wave (audit 18 Nov 2026), run in Node against a fake database —
// no browser, no network, no Deno (tests/edge-loader.js inlines the _shared modules).
//
//   parse-invoice         a team login is needed, not the public key (SEC-03) — staged behind ENFORCE_CALLER_CHECKS
//   daily-backup          the cron, the backup secret or an HQ login (SEC-03, AUT-13); one automation_runs line (AUT-09)
//   create-platform-invite  the Settings rule on the server (SA-03 / SEC-10) — staged behind ENFORCE_INVITE_RULES
//   remove-platform-user  Miguel only, never an Owner (SEC-11)
//   accept-invite rule    an «accepted» invite with no account behind it is closed (SEC-20)
//   gmail-oauth           echoes text, never HTML; needs the expected mailbox (SEC-20)
//   mail-ingest           a CV is never sent to the reader (AUT-07); the reader gets the live categories (AUT-16)
//   hq-weekly-digest      a partner commission already inside the booking is not spend again (SEAM-13)
//   drive-sync, run-month-end  switched off unless their own flag says so (AUT-08 / SEAM-19)
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const { stripTypeScriptTypes } = require('node:module');
const { loadEdge, loadModule, fakeJwt } = require('./edge-loader');
test.skip(typeof stripTypeScriptTypes !== 'function', 'needs Node 22.13+ (node:module stripTypeScriptTypes)');

// ── a small PostgREST-like fake ─────────────────────────────────────────────
function fakeDb(seed = {}, { missing = [] } = {}) {
  let seq = 0;
  const T = { ...seed };
  const calls = [];
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select(_c, o) { if (this.op === 'select') this.head = o; else this.returning = true; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; } neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; } in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    gte(k, v) { this.f.push(r => r[k] != null && String(r[k]) >= v); return this; } lt(k, v) { this.f.push(r => r[k] != null && String(r[k]) < v); return this; }
    or() { return this; } order() { return this; } limit(n) { this.lim = n; return this; } range(a, b) { this.rng = [a, b]; return this; }
    insert(o) { this.op = 'insert'; this.payload = o; return this; } update(o) { this.op = 'update'; this.payload = o; return this; }
    upsert(o) { this.op = 'upsert'; this.payload = o; return this; } delete() { this.op = 'delete'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; } single() { this.one = 'single'; return this; }
    then(ok, no) { try { ok(this.exec()); } catch (e) { no(e); } }
    exec() {
      calls.push({ t: this.t, op: this.op, payload: this.payload });
      if (missing.includes(this.t)) return { data: null, count: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.t}' in the schema cache` } };
      const rows = T[this.t] || (T[this.t] = []);
      const add = o => { const r = { id: 'id' + (++seq), ...o }; rows.push(r); return r; };
      if (this.op === 'insert' || this.op === 'upsert') { const out = [].concat(this.payload).map(add); return { data: this.one ? out[0] : out, error: null }; }
      let out = rows.filter(r => this.f.every(f => f(r)));
      if (this.op === 'update') { out.forEach(r => Object.assign(r, this.payload)); return { data: out, error: null }; }
      if (this.op === 'delete') { T[this.t] = rows.filter(r => !out.includes(r)); return { data: out, error: null }; }
      if (this.head && this.head.head) return { data: null, count: out.length, error: null };
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
      if (this.one) return { data: out[0] ? { ...out[0] } : null, error: this.one === 'single' && !out[0] ? { message: 'no rows' } : null };
      return { data: out.map(r => ({ ...r })), error: null };
    }
  }
  const files = {};
  const storage = { from: (b) => ({
    upload: async (p, blob) => { files[`${b}/${p}`] = blob; return { error: null }; },
    list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }),
  }) };
  const deleted = [];
  const auth = { admin: { deleteUser: async (id) => { deleted.push(id); return { error: null }; }, createUser: async () => ({ data: { user: { id: 'new-user' } }, error: null }) } };
  return { T, calls, files, deleted, from: t => new Q(t), storage, auth, rpc: async () => ({ data: null, error: null }) };
}

// users: { '<jwt>': { id, email, hq } }. The service key gets the fake database; any other key a user client.
function clientFactory(db, users = {}) {
  return (_url, key, opts) => {
    if (key === 'service-key') return db;
    const fromHeader = String(opts?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    return {
      auth: { getUser: async (jwt) => { const u = users[jwt || fromHeader]; return { data: { user: u ? { id: u.id, email: u.email } : null }, error: u ? null : { message: 'bad jwt' } }; } },
      rpc: async (fn) => { const u = users[fromHeader]; return { data: !!u && fn === 'is_hq_member' && !!u.hq, error: null }; },
    };
  };
}
const ANON = fakeJwt({ role: 'anon' });
const team = () => ({ platform_profiles: [{ id: 'u-camp', email: 'manager@example.com', platform_role: 'location_manager', active: true }, { id: 'u-out', email: 'gone@example.com', platform_role: 'viewer', active: false }],
  workspace_memberships: [{ id: 'm1', user_id: 'u-camp', workspace_id: 'ws-pt', active: true }] });
const USERS = { 'jwt-camp': { id: 'u-camp', email: 'manager@example.com' }, 'jwt-out': { id: 'u-out', email: 'gone@example.com' } };

// ── parse-invoice (SEC-03, AUT-16) ──────────────────────────────────────────
function anthropic(seen) {
  return async (url, init) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      seen.push(JSON.parse(init.body));
      return Response.json({ content: [{ text: JSON.stringify({ doc_type: 'invoice', amount: '12.30', invoice_date: '2026-11-10', company: 'bakery', category_hint: 'Food' }) }], usage: {} });
    }
    throw new Error('unexpected fetch ' + url);
  };
}
const pdf = { file_base64: Buffer.from('%PDF-1.4 test').toString('base64'), filename: 'invoice.pdf' };

test('parse-invoice: until the flag the public key still works (logged); with it only a team login reads an invoice', async () => {
  const seen = []; const db = fakeDb({ ...team(), hq_invoice_categories: [{ name: 'Food', active: true }, { name: 'Wild · DJs', active: true }, { name: 'Miguel - Personal', active: true }] });
  const staged = loadEdge('parse-invoice', { env: { ANTHROPIC_API_KEY: 'k' }, createClient: clientFactory(db, USERS), fetch: anthropic(seen) });
  const r0 = await staged.call({ headers: { Authorization: `Bearer ${ANON}` }, body: pdf });
  expect(r0.status).toBe(200);
  expect(staged.logs.join('\n')).toContain('would refuse');

  const on = loadEdge('parse-invoice', { env: { ANTHROPIC_API_KEY: 'k', ENFORCE_CALLER_CHECKS: 'true' }, createClient: clientFactory(db, USERS), fetch: anthropic(seen) });
  const before = seen.length;
  expect((await on.call({ headers: { Authorization: `Bearer ${ANON}` }, body: pdf })).status).toBe(401);
  expect((await on.call({ headers: { Authorization: 'Bearer jwt-out' }, body: pdf })).status).toBe(401);      // inactive account
  expect(seen.length).toBe(before);                                                                           // the reader was never called
  const ok = await on.call({ headers: { Authorization: 'Bearer jwt-camp' }, body: pdf });                      // a camp manager (no HQ)
  expect(ok.status).toBe(200);
  expect(ok.body.extracted).toMatchObject({ amount: 12.3, company: 'bakery' });
  // the reader is offered the app's live categories, never a personal one
  const prompt = seen.at(-1).messages[0].content[1].text;
  expect(prompt).toContain('best guess from: Food, Wild · DJs"');
  expect(prompt).not.toContain('Personal');
});

// ── daily-backup (SEC-03, AUT-13, AUT-09) ──────────────────────────────────
test('daily-backup: the cron key, the backup secret and an HQ login run it; the anon key does not once enforced; each run leaves one automation_runs line', async () => {
  const mk = (env) => { const db = fakeDb({ bookings: [{ id: 'b1' }, { id: 'b2' }] }); return { db, fn: loadEdge('daily-backup', { env, createClient: clientFactory(db, { 'jwt-hq': { id: 'u-hq', email: 'hq@example.com', hq: true }, ...USERS }), fetch: async () => new Response('', { status: 401 }) }) }; };
  // staged: the anon key still runs it, with a log line
  const s = mk({});
  expect((await s.fn.call({ headers: { Authorization: `Bearer ${ANON}` } })).status).toBe(200);
  expect(s.fn.logs.join('\n')).toContain('daily-backup: would refuse');
  // enforced
  const on = { ENFORCE_CALLER_CHECKS: 'true', BACKUP_CRON_SECRET: 'b-secret' };
  let t = mk(on);
  const refused = await t.fn.call({ headers: { Authorization: `Bearer ${ANON}` } });
  expect(refused.status).toBe(401);
  expect(Object.keys(t.db.files)).toHaveLength(0);
  expect((await t.fn.call({ headers: { Authorization: 'Bearer jwt-camp' } })).status).toBe(401);             // a login without HQ
  t = mk(on); const cron = await t.fn.call({ headers: { Authorization: 'Bearer service-key' } });            // what job 4 sends today
  expect(cron.status).toBe(200);
  expect(cron.body.tables.bookings).toMatchObject({ rows: 2, expected: 2, complete: true });
  expect(t.db.files['backups/daily/' + new Date().toISOString().slice(0, 10) + '/bookings.json.gz']).toBeTruthy();
  expect(t.db.T.automation_runs).toHaveLength(1);
  expect(t.db.T.automation_runs[0]).toMatchObject({ job: 'daily-backup', ok: true });
  t = mk(on); expect((await t.fn.call({ headers: { Authorization: `Bearer ${ANON}`, 'x-backup-secret': 'b-secret' } })).status).toBe(200);
  t = mk(on); expect((await t.fn.call({ headers: { Authorization: 'Bearer jwt-hq' } })).status).toBe(200);
});

test('daily-backup: before the SQL is run (no automation_runs table) the backup still finishes', async () => {
  const db = fakeDb({}, { missing: ['automation_runs'] });
  const fn = loadEdge('daily-backup', { createClient: clientFactory(db), fetch: async () => new Response('', { status: 401 }) });
  const r = await fn.call({ headers: { Authorization: 'Bearer service-key' } });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
});

// ── create-platform-invite (SA-03 / SEC-10) ────────────────────────────────
test('invite rule: the same answers as the Settings form', async () => {
  const { inviteRuleProblem } = loadModule('_shared/invite.ts');
  const base = { callerRole: 'owner', callerEmail: 'manager@example.com', targetEmail: 'new@example.com', role: 'viewer', requestedSlugs: ['portugal'], heldSlugs: [], targetRole: null };
  expect(inviteRuleProblem(base)).toBe('');
  expect(inviteRuleProblem({ ...base, requestedSlugs: ['hq', 'portugal'] })).toBe('Only Miguel can give HQ (owner view) access.');
  expect(inviteRuleProblem({ ...base, requestedSlugs: ['settings'] })).toBe('Only Miguel can give Settings access.');
  expect(inviteRuleProblem({ ...base, requestedSlugs: ['hq'], heldSlugs: ['hq'] })).toBe('');                // a resend keeps what they hold
  expect(inviteRuleProblem({ ...base, role: 'owner' })).toBe('Only Miguel can make someone Owner.');
  expect(inviteRuleProblem({ ...base, role: 'admin', targetRole: 'admin' })).toBe('');
  expect(inviteRuleProblem({ ...base, targetEmail: 'Manager@example.com' })).toBe("You can't change your own access here — ask Miguel.");
  expect(inviteRuleProblem({ ...base, role: 'god' })).toContain('Unknown role');
  expect(inviteRuleProblem({ ...base, callerRole: 'super_admin', role: 'owner', requestedSlugs: ['hq', 'settings'] })).toBe('');
  expect(inviteRuleProblem({ ...base, callerRole: 'admin', callerEmail: 'miguel@gotadaguasurf.com', requestedSlugs: ['hq'] })).toBe('');
});

test('create-platform-invite: a manager giving HQ is refused once ENFORCE_INVITE_RULES is on, and only logged before', async () => {
  const seed = () => ({
    platform_profiles: [{ id: 'u-mgr', email: 'manager@example.com', full_name: 'Manager', platform_role: 'owner', active: true },
      { id: 'u-tgt', email: 'staff@example.com', platform_role: 'viewer', active: true, password_set_at: '2026-10-01T00:00:00Z' }],
    workspaces: [{ id: 'ws-hq', slug: 'hq' }, { id: 'ws-pt', slug: 'portugal' }],
    workspace_memberships: [{ id: 'm1', user_id: 'u-tgt', workspace_id: 'ws-pt', active: true }],
    workspace_invitations: [],
  });
  const body = { email: 'staff@example.com', fullName: 'Staff', role: 'viewer', accessRows: [{ workspace_id: 'ws-hq' }, { workspace_id: 'ws-pt' }] };
  const users = { 'jwt-mgr': { id: 'u-mgr', email: 'manager@example.com' } };

  let db = fakeDb(seed());
  const on = loadEdge('create-platform-invite', { env: { ENFORCE_INVITE_RULES: 'true' }, createClient: clientFactory(db, users) });
  const r = await on.call({ headers: { Authorization: 'Bearer jwt-mgr' }, body });
  expect(r.status).toBe(403);
  expect(r.body.error).toBe('Only Miguel can give HQ (owner view) access.');
  expect(db.calls.filter(c => c.op !== 'select')).toHaveLength(0);                                            // nothing written

  db = fakeDb(seed());
  const staged = loadEdge('create-platform-invite', { createClient: clientFactory(db, users) });
  const s = await staged.call({ headers: { Authorization: 'Bearer jwt-mgr' }, body });
  expect(s.body).toMatchObject({ ok: true, already_active: true });                                          // today's behaviour, unchanged
  expect(staged.logs.join('\n')).toContain('would refuse (Only Miguel can give HQ (owner view) access.)');
});

// ── remove-platform-user (SEC-11) ──────────────────────────────────────────
test('remove-platform-user: only Miguel, and never on an Owner', async () => {
  const seed = () => ({ platform_profiles: [
    { id: 'u-own', email: 'owner@example.com', platform_role: 'owner', active: true },
    { id: 'u-mig', email: 'boss@example.com', platform_role: 'super_admin', active: true },
    { id: 'u-v', email: 'viewer@example.com', platform_role: 'viewer', active: true }], workspace_invitations: [] });
  const users = { 'jwt-own': { id: 'u-own', email: 'owner@example.com' }, 'jwt-mig': { id: 'u-mig', email: 'boss@example.com' } };
  let db = fakeDb(seed());
  let fn = loadEdge('remove-platform-user', { createClient: clientFactory(db, users) });
  expect((await fn.call({ headers: { Authorization: 'Bearer jwt-own' }, body: { targetUserId: 'u-v' } })).status).toBe(403);
  expect((await fn.call({ headers: { Authorization: 'Bearer jwt-mig' }, body: { targetUserId: 'u-own' } })).status).toBe(403);
  expect(db.deleted).toHaveLength(0);
  const ok = await fn.call({ headers: { Authorization: 'Bearer jwt-mig' }, body: { targetUserId: 'u-v' } });
  expect(ok.body).toEqual({ ok: true });
  expect(db.deleted).toEqual(['u-v']);
});

// ── accept-invite rule (SEC-20) ────────────────────────────────────────────
test('invite state: an «accepted» invite with no account behind it no longer opens', async () => {
  const { inviteState } = loadModule('_shared/invite.ts');
  const future = new Date(Date.now() + 86400e3).toISOString(), past = '2026-05-09T00:00:00Z';
  expect(inviteState({ status: 'accepted', expires_at: past }, null)).toBe('canceled');                   // the May 2026 leftover
  expect(inviteState({ status: 'accepted', expires_at: past }, { password_set_at: null })).toBe('open');  // the 6 Nov decision stays
  expect(inviteState({ status: 'sent', expires_at: future }, null)).toBe('open');
  expect(inviteState({ status: 'sent', expires_at: past }, null)).toBe('expired');
});

// ── gmail-oauth (SEC-20) ───────────────────────────────────────────────────
test('gmail-oauth: what Google sends back is shown as text; without SHARED_GMAIL_ADDRESS nothing is connected; «Return» only to our site', async () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's' };
  const base = 'https://db.example/functions/v1/gmail-oauth/callback';
  let fn = loadEdge('gmail-oauth', { env: { ...env, SHARED_GMAIL_ADDRESS: 'groups@example.org' }, createClient: clientFactory(fakeDb()) });
  const r = await fn.call({ method: 'GET', url: `${base}?error=${encodeURIComponent('<img src=x onerror=alert(1)>')}` });
  expect(r.status).toBe(400);
  expect(r.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(r.text).not.toContain('<img');

  let tokenCalls = 0;
  fn = loadEdge('gmail-oauth', { env, createClient: clientFactory(fakeDb()), fetch: async () => { tokenCalls++; return Response.json({}); } });
  const unset = await fn.call({ method: 'GET', url: `${base}?code=abc` });
  expect(unset.status).toBe(500);
  expect(unset.text).toContain('SHARED_GMAIL_ADDRESS');
  expect(tokenCalls).toBe(0);

  const db = fakeDb();
  const google = async (url) => String(url).includes('/token') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json({ emailAddress: 'groups@example.org' });
  fn = loadEdge('gmail-oauth', { env: { ...env, SHARED_GMAIL_ADDRESS: 'groups@example.org' }, createClient: clientFactory(db), fetch: google });
  const bad = await fn.call({ method: 'GET', url: `${base}?code=abc&state=${encodeURIComponent('javascript:alert(1)')}` });
  expect(bad.status).toBe(200);
  expect(bad.text).not.toContain('javascript:');
  const good = await fn.call({ method: 'GET', url: `${base}?code=abc&state=${encodeURIComponent('https://gotadaguasurf.vercel.app/crm/')}` });
  expect(good.text).toContain('href="https://gotadaguasurf.vercel.app/crm/"');
});

// ── mail-ingest (AUT-07) ───────────────────────────────────────────────────
test('mail-ingest: a CV, cover letter or catalogue is not sent to the reader; anything named invoice still is', async () => {
  const { notAnInvoiceByName } = loadModule('mail-ingest/route.ts');
  for (const n of ['CV_Joana_Silva.pdf', 'Curriculum Vitae - Tom.pdf', 'Resume 2026.pdf', 'résumé.pdf', 'Cover letter.pdf', 'Catálogo 2027.pdf', 'portfolio-surf.pdf', 'Carta de apresentação.pdf'])
    expect(notAnInvoiceByName(n), n).toBe(true);
  for (const n of ['FT 2026-123.pdf', 'Fatura CV-2026-7.pdf', 'invoice-catalogue-printing.pdf', 'Recibo.pdf', 'MyCV-supplies.pdf', 'scan0001.pdf', 'EDP_Nov.pdf'])
    expect(notAnInvoiceByName(n), n).toBe(false);
});

// ── hq-weekly-digest (SEAM-13, HQ-21) ──────────────────────────────────────
test('weekly digest: a partner commission already inside the booking and personal spending are not spend', async () => {
  const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); t.setUTCDate(t.getUTCDate() - ((dow === 0 ? 6 : dow - 1) + 7) + 2);            // a Wednesday of last week
  const day = t.toISOString().slice(0, 10);
  const line = (o) => ({ is_duplicate: false, deleted_at: null, paying_company: 'water-movements', invoice_date: day, location_slug: 'portugal', ...o });
  const db = fakeDb({
    hq_invoice_categories: [{ name: 'Food', is_personal: false }, { name: 'Partners', is_personal: false }, { name: 'Miguel - Personal', is_personal: true }],
    hq_invoices: [line({ company: 'bakery', category_name: 'Food', amount_eur: 100 }),
      line({ company: 'agency-a', category_name: 'Partners', amount_eur: 4321, commission_in_booking: null }),           // 2026 Partners: inside the booking
      line({ company: 'agency-b', category_name: 'Partners', amount_eur: 50, commission_in_booking: false }),            // marked as a real cost
      line({ company: 'shop', category_name: 'Miguel - Personal', amount_eur: 999 })],
    bookings: [], internal_transfers: [], hq_recurring_expenses: [],
  });
  const fn = loadEdge('hq-weekly-digest', { createClient: clientFactory(db) });
  const r = await fn.call({ method: 'GET', url: 'https://db.example/functions/v1/hq-weekly-digest?preview=1', headers: { Authorization: 'Bearer service-key' } });
  expect(r.status).toBe(200);
  expect(r.text).toContain('bakery');
  expect(r.text).toContain('agency-b');
  expect(r.text).not.toContain('agency-a');
  expect(r.text).not.toContain('€4,321');
  expect(r.text).not.toContain('shop');
  expect(r.text).toContain('€150');
});

// ── dormant crons (AUT-08 / SEAM-19) ───────────────────────────────────────
test('drive-sync and run-month-end do nothing unless their own flag is on, even with the right secret', async () => {
  let db = fakeDb();
  let fn = loadEdge('drive-sync', { env: { DRIVE_SYNC_SECRET: 's', GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 'x', ANTHROPIC_API_KEY: 'k' }, createClient: clientFactory(db) });
  let r = await fn.call({ headers: { 'x-drive-sync-secret': 's' }, body: {} });
  expect(r.body).toMatchObject({ ok: false, disabled: true });
  expect(db.calls.filter(c => c.op !== 'select')).toHaveLength(0);
  expect((await fn.call({ headers: { 'x-drive-sync-secret': 'wrong' }, body: {} })).status).toBe(401);

  db = fakeDb({ monthly_cost_profiles: [{ id: 'p1', name: 'Salary', auto_apply: true, active: true }] });
  fn = loadEdge('run-month-end', { env: { MONTH_END_SECRET: 'm' }, createClient: clientFactory(db) });
  r = await fn.call({ headers: { 'x-month-end-secret': 'm' }, body: {} });
  expect(r.body).toMatchObject({ ok: false, disabled: true });
  expect(db.calls.filter(c => c.op !== 'select')).toHaveLength(0);
});

// ── every function says who may call it (SEC-19, SEC-18) ───────────────────
test('every Edge Function has a caller check, or is public by design and says why', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'functions');
  const PUBLIC = { 'accept-invite': 'the invitee has no login yet; the invitation token is the proof',
    'send-password-reset': 'the person is logged out; answers the same for any address', 'gmail-oauth': 'Google consent; only the SHARED_GMAIL_ADDRESS mailbox is stored' };
  const CHECK = /getUser|isServiceKey|userOf|x-[a-z-]+-secret|CRON_SECRET|SYNC_SECRET|MAIL_INGEST_SECRET|MONTH_END_SECRET|SERVICE_KEY/;
  const missing = [];
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name, 'index.ts');
    if (name.startsWith('_') || !fs.existsSync(f)) continue;
    if (PUBLIC[name]) continue;
    if (!CHECK.test(fs.readFileSync(f, 'utf8'))) missing.push(name);
  }
  expect(missing).toEqual([]);
});
