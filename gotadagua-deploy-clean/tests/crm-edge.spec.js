// The two CRM Edge Functions, run in Node against a fake database and a fake Gmail — no browser, no network
// (audit 18 Nov 2026: crm-03, crm-04, crm-05 / SEC-04, crm-06).
//
//   gmail-sync      remembers what it already looked at, downloads 5 at a time, logs a bounce once
//   email-dispatch  one email per address; Google's 429 still pauses the campaign and leaves the marker the CRM reads
//   both            answer anyone until ENFORCE_CRON_SECRET=true, then only the shared secret (or a CRM login for the sync)
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');
// Node 22.13+ strips TypeScript; on an older Node these tests cannot load the functions.
test.skip(typeof stripTypeScriptTypes !== 'function', 'needs Node 22.13+ (node:module stripTypeScriptTypes)');

// ── a small PostgREST-like fake ─────────────────────────────────────────────
function fakeDb(seed = {}, { missing = [] } = {}) {
  let seq = 0;
  const T = { gmail_account: [{ id: 'acc', email: 'groups@example.org', access_token: 'tok', access_expires_at: new Date(Date.now() + 3600e3).toISOString(), refresh_token: 'r' }],
    outreach_contacts: [], contacts: [], team_users: [{ email: 'sales@gota.example' }], email_messages: [], email_suppression: [], email_queue: [], email_campaigns: [],
    outreach_activity: [], outreach_sequence_runs: [], gmail_sync_seen: [], ...seed };
  const UNIQUE = { email_suppression: 'email', gmail_sync_seen: 'provider_msg_id', email_messages: 'provider_msg_id' };
  const like = (pat, ci) => new RegExp('^' + String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : '');
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select(_c, o) { if (this.op === 'select') this.head = o; else this.returning = true; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; } neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    gte(k, v) { this.f.push(r => r[k] != null && String(r[k]) >= v); return this; } lt(k, v) { this.f.push(r => r[k] != null && String(r[k]) < v); return this; }
    like(k, p) { this.f.push(r => r[k] != null && like(p).test(r[k])); return this; } ilike(k, p) { this.f.push(r => r[k] != null && like(p, true).test(r[k])); return this; }
    order(k, o) { this.ord = this.ord || [k, !!(o && o.ascending === false)]; return this; } limit(n) { this.lim = n; return this; } range(a, b) { this.rng = [a, b]; return this; }
    insert(o) { this.op = 'insert'; this.payload = o; return this; } update(o) { this.op = 'update'; this.payload = o; return this; } delete() { this.op = 'delete'; return this; }
    upsert(o, opt) { this.op = 'upsert'; this.payload = o; this.opt = opt || {}; return this; }
    maybeSingle() { this.one = 'maybe'; return this; } single() { this.one = 'single'; return this; }
    then(ok, no) { try { ok(this.exec()); } catch (e) { no(e); } }
    exec() {
      if (missing.includes(this.t)) return { data: null, count: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.t}' in the schema cache` } };
      const rows = T[this.t] || (T[this.t] = []);
      const add = o => { const r = { id: 'id' + (++seq), created_at: new Date().toISOString(), ...o }; rows.push(r); return r; };
      if (this.op === 'insert') { const out = [].concat(this.payload).map(add); return { data: this.one ? out[0] : out, error: null }; }
      if (this.op === 'upsert') {
        const key = this.opt.onConflict || UNIQUE[this.t]; const out = [];
        for (const o of [].concat(this.payload)) {
          const v = this.t === 'email_suppression' ? String(o.email).trim().toLowerCase() : o[key];      // the table's lowercase trigger
          const hit = rows.find(r => r[key] === v);
          if (hit) { if (!this.opt.ignoreDuplicates) Object.assign(hit, o); continue; }
          out.push(add({ ...o, [key]: v }));
        }
        return { data: this.returning ? out : null, error: null };                                        // with ignoreDuplicates only inserted rows come back
      }
      let out = rows.filter(r => this.f.every(f => f(r)));
      if (this.op === 'update') { out.forEach(r => Object.assign(r, this.payload)); return { data: out, error: null }; }
      if (this.op === 'delete') { T[this.t] = rows.filter(r => !out.includes(r)); return { data: out, error: null }; }
      if (this.head && this.head.head) return { data: null, count: out.length, error: null };
      if (this.ord) { const [k, desc] = this.ord; out = out.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (desc ? -1 : 1)); }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      out = out.slice(0, Math.min(this.lim ?? 1000, 1000));                                               // PostgREST's page cap
      if (this.one) return { data: out[0] ? { ...out[0] } : null, error: this.one === 'single' && !out[0] ? { message: 'no rows' } : null };
      return { data: out.map(r => ({ ...r })), error: null };
    }
  }
  return { T, from: t => new Q(t) };
}

