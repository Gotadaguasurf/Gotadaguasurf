// Shared helpers for the smoke suite.
//
// fakeOwnerSession(page): plants a Supabase v2 session in localStorage
// BEFORE any page script runs. supabase-js getSession() reads storage
// locally (no network round-trip), so the apps' auth gates see a live
// owner session and proceed to render instead of bouncing to the login.
// The JWT is structurally valid but signed with garbage — any REAL
// Supabase call it makes gets a 401 and the apps' error handling paths
// absorb it. Nothing can be written to production this way.
//
// The owner email matters: camp-hub's access guard and surf-school's
// CAN_EDIT_HISTORY both short-circuit on the owner allow-list without
// touching the DB, keeping the tests hermetic.

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const OWNER_EMAIL = 'miguel@gotadaguasurf.com';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeJwt() {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: OWNER_EMAIL,
    role: 'authenticated',
    exp: 9_999_999_999,
  };
  return `${b64url(header)}.${b64url(payload)}.smoke-test-signature`;
}

async function fakeOwnerSession(page) {
  const session = {
    access_token: fakeJwt(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 9_999_999_999,
    refresh_token: 'smoke-test-refresh',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: OWNER_EMAIL,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2024-01-01T00:00:00Z',
    },
  };
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
  }, [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

// Collects FATAL page errors — the class of bug that has actually bitten
// this codebase (TDZ ReferenceErrors on fresh-localStorage boots, syntax
// errors in 10k-line files, calls to functions that got renamed away).
//
// Deliberately narrow: we only trap real JS engine errors. The fake test
// JWT makes real Supabase reject every call (PGRST301), and several app
// paths `throw error` with the raw Supabase error OBJECT — those surface
// here as messageless "Object" pageerrors and are expected test-harness
// noise, not app bugs. A genuine regression always carries a proper
// engine message (ReferenceError / TypeError / SyntaxError / …).
const FATAL_PATTERN = /ReferenceError|TypeError|SyntaxError|RangeError|is not defined|is not a function|Cannot read|Cannot access|Unexpected token/;
function collectFatalErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => {
    const text = `${err && err.message || ''}\n${err && err.stack || ''}`;
    if (FATAL_PATTERN.test(text)) errors.push(text.trim().slice(0, 400));
  });
  return errors;
}

module.exports = { fakeOwnerSession, collectFatalErrors, OWNER_EMAIL };
