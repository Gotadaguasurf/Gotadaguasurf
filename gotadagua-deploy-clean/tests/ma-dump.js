// The Week model of the camp hub, dumped in the oracle's shape (ma_week/oracle/oracle.py):
// nights → beds «room|bed» (bed only in shared rooms) and no_room; days → arrivals, departures,
// room_outs (why: leaves | move | bed_change), breakfast, dinner. Runs inside the page.
async function dumpWeeks(page, weeks) {
  return page.evaluate(async (weeks) => {
    const W = WeekUI._state; const out = { nights: {}, days: {} };
    const key = r => r ? ((r.label.match(/^(\d+) - /) || [null, r.label])[1]) : '';
    const add = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
    for (const ws of weeks) {
      W.week = ws; await WeekUI.loadAll(true);
      const rows = WeekUI.classify(W.cache[ws].rows, W.meta).filter(g => g._st === 'in' || g._st === 'carry');
      for (let i = 0; i < 7; i++) {
        const d = add(ws, i); const n = { beds: {}, no_room: [], in_camp: 0 };
        rows.filter(g => g.check_in <= d && d < g.check_out).forEach(g => {
          n.in_camp++;
          const s = WeekUI.segments(g).find(x => x.from <= d && d < x.to);
          if (!s || !s.r) { n.no_room.push(g.guest_name); return; }
          const k = key(s.r) + '|' + (s.r.shared ? (s.bed || '') : '');
          (n.beds[k] = n.beds[k] || []).push(g.guest_name);
        });
        Object.values(n.beds).forEach(l => l.sort()); n.no_room.sort();
        out.nights[d] = n;
      }
      const M = WeekUI.model();
      M.days.forEach(x => {
        out.days[x.d] = {
          arrivals: x.arrivals.map(g => g.guest_name).sort(), departures: x.departures.map(g => g.guest_name).sort(),
          room_outs: x.roomOuts.map(o => ({ name: o.g.guest_name, room: key(o.r), bed: o.r && o.r.shared ? String(o.bed || '') : '', why: o.leaves ? 'leaves' : o.move ? 'move' : o.bedChange ? 'bed_change' : '?' }))
            .sort((a, b) => (a.room + '|' + a.bed + '|' + a.name).localeCompare(b.room + '|' + b.bed + '|' + b.name)),
          breakfast: x.breakfast, dinner: x.dinner,
        };
      });
    }
    return out;
  }, weeks);
}
// Every difference between the app's dump and the oracle, for the dates the app covers.
function diff(app, oracle) {
  const out = [];
  const sortOuts = l => l.map(o => ({ name: o.name, room: o.room, bed: o.bed, why: o.why })).sort((a, b) => (a.room + '|' + a.bed + '|' + a.name).localeCompare(b.room + '|' + b.bed + '|' + b.name));
  for (const [d, n] of Object.entries(app.nights)) {
    const o = oracle.nights[d] || { beds: {}, no_room: [], in_camp: 0 };
    if (JSON.stringify(n.beds) !== JSON.stringify(Object.fromEntries(Object.entries(o.beds).sort()))
      && JSON.stringify(Object.fromEntries(Object.entries(n.beds).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(o.beds).sort()))) out.push(`night ${d} beds: app ${JSON.stringify(n.beds)} / oracle ${JSON.stringify(o.beds)}`);
    if (JSON.stringify(n.no_room) !== JSON.stringify(o.no_room)) out.push(`night ${d} no_room: app ${n.no_room} / oracle ${o.no_room}`);
    if (n.in_camp !== o.in_camp) out.push(`night ${d} in camp: app ${n.in_camp} / oracle ${o.in_camp}`);
  }
  for (const [d, x] of Object.entries(app.days)) {
    const o = oracle.days[d] || { arrivals: [], departures: [], room_outs: [], breakfast: 0, dinner: 0 };
    for (const k of ['arrivals', 'departures', 'breakfast', 'dinner']) if (JSON.stringify(x[k]) !== JSON.stringify(o[k])) out.push(`day ${d} ${k}: app ${JSON.stringify(x[k])} / oracle ${JSON.stringify(o[k])}`);
    if (JSON.stringify(sortOuts(x.room_outs)) !== JSON.stringify(sortOuts(o.room_outs))) out.push(`day ${d} room_outs: app ${JSON.stringify(x.room_outs)} / oracle ${JSON.stringify(o.room_outs)}`);
  }
  return out;
}
module.exports = { dumpWeeks, diff };