// ── load an Edge Function's index.ts as Deno would, with everything outside it faked ──
// env: the function's secrets · db: fakeDb() · gmail: (url, init) => Response · users: { '<jwt>': { email, hq, crm } }
function loadFunction(name, { env = {}, db, gmail, users = {} }) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', name, 'index.ts'), 'utf8');
  src = src.split('\n').filter(l => !/^import .* from ['"]/.test(l)).join('\n');                         // createClient, buildRaw, buildEmailHtml come from the sandbox
  const js = stripTypeScriptTypes(src);
  let handler = null;
  const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ...env };
  const createClient = (_url, key, opts) => {
    if (key === 'service-key') return db;
    const jwt = String(opts?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const u = users[jwt];
    return { auth: { getUser: async () => ({ data: { user: u ? { id: 'u1', email: u.email } : null }, error: u ? null : { message: 'bad jwt' } }) },
      rpc: async fn => ({ data: !!u && (fn === 'is_hq_member' ? !!u.hq : !!u.crm), error: null }) };
  };
  const sandbox = { Deno: { env: { get: k => ENV[k] }, serve: h => { handler = h; } }, createClient, fetch: gmail,
    buildRaw: a => `raw:${a.to}`, buildEmailHtml: () => '<p></p>',
    setTimeout: fn => { fn(); return 0; },                                                                // the dispatcher waits 20–50 s between sends
    console: { log() {}, warn() {}, error() {} }, Response, Request, URL, URLSearchParams, Headers, Intl, Date, Math, JSON, Promise, atob, escape, decodeURIComponent, encodeURIComponent };
  vm.runInNewContext(js, sandbox, { filename: `${name}/index.ts` });
  return (url = `https://db.example/functions/v1/${name}`, headers = {}) => handler(new Request(url, { method: 'POST', headers })).then(async r => ({ status: r.status, body: await r.json() }));
}

// ── a fake Gmail mailbox ────────────────────────────────────────────────────
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mail = (id, from, subject, over = {}) => ({ id, threadId: over.threadId || 'th-' + id, labelIds: over.sent ? ['SENT'] : ['INBOX'], internalDate: String(over.at || Date.now()),
  snippet: 'hello', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: over.to || 'groups@example.org' }, { name: 'Subject', value: subject }, { name: 'Date', value: new Date(over.at || Date.now()).toUTCString() }], body: { data: b64(over.body || 'Hello there') } } });
function fakeGmail(messages, { throttleAfter = Infinity, sendStatus = 200 } = {}) {
  const byId = new Map(messages.map(m => [m.id, m]));
  const st = { gets: [], lists: [], sends: [], inFlight: 0, maxInFlight: 0 };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'groups@example.org' });
    if (u.pathname.endsWith('/messages/send')) {
      st.sends.push(JSON.parse(init.body).raw);
      if (sendStatus !== 200) return new Response(JSON.stringify({ error: { code: sendStatus, message: 'Too many concurrent requests for user.' } }), { status: sendStatus });
      return Response.json({ id: 'sent-' + st.sends.length, threadId: 'thr-' + st.sends.length });
    }
    if (u.pathname.endsWith('/messages')) { st.lists.push(u.searchParams.get('q')); return Response.json({ messages: [...byId.keys()].map(id => ({ id })) }); }
    const id = u.pathname.split('/').pop();
    st.inFlight++; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
    await new Promise(r => setImmediate(r));
    st.inFlight--;
    if (st.gets.length >= throttleAfter) return new Response('{"error":{"code":429}}', { status: 429 });
    st.gets.push(id);
    return byId.has(id) ? Response.json(byId.get(id)) : new Response('not found', { status: 404 });
  };
  return { fetch, st, add: m => byId.set(m.id, m) };
}

const CLUB = { id: 'co-1', email: 'club@uni.example', status: 'first_email' };
// a small inbox: one real reply, three newsletters nobody in the CRM sent, one bounce of an email we sent to dead@uni.example
function inbox() {
  return [
    mail('m-reply', 'Ana <club@uni.example>', 'Re: Surf trip'),
    mail('m-news1', 'News <news@shop.example>', 'Offers'), mail('m-news2', 'Alerts <alerts@bank.example>', 'Statement'), mail('m-news3', 'noreply@tool.example', 'Your invoice'),
    mail('m-bounce', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)', { threadId: 'th-dead' }),
  ];
}
const sentToDead = { id: 'e-out', company_id: 'co-2', direction: 'outbound', to_addr: 'Dead@uni.example', thread_id: 'th-dead', provider_msg_id: 'm-out', sent_at: new Date().toISOString() };
const seedSync = () => ({ outreach_contacts: [{ ...CLUB }, { id: 'co-2', email: 'dead@uni.example', status: 'first_email' }], email_messages: [{ ...sentToDead }],
  email_queue: [{ id: 'q1', campaign_id: 'c1', to_email: 'dead@uni.example', status: 'pending' }] });

