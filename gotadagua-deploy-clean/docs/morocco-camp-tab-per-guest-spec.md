# Morocco Camp Tab — per-guest mode (spec / planning doc)

**Status:** Not implemented. This document captures the requirement so it
can be picked up later without re-discovering context.

**Owner request date:** Discussed late May 2026 (Miguel, in PT). See the
"Verbatim request" section at the bottom for the original wording.

---

## Why

Morocco operates differently from Sri Lanka. The current Camp Tab model
was designed for Sri Lanka and is wrong for Morocco's flow:

- **Sri Lanka:** guests come for a full week, items accumulate during
  Sat→Fri, owner closes the week once, revenue is generated as a
  weekly batch dated to the Friday.
- **Morocco:** guests come on irregular schedules (often 1-2 days, often
  walk-ins). Tours and other extras are paid on the day they happen,
  not bundled at the end of the week. There is no natural "week close"
  moment.

Forcing the weekly model on Morocco creates two friction points:

1. Revenue from tours sits in the Camp Tab waiting for the week to
   close instead of being recognised in the ledger on the day cash
   actually changes hands.
2. The "guest stays until the week ends" model doesn't fit walk-ins
   who pay and leave the same day.

Sri Lanka **continues to use the weekly model.** This document only
covers the Morocco mode.

---

## Current Sri Lanka model (KEEP)

| Aspect | Behaviour |
|---|---|
| Week cycle | Saturday → Friday (Sat=day 0, Fri=day 6) |
| Guest lifetime | Added to one week, lives there for ~7 days |
| Items | drinks / food / merch / tours, tabbed per guest |
| Closing | Owner clicks "Close week" once per week |
| Revenue | One ledger row per (category × linked item) within the closed week, dated to that Friday (`addDays(wk.start, 6)`) |
| Tables touched | `camp_weeks`, `camp_guests`, `camp_tab_items`, `ledger_entries` |
| sourceKind | `camp_tab` on the generated revenue rows |

---

## Desired Morocco model

### Concept
The week-as-container disappears (or becomes a passive grouping).
Guests are the unit. Payments are individual events that hit the
ledger immediately.

### Behaviour

| Aspect | Behaviour |
|---|---|
| Week cycle | None enforced. Optional grouping at most. |
| Guest lifetime | Lives in the Camp Tab from add until "close guest" |
| Items | Same categories (drinks/food/merch/tours), tabbed per guest |
| **Pay item** | Marking an item paid **creates a ledger_entries row immediately**, `type='income'`, `paymentMethod='Cash'`, `date=today()`, `sourceKind='camp_tab'`. The item stays on the guest's card as a paid-history entry. |
| Close guest | Removes the guest from the active Camp Tab view. Requires all unpaid items to be resolved (paid or voided) first. |
| Re-open / add | If a guest comes back (or the owner remembers a forgotten extra), they can be added again or their items reopened. Each new payment hits the ledger again on its own date. |
| "Close week" | **Does not exist** in Morocco mode. No bulk-end-of-week revenue generation. |

### UI changes
- Hide the week-tab navigation in Morocco (or repurpose as a passive
  day-grouping, no "close" button).
- Each guest card gets a "Pay" / "Pay and close" button per item.
- "Close guest" button at the top of the guest card, disabled when
  unpaid items remain.

### Data writes

| User action | Tables touched |
|---|---|
| Add guest | `camp_guests` |
| Add item to guest tab | `camp_tab_items` |
| Mark item paid | `camp_tab_items.paid_at = now()` + `ledger_entries INSERT` (one row, single item, date=today) |
| Close guest | `camp_guests.closed_at = now()` |

The new ledger writes are NOT batched and NOT dated to a Friday.
Each paid item generates its own row, dated to the day of payment.

---

## Data preservation (CRITICAL)

What's already in Morocco's tables MUST survive a migration to the
new mode:

| Table | What we keep |
|---|---|
| `camp_weeks` | All existing rows. Read-only historical. Not auto-deleted. |
| `camp_guests` | All existing guests, including those in past weeks. |
| `camp_tab_items` | All items, paid and unpaid. |
| `ledger_entries` (`sourceKind='camp_tab'`) | Every closed-week revenue row stays exactly where it is — dated, paymentMethod, amounts. Untouched. |

The new mode does NOT rewrite history. It only changes the behaviour
of future user actions.

### Open question for migration day
Morocco currently has weeks with unpaid items sitting in them. On
the switch-over moment, options:

A. Auto-mark every unpaid item as still-open, attach to its current
   guest, allow the new flow to handle them.
B. Force a final "Close week" sweep on existing Morocco weeks to
   batch-generate the revenue at the old Friday dates, then start
   the new mode for all future guests.
C. Hybrid: existing weeks keep the weekly close button, new weeks
   use per-guest mode.

The user should pick A or B before implementation.

---

## Implementation notes

### Mode switching
- Add `locations.camp_tab_mode` column: `'weekly'` (default, Sri Lanka)
  or `'per_guest'` (Morocco).
- Camp Tab inner page reads that column at boot and switches rendering.

### Code touchpoints (rough)
- `camp-hub/camp-tab-inner.html` — UI rendering, payment flow,
  close-guest button
- `camp-hub/index.html` — `buildClosedWeekRevenueEntries` is bypassed
  in per-guest mode; new `buildPaidItemRevenueEntry` helper writes
  one ledger row per item paid
- `supabase/` — schema migration adding `camp_tab_mode`, plus an SQL
  setting Morocco to `'per_guest'` and Sri Lanka to `'weekly'` (with
  Sri Lanka as the implicit default for legacy rows)

### What NOT to change
- The Sri Lanka close-week flow stays exactly as-is.
- Operations Ledger rendering stays the same — the new per-item rows
  are just normal income entries.
- Cash / Bank balance math stays the same; per-item revenue
  contributes to `aRev` the same way closed-week batches do.

### Backwards compatibility
Existing Sri Lanka closed-week revenue and existing Morocco closed-week
revenue stay valid. The new mode only changes what happens **going
forward** for paid items on `per_guest` locations.

---

## Priority

Not blocking. Sri Lanka users continue normally. Morocco can keep
running the weekly model in the interim — the friction is real but
manageable.

When the implementation does happen, this doc should be revisited
to confirm the migration choice (A/B/C above) and any UX nuances
that have come up since.

---

## Verbatim request (Miguel, PT)

> "SÓ na app de marrocos (SRI LANKA FICA NA MESMA) a parte do camp tab
> nao quero a semana.. porque em marrocos esta a funcionar diferente...
> as pessoas nunca praticamente fazem 1 semana e entram a todos os
> dias... e os tours sao pagos no dia que sao feitos entao era fixe
> mal receber o dinheiro de um tour ficar logo directo no camp tab e
> nao esperar ate ao final da semana, por isso o melhor era secalhar
> fazer sempre o registo por gest w quando chegar ao fim fechar o
> guests e ai sai do camp tab (se nao fica la sempre, e posso
> adicionar coisas e se pagar posso pagar essa individualmente e fica
> logo adicionada ao operation ledger)... entendes? Era importante
> isto ficar registado neste ponto... para se quiser voltar aqui...
> e nao perder nada que ja tenho registado..."

Translation summary: Morocco-only Camp Tab redesign — drop the week
cycle, switch to per-guest mode, every paid item hits the ledger on
its payment date, guests leave the Camp Tab on "close guest", Sri
Lanka stays untouched. Preserve all existing data.
