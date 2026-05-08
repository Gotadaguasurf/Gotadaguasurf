// ════════════════════════════════════════════════════════════════════════════
//  Lightweight error monitor — drop-in script for every page
// ════════════════════════════════════════════════════════════════════════════
//
//  Captures every uncaught JS error + every unhandled promise rejection.
//  Logs them clearly to the browser console with a stack trace, stashes the
//  most recent one on `window.__lastError` for quick inspection from DevTools,
//  and shows a small dismissible banner so the user knows something went wrong
//  (instead of getting a blank screen with no feedback).
//
//  Usage: include `<script src="/error-monitor.js"></script>` in <head>.
//  Pure vanilla, no dependencies, no third-party network calls.
//
//  To inspect from DevTools:    window.__lastError
//  To clear the banner:         click the × button on it
// ════════════════════════════════════════════════════════════════════════════

(function(){
  if (window.__errorMonitorLoaded) return;
  window.__errorMonitorLoaded = true;

  function showBanner(message, detail){
    try{
      let el = document.getElementById('__errMonBanner');
      if(!el){
        el = document.createElement('div');
        el.id = '__errMonBanner';
        el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;max-width:560px;width:calc(100% - 32px);background:#fff;color:#0d1e34;border:1px solid #c43c3c;border-left:4px solid #c43c3c;border-radius:10px;box-shadow:0 8px 24px rgba(13,30,52,.20);padding:12px 14px;font:600 12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;gap:10px;align-items:flex-start';
        document.body.appendChild(el);
      }
      el.innerHTML =
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;color:#c43c3c;margin-bottom:2px">⚠ Something went wrong</div>' +
          '<div style="font-weight:500;color:#0d1e34;font-size:12px;word-break:break-word">' + escapeHtml(message || 'Unknown error') + '</div>' +
          (detail ? '<div style="font-size:11px;color:#6b7a8c;margin-top:4px">' + escapeHtml(detail) + '</div>' : '') +
          '<div style="font-size:11px;color:#6b7a8c;margin-top:6px">Type <code style="background:#f4f6fa;padding:1px 4px;border-radius:3px">window.__lastError</code> in the console to see the full error.</div>' +
        '</div>' +
        '<button onclick="this.parentNode.style.display=\'none\'" style="background:none;border:none;color:#6b7a8c;font-size:20px;cursor:pointer;padding:0;line-height:1;align-self:flex-start" title="Dismiss">×</button>';
      el.style.display = 'flex';
    }catch(_){ /* swallow — no point erroring inside the error monitor */ }
  }

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function record(kind, payload){
    try{
      window.__lastError = { kind: kind, ...payload, when: new Date().toISOString() };
    }catch(_){ window.__lastError = { kind: kind, when: new Date().toISOString() }; }
    // Always log to console so engineers see it in the field too
    try{
      console.warn('[error-monitor]', kind, payload);
    }catch(_){}
  }

  window.addEventListener('error', function(e){
    const msg = (e && e.message) || 'Unknown error';
    const at  = e && e.filename ? (e.filename + ':' + (e.lineno||0) + ':' + (e.colno||0)) : '';
    record('window.error', { message: msg, source: at, error: e && e.error });
    showBanner(msg, at);
  });

  window.addEventListener('unhandledrejection', function(e){
    const reason = e && e.reason;
    const msg = (reason && (reason.message || reason.toString())) || 'Unhandled promise rejection';
    record('unhandledrejection', { message: msg, reason: reason });
    showBanner(msg, 'Unhandled promise rejection');
  });

  // Console signal so anyone debugging knows the monitor is live
  try{ console.info('[error-monitor] active — uncaught errors will surface here'); }catch(_){}
})();
