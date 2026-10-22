/* ════════════════════════════════════════════════════════════════════════════
   AppShell — the one header + app registry of the Gota d'Água app
   (22 Oct 2026, Miguel: «o header devia ser sempre igual… preciso de
   consistência… tudo homogéneo»).

   APPS            the single list of apps every menu shows (order matters)
   AppShell.menu(current)        html of the app-switch menu
   AppShell.mountMenus(current)  fills every <nav class="app-switch-menu" data-app-menu>
                                 (runs by itself on DOMContentLoaded)
   AppShell.nav(opts)            html of the whole header: { app, title, sub,
                                 tabs:[{id,label,onclick,hidden,count}], tabAttr:'data-page',
                                 location:{label, items:[{href,label,sub,current}]},
                                 actions: html, user: true, mobile: true }
   AppShell.mount(el, opts)      renders nav(opts) into el (or #appNav) + mobile drawer
   AppShell.setTab(id)           marks the active tab (desktop + drawer)
   AppShell.setUser(text)        fills the user chip
   AppShell.splash(title, text)  access/sign-in splash html
   AppShell.toast(msg, kind)     floating toast (creates #toast if missing)
   AppShell.icon(name, cls)      inline flat line icon (see ICON_PATHS; spec in /docs/DESIGN-SYSTEM.md)
   helpers: $, esc, eur, eur0, fetchAll(build)
   window.BusinessShell is an alias (older pages).
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const APPS = [
    { slug:'hub',         href:'/',             label:'Home',        sub:'Camps, businesses, management' },
    { slug:'hq',          href:'/hq/',          label:'HQ',          sub:'Finances, profit, cash flow' },
    { slug:'camp-hub',    href:'/camp-hub/',    label:'Camp hub',    sub:'Camp spending and sales' },
    { slug:'prices',      href:'/prices/',      label:'Prices',      sub:'Catalog + packages' },
    { slug:'surf-school', href:'/surf-school/', label:'Surf School', sub:'Rentals + lessons' },
    { slug:'partners',    href:'/partners/',    label:'Partners',    sub:'Partner P&L + statements' },
    { slug:'crm',         href:'/crm/',         label:'CRM',         sub:'Outreach + pipeline' },
    { slug:'instructors', href:'/instructors/', label:'Instructors', sub:'Lessons + payroll' },
    { group:'Businesses' },
    { slug:'wild',        href:'/wild/',        label:'Wild Wednesday', sub:'Close the night · season P&L' },
    { slug:'suk',         href:'/suk/',         label:'The Suk',     sub:'Manjar · restaurant + catering' },
  ];
  const LOGO = `<svg viewBox="0 0 197.4 91" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#fff4d5" d="M61.7,51.9c-.4-9-5.5-16.5-9.7-24.1-2.9-4.8-5.3-9.8-9.3-13.9-3.9-4.4-6.5-9.8-10.8-13.9C19.2,16.6-.5,39.9,0,61.9c9.4-7.9,20.1-17.7,33.1-17.8,3,0,7.2,0,9.5,2.2,1.7,1.7,3.2,4.2,2,6.5-.3.5-1.9,2.7-2.3,2.9-12.9,7.4-20.3,18.6-16.5,33.7,3.1,1.3,8,1,11.1-.3,2.7-.3,5.1-1.3,7.5-2.5,8.7-2.9,14.5-11.1,15.5-20.1,1.2-4.7,2.1-9.7,1.8-14.6h0Z"/>
    <path fill="#fff4d5" d="M69.7,90.6l-.3-1.9c-.7-5.9-.5-11.9-.4-17.9,0-6.7-.3-13.7,0-20.3v-2.3c.5,0,1.1,0,1.7,0,3.3-.3,6.9-.3,10.2,0,.7,0,1.7,0,2.4,0,1.5.3,4,2.2,5,3.3,2.2,2.7,4.9,8.2,5.5,11.7,1.1,7.7-1.8,18.8-6.7,24.8-.4.5-1.4,1.9-1.7,2.1-.2,0-1.5.4-1.9.4-3.3.5-13.7,0-13.7,0h0v.2ZM77.2,61.3v.8c.4,4.6,0,9.3.3,13.9,0,.9-.3,1.7.9,1.8,2.2.3,4.1-.4,5.3-2.3,2.4-3.5,2.3-5.9,1.4-9.9-.3-1.1-1-2.6-1.7-3.5-.8-1-1.4-.8-2.5-.9-.2,0-.3,0-.6,0-1.1,0-2.1,0-3.3,0h.2Z"/>
    <path fill="#fff4d5" d="M124.1.2c2.7,0,4.5.8,7,1.9,6.3,2.9,4.6,10.5,5.1,16.2.5,6.7.9,13.3-1.7,19.7-.9,2.1-3.1,4.1-5.4,4.5-3.5.5-6.3,1-9.8.3-5.6-1.2-7.1-5.7-7.5-10.9-.3-3.7-.4-7.5-.7-11.3-.3-3.5.3-9.2,1.1-12.7,1.5-6.5,6.1-7.6,12.1-7.7h-.2ZM124.1,8.4c-1.4.1-2.7.7-3.7,1.7-.9.8-2.1,3.8-2.4,5-1.1,4.5-.7,9.9.4,14.5.5,2.3,1.9,5.4,4.6,5.7,1.5,0,2.7-.3,3.9-1.1,2-1.4,2-4.9,2.1-7.1.1-1.4.2-2.7.3-4.1,0-1.7,0-3.5-.1-5.1-.3-2.5-.9-7.1-3.1-8.6-.5-.3-1.3-.7-1.9-.7h0v-.2Z"/>
    <path fill="#fff4d5" d="M163.1,48.3c.2-.3,4.1-.3,4.3-.3h3.1v10.8c-.1,5.1-.9,10.1-.7,15.2.1,3.2-.2,5.8-1.1,8.9-.8,2.9-1.7,5.4-4.6,6.8-4.5,2.3-10,1.4-14.4-.9-1.1-.6-2.5-2.7-3-3.8-1.9-4.6-1.2-9.7-1-14.4.1-3.2.4-12.1.4-13.7s.1-6.4.1-8.5,1.5-.3,1.8-.2c.3,0,3.4,0,4.5,0,.2,0,.3,0,.3.2v6.1c-.1,5.9-.1,11.9.1,17.9.1,2.4.3,7.4,1.9,9.3.2.2.6.7.8.7.3,0,1.8.3,2.2.3s2.5-1,2.8-1.3c.1,0,.7-1.6.8-1.9.9-2.8.7-5.9.8-8.7.1-4,.1-7.9.4-11.9.1-1.9.3-9.5.3-10.5h0l.2-.2Z"/>
    <path fill="#fff4d5" d="M176.3.4c.3,1.1.2,2.4.5,3.5.3,1.6.9,3.2,1.2,4.8.9,4.1,1.3,8.3,2.3,12.3.5,2.2,1.3,4.5,1.9,6.7,1.3,4.6,2.3,9.3,3.4,13.9.1.7.3,1,.5,1.6h-8.5c-.1-1.3-.5-2.6-.9-3.9-.3-1.3-.5-2.8-.9-4.1-.3-.9-.5-1.4-.7-2.5,0,0-4.1,0-5.3,0h-.2c-.2,1.2-.4,2.2-.6,3.3-.3,1.5-.7,3.1-1.1,4.7-.1.7-.3,1.7-.4,2.5-1,0-8.3-.2-9,0-.1-.5,5.7-24.6,8.4-36.2.5-2.2.9-4.4,1.4-6.6,0,0,3.5.1,3.7.1h4.3v-.2ZM172.4,11.8q-.3,0-.3.2c-.2.9-.5,1.9-.7,2.8-.5,2.5-.9,5.3-1.3,7.9-.1.9-.3,1.8-.3,2.7,1.6,0,3.2,0,4.7-.3.1-.9-.2-1.7-.3-2.5-.3-2.4-.5-5-1-7.3-.2-1.1-.7-2.3-.9-3.4h.1Z"/>
    <path fill="#fff4d5" d="M162.6,8.9h-.8c-.9.1-2,.3-2.9.4h-4.3c-.3,1.2-.1,2.5-.1,3.7-.3,8.1,0,16.5-.3,24.6,0,1.7.1,3.3.1,4.9s0,.3.1.5c0,.3-7.8,0-8.5,0,0-.9-.3-4.9-.3-6.1-.4-6.9.5-14.1-.3-21,0-.8-.4-1.8-.5-2.6-.1-1.4,0-2.9,0-4.3v-.2c-.8-.1-1.5,0-2.3,0s-.5-.1-.7-.1c-1.5,0-2.9.1-4.4.1V.5h1.3c3.8-.3,7.5.1,11.3,0,3.5,0,6.5.2,10,.4.5,0,2.4-.1,2.6.1.2.3,0,.6,0,.9,0,1,0,2.1-.1,3.1,0,1.3.3,2.5.1,3.9h0Z"/>
    <path fill="#fff4d5" d="M109.8,48c.3,1.1.2,2.4.5,3.5.3,1.6.9,3.2,1.2,4.8.9,4.1,1.3,8.3,2.3,12.3.5,2.2,1.3,4.5,1.9,6.7,1.3,4.6,2.3,9.3,3.4,13.9,0,.7.3,1,.5,1.6h-8.5c0-1.3-.5-2.6-.9-3.9-.3-1.3-.5-2.8-.9-4.1-.3-.9-.5-1.4-.7-2.5,0,0-4.1,0-5.3,0h-.2c-.2,1.2-.4,2.2-.6,3.3-.3,1.5-.7,3.1-1.1,4.7,0,.7-.3,1.7-.4,2.5-1,0-8.3-.2-9,0,0-.5,5.7-24.6,8.4-36.2.5-2.2.9-4.4,1.4-6.6,0,0,3.5,0,3.7,0h4.3v-.2ZM105.9,59.5q-.3,0-.3.2c-.2.9-.5,1.9-.7,2.8-.5,2.5-.9,5.3-1.3,7.9,0,.9-.3,1.8-.3,2.7,1.6,0,3.2,0,4.7-.3,0-.9-.2-1.7-.3-2.5-.3-2.4-.5-5-1-7.3-.2-1.1-.7-2.3-.9-3.4h.1Z"/>
    <path fill="#fff4d5" d="M187.6,48c.3,1.1.2,2.4.5,3.5.3,1.6.9,3.2,1.2,4.8.9,4.1,1.3,8.3,2.3,12.3.5,2.2,1.3,4.5,1.9,6.7,1.3,4.6,2.3,9.3,3.4,13.9.1.7.3,1,.5,1.6h-8.5c-.1-1.3-.5-2.6-.9-3.9-.3-1.3-.5-2.8-.9-4.1-.3-.9-.5-1.4-.7-2.5,0,0-4.1,0-5.3,0h-.2c-.2,1.2-.4,2.2-.6,3.3-.3,1.5-.7,3.1-1.1,4.7-.1.7-.3,1.7-.4,2.5-1,0-8.3-.2-9,0-.1-.5,5.7-24.6,8.4-36.2.5-2.2.9-4.4,1.4-6.6,0,0,3.5,0,3.7,0h4.3v-.2ZM183.7,59.5q-.3,0-.3.2c-.2.9-.5,1.9-.7,2.8-.5,2.5-.9,5.3-1.3,7.9-.1.9-.3,1.8-.3,2.7,1.6,0,3.2,0,4.7-.3.1-.9-.2-1.7-.3-2.5-.3-2.4-.5-5-1-7.3-.2-1.1-.7-2.3-.9-3.4h.1Z"/>
    <path fill="#fff4d5" d="M108.3,13.8h-6.9c-.2-.5,0-1-.2-1.4,0-.5-1.3-2.3-1.5-2.8-.5-.7-1.4-1.5-2.3-1.5-1.3-.1-3.2,0-4.3.8-.5.3-1.1,2.1-1.4,2.7-1.1,3.3-1.3,6.6-1.5,10.1,0,3.6.2,8.1,1.7,11.4,0,.3.5.9.6,1.1.2.3,1.7,1.1,2,1.1.9,0,2.5,0,3.4-.3.3,0,1.7-1,2-1.3.6-.6,1.3-3.3,1.3-4.2s-.3-1.9-.4-2l-4.5-.2c-.3-1.9,0-3.9,0-5.8v-.2c.9,0,6.9.3,9.1.5h2.2c0,.7.2,1.3.3,2,.4,3.1.4,5.2,0,8.3s-.5,6.5-3.1,8.5c-1.1.9-1.8,1.5-3.3,1.9-1.9.6-2.8.6-4.7.7-1.3,0-2.3,0-3.6-.2-3.9-.8-6.3-2.8-7.5-6.5-2.7-8.8-3.1-18.8-.9-27.8.7-3,1.3-4.6,3.9-6.5,2.1-1.5,7-2.3,9.4-1.6,2.7.8,6.6,2.7,8.1,4.4.7.8,1.5,2.7,1.7,3.8.2,1.2,0,5,0,5h.2Z"/>
    <path fill="#fff4d5" d="M142.8,61.3h-6.9c-.2-.5-.1-1-.2-1.4-.1-.5-1.3-2.4-1.5-2.8-.5-.7-1.5-1.5-2.3-1.5-1.3,0-3.2,0-4.3.8-.5.3-1.2,2.1-1.4,2.7-1.1,3.3-1.3,6.7-1.5,10.1,0,3.6.2,8.1,1.7,11.5,0,.3.5.9.6,1.1.2.3,1.7,1.1,2,1.1.9,0,2.5,0,3.5-.3.4,0,1.7-1,2-1.3.6-.7,1.3-3.3,1.3-4.3s-.3-1.9-.4-2l-4.5-.2c-.3-1.9-.1-3.9.1-5.8v-.2c.9,0,6.9.3,9.1.5h2.2c0,.7.2,1.3.3,2.1.5,3.1.4,5.2.1,8.3-.3,3.1-.5,6.5-3.1,8.6-1.1.9-1.8,1.5-3.3,1.9-1.9.6-2.8.6-4.7.7-1.3,0-2.3,0-3.6-.2-3.9-.8-6.3-2.8-7.5-6.6-2.7-8.9-3.1-18.9-.9-27.9.8-3.1,1.3-4.7,3.9-6.5,2.1-1.5,7.1-2.3,9.5-1.6,2.7.8,6.6,2.7,8.1,4.4.7.8,1.5,2.8,1.7,3.8.2,1.3,0,5,0,5h0Z"/>
  </svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const $ = (id) => document.getElementById(id);
  const eur = (n) => '€' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur0 = (n) => '€' + Math.round(Number(n || 0)).toLocaleString('en-GB');

  function currentSlug(){
    const p = location.pathname.replace(/\/index\.html$/, '/');
    if (p === '/' ) return 'hub';
    const hit = APPS.filter(a => a.href && a.href !== '/' && p.startsWith(a.href)).sort((a, b) => b.href.length - a.href.length)[0];
    return hit ? hit.slug : null;
  }
  function appOf(slug){ return APPS.find(a => a.slug === slug) || null; }
  function menu(current){
    current = current || currentSlug();
    return APPS.map(a => a.group
      ? `<div class="app-switch-group">${esc(a.group)}</div>`
      : `<a href="${a.href}"${a.slug === current ? ' class="is-current"' : ''}><span>${esc(a.label)}</span><small>${esc(a.sub)}</small></a>`).join('');
  }
  function mountMenus(current){
    document.querySelectorAll('[data-app-menu]').forEach(el => { el.innerHTML = menu(el.getAttribute('data-app-menu') || current); });
  }

  let NAV = null;   // last mount options (for setTab / drawer)
  function tabHtml(t, attr, cls){
    const act = t.onclick || `showPage('${t.id}')`;
    return `<button class="${cls}${t.active ? ' active' : ''}" ${attr}="${t.id}" onclick="${esc(act)}${cls === 'ntab-m' ? ';AppShell.toggleMobile()' : ''}"${t.hidden ? ' style="display:none"' : ''}${t.domId ? ` id="${t.domId}${cls === 'ntab-m' ? 'Mob' : ''}"` : ''}>${t.label}${t.count ? ` <span class="count">${t.count}</span>` : ''}</button>`;
  }
  function nav(o){
    const app = appOf(o.app) || { label: o.title || '', sub: '' };
    const attr = o.tabAttr || 'data-page';
    const tabs = (o.tabs || []);
    const loc = o.location;
    return `
  <div class="nav-logo">
    <a class="nav-home" href="/" title="Back to hub"><div class="nav-logo-mark">${LOGO}</div></a>
    <details class="app-switch">
      <summary><span>${esc(o.title || app.label)}</span><span class="app-switch-caret">▾</span></summary>
      <nav class="app-switch-menu" data-app-menu="${esc(o.app || '')}">${menu(o.app)}</nav>
    </details>
    ${loc ? `<details class="app-switch loc-switch" id="${loc.id || 'locSwitch'}">
      <summary><span id="${loc.labelId || 'locLabel'}">${esc(loc.label || '')}</span><span class="app-switch-caret">▾</span></summary>
      <nav class="app-switch-menu">${(loc.items || []).map(i => `<a href="${i.href}"${i.slug ? ` data-loc="${i.slug}"` : ''}${i.current ? ' class="is-current"' : ''}><span>${esc(i.label)}</span><small>${esc(i.sub || '')}</small></a>`).join('')}</nav>
    </details>` : ''}
  </div>
  <div class="nav-tabs" id="${o.tabsId || 'navTabs'}"${o.tabsHidden ? ' style="display:none"' : ''}>${tabs.map(t => tabHtml(t, attr, 'ntab')).join('')}</div>
  <div class="nav-actions" id="navActions">${o.actions || ''}${o.user === false ? '' : `<span class="user-chip" id="userChip">—</span>`}${o.signOut ? `<button class="nav-action-btn" onclick="${esc(o.signOut)}" title="Sign out">Sign out</button>` : ''}</div>
  ${o.mobile === false ? '' : `<button class="nav-hamburger" onclick="AppShell.toggleMobile()" aria-label="Open menu">☰</button>`}`;
  }
  function drawerHtml(o){
    const attr = o.tabAttr || 'data-page';
    return `<div class="nav-mob-backdrop" id="mobNavBackdrop" onclick="AppShell.toggleMobile()"></div>
<aside class="nav-mob-drawer" id="mobNavDrawer" aria-hidden="true">
  <button class="nav-mob-close" onclick="AppShell.toggleMobile()" aria-label="Close menu">×</button>
  <div class="nav-mob-lbl">Sections</div>
  ${(o.tabs || []).map(t => tabHtml(t, attr, 'ntab-m')).join('')}
  ${o.mobileActions ? `<div class="nav-mob-lbl">Actions</div>${o.mobileActions}` : ''}
</aside>`;
  }
  function mount(el, o){
    if (typeof el === 'string') el = $(el);
    if (!el) el = $('appNav');
    if (!el) return;
    NAV = o || {};
    el.classList.add('app-nav');
    el.innerHTML = nav(NAV);
    if (NAV.mobile !== false && !$('mobNavDrawer')) el.insertAdjacentHTML('afterend', drawerHtml(NAV));
  }
  function toggleMobile(){
    const d = $('mobNavDrawer'), b = $('mobNavBackdrop'); if (!d) return;
    const open = !d.classList.contains('open');
    d.classList.toggle('open', open); if (b) b.classList.toggle('open', open);
    d.setAttribute('aria-hidden', String(!open));
  }
  function setTab(id){
    const attr = (NAV && NAV.tabAttr) || 'data-page';
    document.querySelectorAll(`.ntab[${attr}],.ntab-m[${attr}]`).forEach(b => b.classList.toggle('active', b.getAttribute(attr) === id));
  }
  function setUser(text){ const c = $('userChip'); if (c) c.textContent = text || '—'; }
  function mountLogo(id){ const el = $(id); if (el) el.innerHTML = LOGO; }
  function splash(title, text){ return `<div class="splash"><h1>${esc(title)}</h1><p>${text}</p><a href="/">← Back to hub</a></div>`; }
  function toast(msg, kind){
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    clearTimeout(t._t); t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
  }
  async function fetchAll(build, page = 1000){
    const out = []; for (let from = 0; ; from += page) {
      const { data, error } = await build().range(from, from + page - 1); if (error) throw error;
      out.push(...(data || [])); if (!data || data.length < page) break;
    } return out;
  }

  // ── Flat icon set (Feather-style line icons, currentColor) — the only icons of the app.
  //    Miguel, 22 Oct 2026: «icons todos flats». Emoji in buttons/titles are replaced at runtime (flattenEmoji).
  const ICON_PATHS = {
    'upload':        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    'download':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'package':       '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    'file-text':     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    'alert':         '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'zap':           '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'bar-chart':     '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'search':        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'home':          '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'folder':        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    'tent':          '<path d="M3 20h18L12 4 3 20z"/><path d="M12 13v7"/>',
    'card':          '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    'users':         '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'check':         '<polyline points="20 6 9 17 4 12"/>',
    'x':             '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'settings':      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'edit':          '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    'trash':         '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    'link':          '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'external':      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    'plus':          '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'refresh':       '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    'mail':          '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    'receipt':       '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/>',
    'truck':         '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    'paperclip':     '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    'inbox':         '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'euro':          '<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
    'wave':          '<path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>',
    'chevron-down':  '<polyline points="6 9 12 15 18 9"/>',
    'arrow-right':   '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'archive':       '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    'calendar':      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'info':          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    'eye':           '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':       '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    'filter':        '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    'map-pin':       '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    'user':          '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'lock':          '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'unlock':        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    'logout':        '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'login':         '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'chevron-left':  '<polyline points="15 18 9 12 15 6"/>',
    'chevron-up':    '<polyline points="18 15 12 9 6 15"/>',
    'arrow-left':    '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    'arrow-up':      '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'arrow-down':    '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    'minus':         '<line x1="5" y1="12" x2="19" y2="12"/>',
    'more':          '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'copy':          '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'printer':       '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    'phone':         '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>',
    'tag':           '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    'globe':         '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    'bell':          '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    'send':          '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    'save':          '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    'list':          '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    'grid':          '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    'star':          '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'check-circle':  '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    'x-circle':      '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    'help':          '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'image':         '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    'sun':           '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    'coffee':        '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    'music':         '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'briefcase':     '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'book':          '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    'trending-up':   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  };
  function icon(name, cls){
    const d = ICON_PATHS[name]; if (!d) return '';
    return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  // emoji → flat icon, applied to buttons/titles/chips at runtime so every page gets the same icons without touching each template
  const EMOJI = { '⬆':'upload', '⬇':'download', '📦':'package', '📋':'file-text', '⚠':'alert', '⚠️':'alert', '🤖':'zap', '📊':'bar-chart', '🔎':'search', '🔍':'search',
    '🏠':'home', '📁':'folder', '🏕':'tent', '🏕️':'tent', '💳':'card', '💶':'euro', '💰':'euro', '👥':'users', '✓':'check', '✅':'check', '✕':'x', '❌':'x', '⏰':'clock',
    '⚙':'settings', '⚙️':'settings', '✎':'edit', '✏️':'edit', '🗑':'trash', '🗑️':'trash', '📎':'paperclip', '📥':'inbox', '📤':'upload', '🧾':'receipt', '🚐':'truck', '🚌':'truck',
    '🏄':'wave', '🏄‍♂️':'wave', '🚀':'zap', '↗':'external', '✔':'check', '🏷':'archive', '🏷️':'archive', '📈':'bar-chart', '📉':'bar-chart', '🏦':'card', '＋':'plus', '➕':'plus', '↻':'refresh', '🔄':'refresh', '📧':'mail', '✉️':'mail', '🗂':'archive', '🗂️':'archive', '📅':'calendar', '🕒':'clock',
    '🔒':'lock', '🔓':'unlock', '📍':'map-pin', '👤':'user', 'ℹ':'info', 'ℹ️':'info', '👁':'eye', '👁️':'eye', '🔔':'bell', '⭐':'star', '🖨':'printer', '🖨️':'printer', '📞':'phone', '📣':'send', '🎵':'music', '☕':'coffee', '🍽':'coffee', '🍽️':'coffee', '🌍':'globe', '🌎':'globe', '🌊':'wave', '🔗':'link', '❓':'help', '→':'arrow-right', '←':'arrow-left', '🚪':'logout' };
  const EMOJI_KEYS = Object.keys(EMOJI).sort((a, b) => b.length - a.length);
  const FLATTEN_SEL = 'button, summary, .ntab, .ntab-m, .health-chip, .card-title, .section-title, .ov-section-title, .form-title, a.btn, .nav-action-btn, .digest-btn, .kpi-label, .add-block-title, th, .badge, .chip, label.period-picker, .section-lbl, h1, h2, h3, h4';
  function flattenEmoji(root){
    const scope = root || document;
    scope.querySelectorAll(FLATTEN_SEL).forEach(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(node => {
        const s = node.nodeValue; if (!s) return;
        const lead = s.match(/^\s*/)[0]; const rest = s.slice(lead.length);
        const key = EMOJI_KEYS.find(k => rest.startsWith(k)); if (!key) return;
        const span = document.createElement('span'); span.innerHTML = icon(EMOJI[key]);
        const after = rest.slice(key.length).replace(/^️/, '').replace(/^\s+/, ' ');
        node.nodeValue = lead; node.parentNode.insertBefore(span.firstChild, node.nextSibling);
        const txt = document.createTextNode(after); node.parentNode.insertBefore(txt, node.nextSibling.nextSibling);
      });
    });
  }
  let flattenTimer = null;
  function watchEmoji(){
    flattenEmoji();
    if (!window.MutationObserver) return;
    new MutationObserver(() => { clearTimeout(flattenTimer); flattenTimer = setTimeout(() => flattenEmoji(), 120); }).observe(document.body, { childList: true, subtree: true });
  }

  const api = { APPS, LOGO, menu, mountMenus, nav, mount, toggleMobile, setTab, setUser, mountLogo, splash, toast, esc, $, eur, eur0, fetchAll, currentSlug, icon, flattenEmoji };
  window.AppShell = api;
  window.BusinessShell = api;
  const auto = () => { mountMenus(); if (document.body) watchEmoji(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
