/* ════════════════════════════════════════════════════════════════════════════
   Camp hub — Sri Lanka extras (Phase 2, 13 Nov 2026)

   B3  Camp Tab prefilled with this week's guests (camp_week_guests, the Monday
       Guests import) + «Leaving today/tomorrow with open tab» chips above the
       Camp Tab.
       - The prefill runs in the FULL view only (Francisco, Miguel): the Camp Tab
         frame tells the hub it has loaded its state (camp-tab-state-changed),
         the hub reads camp_week_guests (RLS: full users only) and posts
         camp-tab-sync-bookings, one entry per guest (the guest, never the
         booker). camp-tab-inner.html matches ref + name, then name, then a
         unique first name; it never deletes and never renames. A guest this
         browser already sent once is never added again (the social host may
         have deleted him on purpose) — only his dates are updated.
       - The chips read the Camp Tab state the frame already posts: open guests
         whose check-out (Guests file) is today / tomorrow in Colombo with
         unpaid lines. Not in ?view=local (Nadith keeps exactly today's screen).
   B4  Read-only chips in the shared checks strip (full view only):
       «<Month> salaries: X of Y in the ledger – missing …» and
       «Bank LKR … · payroll ~… due ~28th → Money from HQ needed ≈ …».
       Nothing is ever written to the ledger.
   B6  «This week» card at the top of the Weekly P&L (full view, Sri Lanka).
   B9  «Tour sold this week with no cost: <tour> ×N».

   Index.html globals used (classic-script globals): S, LOCAL_MANAGER_MODE,
   CAMP_TAB_ONLY_MODE, __HUB_LOCATION_SLUG, HUB_CAMP_TAB_MODE, LOCAL_PER_EUR,
   ledgerDrawerBalances, ledgerDrawerDelta, entryLocalDisplayAmount,
   isHqPaidRow, getHubSupabaseClient, ensureHubLocationId, activePage,
   ovBookings, ovBookingGuestCount, ovBookingsForWeeks, escapeHtml.
   Optional: window.CampCash (cash-count.js), window.TransportUI (transport.js),
   window.GuestsTrips (lib/guests-trips.js). Read-only use of all of them.
   ════════════════════════════════════════════════════════════════════════════ */