// ── gmail-sync ──────────────────────────────────────────────────────────────
test('gmail-sync: what was looked at once is not downloaded again, and a bounce is logged once (crm-03, crm-04)', async () => {
  const db = fakeDb(seedSync()); const g = fakeGmail(inbox());
  const run = loadFunction('gmail-sync', { db, gmail: g.fetch });
  const r1 = await run();
  expect(r1.body).toMatchObject({ ok: true, fetched: 5, newInbound: 1, bouncesSuppressed: 1, downloaded: 5 });
  expect(g.st.gets.sort()).toEqual(['m-bounce', 'm-news1', 'm-news2', 'm-news3', 'm-reply']);
  expect(db.T.gmail_sync_seen.map(r => r.provider_msg_id).sort()).toEqual(['m-bounce', 'm-news1', 'm-news2', 'm-news3']);
  expect(db.T.email_suppression).toHaveLength(1);
  expect(db.T.email_suppression[0]).toMatchObject({ email: 'dead@uni.example', reason: 'bounce' });
  expect(db.T.email_queue[0]).toMatchObject({ status: 'cancelled', error: 'suppressed: bounce' });
  // five more runs (25 minutes of cron): nothing is downloaded, nothing is written again
  for (let i = 0; i < 5; i++) expect((await run()).body).toMatchObject({ ok: true, fetched: 5, note: 'all already in DB' });
  expect(g.st.gets).toHaveLength(5);
  expect(db.T.outreach_activity.filter(a => a.action === 'email_bounced')).toHaveLength(1);
  expect(db.T.outreach_activity.filter(a => a.action === 'replied_marked')).toHaveLength(1);
  expect(db.T.email_messages.filter(m => m.provider_msg_id === 'm-reply')).toHaveLength(1);
});

test('gmail-sync: before the SQL is run (no gmail_sync_seen) it still works, and a bounce is still logged only once', async () => {
  const db = fakeDb(seedSync(), { missing: ['gmail_sync_seen'] }); const g = fakeGmail(inbox());
  const warm = loadFunction('gmail-sync', { db, gmail: g.fetch });
  expect((await warm()).body).toMatchObject({ ok: true, newInbound: 1, bouncesSuppressed: 1 });
  expect((await warm()).body).toMatchObject({ ok: true, note: 'all already in DB' });   // the warm instance remembers
  expect(g.st.gets).toHaveLength(5);
  // a cold start forgets: the four are downloaded again (as before the fix), but nothing is written twice
  const cold = loadFunction('gmail-sync', { db, gmail: g.fetch });
  expect((await cold()).body).toMatchObject({ ok: true, newInbound: 0, bouncesSuppressed: 0, downloaded: 4 });
  expect(g.st.gets).toHaveLength(9);
  expect(db.T.outreach_activity.filter(a => a.action === 'email_bounced')).toHaveLength(1);
  expect(db.T.email_suppression).toHaveLength(1);
});

test('gmail-sync: an address already suppressed by hand gets no bounce line', async () => {
  const seed = seedSync(); seed.email_suppression = [{ id: 's0', email: 'dead@uni.example', reason: 'manual' }];
  const db = fakeDb(seed); const g = fakeGmail(inbox());
  expect((await loadFunction('gmail-sync', { db, gmail: g.fetch })()).body).toMatchObject({ ok: true, bouncesSuppressed: 0 });
  expect(db.T.outreach_activity.filter(a => a.action === 'email_bounced')).toHaveLength(0);
  expect(db.T.email_suppression).toHaveLength(1);
});

test('gmail-sync: downloads go at most 5 at a time, and a 429 stops the run without forgetting the rest (crm-03)', async () => {
  const many = Array.from({ length: 40 }, (_, i) => mail('n' + i, `n${i}@shop${i}.example`, 'News ' + i));
  const db = fakeDb(seedSync()); const g = fakeGmail(many);
  expect((await loadFunction('gmail-sync', { db, gmail: g.fetch })()).body).toMatchObject({ ok: true, downloaded: 40 });
  expect(g.st.gets).toHaveLength(40);
  expect(g.st.maxInFlight).toBeLessThanOrEqual(5);
  expect(g.st.maxInFlight).toBeGreaterThan(1);
  // Google says «too many» after 12: stop there, remember only what was really read
  const db2 = fakeDb(seedSync()); const g2 = fakeGmail(many, { throttleAfter: 12 });
  const r = await loadFunction('gmail-sync', { db: db2, gmail: g2.fetch })();
  expect(r.body).toMatchObject({ ok: true, throttled: true });
  expect(g2.st.gets).toHaveLength(12);
  expect(db2.T.gmail_sync_seen).toHaveLength(12);
});

