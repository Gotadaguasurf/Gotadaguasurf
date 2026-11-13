/* ════════════════════════════════════════════════════════════════════════════
   Camp hub — cash count + checks strip (Sri Lanka Phase 1, 13 Nov 2026)

   1. The evening cash count. The local manager (Nadith, ?view=local) opens it
      from his Cash tile: bar box → pocket/office → ATM after the statement →
      result with a reason. Expected = the ledger's ONE cash rule
      (ledgerDrawerBalances in index.html) over every row dated on or before
      the count day, plus the withdrawals he declares that the statement in
      the app doesn't have yet. Saved to camp_cash_counts
      (supabase/camp-cash-count.sql).
   2. Full users (Francisco, Miguel) see the Counts history under the Cash tile
      and Settle a count through the RPC camp_cash_settle: within the
      tolerance it closes with no row; otherwise one «Cash count» transfer.
   3. The checks strip under the ledger tiles (#expChecks) and on the Overview
      (#ovChecks). Any script can register a check:
        window.CAMP_CHECKS.push({id, run(ctx) → null | {text, level, onClick?}})
        ctx = {ledger: S.ledger, location: slug, isLocal, today}  (+ hour, counts)
      In ?view=local only the checks that concern the manager are drawn
      (LOCAL_CHECK_IDS, or a check with `local:true`): Miguel keeps his view
      exactly as it was (13 Nov 2026).

   Index.html globals used (classic-script globals, NOT window properties):
   S, LOCAL_MANAGER_MODE, __HUB_LOCATION_SLUG, LOCAL_CURRENCY, HUB_LEDGER_HYDRATED,
   ledgerDrawerBalances, entryLocalDisplayAmount, getHubSupabaseClient,
   ensureHubLocationId, dbRowToLedgerEntry, renderExpenses, renderOverview,
   showPage, setExpPeriodUnified, toast, escapeHtml, notifyLedgerChanged,
   hydrateLedgerFromSupabase.
   ════════════════════════════════════════════════════════════════════════════ */
