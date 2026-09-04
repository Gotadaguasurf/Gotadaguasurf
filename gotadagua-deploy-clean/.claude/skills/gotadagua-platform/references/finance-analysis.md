# Financial analysis — how to get numbers Miguel can actually read

The finance data lives in `hq_invoices` (expenses), `bookings` (revenue) and the
Bookinglayer CSV exports. Everything below exists because it went wrong at least
once and cost real hours.

## The two sources of truth, and never mixing them

| Source | What it proves | Where it lands |
|---|---|---|
| Santander statement (`Movimentos_DO.xls`) | money **left the account** | one `hq_invoices` row per debit |
| Google Drive `GENERAL EXPENSES` folder | an **invoice exists** | the same row, with `drive_link` |

A supplier invoice and its bank payment are the **same expense**. Booking both
double-counts. When the amounts differ (invoice €1.414,50, payment €861) that is
a partial payment or a net-vs-gross difference — set `needs_review` and ask; do
not create a second row.

## Reconciliation: match on name AND amount

Matching a bank line to an app row **by amount alone is wrong** and has produced
false matches (a €420 transfer to Luís Felipe Sparrenberger silently matched an
"easy transfer" row; a €10,99 Continente purchase matched a Chubb insurance).

The method that works:

1. Strip the bank prefix to get the payee — `TRF.IMED. P/`, `TRF CRED INTRABANC P/`,
   `DÉBITO DIRETO-`, `COMPRA *NNNN`, `LOTE TRF CRED SEPA+ -`, and the trailing
   `-E17436928` reference.
2. Match on amount **and** token overlap between that payee and
   `company || description`, after stripping accents and `lda|unipessoal|sa`.
3. Report anything that matched on amount but not on name — that list is where the
   real errors hide.

**Ignore by rule** (not expenses to book): `PAG.CTA.CARTAO` (settlement of the card
whose purchases are already booked one by one), commissions, `IS (17.3.4)` stamp
duty, `IMP.CPR. ESTR`, and SWIFT `DESP.SHA`.

**A batch line does not reconcile.** `LOTE TRF CRED SEPA+ -Salarios Agosto` is one
bank line but eight app rows. Expect it to show as unmatched and check the sum.

**Reconcile against BOTH tables.** Money leaving the account is not always an
expense: transfers funding the other companies live in **`internal_transfers`**
(`from_company` → `to_company`), not in `hq_invoices`. A reconciliation that only
looks at `hq_invoices` reports them as missing — that mistake cost an hour on
3 Sep 2026, when €31.200 of "unexplained" August transfers turned out to be already
recorded and beneficiary-confirmed.

The group companies:

| Bank shows | Who it is |
|---|---|
| `MGPR SARL` (Saham Bank) | **Morocco** |
| `Wave Movements PVT LTD` (Sampath Bank) | **Sri Lanka** |
| `Water Movements, LDA` (NIF 515059927) | Portugal / HQ, the account these statements belong to |

**The statement export cannot name a non-SEPA beneficiary.** `Movimentos_DO.xls` has
8 columns (dates, description, type, amount, currency, balance) and for
`TRF.CRÉD.N.SEPA+EMITIDA` the description is only the reference
(`001850386960013601`). The beneficiary comes from the comprovativo in the
homebanking; once looked up, record it in `internal_transfers.notes` against that
reference so nobody has to look it up twice. Each such transfer also generates four
companion lines — `IMP.DE SELO`, `IMP.S/VALOR ACRESCENTADO`, `DESPESAS SWIFT`,
`TRF.CRÉD.N.SEPA+(DESP.SHA)` — all ignorable.

## Supplier aliases — the single biggest cause of "it can't find things"

The same supplier is stored under several names. Always search **both `company`
and `description`, with `ilike '%token%'`, one token at a time** — a two-token
overlap test misses single-word names like TORMENTA.

