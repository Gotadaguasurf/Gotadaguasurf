# Gota d'Água — Live Platform

Full platform deploy. All state lives in Supabase — zero localStorage, works on every computer simultaneously.

## Files

| File | Route | Description |
|------|-------|-------------|
| `index.html` | `/` | Hub + Login + Settings |
| `camp-hub.html` | `/camp-hub` | Sri Lanka Camp Hub (Overview, Camp Tab, Ledger, Instructors) |
| `camp-tab-inner.html` | embedded | Camp Tab charge interface (iframe inside camp-hub) |
| `partners.html` | `/partners` | Partner tracker + bookings |
| `instructors.html` | `/instructors` | Instructor log across all locations |
| `supabase-config.js` | — | Supabase URL + anon key |
| `schema.sql` | — | Full DB schema (run once in Supabase SQL Editor) |
| `vercel.json` | — | Vercel routing config |

## Deploy steps

### 1. Supabase
1. Create project (or use existing)
2. Enable Email auth
3. Create first user: `miguel@gotadaguasurf.com`
4. Open SQL Editor → run `schema.sql`
5. Copy your project URL and anon key

### 2. supabase-config.js
Update with your real values:
```js
window.__SUPABASE_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR-ANON-KEY'
};
```

### 3. Vercel
1. Push folder to GitHub
2. Create new Vercel project → select this folder
3. Deploy

Routes that work:
- `/` → Hub + Login
- `/camp-hub` → Sri Lanka Camp Hub
- `/partners` → Partners
- `/instructors` → Instructors

### 4. First login test
1. Open your Vercel URL
2. Login with `miguel@gotadaguasurf.com`
3. Confirm: Hub opens, all workspaces accessible, Camp Tab loads, Ledger saves, Instructors load

## Architecture — no localStorage

All data flows:
- **Camp Tab** → Supabase `camp_weeks`, `camp_guests`, `camp_tab_items`, `location_menus`
- **Operations Ledger** → Supabase `ledger_entries`
- **Instructors** → Supabase `instructor_lessons`
- **Partners** → Supabase `partners`, `bookings`, `partner_month_status`
- **Team access** → Supabase `platform_profiles`, `workspace_memberships`

When a week is closed in Camp Tab → revenue entries written directly to `ledger_entries`.
When history week is deleted → those ledger entries deleted from Supabase.
T-shirt stock → `location_menus.stock_qty` decrements on add, increments on delete.

## What works now
- ✅ Login, session, password reset, invite flow
- ✅ Team access management (invite by email, set areas, roles)
- ✅ Sri Lanka Camp Hub — all 4 tabs Supabase-backed
- ✅ Camp Tab — charge, this week, history, top sellers, menu settings
- ✅ T-shirt stock tracking (live, per device)
- ✅ Week close → auto-sync to Operations Ledger
- ✅ Delete history → removes from ledger
- ✅ Operations Ledger — full CRUD, monthly filter
- ✅ Instructors — log, mark paid, monthly filter, per-location
- ✅ Partners tracker — status, bookings, commissions
- ✅ Works across all computers simultaneously (zero localStorage)

## Next to build
- Portugal Camp Hub (same structure as Sri Lanka)
- Morocco Camp Hub
- Junior Camp Hub
- Bookinglayer API webhook → auto-populate bookings
