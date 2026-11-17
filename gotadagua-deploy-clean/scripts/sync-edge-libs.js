// Copies the shared browser libraries the mail-ingest Edge Function runs into supabase/functions/_shared/lib/
// (17 Nov 2026). The Edge Function bundle only takes files under supabase/functions/, so the camp hub's
// lib/*.js are copied, byte for byte; tests/bl-ingest.spec.js fails when a copy differs from lib/.
// Run after changing any of these files:  node scripts/sync-edge-libs.js   (or npm run sync:edge)
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['camp-config.js', 'transport-catalog.js', 'guests-trips.js', 'bl-report.js', 'bl-ingest.js', 'bl-revenue.js'];
const DEST = path.join(ROOT, 'supabase', 'functions', '_shared', 'lib');
if (require.main === module) {
  fs.mkdirSync(DEST, { recursive: true });
  FILES.forEach(f => { fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(DEST, f)); console.log('synced', f); });
}
module.exports = { FILES, DEST, ROOT };