| Bank / Drive says | App stores it as |
|---|---|
| Cathering | `manjar alentejano` |
| Event Solutions | `raimundo e cenas` |
| Autoridade Tributária | `estado (at/duc)` |
| Goldenergy | `gold energy` |
| TORMENTA | `tormenta & barreiros` — **same company as `easy transfer`** |
| TRANSFERENCIA - PAG. T.S.U. | `seguranca social` |
| Natã Portela | `nata haupt portela` |
| Heitor Souza | `heitor correa de souza` |
| Joaquim Almeida | `joaquim manuel resina de almeida` |
| Constancia Carvalho | `constancia pedro de carvalho` |
| Veronica João | `veronica mariza joao` |
| Juares Silva / Juares Juvencio da Silva Junior | `juares junior` — surf-school instructor |
| card ref. `RXY3Q8H` | `souk to surf` (Work Trips) — the Drive invoice named it |
| Mobilize / RCI Portugal / RCI Connect | **insurance on the 3 company cars** (`bx47gf`, `bz68ha`, `bz13hb`), HQ — Insurances/general, NOT leasing |
| Chubb | mobile-phone insurance, HQ — Insurances/general |
| Barbara Sinalyova | HQ marketing — Salary/general |
| Fnac | camera/tech gear for the surf camp — Setup/portugal |
| Uber | surf camp transport — Transport/portugal |
| Almafogo | fire extinguishers for the camp — portugal |

**`ilike '%token%'` bites.** `'%uber%'` also matches **`exubercaravela`** (a
surf-school instructor), and a bulk update sent six of his salary rows to
Transport before it was caught. Before any bulk update by name, run the `select`
first and read every row it returns.

Some card lines land with only an opaque reference (`RXY3Q8H`, `206005979555`). The
Drive invoice for the same amount and month is what names them — check there before
leaving a row as "IDENTIFICAR".

Names are stored **lowercase**. Reuse the existing spelling — the base already has
`lavandaria alexandre` / `alexandra` / `alexandre's` / `alexandre´s`,
`safari` / `safari na horta` / `safaribus`, `blueish green` / `greenq`,
`decathlon` / `decathlon almada`. New spellings are how duplicates are born.

**Two people called Ricardo, and they are not the same line:**
`ricardo` = the €1.888,25 monthly salary. `ricardo nuno carvalho` = the €1.462,50
**rent** for the V1 (standing order). Categorising the second as Salary inflates
payroll by €7k+.

## Duplicates

Miguel's rule: *"duplicados é para apagar sempre se tiver a mesma fatura, data e
valor."* Apply it, but **prove it against the statement first** — a same-day repeat
is often real:

- **Mobilize / RCI Portugal €433,05 twice on the same day = two leased cars.** The
  bank shows two debits. Deleting one destroys real expense.
- **Raimundo & Cenas €412,05 twice on 25 Ago** — also two real debits.
- Chubb charges several policies of €12,99 / €14,99 on one day.

A true duplicate looks like this: the app has two rows, the bank has one debit, and
one row carries a description from an automated pass (`— do extrato bancário
(backfill)`, `— auditoria final (extrato)`) while the other came from the invoice.
Delete the automated one. Soft-delete only: `deleted_at = now()`,
`deleted_by = 'miguel@gotadaguasurf.com'`, and say why in `notes`.

## Categories

`hq_invoice_categories` holds 18: Accounting, Activities, Benefits, Cleaning
Supplies, Food, Insurances, Miguel - Personal, Partners, Rent, Ricardo - Personal,
Salary, Services, Setup, Taxes, Transport, Utilities, Wild, Work Trips.

**A row with `category_name is null` is invisible to every category report.** In
Sep 2026 that was 52% of all money. To close the gap without guessing:

```sql
-- what a supplier is usually categorised as, from its own history
select lower(company), category_name, count(*)
from hq_invoices where deleted_at is null and category_name is not null
group by 1,2 order by 1, 3 desc;
```