test('gmail-sync: a contact added after their email arrived still gets it; a young unresolved bounce is tried again', async () => {
  const late = mail('m-late', 'Rui <rui@newclub.example>', 'Hello from the club');
  const orphanBounce = mail('m-orphan', 'mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', { threadId: 'th-unknown' });
  const oldBounce = mail('m-oldorphan', 'mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', { threadId: 'th-unknown2', at: Date.now() - 3 * 86400e3 });
  const db = fakeDb(seedSync()); const g = fakeGmail([late, orphanBounce, oldBounce]);
  const run = loadFunction('gmail-sync', { db, gmail: g.fetch });
  await run();
  expect(db.T.gmail_sync_seen.map(r => [r.provider_msg_id, r.addr]).sort()).toEqual([['m-late', 'rui@newclub.example'], ['m-oldorphan', null]]);
  await run();
  expect(g.st.gets.filter(id => id === 'm-late')).toHaveLength(1);       // not downloaded again
  expect(g.st.gets.filter(id => id === 'm-oldorphan')).toHaveLength(1);  // 3 days old, original never found: left alone
  expect(g.st.gets.filter(id => id === 'm-orphan')).toHaveLength(2);     // its original may still be imported: tried again
  // the sales manager adds the club
  db.T.outreach_contacts.push({ id: 'co-9', email: 'rui@newclub.example', status: 'not_started' });
  const r = await run();
  expect(r.body).toMatchObject({ ok: true, newInbound: 1, advanced: 1 });
  expect(db.T.email_messages.find(m => m.provider_msg_id === 'm-late')).toMatchObject({ company_id: 'co-9', direction: 'inbound' });
  await run();
  expect(g.st.gets.filter(id => id === 'm-late')).toHaveLength(2);
});

test('gmail-sync: ?debug and ?days are only for the secret or a CRM login; anonymous calls still sync (crm-05 / SEC-04)', async () => {
  const users = { 'jwt-crm': { email: 'sales@gota.example', crm: true }, 'jwt-other': { email: 'bar@gota.example' } };
  const mk = env => { const db = fakeDb(seedSync()); const g = fakeGmail(inbox()); return { db, g, run: loadFunction('gmail-sync', { db, gmail: g.fetch, env, users }) }; };
  const URL_DBG = 'https://db.example/functions/v1/gmail-sync?debug=1&days=365';
  // not enforcing (today): the cron's bare call works as before…
  let x = mk({ CRM_CRON_SECRET: 's3cret' });
  let r = await x.run();
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, newInbound: 1 });
  // …but a stranger gets no sender addresses and no year-long window
  x = mk({ CRM_CRON_SECRET: 's3cret' });
  r = await x.run(URL_DBG);
  expect(r.status).toBe(200); expect(r.body.dbg).toBeUndefined(); expect(x.g.st.lists[0]).toContain('newer_than:7d');
  x = mk({});                                                              // no secret configured at all
  r = await x.run(URL_DBG, { 'x-cron-secret': '' });
  expect(r.body.dbg).toBeUndefined(); expect(x.g.st.lists[0]).toContain('newer_than:7d');
  x = mk({ CRM_CRON_SECRET: 's3cret' });
  r = await x.run(URL_DBG, { authorization: 'Bearer jwt-other' });        // logged in, but not CRM / HQ
  expect(r.body.dbg).toBeUndefined();
  // the secret, or a CRM user, gets both
  x = mk({ CRM_CRON_SECRET: 's3cret' });
  r = await x.run(URL_DBG, { 'x-cron-secret': 's3cret' });
  expect(r.body.dbg.unmatched.length).toBeGreaterThan(0); expect(x.g.st.lists[0]).toContain('newer_than:365d');
  x = mk({});
  r = await x.run(URL_DBG, { authorization: 'Bearer jwt-crm' });
  expect(r.body.dbg.accountEmail).toBe('groups@example.org');
});

