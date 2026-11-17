// Builds a small Bookinglayer camp report (one row per booking line × guest) for tests/bl-report.spec.js and week.spec.js.
const G = require('../lib/guests-trips.js');
const HEAD = ['Booking: Reference', 'Booking: Status', 'Booking: Check-in date', 'Booking: Check-out date', 'Company/Channel', 'Product: Product title',
  'Booking line: Start date', 'Booking line: Start time', 'Booking line: End date', 'Booking line: Quantity', 'Booking line: Id', 'Person: Full name',
  'Guest: Full name', 'Guest: Phone', 'Guest: Arrival time', 'Guest: Arrival flight', 'Guest: Departure time', 'Guest: Departure flight',
  'Guest: Transfer comment', 'Guest: List of bed numbers', 'Level', 'Guest: Allergies / Intolerance', 'Booker: Phone', 'Booking: Due amount', 'Guest: Diet'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bl = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${DAY[G.weekday(iso)]} ${d} ${MON[m - 1]} ${y}`; };
const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
let lid = 1000;
// booking: { ref, status, ci, co, channel, due, bphone, guests: [{ name, phone, arrT, arrF, depT, depF, beds, level, diet, comment }], lines: [{ p, person, start, end, time }] }
function rows(bk) {
  const out = [];
  bk.lines.forEach(l => {
    const id = ++lid;
    bk.guests.forEach(g => out.push([bk.ref, bk.status || 'Paid', bl(bk.ci), bl(bk.co), bk.channel || '', l.p, bl(l.start), l.time == null ? '12:00' : l.time, bl(l.end || l.start), l.qty || 1, id, l.person == null ? '' : l.person,
      g.name || '', g.phone || '', g.arrT || '', g.arrF || '', g.depT || '', g.depF || '', g.comment || '', g.beds || '', g.level || '', g.allergies || '', bk.bphone || '', (bk.due || 0).toFixed(2), g.diet || '']));
  });
  return out;
}
const csv = bks => [HEAD, ...bks.flatMap(rows)].map(r => r.map(q).join(',')).join('\n');
// The report from 17 Nov 2026: «Booking line: Start time» removed, «Booking line: Final price incl. tax» added as the
// last column (EUR). Each line's `price` (default 0) fills it.
const ST = HEAD.indexOf('Booking line: Start time');
function csvPriced(bks, header = 'Booking line: Final price incl. tax') {
  const H = HEAD.filter((_, i) => i !== ST).concat(header);
  const body = bks.flatMap(bk => { const prices = []; bk.lines.forEach(l => bk.guests.forEach(() => prices.push(l.price == null ? 0 : l.price))); return rows(bk).map((r, i) => r.filter((_, j) => j !== ST).concat(Number(prices[i]).toFixed(2))); });
  return [H, ...body].map(r => r.map(q).join(',')).join('\n');
}

module.exports = { csv, csvPriced, bl };