Apply the supplier's dominant category only when it holds **≥70% of that supplier's
categorised rows**, and stamp `notes` with `[categoria inferida do historico do
fornecedor <data>]` so it is auditable and reversible. Mixed suppliers (Ricardo:
Salary *and* Rent) fall out of this rule by design — leave them for Miguel.

Never invent a category for a supplier that has never had one. Ask.

## Revenue and partner commission

`bookings` — one row per Bookinglayer reservation, `booking_ref` unique.
Commission comes from the CSV's per-booking **"Partner commission %", never the
partner's default** (`partners.commission_pct` is often stale: Caixa Geral shows
20% there but billed 0% on 19 August bookings).

Location codes → app names: `SC`→Surf School Caparica, `PT`→Surf Camp Portugal,
`MA`→Tamraght Camp, `LK`→Surf Camp Ahangama, `JUN`→Junior Camp Caparica,
`COLON`→Kids Camp Caparica.

Multi-value Location (`SC, Colon`, `Colon, JUN`, `PT, SC, Colon`) is **tags, not a
split** — the package decides: *Junior Surf Camp*→Junior, *Kids Surf
Activities*→Kids, *Surf Camp Caparica*→Portugal, *Group/Private Lessons*→Surf
School. `TRANS` is a transfer bolted onto a lesson.

The per-location split is **per booking**, which is what makes a partner spanning
countries come out right — Kilroy in Aug 2026: €1.429,00 Portugal + €121,80
Morocco. Same for JUVIGO, Ocean Adventure, SURFCAMP IT, Surfcamp Italy, The Surf
Tribe.

**Known debt:** Jan–Jul 2026 bookings were imported with `commission_amount = 0`
across all 2.233 rows. Only August is right. Fixing it needs those months
re-exported from Bookinglayer.

## The monthly report

Give Miguel the numbers, not a method. Structure that works:

1. **Receita por localização** — from `bookings`, gross / commission / net.
2. **Despesa por categoria** — from `hq_invoices`, and state the uncategorised
   share explicitly. A report that silently omits half the money is worse than none.
3. **Resultado por localização** — revenue net of commission, minus expenses
   carrying that `location_slug`.
4. **O que não fecha** — bank debits with no app row, invoices with no payment,
   `needs_review` rows. Always present, even when empty.

Write it in Portuguese, amounts as `12.345,67`, and lead with the number that
changed most versus the previous month.

## Monthly close — the order that works

Doing these out of order creates duplicates, because the bank and the Drive describe
the same expense from two sides.

1. **Statement first.** Export `Movimentos_DO.xls` for the month and reconcile with
   the name+amount method above. Insert only what has no row yet, guarding on
   `(invoice_date, amount_eur, lower(company))`.
2. **Then the Drive folder** `GENERAL EXPENSES / <Month>_2026`. Files named
   `Fornecedor - Mês 2026 - VALOR€.pdf` are the ones already identified; compare each
   against the app **by supplier and amount**, and remember a supplier may be stored
   under a different name (that check alone prevented 5 duplicates in September).
   Attach the PDF to the row that already exists via `drive_link` instead of
   inserting a second one.
3. **Payslips** — see `payroll.md`. Salaries and meal cards come from the
   `Recibo_Geral`, never from the bank batch alone.
4. **Bookings** — the Bookinglayer CSV, commission per booking, split per location.
5. **Categorise what is left**, by the supplier's own history first, then by the
   description. Never invent a category for a supplier that never had one — leave it
   `needs_review` and ask.
6. **Report** the four sections above, and say plainly what did not reconcile.

State of play at 3 Sep 2026: 99,7% of expense value categorised; the Aug 5 – Sep 3
statement reconciles except three non-SEPA transfers (€31.200) whose beneficiary the
statement does not name; `drive-sync` has never run, so PDFs are attached by hand.
