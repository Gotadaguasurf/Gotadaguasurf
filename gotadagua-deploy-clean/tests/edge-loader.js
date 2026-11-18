// Load a Supabase Edge Function (Deno, TypeScript) in Node for a hermetic test — no Deno, no network.
//
// The function's own relative imports (../_shared/*.ts, ./route.ts) are inlined, each module in its own
// scope; remote imports (https://esm.sh/...) and the browser libraries under _shared/lib/ are left to the
// sandbox. Every outside call is a fake the test passes in: env, createClient, fetch.
//
//   const fn = loadEdge('parse-invoice', { env, createClient, fetch });
//   const res = await fn.call({ headers: { Authorization: 'Bearer x' }, body: {...} });   // → { status, body }
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');

const FN_DIR = path.join(__dirname, '..', 'supabase', 'functions');
const IMPORT_RE = /^import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?[ \t]*(?:\/\/.*)?$/gm;

function bundle(entry) {
  const mods = new Map();           // absolute path → variable name
  const out = [];
  function load(file) {
    if (mods.has(file)) return mods.get(file);
    const v = `__mod${mods.size}`; mods.set(file, v);
    let src = fs.readFileSync(file, 'utf8');
    const head = [];
    src = src.replace(IMPORT_RE, (_m, what, spec) => {
      if (!spec.startsWith('.')) return '';                                     // remote: the sandbox provides it
      const target = path.resolve(path.dirname(file), spec);
      if (!target.endsWith('.ts')) return '';                                   // _shared/lib/*.js browser libraries: not needed
      const mv = load(target);
      if (what) {
        const names = what.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(s => s && !s.startsWith('type '))
          .map(s => s.replace(/\s+as\s+/, ': '));
        if (names.length) head.push(`const { ${names.join(', ')} } = ${mv};`);
      }
      return '';
    });
    const exported = [];
    src = src.replace(/^export\s+(?:async\s+)?(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => { exported.push(name); return m.replace(/^export\s+/, ''); })
      .replace(/^export\s+(interface|type)\s/gm, '$1 ')
      .replace(/^export\s*\{\s*\};?\s*$/gm, '');
    const js = stripTypeScriptTypes(src);
    out.push(`const ${v} = (() => {\n${head.join('\n')}\n${js}\nreturn { ${exported.join(', ')} };\n})();`);
    return v;
  }
  const main = load(entry);
  return out.join('\n') + `\nglobalThis.__exports = ${main};`;
}

function loadEdge(name, { env = {}, createClient, fetch, extra = {} } = {}) {
  const entry = path.join(FN_DIR, name, 'index.ts');
  const code = bundle(entry);
  let handler = null;
  const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ...env };
  const logs = [];
  const sandbox = {
    Deno: { env: { get: k => ENV[k] }, serve: h => { handler = h; } },
    createClient, fetch: fetch || (async () => { throw new Error('no network in tests'); }),
    console: { log: (...a) => logs.push(a.join(' ')), info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, URL, URLSearchParams, Headers, Blob, TextEncoder, TextDecoder, CompressionStream, Intl, Date, Math, JSON, Promise, atob, btoa,
    crypto: globalThis.crypto, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, Uint8Array, ArrayBuffer, Number, String, Array, Object, Set, Map, Error, RegExp,
    ...extra,
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { filename: `${name}/index.ts` });
  if (!handler) throw new Error(`${name}: Deno.serve was never called`);
  const call = async ({ method = 'POST', url = `https://db.example/functions/v1/${name}`, headers = {}, body } = {}) => {
    const init = { method, headers };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers = { 'content-type': 'application/json', ...headers }; }
    const r = await handler(new Request(url, init));
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_e) { /* html */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  return { call, logs, env: ENV };
}

// The exports of one module (a _shared helper or route.ts), with the same sandbox rules.
function loadModule(rel, { env = {}, fetch, createClient } = {}) {
  const code = bundle(path.join(FN_DIR, rel));
  const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ...env };
  const sandbox = { Deno: { env: { get: k => ENV[k] } }, createClient, fetch, console, Response, Request, URL, URLSearchParams, Headers, Intl, Date, Math, JSON, Promise, atob, btoa, crypto: globalThis.crypto, encodeURIComponent, decodeURIComponent, Uint8Array, TextEncoder };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { filename: rel });
  return sandbox.__exports;
}

// A JWT-shaped token with a given payload (the signature is not checked in tests; the gateway does that).
const fakeJwt = (payload) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

module.exports = { loadEdge, loadModule, fakeJwt, bundle };
