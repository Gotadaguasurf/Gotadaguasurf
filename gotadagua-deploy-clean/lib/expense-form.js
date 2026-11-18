/* ════════════════════════════════════════════════════════════════════════════
   ExpenseForm — the one expense/invoice form of the app (Miguel, 22 Oct 2026:
   «a app devia estar toda com o mesmo feel… para adicionar faturas e editar»).
   One modal, same fields, same ids, used by the HQ (Water) and by The Suk
   (Manjar). The host decides what to do on Save; the form only collects.

   Field ids are the HQ's historical ones (inv_date, inv_company, inv_amount,
   inv_category, inv_payment …) so every HQ routine that fills or reads the
   form keeps working unchanged.

   ExpenseForm.mount({
     fields: { location, payingCompany, currency, file, driveLink, bankPicker, splitHint, dupWarn },
     locations: [{slug,label}], companies: [{slug,label}], categories: [{id,name,is_personal}],
     payments: ['Bank Transfer','Card','Cash','Other'], currencies: ['EUR','MAD','LKR','USD','GBP'],
     onSave(), onDelete(), onFile(file), onCancel()
   })
   ExpenseForm.open({ title, mode:'add'|'edit', showDelete }) · close() · isOpen()
   ExpenseForm.set(values) · values() · setStatus(html) · toast(kind, msg) · busy(bool)

   Credit notes (18 Nov 2026, lib/credit-notes.js + supabase/credit-notes.sql): with fields.creditNote the form
   has a «Credit note» switch (#inv_credit_note) and, when it is on, «Cancels which invoice?» (#inv_credits_invoice).
   The row stays hidden until the host calls creditNoteAvailable(true) — before the SQL has run the form is the old one.
   creditNote() → { on, creditsInvoiceId } · setCreditNote({ on, creditsInvoiceId }) · refreshCredits()
   The host gives the picker its options: mount({ onCreditLookup: async ({ supplier, nif, amount, date, want }) => [{ id, label, selected? }],
   onCreditToggle(on) }). The form only collects; the host stores the amount negative.
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let CFG = null, ROOT = null;
  const $ = (id) => document.getElementById(id);

  const CSS = `
  .xf-bg{position:fixed;inset:0;background:rgba(22,36,58,.5);backdrop-filter:blur(3px);z-index:400;display:none;align-items:flex-start;justify-content:center;padding:36px 16px;overflow-y:auto}
  .xf-bg.open{display:flex}
  .xf{background:#fff;border-radius:var(--r-lg,16px);width:100%;max-width:860px;box-shadow:var(--sh-lg,0 24px 56px rgba(22,36,58,.18));border:1px solid var(--border,#e5eaf0);overflow:hidden;font-family:'Outfit',system-ui,sans-serif;color:var(--ink,#16243a);animation:xfIn .2s cubic-bezier(.2,.9,.3,1.1)}
  @keyframes xfIn{from{opacity:0;transform:scale(.97) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
  .xf-hd{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border,#e5eaf0)}
  .xf-hd h3{margin:0;font-size:16px;font-weight:700;color:var(--navy,#28394b);letter-spacing:-.01em;line-height:1.3}
  .xf-x{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:var(--muted,#64748b);font-size:18px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
  .xf-x:hover{background:var(--surface-2,#f8fafc);color:var(--navy,#28394b)}
  .xf-bd{padding:20px}
  .xf-banner{margin-bottom:12px}
  .xf-banner:empty{display:none}
  .xf-ai{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--surface-2,#f8fafc);border:1px solid var(--border,#e5eaf0);border-radius:var(--r-sm,10px);padding:10px 12px;margin-bottom:16px;font-size:12.5px;color:var(--muted,#64748b)}
  .xf-ai b{color:var(--navy,#28394b)}
  .xf-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
  .xf-f{display:flex;flex-direction:column;gap:6px;grid-column:span 4;min-width:0}
  .xf-f.c3{grid-column:span 3}.xf-f.c4{grid-column:span 4}.xf-f.c6{grid-column:span 6}.xf-f.c8{grid-column:span 8}.xf-f.c12{grid-column:span 12}
  .xf-f label{font-size:11px;font-weight:600;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:.06em;line-height:1.3}
  .xf-f label small{font-weight:400;text-transform:none;letter-spacing:0}
  .xf-f input,.xf-f select,.xf-f textarea{width:100%;height:38px;border:1px solid var(--border-2,#d5dde8);border-radius:var(--r-sm,10px);padding:0 12px;font-size:14px;color:var(--ink,#16243a);background:#fff;outline:none;font-family:inherit;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
  .xf-f input::placeholder{color:var(--muted-2,#98a3b3)}
  .xf-f input[type=number]{text-align:right;font-variant-numeric:tabular-nums}
  .xf-f input:focus,.xf-f select:focus{border-color:var(--ocean,#1e6fa8);box-shadow:var(--ring,0 0 0 3px rgba(30,111,168,.18))}
  .xf-f input[readonly]{background:var(--surface-2,#f8fafc);color:var(--muted,#64748b)}
  .xf-hint{font-size:12px;color:var(--muted,#64748b);line-height:1.45}
  .xf-hint:empty{display:none}
  .xf-pick{max-height:170px;overflow:auto;border:1px solid var(--border-2,#d5dde8);border-radius:var(--r-sm,10px)}
  .xf-pick label{display:flex;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border,#e5eaf0);font-size:12.5px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:500;color:var(--ink,#16243a)}
  .xf-pick label:last-child{border-bottom:none}
  .xf-pick input[type=radio]{width:16px;height:16px;padding:0;margin:0;flex-shrink:0;accent-color:var(--ocean,#1e6fa8)}
  .xf-pick label:hover{background:var(--surface-2,#f8fafc)}
  .xf-pick label.sel{background:var(--green-bg,#eaf8f0)}
  .xf-pick .amt{margin-left:auto;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
  .xf-cn{grid-column:span 12;display:flex;gap:8px 16px;align-items:flex-end;flex-wrap:wrap;min-width:0}
  .xf-cn[hidden]{display:none}
  .xf-sw{display:inline-flex;align-items:center;gap:8px;height:38px;font-size:13px;font-weight:600;color:var(--ink,#16243a);cursor:pointer;user-select:none;white-space:nowrap}
  .xf-sw input{appearance:none;-webkit-appearance:none;width:34px;height:20px;border-radius:999px;background:var(--border-2,#d5dde8);position:relative;cursor:pointer;margin:0;flex-shrink:0;outline:none;transition:background .15s}
  .xf-sw input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(22,36,58,.25);transition:transform .15s}
  .xf-sw input:checked{background:var(--ocean,#1e6fa8)}
  .xf-sw input:checked::after{transform:translateX(14px)}
  .xf-sw input:focus-visible{box-shadow:var(--ring,0 0 0 3px rgba(30,111,168,.18))}
  .xf-cn .xf-f{flex:1 1 260px;grid-column:auto}
  .xf-cn-as{font-size:12.5px;color:var(--muted,#64748b);height:38px;display:inline-flex;align-items:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  .xf-cn-as b{color:var(--red,#b42318);font-weight:700;margin-left:4px}
  .xf-status{margin-top:12px;font-size:13px}
  .xf-status:empty{display:none}
  .xf-toast{padding:10px 14px;border-radius:var(--r-sm,10px);font-size:13px;font-weight:500;margin-top:12px;border:1px solid transparent;line-height:1.5}
  .xf-toast:empty{display:none}
  .xf-toast.ok{background:var(--green-bg,#eaf8f0);color:var(--green,#1a7a40);border-color:var(--green-border,#bfe8d0)}
  .xf-toast.err{background:var(--red-bg,#fdeeec);color:var(--red,#b42318);border-color:var(--red-border,#f3c2bd)}
  .xf-toast.warn{background:var(--amber-bg,#fdf5e1);color:var(--amber,#9a6700);border-color:var(--amber-border,#f0dca0)}
  .xf-dup{background:var(--amber-bg,#fdf5e1);color:var(--amber,#9a6700);border:1px solid var(--amber-border,#f0dca0);padding:10px 14px;border-radius:var(--r-sm,10px);font-size:13px;margin-top:12px;display:none;line-height:1.5}
  .xf-dup.show{display:block}
  .xf-dup ul{margin:6px 0 0 20px}
  .xf-ft{display:flex;justify-content:space-between;gap:10px;padding:12px 20px;border-top:1px solid var(--border,#e5eaf0);background:var(--surface-2,#f8fafc)}
  @media (max-width:720px){.xf-f,.xf-f.c3,.xf-f.c4,.xf-f.c6,.xf-f.c8{grid-column:span 6}.xf-bg{padding:12px 8px}.xf-bd,.xf-hd{padding-left:16px;padding-right:16px}}
  /* phones: the form scrolls inside the box, so Save / Cancel stay pinned at its bottom */
  @media (max-width:720px){.xf{display:flex;flex-direction:column;max-height:calc(100dvh - 24px)}.xf-hd,.xf-ft{flex-shrink:0}.xf-bd{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}.xf-ft{padding-left:16px;padding-right:16px}.xf-bd>#invToast:not(:empty),.xf-bd>.xf-dup.show{position:sticky;bottom:0;z-index:2;box-shadow:0 -8px 16px #fff}}
  @media (max-width:480px){.xf-f,.xf-f.c3,.xf-f.c4,.xf-f.c6,.xf-f.c8{grid-column:span 12}}
  `;

  const icon = (name) => (window.AppShell && typeof AppShell.icon === 'function') ? AppShell.icon(name) : '';
  // Something typed? (date and selects always have a value, so they do not count)
  function dirty(){
    const typed = ['inv_company','inv_amount','inv_nif','inv_number','inv_description','inv_notes','inv_drive_link'].some(id => { const el = $(id); return el && String(el.value || '').trim() !== ''; });
    const fi = $('inv_file');
    return typed || !!(fi && fi.files && fi.files.length);
  }
  function fieldHtml(cls, id, label, inner, hint){
    return `<div class="xf-f ${cls}"><label for="${id}">${label}</label>${inner}${hint ? `<div class="xf-hint">${hint}</div>` : ''}</div>`;
  }

  function mount(cfg){
    CFG = Object.assign({ fields:{}, locations:[], companies:[], categories:[], payments:['Bank Transfer','Card','Cash','Other'], currencies:['EUR','MAD','LKR','USD','GBP'] }, cfg || {});
    const f = Object.assign({ location:false, payingCompany:false, currency:false, file:true, driveLink:false, bankPicker:false, splitHint:false, dupWarn:false, creditNote:false, description:true, notes:true, nif:true, number:true }, CFG.fields || {});
    if (!document.getElementById('xf-css')) { const st = document.createElement('style'); st.id = 'xf-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (ROOT) ROOT.remove();
    const today = new Date().toISOString().slice(0, 10);
    const opt = (list, val, lab) => list.map(x => `<option value="${esc(x[val])}">${esc(x[lab])}</option>`).join('');
    ROOT = document.createElement('div');
    ROOT.className = 'xf-bg'; ROOT.id = 'xfModal';
    ROOT.innerHTML = `
      <div class="xf" role="dialog" aria-modal="true">
        <div class="xf-hd"><h3 id="xf_title">Add expense</h3><button class="xf-x" type="button" onclick="ExpenseForm.cancel()" aria-label="Close">×</button></div>
        <div class="xf-bd">
          <div class="xf-banner" id="xf_banner"></div>
          ${f.file ? `<div class="xf-ai"><input id="inv_file" type="file" accept="application/pdf,image/*,.heic" style="display:none"><button type="button" class="btn btn-s" onclick="document.getElementById('inv_file').click()">${icon('paperclip')} PDF or photo</button><span id="inv_file_lbl">No file — choose the invoice and the fields are read for you.</span></div>` : ''}
          <div class="xf-grid">
            ${f.location ? fieldHtml('c3', 'inv_location', 'Location', `<select id="inv_location">${opt(CFG.locations, 'slug', 'label')}</select>`) : ''}
            ${fieldHtml('c3', 'inv_date', 'Date', `<input id="inv_date" type="date" value="${today}">`)}
            ${fieldHtml(f.location ? 'c6' : 'c6', 'inv_company', 'Supplier', `<input id="inv_company" type="text" placeholder="e.g. Auchan, EDP"${f.splitHint ? ' onchange="refreshSplitHint()"' : ''}>${f.splitHint ? '<div id="inv_split_hint" class="xf-hint"></div>' : ''}`)}
            ${fieldHtml('c3', 'inv_amount', 'Amount', `<input id="inv_amount" type="number" step="0.01" min="0" placeholder="0.00"${f.splitHint ? ' onchange="refreshSplitHint()"' : ''}>`)}
            ${f.currency ? fieldHtml('c3', 'inv_currency', 'Currency', `<select id="inv_currency">${CFG.currencies.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`) : `<input id="inv_currency" type="hidden" value="EUR">`}
            ${fieldHtml('c3', 'inv_category', 'Category', `<select id="inv_category">${CFG.categories.map(c => `<option value="${esc(c.id)}" data-personal="${c.is_personal ? 1 : 0}">${esc(c.name)}</option>`).join('')}</select>`)}
            ${fieldHtml('c3', 'inv_payment', 'Payment method', `<select id="inv_payment">${CFG.payments.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`)}
            ${f.creditNote ? `<div class="xf-cn" id="xf_cn" hidden>
              <label class="xf-sw"><input type="checkbox" id="inv_credit_note" onchange="ExpenseForm.creditToggled()"> Credit note</label>
              <span class="xf-cn-as" id="xf_cn_as" style="display:none"></span>
              <div class="xf-f" id="xf_cn_pick" style="display:none"><label for="inv_credits_invoice">Cancels which invoice? <small>(optional)</small></label><select id="inv_credits_invoice"><option value="">Not linked</option></select></div>
            </div>` : ''}
            ${f.payingCompany ? fieldHtml('c4', 'inv_paying_company', 'Paying company <small id="payCoAuto">(auto from location)</small>', `<select id="inv_paying_company">${opt(CFG.companies, 'slug', 'label')}</select>`) : ''}
            ${f.nif ? fieldHtml('c4', 'inv_nif', 'Tax number (NIF)', `<input id="inv_nif" type="text" placeholder="optional">`) : ''}
            ${f.number ? fieldHtml('c4', 'inv_number', 'Invoice number', `<input id="inv_number" type="text" placeholder="e.g. FT 2026/1234">`) : ''}
            ${f.currency ? fieldHtml('c3', 'inv_fx', 'Exchange rate to € <small id="fxHint">(auto)</small>', `<input id="inv_fx" type="number" step="0.000001" min="0" placeholder="1.000000" value="1">`) + fieldHtml('c3', 'inv_amount_eur', 'Amount in €', `<input id="inv_amount_eur" type="number" step="0.01" min="0" placeholder="auto" readonly>`) : `<input id="inv_fx" type="hidden" value="1"><input id="inv_amount_eur" type="hidden">`}
            ${f.description ? fieldHtml(f.currency ? 'c6' : 'c12', 'inv_description', 'Description', `<input id="inv_description" type="text" placeholder="What was purchased?">`) : ''}
            ${f.driveLink ? fieldHtml('c6', 'inv_drive_link', 'Google Drive link', `<input id="inv_drive_link" type="url" placeholder="https://drive.google.com/…">`) : ''}
            ${f.notes ? fieldHtml(f.driveLink ? 'c6' : 'c12', 'inv_notes', 'Notes', `<input id="inv_notes" type="text" placeholder="Internal notes">`) : ''}
            ${f.bankPicker ? `<div class="xf-f c12"><label id="inv_bankpick_lbl">Bank movement — the debit this was paid with</label><div class="xf-pick" id="inv_bankpick"></div><div class="xf-hint" id="inv_bankpick_hint">Debits of the same amount near the date come first. Leave none selected for cash purchases.</div></div>` : ''}
          </div>
          <div id="manualExtras" style="display:none"></div>
          <button type="button" id="extractBtn" style="display:none"></button>
          <div id="extractStatus" class="xf-status"></div>
          ${f.dupWarn ? '<div id="dupWarn" class="xf-dup"></div>' : ''}
          <div id="invToast" class="xf-toast"></div>
        </div>
        <div class="xf-ft">
          <div><button type="button" class="btn btn-danger" id="xf_delete" style="display:none" onclick="ExpenseForm.del()">${icon('trash')} Delete</button></div>
          <div style="display:flex;gap:8px"><button type="button" class="btn btn-s" onclick="ExpenseForm.cancel()">Cancel</button><button type="button" class="btn btn-p" id="saveInvBtn" onclick="ExpenseForm.save()">Save</button></div>
        </div>
      </div>`;
    document.body.appendChild(ROOT);
    // A click on the backdrop never throws away a half-filled form silently.
    ROOT.addEventListener('click', (e) => { if (e.target !== ROOT) return; if (dirty() && !confirm('Discard this expense?')) return; cancel(); });
    const file = $('inv_file');
    if (file) file.addEventListener('change', () => { const fl = file.files && file.files[0]; if (fl) { const lbl = $('inv_file_lbl'); if (lbl) lbl.textContent = fl.name; if (CFG.onFile) CFG.onFile(fl); } });
    // credit note: the options of «Cancels which invoice?» follow the supplier, the date and the amount
    if (f.creditNote) {
      ['inv_company', 'inv_date', 'inv_amount', 'inv_nif'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', () => { if (creditNote().on) refreshCredits(); }); });
      const amt = $('inv_amount'); if (amt) amt.addEventListener('input', paintCreditAs);
      CN_WANT = null; const cnRow = $('xf_cn'); if (cnRow) cnRow.hidden = !CN_AVAILABLE;   // a re-mount keeps what the host said
    }
    return ROOT;
  }

  function open(o = {}){
    if (!ROOT) throw new Error('ExpenseForm.mount() first');
    $('xf_title').textContent = o.title || (o.mode === 'edit' ? 'Edit expense' : 'Add expense');
    $('saveInvBtn').textContent = o.saveLabel || (o.mode === 'edit' ? 'Save changes' : 'Save');
    $('xf_delete').style.display = o.showDelete ? '' : 'none';
    if (o.values) set(o.values);
    ROOT.classList.add('open');
    setTimeout(() => { const el = $('inv_company'); if (el && !el.value) el.focus(); }, 50);
  }
  function close(){ if (ROOT) ROOT.classList.remove('open'); }
  function isOpen(){ return !!(ROOT && ROOT.classList.contains('open')); }
  function cancel(){ if (CFG?.onCancel) CFG.onCancel(); close(); }
  function save(){ if (CFG?.onSave) return CFG.onSave(); }
  function del(){ if (CFG?.onDelete) return CFG.onDelete(); }
  function busy(b){ const s = $('saveInvBtn'); if (s) s.disabled = !!b; }

  const FIELDS = { location:'inv_location', date:'inv_date', company:'inv_company', amount:'inv_amount', currency:'inv_currency', category:'inv_category', payment:'inv_payment', payingCompany:'inv_paying_company', nif:'inv_nif', number:'inv_number', fx:'inv_fx', amountEur:'inv_amount_eur', description:'inv_description', driveLink:'inv_drive_link', notes:'inv_notes' };
  function set(v){
    Object.entries(FIELDS).forEach(([k, id]) => { const el = $(id); if (el && v[k] !== undefined) el.value = v[k] == null ? '' : v[k]; });
    const lbl = $('inv_file_lbl'); if (lbl) lbl.textContent = v.fileLabel || 'No file — choose the invoice and the fields are read for you.';
    const fi = $('inv_file'); if (fi) fi.value = '';
    setStatus(''); toast('', '');
    const b = $('xf_banner'); if (b) b.innerHTML = v.banner || '';
    setCreditNote({ on: !!v.creditNote, creditsInvoiceId: v.creditsInvoiceId || null });
  }
  function values(){
    const out = {};
    Object.entries(FIELDS).forEach(([k, id]) => { const el = $(id); if (el) out[k] = el.value; });
    const cs = $('inv_category'); out.categoryName = cs ? (cs.options[cs.selectedIndex]?.textContent || null) : null;
    const fi = $('inv_file'); out.file = fi && fi.files && fi.files[0] || null;
    const cn = creditNote(); out.creditNote = cn.on; out.creditsInvoiceId = cn.creditsInvoiceId;
    return out;
  }
  function setStatus(html){ const el = $('extractStatus'); if (el) el.innerHTML = html || ''; }
  function toast(kind, msg){ const el = $('invToast'); if (!el) return; el.className = 'xf-toast' + (kind ? ' ' + kind : ''); el.textContent = msg || ''; }
  // o.credit: a credit note comes back as money IN — the list shows bank credits instead of debits
  function setBank(cands, selectedId, onPick, o = {}){
    const box = $('inv_bankpick'); if (!box) return;
    const eur = (n) => '€' + Number(n || 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2});
    const lbl = $('inv_bankpick_lbl'), hint = $('inv_bankpick_hint');
    if (lbl) lbl.textContent = o.credit ? 'Bank movement — the refund this credit note came back as' : 'Bank movement — the debit this was paid with';
    if (hint) hint.textContent = o.credit ? 'Credits of the same amount near the date come first. Leave none selected when the supplier takes it off the next invoice.' : 'Debits of the same amount near the date come first. Leave none selected for cash purchases.';
    box.innerHTML = cands.length ? cands.map(r => `<label class="${r.id === selectedId ? 'sel' : ''}"><input type="radio" name="bankpick" ${r.id === selectedId ? 'checked' : ''} data-id="${esc(r.id)}"><span>${esc(r.movement_date)}</span><span>${esc(r.description)}</span><span class="amt">${o.credit ? '+' + eur(r.amount) : eur(-r.amount)}</span></label>`).join('') : `<div class="xf-hint" style="padding:8px 10px">${o.credit ? 'No credit of this amount near the date.' : 'No debit of this amount near the date.'}</div>`;
    box.querySelectorAll('input[type=radio]').forEach(inp => inp.addEventListener('click', () => onPick && onPick(inp.dataset.id)));
  }

  // ── Credit note ─────────────────────────────────────────────────────────
  let CN_AVAILABLE = false, CN_WANT = null, CN_SEQ = 0, CN_WAS_NEG = false;
  // The host says whether the database knows credit notes (supabase/credit-notes.sql). Until then: the old form.
  function creditNoteAvailable(on){ CN_AVAILABLE = !!on; const row = $('xf_cn'); if (row) row.hidden = !CN_AVAILABLE; if (!CN_AVAILABLE) { const c = $('inv_credit_note'); if (c) c.checked = false; paintCredit(); } }
  function creditNote(){
    const c = $('inv_credit_note'), s = $('inv_credits_invoice');
    const on = !!(CN_AVAILABLE && c && c.checked);
    return { on, creditsInvoiceId: on && s && s.value ? s.value : null };
  }
  function paintCreditAs(){
    const as = $('xf_cn_as'); if (!as) return;
    const on = creditNote().on, n = Math.abs(Number(($('inv_amount') || {}).value) || 0);
    as.style.display = on ? '' : 'none';
    as.innerHTML = on ? `Saved as<b>−${n.toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2})}</b>` : '';
  }
  function paintCredit(){
    const on = creditNote().on, pick = $('xf_cn_pick');
    if (pick) pick.style.display = on ? '' : 'none';
    // a credit note is typed as a plain amount: the sign is the switch. The form remembers that the amount was
    // negative, so switching it off gives the minus back (a stored credit never turns into a cost by a toggle).
    const amt = $('inv_amount'), eurEl = $('inv_amount_eur');
    if (on && amt && Number(amt.value) < 0) { amt.value = Math.abs(Number(amt.value)).toFixed(2); CN_WAS_NEG = true; }
    if (on && eurEl && Number(eurEl.value) < 0) eurEl.value = Math.abs(Number(eurEl.value)).toFixed(2);
    if (!on && CN_WAS_NEG) {
      if (amt && Number(amt.value) > 0) amt.value = (-Number(amt.value)).toFixed(2);
      if (eurEl && Number(eurEl.value) > 0) eurEl.value = (-Number(eurEl.value)).toFixed(2);
    }
    paintCreditAs();
  }
  // Fill «Cancels which invoice?» from the host; the wanted id stays selected even when it is outside the list.
  async function refreshCredits(){
    const sel = $('inv_credits_invoice'); if (!sel || !creditNote().on) return;
    const want = CN_WANT || sel.value || null, seq = ++CN_SEQ;
    let list = [];
    try { if (CFG && CFG.onCreditLookup) list = await CFG.onCreditLookup({ supplier: ($('inv_company') || {}).value || '', nif: ($('inv_nif') || {}).value || '', amount: Math.abs(Number(($('inv_amount') || {}).value) || 0), date: ($('inv_date') || {}).value || '', want }) || []; } catch (_e) { list = []; }
    if (seq !== CN_SEQ) return;
    sel.innerHTML = `<option value="">${list.length ? 'Not linked' : 'Not linked — no invoice of this supplier or amount in the last 120 days'}</option>` + list.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    // keep the linked invoice; otherwise take the one the document itself names (the host marks it «selected»)
    const pre = want || (list.find(o => o.selected) || {}).id || null;
    if (pre && list.some(o => o.id === pre)) sel.value = pre;
    CN_WANT = null;
  }
  function setCreditNote(o = {}){
    const c = $('inv_credit_note'); if (!c) return;
    CN_WAS_NEG = false;   // a new form: nothing to give back yet
    c.checked = !!(o.on && CN_AVAILABLE);
    CN_WANT = c.checked ? (o.creditsInvoiceId || null) : null;
    const sel = $('inv_credits_invoice'); if (sel) sel.innerHTML = '<option value="">Not linked</option>';
    paintCredit();
    if (c.checked) refreshCredits();
  }
  function creditToggled(){ paintCredit(); if (creditNote().on) refreshCredits(); if (CFG && CFG.onCreditToggle) CFG.onCreditToggle(creditNote().on); }

  window.ExpenseForm = { mount, open, close, isOpen, cancel, save, del, busy, set, values, setStatus, toast, setBank, dirty, creditNoteAvailable, creditNote, setCreditNote, refreshCredits, creditToggled, root: () => ROOT };
})();