test('gmail-sync: with ENFORCE_CRON_SECRET=true only the secret or a CRM / HQ login is served', async () => {
  const users = { 'jwt-crm': { email: 'sales@gota.example', crm: true }, 'jwt-hq': { email: 'owner@gota.example', hq: true }, 'jwt-other': { email: 'bar@gota.example' } };
  const mk = env => { const db = fakeDb(seedSync()); const g = fakeGmail(inbox()); return { db, g, run: loadFunction('gmail-sync', { db, gmail: g.fetch, env, users }) }; };
  const ON = { CRM_CRON_SECRET: 's3cret', ENFORCE_CRON_SECRET: 'true' };
  for (const headers of [{}, { 'x-cron-secret': 'wrong' }, { authorization: 'Bearer anon-key' }, { authorization: 'Bearer service-key' }, { authorization: 'Bearer jwt-other' }, { authorization: 'Bearer nonsense' }]) {
    const x = mk(ON); const r = await x.run(undefined, headers);
    expect(r.status, JSON.stringify(headers)).toBe(401);
    expect(x.g.st.lists).toHaveLength(0); expect(x.db.T.email_suppression).toHaveLength(0);     // nothing read, nothing written
  }
  for (const headers of [{ 'x-cron-secret': 's3cret' }, { authorization: 'Bearer jwt-crm' }, { authorization: 'Bearer jwt-hq' }]) {
    const r = await mk(ON).run(undefined, headers);
    expect(r.status, JSON.stringify(headers)).toBe(200); expect(r.body).toMatchObject({ ok: true, newInbound: 1 });
  }
  // the flag without the secret is a configuration mistake: refuse loudly rather than run open
  const r = await mk({ ENFORCE_CRON_SECRET: 'true' }).run(undefined, { authorization: 'Bearer jwt-crm' });
  expect(r.status).toBe(500); expect(r.body.error).toMatch(/CRM_CRON_SECRET is not set/);
});

// ── email-dispatch ──────────────────────────────────────────────────────────
const camp = (over = {}) => ({ id: 'c1', name: 'Follow-up · 13 Nov', status: 'running', daily_cap: 80, window_start: '00:00', window_end: '23:59', timezone: 'Europe/Lisbon',
  stop_on_reply: true, sender_user_id: null, created_by: 'sales@gota.example', created_at: '2026-11-13T09:00:00Z', ...over });
let qn = 0;
const qrow = (to, company, over = {}) => ({ id: 'q' + (++qn), campaign_id: 'c1', company_id: company, contact_id: null, to_email: to, subject: 'Surf trip', body: 'Hi', status: 'pending',
  error: null, attempts: 0, sent_at: null, created_at: new Date(Date.parse('2026-11-13T09:00:00Z') + qn * 1000).toISOString(), ...over });
const cos = n => Array.from({ length: n }, (_, i) => ({ id: 'co-' + (i + 1), status: 'not_started', last_contacted_at: null }));

test('email-dispatch: the same address on two company rows is emailed once (crm-06)', async () => {
  const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(3),
    email_queue: [qrow('Club@uni.example', 'co-1'), qrow(' club@uni.example', 'co-2'), qrow('other@uni.example', 'co-3')] });
  const g = fakeGmail([]);
  const r = await loadFunction('email-dispatch', { db, gmail: g.fetch })();
  expect(r.body).toMatchObject({ sent: 2, skipped: 1, failed: 0 });
  expect(g.st.sends).toEqual(['raw:Club@uni.example', 'raw:other@uni.example']);
  expect(db.T.email_queue.map(q => q.status)).toEqual(['sent', 'skipped', 'sent']);
  expect(db.T.email_queue[1].error).toBe('this campaign already emailed this address — duplicate blocked');
  expect(db.T.outreach_contacts.map(c => c.status)).toEqual(['first_email', 'not_started', 'first_email']);   // the skipped company is not marked as emailed
});

test('email-dispatch: an address this campaign emailed days ago, or anyone emailed in the last 24 h, is skipped', async () => {
  const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
  const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(5),
    email_queue: [
      qrow('first@uni.example', 'co-1', { status: 'sent', sent_at: hoursAgo(50) }),          // this campaign, two days ago, another company row
      qrow('First@uni.example', 'co-2'),
      qrow('byhand@uni.example', 'co-3'),                                                     // answered by hand from Gmail this morning
      qrow('twin@uni.example', 'co-4'),                                                       // sent by another campaign an hour ago
      qrow('fresh@uni.example', 'co-5'),
      { ...qrow('twin@uni.example', 'co-9', { status: 'sent', sent_at: hoursAgo(1) }), campaign_id: 'c-other' },
    ],
    email_messages: [{ id: 'm1', company_id: 'co-8', direction: 'outbound', to_addr: '"By Hand" <ByHand@uni.example>, cc@uni.example', sent_at: hoursAgo(3) }] });
  const g = fakeGmail([]);
  const run = loadFunction('email-dispatch', { db, gmail: g.fetch });
  expect((await run()).body).toMatchObject({ sent: 0, skipped: 3 });       // a run looks at 3 rows
  expect((await run()).body).toMatchObject({ sent: 1, skipped: 0 });
  expect(g.st.sends).toEqual(['raw:fresh@uni.example']);
  const err = to => db.T.email_queue.find(q => q.to_email === to && q.campaign_id === 'c1' && q.status !== 'sent').error;
  expect(err('First@uni.example')).toMatch(/^this campaign already emailed this address/);
  expect(err('byhand@uni.example')).toMatch(/^this address was emailed in the last 24 h/);
  expect(err('twin@uni.example')).toMatch(/^this address was emailed in the last 24 h/);
});

