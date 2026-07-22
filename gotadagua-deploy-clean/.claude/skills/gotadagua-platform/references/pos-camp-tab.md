# The POS (Camp Tab)

`camp-hub/camp-tab-inner.html` — ~5k lines, the single most subtle file in the
platform. Two incidents in one week came from here. Read this before editing it.

## The iframe contract

The POS is an **iframe** mounted by `camp-hub/index.html`. The parent owns the
Supabase catalog and pushes menu data down by `postMessage`:

| Message | Payload | Behaviour on receipt |
|---|---|---|
| `camp-tab-parent-bootstrap` | state + menu + staff | write-once (only fills empty slots) |
| `camp-tab-tours-update` | `Tours[]` | always adopted when non-empty |
| `camp-tab-merch-update` | `Merch[]` | always adopted, **even empty** |
| `camp-tab-drinks-update` | `Drinks[]` | always adopted, even empty |
| `camp-tab-extras-update` | `Extras[]` | always adopted, even empty |
| `camp-tab-any-update` | `{tab: items[]}` | Add-ons + custom `pricing_areas` tabs |

"Even empty" matters: it is how a location with no Drinks rows gets the Drinks tab
hidden (`visibleCats` filters empty categories out) instead of showing stale
seed data from another camp.

### ⚠️ Never open the iframe URL directly

Standalone, there is no parent, so `MENU` stays as `DEFAULT_MENU` — the Sri Lanka
seed (LKR drinks, tees at 6500). Since `syncCampTabMenuToSupabase` is
delete-all-then-write, one such load **replaced Portugal's whole POS menu**: Tours,
Lesson, Extras and Add-ons gone, merch showing €6,500.

The `MENU_HYDRATED` flag now guards it — the sync no-ops until
`hydrateCampTabMenuFromSupabase` establishes what the DB holds (rows loaded, or
confirmed empty for a legitimate first seed). Keep that guard intact, and still
always test via `/camp-hub?location=<slug>` → Camp Tab.

Recovery if it happens again: `supabase/restore-portugal-menu.sql` rebuilds
`location_menus` from `pricing_catalog` (the real source of truth), preserving
non-catalog categories like Diploria.

## Catalog → POS mapping

`/prices` writes `pricing_catalog`; the hub converts rows with
`show_in_camp_tab = true` into POS menu items. Category → tab name:

- `Tour` → **Tours** (displayed as "Tours/Activities")
- `Other Service` → **Add-ons**
- everything else → same name (Merch, Extras, Drinks, Lesson, …)

Extra fields ride along: `stock_qty` → `stk`, `alt_price` + `alt_label='Staff'` →
staff price, `notes` → description. Tour-only extras (`hasTransport`,
`costPerGuest`, `transportAssoc`) are encoded into the description with `[TRANSPORT]`,
`[COST:n]`, `[TA:name]` markers because `location_menus` has no columns for them.

## Tabs per location

`LOCATION_TAB_CONFIG` in camp-tab-inner.html decides the tab order:

```js
'sri-lanka':   ['Drinks', 'Tours', 'Extras', 'Merch'],
'morocco':     ['Tours', 'Extras', 'Merch'],
'portugal':    ['Tours', 'Extras', 'Merch', 'Diploria', 'Bar Tab'],
'junior-camp': ['Merch', 'Extras'],
```

A tab only renders if it has items for the current roster (`visibleCats`), so
configuring a tab is safe even before its catalog rows exist. `getCats()` is
`Object.keys(MENU)` — dynamic, so a category that exists only in `location_menus`
(like Diploria) survives syncs.

## Stock models

Two deliberately different models — pick the right one for new categories:

**Merch — family + size grouping.** `"T-Shirt Offer L"` and `"T-Shirt Staff L"`
draw from the same `"T-Shirt L"` counter. Naming convention:
`{Product} [Offer|Staff|Sale|Promo|Discount] {Size}`. This exists so discount
variants don't need their own stock. Adding a product family? It just works.

**Standalone — the name IS the SKU.** Used by Extras and Diploria: every distinct
name keeps its own counter (`standaloneSoldCount(name, category)`). Correct when
SKUs are already fully specified, e.g. Diploria's `"Core Black 32"` — colour+size
combinations that must not borrow from each other.

Router: `stockLeftForCategory(item, category)`. A missing `stk` field means
**untracked** (returns `null`), not zero — don't conflate them.

## Modes: weekly vs per_guest

`camp_tab_mode` on the location row:

- **`weekly`** (Sri Lanka): guests belong to a week; closing the week archives it
  into History and generates the revenue rows.
- **`per_guest`** (Portugal, Morocco): no meaningful weeks. Each guest is closed
  individually (`closedAt` stamp — a *soft* close, data is retained). Items are
  paid individually (`paidAt`), each generating its own ledger row.

The History tab in per_guest mode renders `renderHistoryPerGuest`: every closed
guest with paid items, close date, lifetime-collected total, name search, and
**Re-open** for returning guests. It was hidden for a while on the theory the
Operations Ledger covered it — it doesn't, staff need the guest-centric view.

## Currency

Item rows carry a `currency` column, but the **location's** currency is the source
of truth for display. Rows were historically stamped `'LKR'` regardless of location,
which made the Activity feed show "LKR 30" for €30 Portugal merch. The write site
now stamps `LOCAL_CURRENCY`, and read sites prefer `LOCAL_CURRENCY` over the stored
column. Prefer the location's currency in any new UI.

## Sync mechanics

`syncCampTabMenuToSupabase` = delete-all-then-**upsert** on the unique index
`(location_id, category, item_name, price_local)`. It was a plain insert until two
browsers syncing concurrently interleaved as "A deletes, B deletes, A inserts,
B inserts" and every item appeared 2-3× with mixed stock snapshots. `normalizeMenu`
also dedups by (name, price) on every entry path, so a client's *view* heals even
against a dirty DB.

Tables: `camp_weeks` → `camp_guests` → `camp_tab_items`, plus `location_menus`
(the POS menu), `camp_staff_directory`, `tour_zones`.
