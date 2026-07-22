# SQL recipes

Patterns that recur. Miguel runs these by pasting into the Supabase SQL Editor, so
**give him the full block in chat** — not a file path — and always end with a
sanity `select` plus the expected numbers so he can verify without asking.

House rules: idempotent by default (`if not exists`, `on conflict`, `where not
exists`), wrap multi-statement changes in `begin; … commit;`, and never write a
destructive statement without showing him a preview `select` first.

## Camp expenses → Operations Ledger

The most common request ("add these expenses to <camp>"). Local-float expenses
belong in `ledger_entries`, **not** `hq_invoices`. Category → business area:
Food→Food, Transport→Transport, Setup→Utilities, Activities→Tours, Rent→Utilities.

```sql
insert into public.ledger_entries
  (id, location_id, type, category, description, payment_method, qty,
   amount_local, currency, entry_date, business_area, fx_rate, amount_eur,
   source_kind, is_comp, paid_from, attributed_location)
select gen_random_uuid(),
       (select id from public.locations where slug='junior-camp'),
       'expense', v.cat, v.descr, v.pay, 1,
       v.amt, 'EUR', v.d, v.area, 1, v.amt,
       'manual', false, 'junior-camp', 'junior-camp'
from (values
  ('SUPPLIER · INVOICE#', 61.48, date '2026-07-04', 'Food', 'Food', 'Bank Transfer')
) as v(descr, amt, d, cat, area, pay)
where not exists (           -- dedup: safe to re-run
  select 1 from public.ledger_entries le
   where le.attributed_location='junior-camp' and le.description = v.descr
);
```

Build `description` as `"{Supplier} · {Invoice#}"` — it doubles as the dedup key.
When the user re-sends an updated CSV, diff against the invoice numbers already
imported and insert only the new ones.

## Migrating rows out of hq_invoices into the ledger

When camp expenses were imported to the wrong place:

```sql
begin;
insert into public.ledger_entries (…)   -- same shape as above
select …, i.category_name, trim(i.company || coalesce(' · ' || nullif(i.invoice_number,''), '')), …
  from public.hq_invoices i
 where i.location_slug = 'junior-camp' and i.deleted_at is null;

delete from public.hq_invoices
 where location_slug = 'junior-camp' and deleted_at is null;
commit;
```

## Seeding / restocking POS items

`location_menus` has a unique index on
`(location_id, category, item_name, price_local)` — upsert against it so re-runs
refresh stock instead of duplicating. This is also the restock path.

```sql
insert into public.location_menus
  (id, location_id, category, item_name, price_local, stock_qty,
   description, staff_price_local, sort_order, active)
select gen_random_uuid(),
       (select id from public.locations where slug='portugal'),
       'Diploria', v.item_name, 65, v.stock_qty, null, null, v.sort_order, true
from (values ('Core Black 32', 1, 4190)) as v(item_name, stock_qty, sort_order)
on conflict (location_id, category, item_name, price_local)
do update set stock_qty = excluded.stock_qty, active = true;
```

## Rebuilding a corrupted POS menu

`pricing_catalog` is the source of truth. Full script:
`supabase/restore-portugal-menu.sql`. Shape: delete the location's menu **except**
non-catalog categories (Diploria), then re-insert every
`show_in_camp_tab = true` row with the category→tab mapping (`Tour`→`Tours`,
`Other Service`→`Add-ons`, else identity).

## Diagnosing access ("user X can't see Y")

```sql
-- the decisive one: what workspaces does this user actually hold?
select wm.member_role, wm.can_view, wm.can_edit, wm.active,
       w.slug as workspace_slug, w.name
  from public.workspace_memberships wm
  join public.workspaces w on w.id = wm.workspace_id
 where wm.user_id = (select id from auth.users
                      where lower(email) = lower('someone@gotadaguasurf.com'));
```

Read it as: row for the location slug + `can_view=true` + `active=true` → has
access. `can_edit=false` → Camp Tab only. No row → no access (the app blocks with
a picker rather than falling back to another location).

## Sanity queries worth keeping

```sql
-- Junior Camp accounting: expenses in the ledger, nothing stuck in HQ
select (select count(*) from public.ledger_entries
         where attributed_location='junior-camp' and type='expense') as no_ledger,
       (select count(*) from public.hq_invoices
         where location_slug='junior-camp' and deleted_at is null) as ainda_no_hq;

-- POS menu health for a location
select category, count(*) from public.location_menus
 where location_id = (select id from public.locations where slug='portugal')
 group by category order by category;

-- Duplicate POS items (should return zero rows)
select location_id, category, item_name, price_local, count(*)
  from public.location_menus group by 1,2,3,4 having count(*) > 1;

-- Currency labels per location (no LKR outside Sri Lanka)
select l.slug, i.currency, count(*)
  from public.camp_tab_items i join public.locations l on l.id = i.location_id
 group by l.slug, i.currency order by l.slug;
```

## Soft-delete: hq_invoices

Delete is soft (`deleted_at`, `deleted_by`) with a JSONB snapshot in
`hq_invoice_audit`. **Every reader must filter `.is('deleted_at', null)`** —
list, aggregates, period dropdown, review/duplicate counts, dedup checks. The only
hard-delete path is "Delete forever" inside the 🗑 Deleted view, which is
two-step by construction. The audit row survives a purge.

## Triggers that own money

- `tr_surf_rental_ledger` — BEFORE INSERT on `surf_school_rentals`, creates the
  revenue row and stamps `ledger_entry_id`. SECURITY DEFINER so it bypasses caller
  RLS for the internal write.
- `tr_surf_rental_delete_ledger` / `tr_ledger_cascade_surf_rental` — deletes
  cascade both ways. The cascade nulls the back-link first to avoid recursion.

If a rental ever shows `ledger_entry_id IS NULL`, the trigger didn't run — check
it exists before writing a backfill.
