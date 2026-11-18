// .vercelignore + the blocking redirects of vercel.json (audit 18 Nov 2026, SA-12 / AUT-12).
// The site is static, so every file in the deploy is public. These tests prove two things on every run:
//   1. the folders with SQL, docs, tests and scripts are left out of the deploy;
//   2. nothing a page loads (script, stylesheet, image, fetch) lives in what is left out.
// No browser and no network: the files are read from disk.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The small part of the .gitignore syntax the file uses: "/x/" (top folder), "/x" (top file), "*.ext" and bare names (any depth).
function ignoreRules() {
  return read('.vercelignore').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function isIgnored(rel, rules = ignoreRules()) {
  const p = rel.split(path.sep).join('/').replace(/^\/+/, '');
  return rules.some(rule => {
    if (rule.startsWith('/') && rule.endsWith('/')) return (p + '/').startsWith(rule.slice(1));
    if (rule.startsWith('/')) return p === rule.slice(1);
    if (rule.startsWith('*.')) return p.endsWith(rule.slice(1));
    return p.split('/').includes(rule);
  });
}
function walk(dir, out = []) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.git') continue;
    const rel = dir ? `${dir}/${name}` : name;
    let st; try { st = fs.statSync(path.join(ROOT, rel)); } catch (_e) { continue; }
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}
const served = () => walk('').filter(f => !isIgnored(f));

test('vercelignore: SQL, docs, tests, scripts and notes are left out; the app is kept', () => {
  for (const f of ['supabase/audit-wave1.sql', 'docs/DESIGN-SYSTEM.md', 'tests/smoke.spec.js', 'scripts/sync-edge-libs.js', 'README.md', 'ARCHITECTURE.md',
    'package.json', 'package-lock.json', 'playwright.config.js', 'signatures/gen.py', '.github/workflows/x.yml', '.claude/skills/x/SKILL.md', 'test-results/x.png']) {
    expect(isIgnored(f), f + ' must not be published').toBe(true);
  }
  // every tracked file under the four folders is out, whatever its name
  const left = walk('').filter(f => /^(supabase|docs|tests|scripts)\//.test(f) && !isIgnored(f));
  expect(left).toEqual([]);
  for (const f of ['index.html', 'vercel.json', 'supabase-config.js', 'owner-config.js', 'error-monitor.js', 'lib/app-shell.js', 'lib/app-shell.css', 'lib/supabase.min.js',
    'hq/index.html', 'camp-hub/index.html', 'camp-hub/camp-tab-inner.html', 'partners/index.html', 'crm/index.html', 'prices/index.html', 'prices/pricelist.html',
    'surf-school/index.html', 'instructors/index.html', 'wild/index.html', 'suk/index.html', 'diploria/index.html', 'contabilista/index.html', 'signatures/index.html']) {
    expect(fs.existsSync(path.join(ROOT, f)), f + ' exists').toBe(true);
    expect(isIgnored(f), f + ' must stay published').toBe(false);
  }
  expect(served().some(f => f.startsWith('assets/'))).toBe(true);
});

// Every local address a served page asks the browser to load: src / href attributes, fetch(), import, url(), importScripts, new Worker.
function localRefs(file) {
  const text = read(file); const refs = [];
  const patterns = [
    /\b(?:src|href)\s*=\s*["']([^"'<>\s]+)["']/g,
    /\bfetch\(\s*["'`]([^"'`]+)["'`]/g,
    /\bimport\s*(?:[^"'`;()]*?\sfrom\s*)?\(?\s*["']([^"']+)["']/g,
    /\burl\(\s*["']?([^"')\s]+)["']?\s*\)/g,
    /\b(?:importScripts|new\s+Worker)\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const re of patterns) {
    let m; while ((m = re.exec(text))) {
      const raw = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw) || raw.includes('${') || raw.includes('{{')) continue;   // other sites, data:, mailto:, anchors, templates
      const clean = raw.split(/[?#]/)[0]; if (!clean) continue;
      const rel = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
      if (rel.startsWith('..')) continue;
      refs.push({ from: file, raw, rel });
    }
  }
  return refs;
}

test('vercelignore: nothing a page loads lives in a folder that is left out', () => {
  const pages = served().filter(f => /\.(html|js|css)$/.test(f) && !/\.min\.js$/.test(f));
  expect(pages.length).toBeGreaterThan(20);
  const refs = pages.flatMap(localRefs);
  expect(refs.length).toBeGreaterThan(50);                        // the scan really finds the loads (scripts, styles, images)
  expect(refs.some(r => r.rel === 'lib/app-shell.js')).toBe(true);
  const broken = refs.filter(r => isIgnored(r.rel) || /^(supabase|docs|tests|scripts|\.claude|\.github|test-results)\//.test(r.rel));
  expect(broken.map(r => `${r.from} → ${r.raw}`)).toEqual([]);
});

test('vercel.json: the blocking redirects cover the left-out folders and never touch a published file', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const blockers = cfg.redirects.filter(r => r.destination === '/').map(r => new RegExp('^' + r.source.replace(/:path\*/g, '.*') + '$'));
  const blocked = (url) => blockers.some(re => re.test(url));
  for (const url of ['/supabase/import-268-new-leads.sql', '/supabase/functions/mail-ingest/index.ts', '/docs/DESIGN-SYSTEM.md', '/tests/fixtures/guests-13h47.csv',
    '/scripts/sync-edge-libs.js', '/README.md', '/ARCHITECTURE.md', '/package.json', '/package-lock.json', '/playwright.config.js', '/signatures/gen.py']) {
    expect(blocked(url), url + ' answers with the home page').toBe(true);
  }
  const hit = served().map(f => '/' + f).filter(blocked);
  expect(hit).toEqual([]);                                        // e.g. /supabase-config.js is NOT caught by /supabase/…
  expect(blocked('/supabase-config.js')).toBe(false);
  // the redirects that were there before are still there
  expect(cfg.redirects.filter(r => r.destination !== '/').map(r => r.source)).toEqual(['/hq', '/wild', '/suk', '/contabilista']);
});