window.CAMP_CHECKS = window.CAMP_CHECKS || [];
(function () {
  'use strict';

  // ── Settings (Miguel may change these) ────────────────────────────────────
  const EXTRAS_LOCATIONS = ['sri-lanka'];              // the salary / Money from HQ / tour-cost chips (Sri Lanka's cash and payroll)
  // Camp Tab prefill, «Leaving with open tab» and the «This week» card: every camp with a Week page (Morocco since 14 Nov).
  const WEEK_EXTRAS_LOCATIONS = ['sri-lanka', 'morocco'];
  const CAMP_CFG = () => (window.CampConfig && CampConfig.get(typeof __HUB_LOCATION_SLUG !== 'undefined' ? __HUB_LOCATION_SLUG : '')) || {};
  const CAMP_TZ = CAMP_CFG().tz || 'Asia/Colombo';
  const SALARY_DUE_DAY = 28;          // payday ~28th: from then on the chip checks THIS month
  const MONEY_CHIP_FROM_DAY = 15;     // «Money from HQ needed» from the 15th of the month
  const TOUR_COST_LOOKBACK_DAYS = 3;  // a tour cost paid up to 3 days before the week still counts
  const TOURS_WITHOUT_COST = [];      // tours that never have a cost (none known yet)
  const DEAD_STATUSES = ['cancelled', 'canceled', 'expired', 'not_here'];   // not_here = dropped out of a later Guests file (build/sl-week)
  const PREFILL_RETRY_MS = 1500;
  const PREFILL_MAX_TRIES = 20;

  // ── Small helpers ─────────────────────────────────────────────────────────
  const slug = () => (typeof __HUB_LOCATION_SLUG !== 'undefined' ? __HUB_LOCATION_SLUG : '');
  const isLocal = () => (typeof LOCAL_MANAGER_MODE !== 'undefined' && LOCAL_MANAGER_MODE === true);
  const isTabOnly = () => (typeof CAMP_TAB_ONLY_MODE !== 'undefined' && CAMP_TAB_ONLY_MODE === true);
  const enabled = () => WEEK_EXTRAS_LOCATIONS.includes(slug());
  const fullView = () => enabled() && !isLocal() && !isTabOnly();
  const perGuest = () => (typeof HUB_CAMP_TAB_MODE !== 'undefined' && HUB_CAMP_TAB_MODE === 'per_guest');
  const ledger = () => (typeof S !== 'undefined' && S && Array.isArray(S.ledger) ? S.ledger : []);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const int = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
  const lkrTxt = (n) => `${CAMP_CFG().currency || 'LKR'} ${int(n)}`;
  const localAmt = (r) => (typeof entryLocalDisplayAmount === 'function' ? entryLocalDisplayAmount(r) : Number(r.amountLocal || 0));
  const isIncome = (r) => r && (r.type === 'income' || r.type === 'revenue');
  const isHqPaid = (r) => (typeof isHqPaidRow === 'function' ? isHqPaidRow(r) : (r.paymentMethod === 'HQ Paid' || String(r.sourceKind || '') === 'hq_invoice'));
  const client = () => (typeof getHubSupabaseClient === 'function' ? getHubSupabaseClient() : null);
  const wls = {
    get(k, d) { try { const v = window.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  // The camp's date — never through toISOString or the browser's zone.
  function colomboToday() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CAMP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  const dayNum = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000; };
  const addDays = (ymd, n) => new Date((dayNum(ymd) + n) * 86400000).toISOString().slice(0, 10); // pure date arithmetic on a UTC midnight
  const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
  // Saturday of the Sat–Fri week (same rule as GuestsTrips.weekStart).
  const weekStart = (ymd) => { const wd = new Date(dayNum(ymd) * 86400000).getUTCDay(); return addDays(ymd, -((wd + 1) % 7)); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dMon = (ymd) => { if (!ymd) return ''; const [, m, d] = String(ymd).split('-').map(Number); return `${d} ${MON[(m || 1) - 1]}`; };
  const range = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${dMon(b)}` : `${dMon(a)} – ${dMon(b)}`);
  const monthKey = (ymd) => String(ymd || '').slice(0, 7);
  const shiftMonth = (mk, n) => { const [y, m] = mk.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  // Browser-local midnight ms ↔ date: the Camp Tab stores bookingCi/Co this way
  // (camp-tab-inner hydrate: new Date(iso+'T00:00:00').getTime()). Read back
  // with local getters only.
  const localMs = (ymd) => new Date(`${ymd}T00:00:00`).getTime();
  const msToYmd = (ms) => { const d = new Date(Number(ms)); if (isNaN(d)) return ''; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  const state = {
    guests: [], guestsLoaded: false, guestsError: null, guestsLoading: null,
    tab: null,                                  // last Camp Tab state the frame posted
    prefill: { started: false, busy: false, tries: 0, sentSig: '', pendingSig: '', timer: null, last: null },
    leavingOpen: '',
  };

  // ── Data: this week's guests from the Guests import ──────────────────────
  async function loadWeekGuests() {
    if (!fullView()) return [];
    if (state.guestsLoading) return state.guestsLoading;
    state.guestsLoading = (async () => {
      try {
        const c = client();
        const loc = c && typeof ensureHubLocationId === 'function' ? await ensureHubLocationId() : '';
        if (!c || !loc) throw new Error('no client');
        const from = addDays(weekStart(colomboToday()), -7);
        const { data, error } = await c.from('camp_week_guests')
          .select('booking_ref,guest_key,guest_name,check_in,check_out,booking_status,updated_at')
          .eq('location_id', loc).gte('check_out', from).order('check_in').order('booking_ref').limit(1000);
        if (error) throw error;
        state.guests = Array.isArray(data) ? data : [];
        state.guestsLoaded = true; state.guestsError = null;
      } catch (err) {
        // Table missing, RLS (not a full user) or offline: no prefill, no guests line.
        state.guestsLoaded = false; state.guestsError = err;
      }
      return state.guests;
    })();
    try { return await state.guestsLoading; } finally { state.guestsLoading = null; }
  }
  const liveGuest = (g) => g && g.guest_name && g.check_in && g.check_out && !DEAD_STATUSES.includes(String(g.booking_status || '').trim().toLowerCase());

  // ── B3 · Prefill the Camp Tab ─────────────────────────────────────────────
  const SENT_KEY = () => `campExtras.prefilled.${slug()}`;
  const guestId = (g) => `${String(g.booking_ref || '').trim()}|${norm(g.guest_key || g.guest_name)}`;
  function prefillList(today) {
    const we = addDays(weekStart(today), 6);
    const sent = new Set(wls.get(SENT_KEY(), []));
    return state.guests.filter(liveGuest)
      .filter((g) => String(g.check_out) >= today && String(g.check_in) <= we)
      .map((g) => ({
        ref: String(g.booking_ref || '').trim(), name: String(g.guest_name).trim(), key: guestId(g), pax: 1,
        ci: localMs(String(g.check_in)), co: localMs(String(g.check_out)),
        noAdd: sent.has(guestId(g)),            // sent once already: update dates only, never re-add
      }));
  }
  const frameWin = () => { const f = document.getElementById('campTabFrame'); return f && f.contentWindow ? f.contentWindow : null; };
  async function prefillCampTab(force) {
    const P = state.prefill;
    if (!fullView() || !perGuest() || P.busy) return;
    const win = frameWin(); if (!win) return;
    P.busy = true;
    try {
      await loadWeekGuests();
      if (!state.guestsLoaded) return;
      const today = colomboToday();
      const list = prefillList(today);
      if (!list.length) return;
      const sig = JSON.stringify(list);
      if (!force && sig === P.sentSig) return;
      P.pendingSig = sig;
      win.postMessage({ type: 'camp-tab-sync-bookings', perGuest: true, weekStart: weekStart(today), bookings: list }, '*');
    } finally { P.busy = false; }
  }
  function onSynced(data) {
    const P = state.prefill;
    if (!data || !data.perGuest) return;
    P.last = data;
    if (data.reason === 'not-ready') {
      // The Camp Tab hasn't loaded its guests yet: never prefill an empty state.
      if (P.tries++ < PREFILL_MAX_TRIES) { clearTimeout(P.timer); P.timer = setTimeout(() => prefillCampTab(true), PREFILL_RETRY_MS); }
      return;
    }
    if (data.ok) {
      P.sentSig = P.pendingSig || P.sentSig; P.tries = 0;
      const sent = new Set(wls.get(SENT_KEY(), []));
      (data.keys || []).forEach((k) => sent.add(k));
      wls.set(SENT_KEY(), [...sent].slice(-2000));
    }
  }

  // ── B3 · «Leaving today/tomorrow with open tab» above the Camp Tab ───────
  function openAmount(g) {
    const items = Array.isArray(g.items) ? g.items : [];
    if (g.paid && !items.some((i) => i && i.paidAt)) return 0;                 // weekly-style paid flag, nothing per line
    return items.filter((i) => i && !i.paidAt).reduce((s, i) => s + (Number(i.p) > 0 ? Number(i.p) : 0), 0);
  }
  function leavingGroups(tabState, today) {
    const guests = tabState && tabState.activeWeek && Array.isArray(tabState.activeWeek.guests) ? tabState.activeWeek.guests : [];
    const tomorrow = addDays(today, 1);
    const out = { today: [], tomorrow: [] };
    guests.forEach((g) => {
      if (!g || g.closedAt || g.closed_at || !g.bookingCo) return;
      const co = msToYmd(g.bookingCo);
      const amt = openAmount(g);
      if (!(amt > 0)) return;
      if (co === today) out.today.push({ name: g.name, amount: amt });
      else if (co === tomorrow) out.tomorrow.push({ name: g.name, amount: amt });
    });
    return out;
  }
  function renderLeaving() {
    const page = document.getElementById('page-pos');
    const wrap = page && page.querySelector('.hub-embed-wrap');
    if (!wrap) return;
    let host = document.getElementById('exLeaving');
    if (!enabled() || isLocal() || !state.tab) { if (host) host.remove(); wrap.classList.remove('ex-has-chips'); return; }
    injectStyles();
    const G = leavingGroups(state.tab, colomboToday());
    const chips = [['today', 'Leaving today'], ['tomorrow', 'Leaving tomorrow']].filter(([k]) => G[k].length);
    if (!chips.length) { if (host) host.remove(); wrap.classList.remove('ex-has-chips'); return; }
    if (!host) { host = document.createElement('div'); host.id = 'exLeaving'; wrap.insertBefore(host, wrap.firstChild); }
    wrap.classList.add('ex-has-chips');
    if (state.leavingOpen && !G[state.leavingOpen].length) state.leavingOpen = '';
    const list = state.leavingOpen ? `<div class="ex-leave-list" id="exLeaveList">${G[state.leavingOpen].map((x) => `<div class="ex-leave-row"><span>${esc(x.name)}</span><span class="num">${lkrTxt(x.amount)}</span></div>`).join('')}</div>` : '';
    host.innerHTML = `<div class="health-strip" role="list">${chips.map(([k, label]) => {
      const n = G[k].length; const sum = G[k].reduce((s, x) => s + x.amount, 0);
      return `<button class="health-chip${state.leavingOpen === k ? ' ex-on' : ''}" role="listitem" data-leave="${k}">${label} with open tab: ${n} · ${lkrTxt(sum)}</button>`;
    }).join('')}</div>${list}`;
    host.onclick = (e) => { const b = e.target.closest('[data-leave]'); if (!b) return; state.leavingOpen = state.leavingOpen === b.dataset.leave ? '' : b.dataset.leave; renderLeaving(); };
  }

  window.addEventListener('message', (e) => {
    const d = e && e.data; if (!d || typeof d !== 'object') return;
    const win = frameWin(); if (win && e.source && e.source !== win) return;
    if (d.type === 'camp-tab-state-changed') {
      if (!enabled()) return;
      state.tab = d.state || null;
      try { renderLeaving(); } catch (err) { console.warn('[extras] leaving', err); }
      if (!state.prefill.started) { state.prefill.started = true; prefillCampTab(false); }   // once per page; retries and re-imports go their own way
      return;
    }
    if (d.type === 'camp-tab-bookings-synced') { onSynced(d); }
  });

  // ── B4 · Salaries ─────────────────────────────────────────────────────────
  const MONTH_PT = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MONTH_AB = ['jan', 'feb', '', 'apr', '', 'jun', 'jul', 'aug', 'sep|sept', 'oct', 'nov', 'dec'];  // «mar»/«may» are ordinary words
  const MONTH_RE = MONTH_EN.map((m, i) => new RegExp(`\\b(${[m.toLowerCase(), MONTH_PT[i], MONTH_AB[i]].filter(Boolean).join('|')})\\b`));
  // Month a salary row is for: the month its description names, else its date.
  function salaryMonth(r) {
    const date = String(r.date || ''); const mk = monthKey(date);
    const t = norm(r.description);
    // The month named FIRST wins: «September salary (bank, paid 1 Oct)» is September's.
    let i = -1, at = Infinity;
    MONTH_RE.forEach((re, k) => { const m = re.exec(t); if (m && m.index < at) { at = m.index; i = k; } });
    if (i < 0) return mk;
    let y = Number(date.slice(0, 4)); const dm = Number(date.slice(5, 7));
    if (i + 1 - dm > 6) y -= 1; else if (dm - (i + 1) > 6) y += 1;
    return `${y}-${String(i + 1).padStart(2, '0')}`;
  }
  const isSalary = (r) => r && r.type === 'expense' && r.category === 'Salary' && !isHqPaid(r);
  const mentionsSalary = (r) => /salar|ordenado|wage/i.test(String(r.description || ''));
  function payeeOf(desc) {
    let s = String(desc || '').trim(); let m;
    if ((m = s.match(/^salary\s+for\s+(.+)$/i))) s = m[1];
    if ((m = s.match(/^(.+?)['’]s\s+salary\b/i))) s = m[1];
    s = s.split(/\s+[—–-]\s+|\s*·\s*|\s*\(|,/)[0].trim();
    return s;
  }
  const STOP = new Set(['salary', 'salario', 'ordenado', 'month', 'local', 'for', 'the', 'and']);
  const tokens = (s) => norm(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  // Expected = the salaries of the month before, one entry per payee. A payee
  // counts as many times as he appears on ONE day (3 × «Surf instructor» on
  // the 30th = 3 people; Sithum on the 2nd and the 31st = 1 person).
  function expectedPayees(rows, mk) {
    const by = new Map();
    rows.filter((r) => isSalary(r) && mentionsSalary(r) && salaryMonth(r) === mk).forEach((r) => {
      const label = payeeOf(r.description); const key = norm(label); if (!key || !tokens(label).length) return;
      const e = by.get(key) || { key, label, perDay: new Map() };
      e.perDay.set(r.date, (e.perDay.get(r.date) || 0) + 1);
      by.set(key, e);
    });
    return [...by.values()].map((e) => ({ key: e.key, label: e.label, tokens: tokens(e.label), count: Math.max(...e.perDay.values()) }));
  }
  function salaryStatus(rows, today) {
    const day = Number(today.slice(8, 10));
    const target = day >= SALARY_DUE_DAY ? monthKey(today) : shiftMonth(monthKey(today), -1);
    const prev = shiftMonth(target, -1);
    const dismissed = new Set(wls.get(NOT_EXPECTED_KEY(), []));
    const all = expectedPayees(rows, prev);
    const expected = all.filter((e) => !dismissed.has(e.key));
    const pool = rows.filter((r) => isSalary(r) && salaryMonth(r) === target).map((r) => ({ r, t: new Set(norm(r.description).split(' ')), used: false }));
    const firstCount = new Map(); expected.forEach((e) => firstCount.set(e.tokens[0], (firstCount.get(e.tokens[0]) || 0) + 1));
    const res = expected.slice().sort((a, b) => b.tokens.length - a.tokens.length).map((e) => {
      let found = 0;
      const take = (test) => { pool.forEach((p) => { if (found < e.count && !p.used && test(p)) { p.used = true; found++; } }); };
      take((p) => e.tokens.every((w) => p.t.has(w)));
      // «Francisco G.» for «Francisco Guimarães»: the first name alone, when no other payee shares it.
      if (found < e.count && e.tokens[0].length >= 4 && firstCount.get(e.tokens[0]) === 1) take((p) => p.t.has(e.tokens[0]));
      return { ...e, found };
    });
    const total = res.reduce((s, e) => s + e.count, 0);
    const have = res.reduce((s, e) => s + Math.min(e.found, e.count), 0);
    const missing = res.filter((e) => e.found < e.count).sort((a, b) => a.label.localeCompare(b.label));
    return { target, prev, total, have, missing, dismissed: all.filter((e) => dismissed.has(e.key)) };
  }
  const NOT_EXPECTED_KEY = () => `campExtras.salaryNotExpected.${slug()}`;
  const monthName = (mk) => MONTH_EN[Number(mk.slice(5, 7)) - 1];
  const missingLabel = (e) => `${e.label}${e.count - e.found > 1 ? ` ×${e.count - e.found}` : ''}`;

  const salaryCheck = {
    id: 'salaries-missing',
    run(ctx) {
      if (!ctx || ctx.isLocal || !EXTRAS_LOCATIONS.includes(ctx.location) || !fullView()) return null;
      const st = salaryStatus(ctx.ledger || [], ctx.today);
      if (!st.total || !st.missing.length) return null;
      const names = st.missing.slice(0, 3).map(missingLabel).join(', ') + (st.missing.length > 3 ? ` +${st.missing.length - 3}` : '');   // the modal has the full list
      return { text: `${monthName(st.target)} salaries: ${st.have} of ${st.total} in the ledger – missing ${names}`, level: 'warn', onClick: openSalaries };
    },
  };

  // Payroll still due this month, paid from the camp's bank.
  function moneyStatus(rows, today) {
    const mk = monthKey(today); const prev = shiftMonth(mk, -1);
    const bankSalary = (m) => rows.filter((r) => isSalary(r) && r.paymentMethod === 'Bank Transfer' && salaryMonth(r) === m).reduce((s, r) => s + localAmt(r), 0);
    const payroll = bankSalary(prev);
    const paid = bankSalary(mk);
    const due = Math.max(0, payroll - paid);
    const bank = ledgerDrawerBalances(rows).bankLocal;    // same rows as the Bank tile (all of S.ledger)
    const fx = (typeof LOCAL_PER_EUR !== 'undefined' && Number(LOCAL_PER_EUR) > 0) ? Number(LOCAL_PER_EUR) : 0;
    const need = Math.max(0, due - bank);
    return { payroll, paid, due, bank, need, eur: fx ? need / fx : 0 };
  }
  const moneyCheck = {
    id: 'money-from-hq-needed',
    run(ctx) {
      if (!ctx || ctx.isLocal || !EXTRAS_LOCATIONS.includes(ctx.location) || !fullView()) return null;
      if (Number(String(ctx.today).slice(8, 10)) < MONEY_CHIP_FROM_DAY) return null;
      const m = moneyStatus(ctx.ledger || [], ctx.today);
      if (!(m.due > 0) || m.bank >= m.due) return null;
      return { text: `Bank LKR ${int(m.bank)} · payroll ~${int(m.due)} due ~${SALARY_DUE_DAY}th → Money from HQ needed ≈ LKR ${int(m.need)}${m.eur ? ` (≈ € ${int(m.eur)})` : ''}`, level: 'warn' };
    },
  };

  // ── B9 · Tour sold this week with no cost ─────────────────────────────────
  function toursWithoutCost(rows, today) {
    const ws = weekStart(today); const from = addDays(ws, -TOUR_COST_LOOKBACK_DAYS);
    const sold = new Map();
    rows.forEach((r) => {
      const d = String(r.date || '');
      if (!isIncome(r) || !/^tours?$/i.test(String(r.category || '').trim()) || d < ws || d > today) return;
      const item = String(r.linkedItem || '').trim(); if (!item || TOURS_WITHOUT_COST.includes(item)) return;
      sold.set(item, (sold.get(item) || 0) + (Number(r.quantity) > 0 ? Number(r.quantity) : 1));
    });
    const costed = new Set(rows.filter((r) => r.type === 'expense' && String(r.date || '') >= from && String(r.date || '') <= today).map((r) => String(r.linkedItem || '').trim()).filter(Boolean));
    return [...sold.entries()].filter(([item]) => !costed.has(item)).map(([item, n]) => ({ item, n }));
  }
  const tourCheck = {
    id: 'tour-without-cost',
    run(ctx) {
      if (!ctx || ctx.isLocal || !EXTRAS_LOCATIONS.includes(ctx.location) || !fullView()) return null;
      const list = toursWithoutCost(ctx.ledger || [], ctx.today);
      if (!list.length) return null;
      return { text: `Tour sold this week with no cost: ${list.map((x) => `${x.item} ×${x.n}`).join(', ')}`, level: 'info' };
    },
  };

  [salaryCheck, moneyCheck, tourCheck].forEach((c) => { if (!window.CAMP_CHECKS.some((x) => x && x.id === c.id)) window.CAMP_CHECKS.push(c); });
  const redrawChecks = () => { try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {} };

  // ── Salaries modal: «Not expected anymore» per person ────────────────────
  function ensureOverlay(id) {
    let ov = document.getElementById(id);
    if (ov) return ov;
    ov = document.createElement('div'); ov.className = 'overlay'; ov.id = id;
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="mhdr"><div class="mhdr-title"></div><div class="mhdr-sub"></div></div><div class="mbody"></div><div class="mfooter"></div></div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
    document.body.appendChild(ov);
    return ov;
  }
  function openSalaries() { injectStyles(); ensureOverlay('exSalOv').classList.add('open'); drawSalaries(); }
  function drawSalaries() {
    const ov = document.getElementById('exSalOv'); if (!ov) return;
    const st = salaryStatus(ledger(), colomboToday());
    ov.querySelector('.mhdr-title').textContent = `${monthName(st.target)} salaries`;
    ov.querySelector('.mhdr-sub').textContent = `${st.have} of ${st.total} in the ledger · expected = the ${monthName(st.prev)} salaries`;
    const row = (e, btn) => `<div class="ex-sal-row"><div class="ex-sal-main"><b>${esc(e.label)}</b>${e.count > 1 ? `<span class="ex-sal-sub">${e.found} of ${e.count}</span>` : ''}</div>${btn}</div>`;
    ov.querySelector('.mbody').innerHTML = `
      ${st.missing.length ? `<div class="ex-sal-h">Missing</div>${st.missing.map((e) => row(e, `<button class="btn btn-s btn-sm" data-not-expected="${esc(e.key)}">Not expected anymore</button>`)).join('')}` : '<div class="ex-sal-h">Nothing missing</div>'}
      ${st.dismissed.length ? `<div class="ex-sal-h">Not expected anymore</div>${st.dismissed.map((e) => row(e, `<button class="btn btn-s btn-sm" data-expected="${esc(e.key)}">Expected again</button>`)).join('')}` : ''}
      <div class="ex-small">Read-only: nothing is written to the ledger. «Not expected anymore» is kept on this browser only.</div>`;
    ov.querySelector('.mfooter').innerHTML = '<button class="btn btn-p" data-ex-close="1">Done</button>';
    ov.onclick = (e) => {
      if (e.target === ov || e.target.closest('[data-ex-close]')) { ov.classList.remove('open'); return; }
      const a = e.target.closest('[data-not-expected]'); const b = e.target.closest('[data-expected]');
      if (!a && !b) return;
      const set = new Set(wls.get(NOT_EXPECTED_KEY(), []));
      if (a) set.add(a.dataset.notExpected); else set.delete(b.dataset.expected);
      wls.set(NOT_EXPECTED_KEY(), [...set]);
      drawSalaries(); redrawChecks();
    };
  }

  // ── B6 · «This week» card at the top of the Weekly P&L ───────────────────
  function weekNumbers(today) {
    const ws = weekStart(today); const we = addDays(ws, 6);
    const rows = ledger();
    const inWeek = rows.filter((r) => { const d = String(r.date || ''); return d >= ws && d <= we; });
    const bar = inWeek.filter((r) => isIncome(r) && /^camp_?tab|^campclose/i.test(String(r.sourceKind || ''))).reduce((s, r) => s + localAmt(r), 0);
    let spentCash = 0, spentBank = 0;
    inWeek.filter((r) => r.type === 'expense').forEach((r) => { const d = ledgerDrawerDelta(r); if (d.cash < 0) spentCash += localAmt(r); else if (d.bank < 0) spentBank += localAmt(r); });
    // Guests: the Guests file (this Sat–Fri week), else the HQ bookings the table uses.
    let guests = null, guestsSrc = '';
    if (state.guestsLoaded) {
      const seen = new Set(state.guests.filter(liveGuest).filter((g) => String(g.check_in) <= we && String(g.check_out) > ws).map(guestId));
      if (seen.size) { guests = seen.size; guestsSrc = 'Guests file'; }
    }
    if (guests == null && typeof ovBookings !== 'undefined' && Array.isArray(ovBookings) && ovBookings.length && typeof ovBookingGuestCount === 'function') {
      guests = ovBookingGuestCount(ovBookingsForWeeks([{ start: ws }])); guestsSrc = 'HQ bookings';
    }
    // Cash: the one drawer rule today vs the last count (cash-count.js).
    const cashNow = ledgerDrawerBalances(rows.filter((r) => String(r.date || '') <= today)).cashLocal;
    const CC = window.CampCash;
    const last = CC && CC.state && CC.state.available && CC.state.counts && CC.state.counts[0];
    const lastView = last && typeof CC.countView === 'function' ? CC.countView(last) : null;
    const through = CC && typeof CC.statementThrough === 'function' ? CC.statementThrough(today) : null;
    // Transfers (transport.js, read-only): this week's trips with its own rules.
    const T = window.TransportUI; const TS = T && T._state;
    let tr = null;
    if (TS && TS.loaded) {
      const trips = TS.trips || [];
      const wk = trips.filter((t) => t.trip_date >= ws && t.trip_date <= we);
      const air = (t) => t.kind === 'airport_arrival' || t.kind === 'airport_departure';
      tr = {
        booked: wk.filter((t) => air(t) && t.source === 'bookinglayer' && !['cancelled', 'merged'].includes(t.status)).length,
        done: wk.filter((t) => T.isDone(t) && !['cancelled', 'no_show', 'merged'].includes(t.status)).length,
        paid: wk.filter((t) => t.payment_entry_id).length,
        owed: trips.filter((t) => T.reconcileStatus(t) === 'owed').reduce((s, t) => s + Number(t.expected_price || 0), 0),
      };
    }
    // Guests file age: the export date the import stamped on the trips, else the last import.
    let fileDate = '', fileWord = '';
    if (TS && TS.loaded) (TS.trips || []).forEach((t) => { if (t.last_export_date && String(t.last_export_date) > fileDate) { fileDate = String(t.last_export_date).slice(0, 10); fileWord = 'exported'; } });
    if (!fileDate && state.guestsLoaded) state.guests.forEach((g) => { const d = g.updated_at ? new Intl.DateTimeFormat('en-CA', { timeZone: CAMP_TZ }).format(new Date(g.updated_at)) : ''; if (d > fileDate) { fileDate = d; fileWord = 'imported'; } });
    return { ws, we, bar, spentCash, spentBank, guests, guestsSrc, cashNow, last, lastView, through, tr, fileDate, fileWord, fileAge: fileDate ? daysBetween(fileDate, today) : null };
  }
  function weekCardHtml() {
    const today = colomboToday();
    const N = weekNumbers(today);
    const row = (k, v, sub) => `<div class="ex-wk-row"><div class="ex-wk-k">${k}</div><div class="ex-wk-v">${v}${sub ? `<div class="ex-wk-sub">${sub}</div>` : ''}</div></div>`;
    const diffTxt = (v) => (Math.abs(v.diff) < 0.005 ? 'matches' : `${v.diff < 0 ? '−' : '+'}${int(Math.abs(v.diff))}`);
    const lines = [
      row('Guests', N.guests == null ? '—' : String(N.guests), N.guestsSrc),
      row('Bar sales', lkrTxt(N.bar), 'Camp Tab'),
      row('Spent', `cash ${lkrTxt(N.spentCash)} · bank ${lkrTxt(N.spentBank)}`),
      row('Cash', `expected ${lkrTxt(N.cashNow)}`, N.lastView ? `last count ${dMon(N.last.count_date)}: counted ${int(N.lastView.counted)} · ${diffTxt(N.lastView)}${N.lastView.settled ? ' · settled' : ''}${N.through ? ` · statement up to ${dMon(N.through)}` : ''}` : `no count yet${N.through ? ` · statement up to ${dMon(N.through)}` : ''}`),
      row('Transfers', N.tr ? `${N.tr.booked} booked · ${N.tr.done} done · ${N.tr.paid} paid` : '—', N.tr ? `owed to drivers ${lkrTxt(N.tr.owed)}` : 'Transport not loaded'),
      row('Guests file', N.fileDate ? `${N.fileWord} ${dMon(N.fileDate)}` : 'not imported', N.fileDate ? (N.fileAge <= 0 ? 'today' : `${N.fileAge} day${N.fileAge === 1 ? '' : 's'} old`) : 'Week → import on Monday'),
    ];
    return `<div class="card ex-wk" id="exWeekCard"><div class="card-pad ex-wk-hdr"><div class="card-title">This week · ${range(N.ws, N.we)}</div></div><div class="ex-wk-body">${lines.join('')}</div></div>`;
  }
  function renderWeekCard() {
    const el = document.getElementById('weeklyContent'); if (!el) return;
    const old = document.getElementById('exWeekCard');
    if (!fullView()) { if (old) old.remove(); return; }
    injectStyles();
    const html = weekCardHtml();
    if (old) { old.outerHTML = html; return; }
    // Under the week's P&L and the chart when the page has a slot for it.
    const slot = document.getElementById('wplExtrasSlot');
    if (slot) slot.innerHTML = html; else el.insertAdjacentHTML('afterbegin', html);
  }
  // Called at the end of renderWeeklyPL() in index.html.
  window.campExtrasAfterWeekly = function () { try { renderWeekCard(); } catch (err) { console.warn('[extras] week card', err); } };

  // ── Styles (scoped; tokens from /lib/app-shell.css) ───────────────────────
  function injectStyles() {
    if (document.getElementById('campExtrasCss')) return;
    const st = document.createElement('style');
    st.id = 'campExtrasCss';
    st.textContent = `
#page-pos .hub-embed-wrap.ex-has-chips{display:flex;flex-direction:column}
#page-pos .hub-embed-wrap.ex-has-chips .hub-embed-frame{flex:1 1 auto;min-height:0;height:auto}
#exLeaving{flex:0 0 auto;padding:8px 12px 6px;background:var(--bg)}
#exLeaving .health-strip{padding:0}
#exLeaving .health-chip{white-space:normal;height:auto;min-height:var(--h-pill);padding:5px 12px;text-align:left;line-height:1.3;max-width:100%}
#exLeaving .health-chip.ex-on{background:var(--amber);color:#fff;border-color:var(--amber)}
.ex-leave-list{margin-top:6px;border:1px solid var(--border);border-radius:var(--r-sm);background:#fff;max-height:30vh;overflow-y:auto}
.ex-leave-row{display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-bottom:1px solid var(--border);font-size:13px}
.ex-leave-row:last-child{border-bottom:none}
.ex-leave-row .num{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
.ex-wk{margin-bottom:16px}
.ex-wk-hdr{border-bottom:1px solid var(--border)}
.ex-wk-body{padding:12px var(--card-pad,16px) 14px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 24px}
.ex-wk-row{display:flex;flex-direction:column;gap:2px;font-size:13.5px;min-width:0}
.ex-wk-k{color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.ex-wk-v{font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums;min-width:0;overflow-wrap:anywhere}
@media (max-width:700px){.ex-wk-body{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}}
.ex-wk-sub{font-weight:500;color:var(--muted);font-size:12px;margin-top:2px}
#exSalOv .modal{max-width:420px}
.ex-sal-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:6px 0 4px}
.ex-sal-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)}
.ex-sal-main{display:flex;flex-direction:column;gap:1px;min-width:0;font-size:14px}
.ex-sal-sub{color:var(--muted);font-size:12px}
.ex-small{font-size:12px;color:var(--muted);line-height:1.45;margin-top:12px}
@media (max-width:600px){
  #exSalOv{padding:0;align-items:stretch}
  #exSalOv .modal{max-width:none;max-height:100vh;height:100%;border-radius:0;display:flex;flex-direction:column}
  #exSalOv .mbody{flex:1;overflow-y:auto}
  #exSalOv .mfooter .btn{flex:1;height:44px}
}`;
    document.head.appendChild(st);
  }

  // Transport / cash data arrive later: redraw the card; a new import → prefill again.
  window.addEventListener('camp-checks-changed', () => {
    try { if (typeof activePage !== 'undefined' && activePage === 'weekly') renderWeekCard(); } catch (_) {}
    if (!fullView()) return;
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(async () => {
      const before = JSON.stringify(state.guests);
      await loadWeekGuests();
      if (JSON.stringify(state.guests) !== before) {
        try { if (typeof activePage !== 'undefined' && activePage === 'weekly') renderWeekCard(); } catch (_) {}
        if (state.prefill.started) prefillCampTab(false);
      }
    }, 400);
  });
  // The date rolls over at midnight Colombo: redraw the leaving chips.
  setInterval(() => { try { renderLeaving(); } catch (_) {} }, 5 * 60 * 1000);

  window.CampExtras = {
    state, colomboToday, weekStart, salaryMonth, payeeOf, expectedPayees, salaryStatus, moneyStatus, toursWithoutCost,
    leavingGroups, prefillList, prefillCampTab, loadWeekGuests, renderLeaving, renderWeekCard, openSalaries,
    checks: { salaryCheck, moneyCheck, tourCheck },
    settings: { EXTRAS_LOCATIONS, SALARY_DUE_DAY, MONEY_CHIP_FROM_DAY, TOUR_COST_LOOKBACK_DAYS, TOURS_WITHOUT_COST },
  };
})();
