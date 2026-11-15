// Golden check of the Week team messages and the transfers message (15 Nov 2026, «Week = guests and
// camp teams, Transport = drivers and money»).
//
// The goldens were captured ONCE from the code before the move (main at c67ce2d, when the transfers
// message still lived in Week → Transfers) with GOLDEN_WRITE=1, and are never regenerated after an
// edit: a mismatch means the code changed a message, so fix the code.
//   - Rooms (Cleaning, Darija and its English twin), Kitchen, Surf and Guests: every day and the week,
//     raw (stored and compared) and dressed (TODAY / TOMORROW, what is sent) — must stay byte-identical.
//   - The «To check» items of those tabs, the people check and the day model (arrivals, departures,
//     beds freed, meals): the «zero errors» area.
//   - The transfers message, a day and the whole week, as Week sent it: Transport's «Send the whole
//     day» / «Send the whole week» must send the same bytes.
// Only SHA-256 hashes are stored: the Sri Lanka fixture is a real Guests file (no guest names in a new file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const file = name => path.join(__dirname, 'fixtures', `week-messages-${name}.golden.json`);

// Runs in the page: every team message of the viewed week, plus the facts behind them.
async function teamMessages(page, { darija } = {}) {
  return page.evaluate(({ darija }) => {
    const today = TransportUI.colomboNow().slice(0, 10);
    const ws = WeekUI._state.week;
    const days = ['week', ...[0, 1, 2, 3, 4, 5, 6].map(i => GuestsTrips.addDaysIso(ws, i))];
    const out = {};
    ['cleaning', 'kitchen', 'surf', 'guests'].forEach(team => days.forEach(d => {
      const b = WeekUI.bodyOf(team, d);
      out[`${team}|${d}`] = b;
      out[`${team}|${d}|dressed`] = WeekUI.dress(b, today);
      if (darija && team === 'cleaning') { const en = WeekUI.bodyOf('cleaning', d, 'en'); out[`cleaning-en|${d}`] = en; out[`cleaning-en|${d}|dressed`] = WeekUI.dress(en, today); }
    }));
    out.toCheck = JSON.stringify(WeekUI.toCheck().filter(i => i.tab !== 'transfers').map(i => [i.tab, i.short, i.text, i.who || '', (i.guests || []).map(g => g.guest_name)]));
    out.people = JSON.stringify(WeekUI.people());
    out.model = JSON.stringify(WeekUI.model().days.map(x => [x.d, x.sleep, x.outside, x.breakfast, x.dinner, x.arrivals.map(g => g.guest_name), x.departures.map(g => g.guest_name),
      x.staying.map(g => g.guest_name), x.roomOuts.map(o => [o.g.guest_name, o.r ? o.r.label : '', o.bed, o.note]), x.students.length, x.yoga]));
    return out;
  }, { darija: !!darija });
}

// The transfers message of every day of the week and of the whole week, dressed, as it goes out.
// `build(day)` runs in the page and returns the text for a day or for 'week'.
async function transfersMessages(page, build) {
  return page.evaluate(src => {
    const fn = new Function('day', 'ws', `return (${src})(day, ws);`);
    const ws = (window.WeekUI && WeekUI._state.week) || TransportUI._state.week;
    const out = {};
    ['week', ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => GuestsTrips.addDaysIso(ws, i))].forEach(d => { out[`transfers|${d}`] = fn(d, ws); });
    return out;
  }, build.toString());
}

// Compare `msgs` with the golden `name.case`. GOLDEN_WRITE=1 stores them instead (only on the old code).
function check(name, kase, msgs) {
  const f = file(name);
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  if (process.env.GOLDEN_WRITE === '1') {
    all[kase] = { ...(all[kase] || {}), ...Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, sha(v)])) };
    fs.writeFileSync(f, JSON.stringify(all, null, 1) + '\n');
    return [];
  }
  const want = all[kase] || {};
  const bad = [];
  Object.entries(msgs).forEach(([k, v]) => { if (!(k in want)) bad.push(`${k}: no golden`); else if (want[k] !== sha(v)) bad.push(`${k}: changed —\n${v}`); });
  return bad;
}
const covered = (name, kase, prefix) => Object.keys((JSON.parse(fs.readFileSync(file(name), 'utf8'))[kase]) || {}).filter(k => k.startsWith(prefix)).length;

module.exports = { teamMessages, transfersMessages, check, covered, sha };
