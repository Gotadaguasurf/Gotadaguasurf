// Platform owner allow-list — THE single place to add/change an owner email.
//
// Every app builds its owner-bypass Set from this global. Each site keeps a
// hardcoded fallback (`|| ['miguel@gotadaguasurf.com']`) so a failed load of
// this script degrades to the current owner instead of locking Miguel out.
//
// NOTE: this is a CLIENT-side convenience gate (skip a DB round-trip, show
// owner-only buttons). Real enforcement is RLS + workspace_memberships —
// editing this file grants nothing at the data layer.
window.__PLATFORM_OWNER_EMAILS = ['miguel@gotadaguasurf.com'];