test('email-dispatch: Google\'s 429 pauses the campaign and leaves «HTTP 429» on the pending row — the marker the CRM chip reads (crm-02)', async () => {
  const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(2), email_queue: [qrow('a@uni.example', 'co-1'), qrow('b@uni.example', 'co-2')] });
  const g = fakeGmail([], { sendStatus: 429 });
  const r = await loadFunction('email-dispatch', { db, gmail: g.fetch })();
  expect(r.body).toMatchObject({ sent: 0, reason: 'campaign Follow-up · 13 Nov auto-paused on HTTP 429' });
  expect(db.T.email_campaigns[0].status).toBe('paused');
  expect(db.T.email_queue.map(q => q.status)).toEqual(['pending', 'pending']);
  expect(db.T.email_queue[0].error).toMatch(/^HTTP 429: /);
  expect(db.T.email_queue[1].error).toBeNull();
  // and a paused campaign sends nothing on the next run
  expect((await loadFunction('email-dispatch', { db, gmail: fakeGmail([]).fetch })()).body).toMatchObject({ sent: 0, reason: 'no running campaigns' });
});

test('email-dispatch: answers anyone until ENFORCE_CRON_SECRET=true, then only the shared secret (crm-05 / SEC-04)', async () => {
  const mk = env => { const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(1), email_queue: [qrow('a@uni.example', 'co-1')] }); const g = fakeGmail([]);
    return { db, g, run: loadFunction('email-dispatch', { db, gmail: g.fetch, env }) }; };
  let x = mk({ CRM_CRON_SECRET: 's3cret' });                                // secret set, not enforced: today's cron (no header) keeps working
  expect((await x.run()).body).toMatchObject({ sent: 1 });
  x = mk({ CRM_CRON_SECRET: 's3cret', ENFORCE_CRON_SECRET: 'true' });
  for (const headers of [{}, { 'x-cron-secret': 'wrong' }, { authorization: 'Bearer service-key' }]) {
    const r = await x.run(undefined, headers);
    expect(r.status).toBe(401); expect(x.g.st.sends).toHaveLength(0); expect(x.db.T.email_queue[0].status).toBe('pending');
  }
  expect((await x.run(undefined, { 'x-cron-secret': 's3cret' })).body).toMatchObject({ sent: 1 });
  x = mk({ ENFORCE_CRON_SECRET: 'true' });
  const r = await x.run(undefined, { 'x-cron-secret': '' });
  expect(r.status).toBe(500); expect(x.g.st.sends).toHaveLength(0);
});

// ── W4 (audit 18 Nov 2026): replies read more carefully, Gmail trouble never loses an email ──
const withHeaders = (m, extra) => { m.payload.headers.push(...Object.entries(extra).map(([name, value]) => ({ name, value }))); return m; };

test('gmail-sync: an out-of-office answer is kept in the conversation but moves nothing (crm-14)', async () => {
  const ooo = withHeaders(mail('m-ooo', 'Ana <club@uni.example>', 'Out of Office: Re: Surf trip'), { 'Auto-Submitted': 'auto-replied' });
  const ooo2 = mail('m-ooo2', 'Rui <rui@club2.example>', 'Automatische Antwort: Surf trip');
  const db = fakeDb({ outreach_contacts: [{ ...CLUB }, { id: 'co-2', email: 'rui@club2.example', status: 'follow_up' }] }); const g = fakeGmail([ooo, ooo2]);
  const r = await loadFunction('gmail-sync', { db, gmail: g.fetch })();
  expect(r.body).toMatchObject({ ok: true, newInbound: 2, matched: 0, advanced: 0, autoReplies: 2 });
  expect(db.T.email_messages.map(m => m.provider_msg_id).sort()).toEqual(['m-ooo', 'm-ooo2']);   // still shown
  expect(db.T.outreach_contacts.map(c => [c.status, !!c.replied])).toEqual([['first_email', false], ['follow_up', false]]);
  expect(db.T.outreach_activity).toHaveLength(0);
});

