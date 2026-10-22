/* alias — see lib/app-shell.js (window.BusinessShell === window.AppShell) */
if (!window.AppShell) { const s = document.createElement('script'); s.src = '/lib/app-shell.js'; s.async = false; document.head.appendChild(s); }