window.CAMP_CHECKS = window.CAMP_CHECKS || [];
(function(){
  'use strict';

  // ── Settings (Miguel may change these) ────────────────────────────────────
  const CASH_COUNT_LOCATIONS = ['sri-lanka'];   // camps with the count + strip
  const CASH_TZ = 'Asia/Colombo';               // the camp's own day
  const COUNT_DUE_HOUR = 18;                    // «Count the cash» from 18:00 camp time
  const TOLERANCE = 1000;                       // same as camp_cash_tolerance() in SQL
  const SILENT_DAYS = 2;                        // no cash payment typed for this many days…
  const DUP_WINDOW_DAYS = 14;                   // duplicate: within 14 days + similar text
  const DUP_SIMILARITY = 0.5;
  const DUP_LOOKBACK_DAYS = 45;                 // only recent rows can be flagged
  const DUP_MAX_CHIPS = 3;
  const LOCAL_CHECK_IDS = ['cash-count-today', 'cash-duplicate'];
  const NOTES = [5000, 2000, 1000, 500, 100, 50, 20];
  const REASONS = [
    { v: 'payments_not_entered', t: 'Payments not entered', s: 'I will add them now' },
    { v: 'revenue_not_entered', t: 'Revenue not entered', s: 'Check Out, bar' },
    { v: 'unknown', t: "I don't know", s: 'Francisco will look' },
  ];

  const state = {
    available: false,     // camp_cash_counts readable (false until loaded, or if the table is missing)
    loaded: false,
    counts: [],
    error: null,
  };

  // ── Small helpers ─────────────────────────────────────────────────────────
  const slug = () => (typeof __HUB_LOCATION_SLUG !== 'undefined' ? __HUB_LOCATION_SLUG : '');
  const isLocal = () => (typeof LOCAL_MANAGER_MODE !== 'undefined' && LOCAL_MANAGER_MODE === true);
  const enabled = () => CASH_COUNT_LOCATIONS.includes(slug());
  const ledger = () => (typeof S !== 'undefined' && S && Array.isArray(S.ledger) ? S.ledger : []);
  const cur = () => (typeof LOCAL_CURRENCY !== 'undefined' && LOCAL_CURRENCY) || 'LKR';
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const num = (n, dec = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const money = (n) => `${cur()} ${num(Math.abs(n))}`;
  const short = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const localAmt = (r) => (typeof entryLocalDisplayAmount === 'function' ? entryLocalDisplayAmount(r) : Number(r.amountLocal || 0));
  const say = (msg, kind) => { try { if (typeof toast === 'function') toast(msg, kind); } catch (_) {} };

  // The camp's date and hour — never through toISOString (UTC day shift).
  function colombo(d) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CASH_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d || new Date());
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24, time: `${g('hour')}:${g('minute')}` };
  }
  const colomboDateOf = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : colombo(d).date; };
  const dayNum = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000; };
  const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dMon = (ymd) => { const [, m, d] = String(ymd || '').split('-').map(Number); return ymd ? `${d} ${MON[(m || 1) - 1]}` : ''; };
  const addDays = (ymd, n) => { const t = new Date((dayNum(ymd) + n) * 86400000); return t.toISOString().slice(0, 10); }; // pure date arithmetic on a UTC midnight

  const isAtm = (r) => r && r.type === 'transfer' && r.paymentMethod === 'ATM Withdrawal';
  const sk = (r) => String((r && r.sourceKind) || '').toLowerCase();

  // «The bank statement in the app goes up to …»: the last ATM withdrawal
  // dated on or before the day (Phase 1 has no statement-load marker).
  function statementThrough(onOrBefore) {
    let best = '';
    ledger().forEach((r) => { const d = String(r.date || ''); if (isAtm(r) && d <= onOrBefore && d > best) best = d; });
    return best || null;
  }

  // Expected cash for a count — the ONE drawer rule, rows dated ≤ the count day.
  // Declared ATM withdrawals count until the statement brings the real ones:
  //   real    = withdrawals now in the ledger dated (snapshot, count day]
  //   covered = the statement reaches past the count day (an ATM row dated after it)
  //   declared used = covered ? 0 : max(0, declared − real)
  // so a statement loaded only part of the way (e.g. through the day before
  // the count) never drops the part still missing. Same rule in SQL
  // (camp_cash_settle).
  function expectedFor(countDate, declared, snapshotThrough) {
    const all = ledger();
    const rows = all.filter((r) => String(r.date || '') <= countDate);
    const ledgerCash = round2(ledgerDrawerBalances(rows).cashLocal);
    const from = snapshotThrough || '';
    const real = round2(rows.filter((r) => isAtm(r) && String(r.date || '') > from).reduce((s, r) => s + localAmt(r), 0));
    const covered = all.some((r) => isAtm(r) && String(r.date || '') > countDate);
    const declaredUsed = covered ? 0 : round2(Math.max(0, Number(declared || 0) - real));
    return { ledgerCash, real, covered, declaredUsed, expected: round2(ledgerCash + declaredUsed) };
  }
  function countView(c) {
    const e = expectedFor(c.count_date, Number(c.declared_unloaded_withdrawals || 0), c.statement_through);
    const counted = round2(Number(c.bar_box || 0) + Number(c.pocket || 0));
    const settled = c.status === 'settled';
    const expected = settled && c.settled_expected != null ? Number(c.settled_expected) : e.expected;
    const diff = settled && c.settled_difference != null ? Number(c.settled_difference) : round2(counted - e.expected);
    return { ...e, counted, expected, diff, settled };
  }
  function diffWords(diff) {
    if (Math.abs(diff) < 0.005) return 'Matches the app';
    return `${money(diff)} ${diff < 0 ? 'less' : 'more'} than the app expects`;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadCounts() {
    if (!enabled()) return;
    try {
      const client = typeof getHubSupabaseClient === 'function' ? getHubSupabaseClient() : null;
      const locationId = client && typeof ensureHubLocationId === 'function' ? await ensureHubLocationId() : '';
      if (!client || !locationId) throw new Error('no client');
      const { data, error } = await client.from('camp_cash_counts').select('*')
        .eq('location_id', locationId)
        .order('count_date', { ascending: false }).order('created_at', { ascending: false })
        .limit(90);
      if (error) throw error;
      state.counts = Array.isArray(data) ? data : [];
      state.available = true; state.error = null;
    } catch (err) {
      // Table not created yet, or no session: no count button, no «not
      // counted» chip — unknown is not the same as «not counted».
      state.available = false; state.error = err;
    }
    state.loaded = true;
    renderAll();
  }
  const sortCounts = () => state.counts.sort((a, b) => (String(b.count_date).localeCompare(String(a.count_date)) || String(b.created_at || '').localeCompare(String(a.created_at || ''))));

  // ── Styles (scoped; tokens from /lib/app-shell.css) ───────────────────────
  function injectStyles() {
    if (document.getElementById('cashCountCss')) return;
    const st = document.createElement('style');
    st.id = 'cashCountCss';
    st.textContent = `
#expChecks .health-strip,#ovChecks .health-strip{padding:0;margin:12px 0 4px}
#ovChecks .health-strip{margin:0 0 16px}
#expChecks .health-chip,#ovChecks .health-chip{white-space:normal;height:auto;min-height:var(--h-pill);padding:5px 12px;text-align:left;line-height:1.3;max-width:100%}
.health-chip.cc-info{background:var(--ocean-soft);border-color:#cfe2f2;color:var(--ocean)}
.health-chip.cc-info:hover{background:var(--ocean);color:#fff;border-color:var(--ocean)}
.cc-filter{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 10px;padding:10px 12px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:var(--r-sm);font-size:var(--fs-sec);color:var(--ink);scroll-margin-top:80px}
.cc-filter span{flex:1 1 100%}
.cc-tile{margin-top:10px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.cc-last{font-size:var(--fs-sec);color:var(--muted)}
.cc-hist{width:100%;font-size:12.5px}
.cc-hist summary{cursor:pointer;color:var(--ocean);font-weight:600;list-style:none}
.cc-hist summary::-webkit-details-marker{display:none}
.cc-hrow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)}
.cc-hrow:last-child{border-bottom:none}
.cc-hrow .cc-hmain{display:flex;flex-direction:column;gap:1px;min-width:0}
.cc-hrow .cc-hsub{color:var(--muted);font-size:11.5px}
#cashCountOv .modal,#cashSettleOv .modal{max-width:420px}
.cc-q{font-size:18px;font-weight:700;color:var(--navy);line-height:1.3;margin-bottom:6px}
.cc-hint{font-size:var(--fs-sec);color:var(--muted);line-height:1.45;margin-bottom:14px}
.cc-amt{width:100%;height:52px;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;border:1.5px solid var(--border-2);border-radius:var(--r-sm);padding:0 14px;font-family:inherit;color:var(--navy)}
.cc-amt:focus{outline:none;border-color:var(--ocean);box-shadow:var(--ring)}
.cc-link{background:none;border:none;color:var(--ocean);font-weight:600;font-size:13px;padding:8px 0;cursor:pointer;font-family:inherit}
.cc-notes{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;margin-top:6px;font-size:13px}
.cc-notes input{width:100%;height:34px;border:1px solid var(--border-2);border-radius:8px;padding:0 8px;font-family:inherit;font-size:14px}
.cc-notes .r{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.cc-choice{display:flex;gap:8px;margin-bottom:12px}
.cc-choice button,.cc-reason button{flex:1;min-height:44px;border:1.5px solid var(--border-2);background:#fff;border-radius:var(--r-sm);font-family:inherit;font-size:14px;font-weight:600;color:var(--navy);cursor:pointer;padding:8px 10px;text-align:left}
.cc-choice button{text-align:center}
.cc-choice button.on,.cc-reason button.on{border-color:var(--ocean);background:var(--ocean-soft);color:var(--ocean)}
.cc-reason{display:flex;flex-direction:column;gap:8px;margin:8px 0 12px}
.cc-reason small{display:block;font-weight:500;color:var(--muted);font-size:12px}
.cc-big{font-size:20px;font-weight:700;line-height:1.3;margin-bottom:12px}
.cc-big.neg{color:var(--red)}.cc-big.pos{color:var(--green)}.cc-big.zero{color:var(--navy)}
.cc-sum{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:12px}
.cc-sum td{padding:7px 0;border-bottom:1px solid var(--border)}
.cc-sum td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.cc-sum tr.tot td{font-weight:700;color:var(--navy)}
.cc-note{width:100%;min-height:60px;border:1.5px solid var(--border-2);border-radius:var(--r-sm);padding:8px 12px;font-family:inherit;font-size:14px;resize:vertical}
.cc-warn{font-size:12.5px;background:var(--amber-bg);border:1px solid var(--amber-border);color:var(--amber);border-radius:8px;padding:8px 10px;margin-bottom:12px;line-height:1.45}
.cc-small{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px}
@media (max-width:600px){
  #cashCountOv,#cashSettleOv{padding:0;align-items:stretch}
  #cashCountOv .modal,#cashSettleOv .modal{max-width:none;max-height:100vh;height:100%;border-radius:0;display:flex;flex-direction:column}
  #cashCountOv .mbody,#cashSettleOv .mbody{flex:1;overflow-y:auto}
  #cashCountOv .mfooter .btn,#cashSettleOv .mfooter .btn{flex:1;height:44px}
}`;
    document.head.appendChild(st);
  }

  function ensureOverlay(id) {
    let ov = document.getElementById(id);
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = id;
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="mhdr"><div class="mhdr-title"></div><div class="mhdr-sub"></div></div><div class="mbody"></div><div class="mfooter"></div></div>`;
    document.body.appendChild(ov);
    return ov;
  }
  const closeOverlay = (id) => { const ov = document.getElementById(id); if (ov) ov.classList.remove('open'); };

  // ── The count (4 screens) ─────────────────────────────────────────────────
  let draft = null;
  function openCount() {
    if (!enabled() || !state.available) return;
    injectStyles();
    const today = colombo().date;
    draft = { step: 1, date: today, bar: '', pocket: '', took: null, declared: '', reason: '', note: '', notes: {}, showNotes: false, saving: false, through: statementThrough(today) };
    ensureOverlay('cashCountOv').classList.add('open');
    drawCount();
  }
  function readDraftInputs() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
    if (draft.step === 1 && v('ccBar') !== undefined) draft.bar = v('ccBar');
    if (draft.step === 2 && v('ccPocket') !== undefined) draft.pocket = v('ccPocket');
    if (draft.step === 3 && v('ccDeclared') !== undefined) draft.declared = v('ccDeclared');
    if (draft.step === 4 && v('ccNote') !== undefined) draft.note = v('ccNote');
  }
  const amtOf = (s) => { const n = Number(String(s == null ? '' : s).replace(/,/g, '')); return isFinite(n) && n >= 0 ? n : NaN; };
  function draftNumbers() {
    const bar = amtOf(draft.bar || 0), pocket = amtOf(draft.pocket || 0);
    const declared = draft.took ? amtOf(draft.declared || 0) : 0;
    const e = expectedFor(draft.date, declared, draft.through);
    const counted = round2(bar + pocket);
    return { bar, pocket, declared, counted, ...e, diff: round2(counted - e.expected) };
  }
  function drawCount() {
    const ov = ensureOverlay('cashCountOv');
    const q = (s) => ov.querySelector(s);
    q('.mhdr-title').textContent = 'Count cash';
    q('.mhdr-sub').textContent = `${dMon(draft.date)} · ${draft.step} of 4`;
    const through = draft.through ? dMon(draft.through) : '';
    let body = '', foot = '';
    const back = draft.step > 1 ? `<button class="btn btn-s" data-cc="back">Back</button>` : `<button class="btn btn-s" data-cc="cancel">Cancel</button>`;
    if (draft.step === 1) {
      const rows = NOTES.map((n) => `<span>${short(n)} ×</span><input type="number" inputmode="numeric" min="0" step="1" data-note="${n}" value="${draft.notes[n] || ''}" aria-label="${n} notes"><span class="r" data-note-sum="${n}">${short((draft.notes[n] || 0) * n)}</span>`).join('')
        + `<span>Coins</span><input type="number" inputmode="decimal" min="0" step="1" data-note="coins" value="${draft.notes.coins || ''}" aria-label="Coins"><span class="r" data-note-sum="coins">${short(draft.notes.coins || 0)}</span>`;
      body = `<div class="cc-q">How much cash is in the bar box?</div>
        <div class="cc-hint">Count the notes and coins in the bar box only.</div>
        <input class="cc-amt" id="ccBar" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${esc(draft.bar)}" aria-label="Bar box">
        <button class="cc-link" data-cc="notes">${draft.showNotes ? 'Hide the notes' : 'Count by notes'}</button>
        ${draft.showNotes ? `<div class="cc-notes">${rows}</div>` : ''}`;
      foot = `${back}<button class="btn btn-p" data-cc="next">Next</button>`;
    } else if (draft.step === 2) {
      body = `<div class="cc-q">And the rest of the camp cash?</div>
        <div class="cc-hint">Your pocket, the office: every rupee of camp money that is not in the bar box.</div>
        <input class="cc-amt" id="ccPocket" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${esc(draft.pocket)}" aria-label="Pocket and office">`;
      foot = `${back}<button class="btn btn-p" data-cc="next">Next</button>`;
    } else if (draft.step === 3) {
      const qtext = through ? `Cash you took from the ATM after ${through}?` : 'Cash you took from the ATM that is not in the app?';
      const hint = through ? `The bank statement in the app goes up to <strong>${through}</strong>. Withdrawals after that are not in the app yet.` : 'The app has no ATM withdrawals from the bank statement yet.';
      body = `<div class="cc-q">${qtext}</div>
        <div class="cc-hint">${hint}</div>
        <div class="cc-choice"><button data-cc="took-no" class="${draft.took === false ? 'on' : ''}">None</button><button data-cc="took-yes" class="${draft.took ? 'on' : ''}">I took cash</button></div>
        ${draft.took ? `<div class="mfield"><label for="ccDeclared">Amount taken${through ? ` after ${through}` : ''}</label><input class="cc-amt" id="ccDeclared" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${esc(draft.declared)}"></div>` : ''}
        <div class="cc-small">This is saved with the count only. It is not added to the ledger: withdrawals come from the bank statement, which HQ loads every few days.</div>`;
      foot = `${back}<button class="btn btn-p" data-cc="next" ${draft.took === null ? 'disabled' : ''}>Next</button>`;
    } else {
      const n = draftNumbers();
      const cls = Math.abs(n.diff) < 0.005 ? 'zero' : n.diff < 0 ? 'neg' : 'pos';
      const needReason = Math.abs(n.diff) > TOLERANCE;
      body = `<div class="cc-big ${cls}" id="ccResult">${diffWords(n.diff)}</div>
        <table class="cc-sum">
          <tr><td>Bar box</td><td class="r">${num(n.bar)}</td></tr>
          <tr><td>Pocket / office</td><td class="r">${num(n.pocket)}</td></tr>
          <tr class="tot"><td>Counted</td><td class="r">${num(n.counted)}</td></tr>
          <tr><td>Expected by the app</td><td class="r" id="ccExpected">${num(n.ledgerCash)}</td></tr>
          <tr><td>+ taken ${through ? `after ${through}` : 'from the ATM'}</td><td class="r">${num(n.declaredUsed)}</td></tr>
          <tr class="tot"><td>Difference</td><td class="r" id="ccDiff">${n.diff < 0 ? '−' : n.diff > 0 ? '+' : ''}${num(Math.abs(n.diff))}</td></tr>
        </table>
        ${Math.abs(n.diff) >= 0.005 ? `<div class="mfield" style="margin-bottom:0"><label>Why is it different?${needReason ? '' : ' (optional)'}</label></div>
        <div class="cc-reason">${REASONS.map((r) => `<button data-cc="reason" data-v="${r.v}" class="${draft.reason === r.v ? 'on' : ''}">${r.t}<small>${r.s}</small></button>`).join('')}</div>` : ''}
        <div class="mfield"><label for="ccNote">Note (optional)</label><textarea class="cc-note" id="ccNote">${esc(draft.note)}</textarea></div>
        <div class="cc-small">When you add the missing payments, the difference updates on its own.</div>`;
      foot = `${back}<button class="btn btn-p" data-cc="save" ${(needReason && !draft.reason) || draft.saving ? 'disabled' : ''}>${draft.saving ? 'Saving…' : 'Save count'}</button>`;
    }
    q('.mbody').innerHTML = body;
    q('.mfooter').innerHTML = foot;
    ov.onclick = onCountClick;
    ov.oninput = onCountInput;
    const first = q('.cc-amt'); if (first && draft.step !== 4) setTimeout(() => { try { first.focus(); } catch (_) {} }, 30);
  }
  function onCountInput(e) {
    const t = e.target;
    if (t && t.dataset && t.dataset.note) {
      const k = t.dataset.note; const v = Math.max(0, Number(t.value || 0) || 0);
      draft.notes[k] = v;
      const sumEl = document.querySelector(`[data-note-sum="${k}"]`); if (sumEl) sumEl.textContent = short(k === 'coins' ? v : v * Number(k));
      const total = NOTES.reduce((s, n) => s + (draft.notes[n] || 0) * n, 0) + (draft.notes.coins || 0);
      const bar = document.getElementById('ccBar'); if (bar) { bar.value = total ? String(round2(total)) : ''; draft.bar = bar.value; }
    }
  }
  function onCountClick(e) {
    const ov = document.getElementById('cashCountOv');
    if (e.target === ov) { closeOverlay('cashCountOv'); return; }
    const b = e.target.closest('[data-cc]'); if (!b) return;
    readDraftInputs();
    const a = b.dataset.cc;
    if (a === 'cancel') { closeOverlay('cashCountOv'); return; }
    if (a === 'back') { draft.step = Math.max(1, draft.step - 1); return drawCount(); }
    if (a === 'notes') { draft.showNotes = !draft.showNotes; return drawCount(); }
    if (a === 'took-no') { draft.took = false; return drawCount(); }
    if (a === 'took-yes') { draft.took = true; return drawCount(); }
    if (a === 'reason') { draft.reason = b.dataset.v; return drawCount(); }
    if (a === 'next') {
      if (draft.step === 1 && isNaN(amtOf(draft.bar || 0))) return say('Enter the bar box amount', 'error');
      if (draft.step === 2 && isNaN(amtOf(draft.pocket || 0))) return say('Enter the pocket amount', 'error');
      if (draft.step === 3 && draft.took && !(amtOf(draft.declared) > 0)) return say('Enter the amount you took', 'error');
      draft.step = Math.min(4, draft.step + 1); return drawCount();
    }
    if (a === 'save') return saveCount();
  }
  async function saveCount() {
    if (!draft || draft.saving) return;
    const n = draftNumbers();
    draft.saving = true; drawCount();
    try {
      const client = getHubSupabaseClient();
      const locationId = await ensureHubLocationId();
      if (!client || !locationId) throw new Error('Not connected — check the internet and try again');
      const payload = {
        location_id: locationId,
        count_date: draft.date,
        bar_box: round2(n.bar),
        pocket: round2(n.pocket),
        declared_unloaded_withdrawals: round2(n.declared),
        statement_through: draft.through,
        expected_at_save: n.expected,
        reason: Math.abs(n.diff) >= 0.005 && draft.reason ? draft.reason : null,
        note: String(draft.note || '').trim() || null,
        status: 'open',
      };
      const { data, error } = await client.from('camp_cash_counts').insert(payload).select('*');
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) || { ...payload, id: `local-${Date.now()}`, created_at: new Date().toISOString() };
      state.counts.push(row); sortCounts();
      closeOverlay('cashCountOv');
      say(`Count saved · ${diffWords(n.diff)}`, 'success');
      draft = null;
      renderAll();
    } catch (err) {
      // Keep the sheet and its numbers; show the real error.
      draft.saving = false; drawCount();
      say(`Count not saved: ${(err && (err.message || err.details)) || err}`, 'error');
    }
  }

  // ── Settle (full users) ───────────────────────────────────────────────────
  let settling = null;
  function canSettle(c) {
    if (isLocal() || !c || c.status !== 'open') return false;
    const newest = state.counts[0];
    return newest && newest.id === c.id; // only the latest count; older ones are superseded by it
  }
  function openSettle(id) {
    const c = state.counts.find((x) => String(x.id) === String(id));
    if (!c || !canSettle(c)) return;
    injectStyles();
    settling = { id: c.id, busy: false, note: '' };
    ensureOverlay('cashSettleOv').classList.add('open');
    drawSettle();
  }
  function drawSettle() {
    const c = state.counts.find((x) => String(x.id) === String(settling.id));
    const ov = ensureOverlay('cashSettleOv');
    const q = (s) => ov.querySelector(s);
    if (!c) { closeOverlay('cashSettleOv'); return; }
    const v = countView(c);
    const thr = c.statement_through ? dMon(c.statement_through) : '';
    const nowThrough = statementThrough(colombo().date);
    const covered = v.covered;
    const at = c.created_at ? colombo(new Date(c.created_at)).time : '';
    q('.mhdr-title').textContent = `Count of ${dMon(c.count_date)}`;
    q('.mhdr-sub').textContent = `Counted ${dMon(colomboDateOf(c.created_at) || c.count_date)}${at ? ` ${at}` : ''} · ${covered ? 'statement covers it' : 'open'}`;
    const within = Math.abs(v.diff) <= TOLERANCE;
    const reason = REASONS.find((r) => r.v === c.reason);
    const line = within
      ? `Within ${short(TOLERANCE)}: settling closes the count with no ledger line.`
      : `Settling writes one ledger line: <strong>${v.diff < 0 ? 'Cash Out' : 'Into cash'} · Cash count · ${v.diff < 0 ? '−' : '+'}${num(Math.abs(v.diff))}</strong>.`;
    q('.mbody').innerHTML = `
      ${covered ? '' : `<div class="cc-warn">The bank statement in the app goes up to ${nowThrough ? dMon(nowThrough) : '—'}, not past ${dMon(c.count_date)} yet. ${v.declaredUsed > 0 ? `${num(v.declaredUsed)} of the cash Nadith said he took is not in the ledger yet and counts as expected cash.` : 'Cash taken from the ATM since then is not checked against the bank yet.'}</div>`}
      <table class="cc-sum">
        <tr><td>Counted (bar ${short(c.bar_box)} + pocket ${short(c.pocket)})</td><td class="r">${num(v.counted)}</td></tr>
        <tr><td>Expected (ledger to ${dMon(c.count_date)})</td><td class="r">${num(v.ledgerCash)}</td></tr>
        <tr><td>Said taken ${thr ? `after ${thr}` : 'from the ATM'}</td><td class="r">${num(c.declared_unloaded_withdrawals)}</td></tr>
        ${v.real > 0 ? `<tr><td>Statement shows ${thr ? `after ${thr}` : ''} (in the ledger)</td><td class="r">${num(v.real)}</td></tr>` : ''}
        ${v.declaredUsed > 0 ? `<tr><td>+ said taken, not in the ledger yet</td><td class="r" id="csDeclUsed">${num(v.declaredUsed)}</td></tr>` : ''}
        <tr class="tot"><td>Difference</td><td class="r" id="csDiff">${v.diff < 0 ? '−' : v.diff > 0 ? '+' : ''}${num(Math.abs(v.diff))}</td></tr>
      </table>
      ${reason ? `<div class="cc-hint">Reason: ${esc(reason.t)}.${c.note ? ` «${esc(c.note)}»` : ''}</div>` : (c.note ? `<div class="cc-hint">«${esc(c.note)}»</div>` : '')}
      ${within ? '' : `<div class="mfield"><label for="csNote">Note on the adjustment (optional)</label><textarea class="cc-note" id="csNote">${esc(settling.note)}</textarea></div>`}
      <div class="cc-small" id="csLine">${line}</div>`;
    q('.mfooter').innerHTML = `<button class="btn btn-s" data-cs="close">Leave open</button><button class="btn btn-p" data-cs="settle" ${settling.busy ? 'disabled' : ''}>${settling.busy ? 'Settling…' : 'Settle count'}</button>`;
    ov.onclick = (e) => {
      if (e.target === ov) return closeOverlay('cashSettleOv');
      const b = e.target.closest('[data-cs]'); if (!b) return;
      if (b.dataset.cs === 'close') return closeOverlay('cashSettleOv');
      if (b.dataset.cs === 'settle') return doSettle();
    };
  }
  async function doSettle() {
    if (!settling || settling.busy) return;
    const noteEl = document.getElementById('csNote'); if (noteEl) settling.note = noteEl.value;
    settling.busy = true; drawSettle();
    try {
      const client = getHubSupabaseClient();
      if (!client) throw new Error('Not connected');
      const { data, error } = await client.rpc('camp_cash_settle', { p_count: settling.id, p_note: String(settling.note || '').trim() || null });
      if (error) throw error;
      const res = data || {};
      const c = state.counts.find((x) => String(x.id) === String(settling.id));
      if (c) {
        c.status = 'settled'; c.settled_expected = res.expected; c.settled_difference = res.difference;
        c.adjustment_entry_id = res.adjustment ? res.adjustment.id : null; c.settled_at = new Date().toISOString();
      }
      if (res.adjustment && typeof dbRowToLedgerEntry === 'function' && typeof S !== 'undefined') {
        const entry = dbRowToLedgerEntry(res.adjustment);
        if (entry && !S.ledger.some((x) => String(x.id) === String(entry.id))) S.ledger.push(entry);
      }
      closeOverlay('cashSettleOv');
      settling = null;
      say(res.adjustment ? `Count settled · ${money(res.difference)} adjustment added` : 'Count settled · no adjustment needed', 'success');
      try { if (typeof notifyLedgerChanged === 'function') notifyLedgerChanged(); } catch (_) {}
      rerenderHub();
      try { if (typeof hydrateLedgerFromSupabase === 'function') hydrateLedgerFromSupabase({ mergeLocal: false }).then(rerenderHub).catch(() => {}); } catch (_) {}
    } catch (err) {
      settling.busy = false; drawSettle();
      say(`Not settled: ${(err && (err.message || err.details)) || err}`, 'error');
    }
  }
  function rerenderHub() {
    try { if (typeof renderExpenses === 'function') renderExpenses(); } catch (_) {}
    try { if (typeof renderOverview === 'function' && !isLocal()) renderOverview(); } catch (_) {}
  }

  // ── Cash tile: count button (+ history for full users) ────────────────────
  function decorateCashTile() {
    const root = document.getElementById('expKpis'); if (!root) return;
    const tile = [...root.querySelectorAll('.kpi')].find((k) => ((k.querySelector('.kpi-label') || {}).textContent || '').trim() === 'Cash');
    if (!tile) return;
    const old = tile.querySelector('.cc-tile'); const histOpen = !!(old && old.querySelector('details[open]')); if (old) old.remove();
    if (!enabled() || !state.available) return;
    injectStyles();
    const wrap = document.createElement('div');
    wrap.className = 'cc-tile';
    const btn = `<button class="btn btn-s btn-sm" data-cc-open="1" id="ccOpenBtn"><span class="btn-icon-label">${window.AppShell && AppShell.icon ? AppShell.icon('check') : ''}<span>Count cash</span></span></button>`;
    if (isLocal()) {
      wrap.innerHTML = btn;               // his view: the button only
    } else {
      const last = state.counts[0];
      const lastTxt = last ? (() => { const v = countView(last); return `Last count: ${dMon(last.count_date)} · ${Math.abs(v.diff) < 0.005 ? 'matches' : `${v.diff < 0 ? '−' : '+'}${short(Math.abs(v.diff))}`} · ${v.settled ? 'settled' : 'open'}`; })() : 'Last count: never';
      const rows = state.counts.slice(0, 20).map((c) => {
        const v = countView(c);
        return `<div class="cc-hrow" data-count-id="${esc(c.id)}"><div class="cc-hmain"><span><strong>${dMon(c.count_date)}</strong> · ${v.diff < 0 ? '−' : v.diff > 0 ? '+' : ''}${short(Math.abs(v.diff))}</span><span class="cc-hsub">Counted ${short(v.counted)} · expected ${short(v.expected)} · ${v.settled ? 'settled' : canSettle(c) ? 'open' : 'superseded'}</span></div>${canSettle(c) ? `<button class="btn btn-s btn-sm" data-cc-settle="${esc(c.id)}">Settle</button>` : ''}</div>`;
      }).join('');
      wrap.innerHTML = `<div class="cc-last" id="ccLast">${lastTxt}</div>${btn}${state.counts.length ? `<details class="cc-hist" id="ccHist"${histOpen ? ' open' : ''}><summary>Counts · ${state.counts.length}</summary>${rows}</details>` : ''}`;
    }
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-cc-open]')) return openCount();
      const s = e.target.closest('[data-cc-settle]'); if (s) return openSettle(s.dataset.ccSettle);
    });
    tile.appendChild(wrap);
  }

  // ── Checks ────────────────────────────────────────────────────────────────
  function norm(s) {
    const stop = new Set(['for', 'of', 'the', 'and', 'month', 'oct', 'october', 'nov', 'november', 'sep', 'september', 'in', 'to', 'with', 'a']);
    return new Set(String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
  }
  function similarity(a, b) {
    const A = norm(a), B = norm(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  const DISMISS_KEY = () => `campChecks.notDuplicate.${slug()}`;
  // The browser's real storage (window.localStorage): index.html shadows the
  // global `localStorage` with an in-memory map, which a reload would forget.
  function loadDismissed() { try { return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY()) || '[]')); } catch (_) { return new Set(); } }
  function saveDismissed(set) { try { window.localStorage.setItem(DISMISS_KEY(), JSON.stringify([...set])); } catch (_) {} }
  const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

  // Duplicate groups among manually typed cash payments (cash.md K6): same
  // amount, and either the same day + category, or ≤ 14 days apart with
  // similar text. Withdrawals (2 × 100,000 a day), Camp Tab lines and
  // statement rows are never candidates.
  function duplicateGroups(rows, today) {
    const from = addDays(today, -DUP_LOOKBACK_DAYS);
    const cand = rows.filter((r) => r && r.type === 'expense' && r.paymentMethod === 'Cash'
      && !['camp_tab_per_item', 'cash_count', 'hq_invoice', 'hq_transfer'].includes(sk(r))
      && String(r.date || '') >= from && String(r.date || '') <= today);
    const dismissed = loadDismissed();
    const parent = new Map(cand.map((r) => [r.id, r.id]));
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    const pairs = [];
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        if (Math.abs(localAmt(a) - localAmt(b)) >= 0.01) continue;
        const dd = Math.abs(daysBetween(a.date, b.date));
        if (dd > DUP_WINDOW_DAYS) continue;
        const strong = dd === 0 && a.category === b.category;
        if (!strong && similarity(a.description, b.description) < DUP_SIMILARITY) continue;
        const k = pairKey(a.id, b.id);
        if (dismissed.has(k)) continue;
        pairs.push(k);
        parent.set(find(a.id), find(b.id));
      }
    }
    const groups = new Map();
    pairs.forEach((k) => { const [a] = k.split('|'); const root = find(a); if (!groups.has(root)) groups.set(root, new Set()); k.split('|').forEach((id) => groups.get(root).add(id)); });
    const byId = new Map(cand.map((r) => [String(r.id), r]));
    return [...groups.values()].map((ids) => {
      const list = [...ids].map((id) => byId.get(id)).filter(Boolean);
      return { ids: list.map((r) => String(r.id)), rows: list, amount: localAmt(list[0]), category: list[0].category };
    }).sort((x, y) => y.amount * y.ids.length - x.amount * x.ids.length);
  }

  function showRowsInLedger(ids, label, actions) {
    window.__checkFilterIds = new Set(ids.map(String));
    window.__checkFilterInfo = { label, actions: actions || [] };
    const s = document.getElementById('expSearch'); if (s) s.value = '';
    ['expTypeF', 'expPayF', 'expCatF', 'expWeekF'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = 'all'; });
    try { if (typeof showPage === 'function') showPage('expenses'); } catch (_) {}
    if (typeof setExpPeriodUnified === 'function') setExpPeriodUnified('all'); else rerenderHub();
    const bar = document.getElementById('ccFilterBar'); if (bar && bar.scrollIntoView) { try { bar.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {} }
  }
  function clearRowFilter() {
    window.__checkFilterIds = null; window.__checkFilterInfo = null;
    rerenderHub();
  }

  const BUILTIN_CHECKS = [
    { // K1 — the evening count
      id: 'cash-count-today', local: true,
      run(ctx) {
        if (!state.available || ctx.hour < COUNT_DUE_HOUR) return null;
        if ((ctx.counts || []).some((c) => c.count_date === ctx.today)) return null;
        if (ctx.isLocal) return { text: 'Count the cash', level: 'warn', onClick: openCount };
        const last = (ctx.counts || [])[0];
        const ago = last ? daysBetween(last.count_date, ctx.today) : null;
        return { text: `Cash not counted today${last ? ` · last count ${ago === 1 ? 'yesterday' : `${ago} days ago`}` : ' · never counted'}`, level: 'warn', onClick: openCount };
      },
    },
    { // K3 — cash going out of the bank, nothing typed
      id: 'cash-no-entries',
      run(ctx) {
        let last = '';
        ctx.ledger.forEach((r) => {
          if (r.type === 'expense' && r.paymentMethod === 'Cash' && !['camp_tab_per_item', 'cash_count', 'hq_invoice', 'hq_transfer'].includes(sk(r))) {
            const c = String(r.createdAt || ''); if (c > last) last = c;
          }
        });
        if (!last) return null;
        const lastDay = colomboDateOf(last);
        const days = daysBetween(lastDay, ctx.today);
        if (days < SILENT_DAYS) return null;
        const atm = ctx.ledger.filter((r) => isAtm(r) && String(r.date || '') > lastDay && String(r.date || '') <= ctx.today);
        const withdrawn = atm.reduce((s, r) => s + localAmt(r), 0);
        if (!(withdrawn > 0)) return null;
        return {
          text: `No cash payments entered for ${days} days · ${cur()} ${short(withdrawn)} withdrawn since ${dMon(lastDay)}`, level: 'warn',
          onClick: () => showRowsInLedger(atm.map((r) => r.id), `Withdrawals since ${dMon(lastDay)}, with no cash payment entered since`),
        };
      },
    },
    { // K6 — the same bill typed twice
      id: 'cash-duplicate', local: true,
      run(ctx) {
        const groups = duplicateGroups(ctx.ledger, ctx.today);
        return groups.slice(0, DUP_MAX_CHIPS).map((g) => ({
          text: `Possible duplicate: ${g.category} ${short(g.amount)} ×${g.ids.length}`, level: 'warn',
          onClick: () => showRowsInLedger(g.ids, `Possible duplicate: ${g.category} ${short(g.amount)} ×${g.ids.length}. Delete the extra line, or mark it as not a duplicate.`, [
            { label: 'Not a duplicate', run: () => {
              const set = loadDismissed();
              for (let i = 0; i < g.ids.length; i++) for (let j = i + 1; j < g.ids.length; j++) set.add(pairKey(g.ids[i], g.ids[j]));
              saveDismissed(set); clearRowFilter(); say('Marked as not a duplicate', 'success');
            } },
          ]),
        }));
      },
    },
  ];
  BUILTIN_CHECKS.forEach((c) => { if (!window.CAMP_CHECKS.some((x) => x && x.id === c.id)) window.CAMP_CHECKS.push(c); });

  function runChecks() {
    const today = colombo();
    const ctx = { ledger: ledger(), location: slug(), isLocal: isLocal(), today: today.date, hour: today.hour, counts: state.counts };
    const out = [];
    (window.CAMP_CHECKS || []).forEach((check) => {
      if (!check || typeof check.run !== 'function') return;
      if (ctx.isLocal && !(check.local === true || LOCAL_CHECK_IDS.includes(check.id))) return;
      let res = null;
      try { res = check.run(ctx); } catch (err) { console.warn('[checks]', check.id, err); res = null; }
      (Array.isArray(res) ? res : [res]).forEach((r) => { if (r && r.text) out.push({ ...r, id: check.id }); });
    });
    return out;
  }

  let chipHandlers = [];
  function renderStrip(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!enabled() || (hostId === 'ovChecks' && isLocal())) { host.innerHTML = ''; return; }
    injectStyles();
    const chips = runChecks();
    const base = chipHandlers.length;
    chips.forEach((c) => chipHandlers.push(c.onClick || null));
    const info = hostId === 'expChecks' && window.__checkFilterIds instanceof Set ? window.__checkFilterInfo || { label: 'Filtered by a check', actions: [] } : null;
    const filterBar = info ? `<div class="cc-filter" id="ccFilterBar"><span>${esc(info.label)}</span>${(info.actions || []).map((a, i) => `<button class="btn btn-s btn-sm" data-cc-act="${i}">${esc(a.label)}</button>`).join('')}<button class="btn btn-s btn-sm" data-cc-act="clear">Show all</button></div>` : '';
    host.innerHTML = chips.length ? `<div class="health-strip" role="list">${chips.map((c, i) => `<button class="health-chip${c.level === 'info' ? ' cc-info' : ''}" role="listitem" data-chip="${base + i}" data-check="${esc(c.id)}">${esc(c.text)}</button>`).join('')}</div>` : '';
    host.onclick = (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { const fn = chipHandlers[Number(chip.dataset.chip)]; if (typeof fn === 'function') fn(); }
    };
    // The «showing these rows» bar sits right above the ledger table.
    if (hostId === 'expChecks') {
      const table = document.getElementById('expTable');
      let fh = document.getElementById('ccFilterHost');
      if (!fh && table && table.parentNode) { fh = document.createElement('div'); fh.id = 'ccFilterHost'; table.parentNode.insertBefore(fh, table); }
      if (fh) {
        fh.innerHTML = filterBar;
        fh.onclick = (e) => {
          const act = e.target.closest('[data-cc-act]'); if (!act) return;
          if (act.dataset.ccAct === 'clear') return clearRowFilter();
          const a = (info && info.actions || [])[Number(act.dataset.ccAct)]; if (a && typeof a.run === 'function') a.run();
        };
      }
    }
    if (chipHandlers.length > 500) chipHandlers = chipHandlers.slice(-100); // handlers of old renders are dropped
  }

  function renderAll() {
    try { decorateCashTile(); } catch (err) { console.warn('[cash count] tile', err); }
    try { renderStrip('expChecks'); } catch (err) { console.warn('[checks] expChecks', err); }
    try { renderStrip('ovChecks'); } catch (err) { console.warn('[checks] ovChecks', err); }
  }

  // Called by renderExpenses() / renderOverview() in index.html.
  window.campCashAfterRender = function (where) {
    if (where === 'overview') { try { renderStrip('ovChecks'); } catch (_) {} return; }
    renderAll();
  };

  window.CampCash = {
    state, colombo, expectedFor, countView, statementThrough, duplicateGroups, similarity, runChecks,
    openCount, openSettle, loadCounts, render: renderAll, clearRowFilter,
    settings: { CASH_COUNT_LOCATIONS, COUNT_DUE_HOUR, TOLERANCE, SILENT_DAYS, DUP_WINDOW_DAYS, DUP_SIMILARITY, DUP_LOOKBACK_DAYS, LOCAL_CHECK_IDS },
  };

  // Boot: once the ledger is in, read the counts; redraw the strip every
  // 5 minutes so «Count the cash» appears at 18:00 without a reload.
  function boot() {
    if (!enabled()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const ready = typeof HUB_LEDGER_HYDRATED !== 'undefined' && HUB_LEDGER_HYDRATED === true;
      if (ready || tries > 240) { clearInterval(t); loadCounts(); }
    }, 250);
    setInterval(() => { try { renderAll(); } catch (_) {} }, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