test('gmail-sync: «unsubscribe» on its own first line is honoured whatever the quoted original looks like; an interested reply quoting our footer is not (crm-08)', async () => {
  const quoteDe = '\n\nAm 15.09.2026 um 10:12 schrieb Gota Dagua <groups@example.org>:\n' + 'Hallo! We run surf trips for clubs. '.repeat(30) + '\nIf you\'d rather not receive these emails, just reply "unsubscribe".';
  const quoteOutlook = '\n\nFrom: Gota Dagua <groups@example.org>\nSent: 17 September 2026\n' + 'Surf trip offer text. '.repeat(40) + '\nIf you\'d rather not receive these emails, just reply "unsubscribe".';
  const msgs = [
    mail('u1', 'Club One <one@a.example>', 'Re: Surf trip', { body: 'Unsubscribe' + quoteDe }),
    mail('u2', 'Club Two <two@b.example>', 'Re: Surf trip', { body: 'Remove me please.\n\nKind regards\nThe board' + quoteOutlook }),
    mail('i1', 'Club Three <three@c.example>', 'Re: Surf trip', { body: 'Hi! Yes we are interested, can you send prices for 20 people in May?' + quoteDe }),
    mail('i2', 'Club Four <four@d.example>', 'Re: Surf trip', { body: 'Sounds great, call me tomorrow.' + quoteOutlook }),
  ];
  const companies = [['co-1', 'one@a.example'], ['co-2', 'two@b.example'], ['co-3', 'three@c.example'], ['co-4', 'four@d.example']].map(([id, email]) => ({ id, email, status: 'first_email' }));
  const db = fakeDb({ outreach_contacts: companies }); const g = fakeGmail(msgs);
  const r = await loadFunction('gmail-sync', { db, gmail: g.fetch })();
  expect(r.body).toMatchObject({ ok: true, newInbound: 4, unsubsSuppressed: 2, advanced: 2 });
  expect(db.T.email_suppression.map(s => [s.email, s.reason]).sort()).toEqual([['one@a.example', 'unsubscribe'], ['two@b.example', 'unsubscribe']]);
  expect(db.T.outreach_contacts.map(c => c.status)).toEqual(['excluded', 'excluded', 'in_conversation', 'in_conversation']);
});

test('gmail-sync: an unreadable Date header no longer stops the run (crm-22 / AUT-18)', async () => {
  const bad = mail('m-bad', 'Ana <club@uni.example>', 'Re: Surf trip', { at: Date.parse('2026-11-17T08:00:00Z') });
  bad.payload.headers.find(h => h.name === 'Date').value = 'not a date at all';
  const db = fakeDb({ outreach_contacts: [{ ...CLUB }] }); const g = fakeGmail([bad]);
  const r = await loadFunction('gmail-sync', { db, gmail: g.fetch })();
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, newInbound: 1 });
  expect(db.T.email_messages[0].sent_at).toBe('2026-11-17T08:00:00.000Z');   // Gmail's own receive time
});

test('gmail-sync: a reply from a domain several companies share goes to the one we wrote to in that thread (crm-13)', async () => {
  const db = fakeDb({
    outreach_contacts: [{ id: 'co-twin', email: 'sports@uni2.example', status: 'excluded' }, { id: 'co-real', email: 'surfclub@uni2.example', status: 'first_email', last_contacted_at: '2026-11-01T10:00:00Z' }, { id: 'co-other', email: 'board@uni2.example', status: 'not_started', last_contacted_at: null }],
    email_messages: [{ id: 'e1', company_id: 'co-real', direction: 'outbound', to_addr: 'surfclub@uni2.example', thread_id: 'th-x', provider_msg_id: 'out-x', sent_at: new Date().toISOString() }],
  });
  const g = fakeGmail([mail('m-x', 'New President <president@uni2.example>', 'Re: Surf trip', { threadId: 'th-x' }), mail('m-y', 'Someone <someone@uni2.example>', 'Question')]);
  await loadFunction('gmail-sync', { db, gmail: g.fetch })();
  expect(db.T.email_messages.find(m => m.provider_msg_id === 'm-x').company_id).toBe('co-real');
  expect(db.T.email_messages.find(m => m.provider_msg_id === 'm-y').company_id).toBe('co-real');   // no thread of ours: the one we last wrote to, never the excluded twin
});

