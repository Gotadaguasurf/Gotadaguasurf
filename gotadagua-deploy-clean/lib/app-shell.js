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
   helpers: $, esc, eur, eur0, fetchAll(build)
   window.BusinessShell is an alias (older pages).
   ════════════════════════════════════════════════════════════════════════ */
(function(){
  const APPS = [
    { slug:'hub',         href:'/',             label:'Overview',    sub:'Camps, businesses, management' },
    { slug:'hq',          href:'/hq/',          label:'HQ',          sub:'Finances, profit, cash flow' },
    { slug:'camp-hub',    href:'/camp-hub/',    label:'Camp hub',    sub:"Managers' float ledger" },
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
  const api = { APPS, LOGO, menu, mountMenus, nav, mount, toggleMobile, setTab, setUser, mountLogo, splash, toast, esc, $, eur, eur0, fetchAll, currentSlug };
  window.AppShell = api;
  window.BusinessShell = api;
  const auto = () => mountMenus();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