test('email-dispatch: a company set to Excluded after the campaign was queued is not emailed (crm-08)', async () => {
  const companies = cos(2); companies[0].status = 'excluded';
  const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: companies, email_queue: [qrow('a@uni.example', 'co-1'), qrow('b@uni.example', 'co-2')] });
  const g = fakeGmail([]);
  expect((await loadFunction('email-dispatch', { db, gmail: g.fetch })()).body).toMatchObject({ sent: 1, skipped: 1 });
  expect(g.st.sends).toEqual(['raw:b@uni.example']);
  expect(db.T.email_queue.map(q => [q.status, q.error])).toEqual([['skipped', 'company excluded'], ['sent', null]]);
});

test('email-dispatch: Gmail trouble leaves rows pending instead of failing them for good (AUT-10)', async () => {
  // the token cannot be refreshed: nothing is sent and no row changes
  const expired = { id: 'acc', email: 'groups@example.org', access_token: 'old', access_expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token: 'r' };
  let db = fakeDb({ gmail_account: [expired], email_campaigns: [camp()], outreach_contacts: cos(1), email_queue: [qrow('a@uni.example', 'co-1')] });
  let r = await loadFunction('email-dispatch', { db, gmail: fakeGmail([]).fetch })();
  expect(r.body.reason).toMatch(/^Gmail token: Token refresh failed/);
  expect(db.T.email_queue[0]).toMatchObject({ status: 'pending', attempts: 0, error: null });
  expect(db.T.email_campaigns[0].status).toBe('running');
  // Google answers 500 three times: pending twice (tried again next run), failed on the third
  db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(1), email_queue: [qrow('a@uni.example', 'co-1')] });
  const g500 = fakeGmail([], { sendStatus: 500 });
  const run = loadFunction('email-dispatch', { db, gmail: g500.fetch });
  expect((await run()).body).toMatchObject({ sent: 0, failed: 0, retry: 1 });
  expect(db.T.email_queue[0]).toMatchObject({ status: 'pending', attempts: 1 });
  expect(db.T.email_queue[0].error).toMatch(/^will retry \(1\/3\): HTTP 500/);
  await run();
  expect(db.T.email_queue[0]).toMatchObject({ status: 'pending', attempts: 2 });
  expect((await run()).body).toMatchObject({ failed: 1 });
  expect(db.T.email_queue[0]).toMatchObject({ status: 'failed', attempts: 3 });
  // an answer about the email itself (400) fails it at once
  db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(1), email_queue: [qrow('bad@uni.example', 'co-1')] });
  expect((await loadFunction('email-dispatch', { db, gmail: fakeGmail([], { sendStatus: 400 }).fetch })()).body).toMatchObject({ failed: 1 });
  expect(db.T.email_queue[0].status).toBe('failed');
});

test('email-dispatch: a row another run already claimed is not sent twice (crm-22)', async () => {
  const db = fakeDb({ email_campaigns: [camp()], outreach_contacts: cos(2), email_queue: [qrow('a@uni.example', 'co-1'), qrow('b@uni.example', 'co-2')] });
  const g = fakeGmail([]);
  const realFrom = db.from;
  let raced = false;
  db.from = t => {                                         // a second run claims row a between our read and our claim
    if (t === 'email_queue' && !raced && db.T.email_queue.every(q => q.attempts === 0)) {
      const q = realFrom(t); const origUpdate = q.update.bind(q);
      q.update = o => { if (o && o.attempts === 1 && !raced) { raced = true; db.T.email_queue[0].attempts = 1; } return origUpdate(o); };
      return q;
    }
    return realFrom(t);
  };
  expect((await loadFunction('email-dispatch', { db, gmail: g.fetch })()).body).toMatchObject({ sent: 1 });
  expect(g.st.sends).toEqual(['raw:b@uni.example']);
});

test('gmail-sync: with more than 1,000 messages in the window, what is stored is still seen as stored (paged list, crm-22)', async () => {
  const msgs = Array.from({ length: 1100 }, (_, i) => mail('s' + i, 'Ana <club@uni.example>', 'Re: Surf trip ' + i));
  const stored = msgs.map((m, i) => ({ id: 'e' + i, company_id: 'co-1', direction: 'inbound', provider_msg_id: m.id, thread_id: m.threadId, sent_at: new Date().toISOString() }));
  const db = fakeDb({ outreach_contacts: [{ ...CLUB }], email_messages: stored }); const g = fakeGmail(msgs);
  const r = await loadFunction('gmail-sync', { db, gmail: g.fetch })();
  expect(r.body).toMatchObject({ ok: true, fetched: 1100, note: 'all already in DB' });
  expect(g.st.gets).toHaveLength(0);
  expect(db.T.outreach_activity).toHaveLength(0);
});
