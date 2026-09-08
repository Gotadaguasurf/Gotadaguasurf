# Surf lessons and instructor pay

The lesson log lives in a Google Sheet, **NEW_Instructor_Analysis**
(`1UAJGs3CWjkin4lLRhFLrRBb2e-jgdPjSaYBQuHdNI4w`). What matters is the **`Data`**
tab: one row per instructor per day per location —
`Date · Instructor_Name · Location · Number_of_Lessons · RecVerde/Cash ·
Price_unit · Total`. 5.851 rows from Jan 2024 to Aug 2026.

**Ask for the `.xlsx` download, not the Google link.** Reading the sheet through
the Drive API returns the first tab and truncates; a CSV export gives only the
first tab. The downloaded workbook has everything. The hundreds of
`DetailNNN-NAME-YYYY-Mon` tabs are auto-generated filters of `Data` — they hold
nothing `Data` does not.

## Reconciling lessons against what was paid

Four things must be applied, in this order, or the numbers look wrong:

**1. Shift by one month.** Lessons given in month M are paid at the start of
M+1 — August's lessons are paid in early September. Comparing the same month on
both sides showed a €9.467 hole across 2026 that did not exist. Some instructors
are paid in batches every two or three months, so **compare year totals, not
months**: Felipe's monthly rows never line up but his year is €1.350 against
€1.350, exact.

**2. Apply each instructor's VAT status.** Some invoice with 23% VAT, some
without. This is a property of the person, not of the month.

| Passa recibo COM IVA (×1,23) | Sem IVA |
|---|---|
| Romi · André · Matilde · Joaquim Kiko | Tiago Madeira · Nathan · Heitor · Cauê · Yuri · Pietro · Juares · Petr · Thiago · Alexandre · George |

Joaquim Kiko: €1.325 of lessons → €1.630 paid, to the cent.

**3. Add the fixed extras.** They are not lessons and never appear in the sheet
as such:

- **Romi — head coach, €250/month.** The sheet carries a single `Salary 250`
  row (1 Apr 2026) where there should be one per month.
- **Cauê — head coach of the Junior camp, €62,50/week**, and Junior only runs a
  few summer weeks (2026: 11 weeks, 21 Jun – 28 Aug = €687,50).

**4. Subtract non-teaching work.** **Guilherme** and **Marcos** both worked the
surf-school reception for a while. That pay sits under the same supplier name as
their lessons, so their totals run far above what they taught — Guilherme's ratio
is 2,8 and Marcos's is 32. Nothing is wrong; it just cannot be read as lessons.

Once all four are applied, every instructor in 2026 reconciles. Residual gaps
under about €100 are normal: **the instructor sometimes invoices for less than he
taught, and gets paid the invoice.**

## Cash

`RecVerde/Cash` says how each lesson was settled. `Cash - 25` never reaches the
bank and so never reaches `hq_invoices` — do not chase it. In 2026 that was
Emiliano (€175) and Namour (€25).

## Sheet name → app supplier

The sheet uses short names, the app the full legal one.

| Sheet | App |
|---|---|
| ANDRE | `joaquim manuel resina de almeida` |
| JOAQUIM KIKO | `joaquim gasalho` — invoices sometimes issued via **Natacha Ema Martinho Afonso**, his mother |
| CATARINA | `catarina brazão da silva` — *not* `catarina bettencourt` (surf-school reception) nor `catarina ragageles` (kids-camp monitor) |
| MATILDE | **`exubercaravela`** — her company, not a separate instructor |
| NATHAN | `nata haupt portela` |
| FELIPE | `luis felipe sparrenberger` |
| ROMI | `romildo costa ramos` / `romildo da costa ramos` / `romildo ramos` / `romi` |
| CAUE | `caue avila flores` / `caue flores` |
| TIAGO MADEIRA | `tiago madeira` / `tiago jose pereira madeira` — `tiago martins` is someone else |
| GUILHERME | `guilherme lopes` / `guilherme vieira lopes` |
| HEITOR | `heitor correa de souza` / `heitor souza` |
| PETR | `petr kvapik` / `petr kvapil` |
| THIAGO | `thiago costa santos` / `thiago costa dos santos` |
| YURI MEDEIROS | `yuri florence` / `yuri florence de medeiros` / `yuri medeiros` |
| JOANA CARDOSO | `maria joana cardoso` |
| LUCAS MOTA | `lucas mota martins` |
| MARCOS | `marcos panceira` / `marcos panciera` |
| PEDRO | `pedro silva` **and** `pedro fialho` are two different people |

## An instructor invoice paid in instalments is not a row

**Book the payments, never the invoice.** Exubercaravela's €1.414,50 invoice was
settled as €1.150 (6 Aug) + €264,50 (13 Aug), and its €461,25 invoice as €375 +
€86,25. Both invoices were entered from the Drive alongside their payments, and
each expense was counted twice — €1.875,75 too much, removed on 8 Sep 2026.

**The test:** an app row with no counterpart in the Santander statement within
±7 days is an invoice, not a payment. Check before entering anything from the
Drive folder.

## What is loaded, and what was deliberately left out

`instructor_lessons` holds **2026 only: 1.728 rows, 3.117 lessons, €91.645**, every
row `paid = true` because the year reconciles against the Santander. The 30
instructors are in `instructor_directory` with three columns added on 8 Sep 2026:
`vat_pct` (23 for Romi, André Maria, Matilde, Joaquim Gasalho — 0 for everyone
else), `app_supplier` (the name the receipt is issued under, which is how a payment
finds its `hq_invoices` row), and `extra_kind`/`extra_amount` for the head-coach and
reception cases.

Names in the app are **first + last name of the receipt** — except **Matilde** and
**André Maria**, who keep the name everyone uses while `app_supplier` carries the
company or legal name the money actually goes to.

**Four rows of the sheet were left out on purpose** (€240, 8 lessons): exact
repeats of another row — Heitor 23 Apr, and Nathan, Romi and Tiago Madeira all on
2 Jun, each 2 Surf Camp lessons at €30. Miguel decided on 8 Sep 2026 to drop them.
That is why the app reads 3.117 lessons against the sheet's 3.125, and €91.645
against €91.885. **The gap is expected — do not "fix" it.**

## The `/instructors` app — how the payroll tab pays

Miguel does not like charts: the dashboard is tables only (8 Sep 2026) — six
location cards, the month × location grid that mirrors the Excel DashBoard, and an
instructor × location matrix (lessons + €). Filters are one bar: year pills, short
month pills, "Este mês / Mês passado / Este ano / Tudo" shortcuts, category chips,
paid select, instructor search, and a summary line with × to drop each filter.
Clicking a location card or an instructor name filters; clicking again clears.

`instructors/index.html` reads `instructor_lessons` **paginated in 1000-row pages**
(PostgREST cap — the live site showed 2.019 lessons for 2026 and an empty April
until the paginated version was deployed on 8 Sep 2026). Lessons are paid at the
start of the following month, so **the payroll tab groups by the month the lesson
was given**: at the start of September, open August.

**Amount due = lessons × (1 + `vat_pct`/100) + extras**, per instructor per month,
from `instructor_directory`:

- `vat_pct` 23 → Romildo, André Maria, Matilde, Joaquim Gasalho; 0 for everyone else.
- `extra_kind = head_coach_month` (Romildo, €250) → added to every month with lessons.
- `extra_kind = head_coach_junior_week` (Cauê, €62,50) → × distinct weeks with
  Junior Camp lessons in that month.
- `extra_kind = reception` (Guilherme, Marcos) → only a note; reception hours are
  not in the lesson table and are booked straight into `hq_invoices`.

**"Mark paid" flips one instructor × one month** (the button key is
`name|YYYY-MM`) and checks the number of rows the update returned — a viewer
without write access gets an error, not a fake "updated". The first version
carried only the name and, with "All months", one click un-paid the whole year.

**A lesson added from the app never rewrites `rate` / `payment_type` in
`instructor_directory`** — that table is reference data (VAT, supplier, extras).

Known oddity still in the data: Romildo's `Salary 250` sheet row sits in
`instructor_lessons` as **1 Surf Camp lesson at €250 on 1 Apr 2026**. It inflates
April's lesson count and, now that `extra_amount = 250` exists, would double the
head-coach pay for April if the payroll tab were used to book April. Miguel to
decide: delete the row (the extra covers it) or keep it with its own category.

The xlsx importer in the page is unreachable (hidden input, nothing triggers it)
and must stay that way until it maps sheet names to app names, normalises
`RecVerde/Cash`, and refuses years outside the loaded range — as it stands it
would re-insert every row of the sheet as unpaid.

## Two known data faults in the sheet

- Two corrupted dates: `24/03/0204` (Cauê, €60 — probably 2024) and
  `14/04/0226` (Heitor, €30 — probably 2026). They fall outside every year and
  the DashBoard pivots silently drop them, which is why the pivot reads €91.825
  for 2026 while the rows sum to €91.885.
- `Theoric`/`Theory` and `Videoanalise`/`VIDEO ANALYSIS` are the same categories
  under two spellings, one stray row each.

## 2026 by location (Jan–Aug, €91.885 · 3.125 lessons)

| | Surf Camp | Surf School | Junior | Kids | Vídeo | Teoria |
|---|---:|---:|---:|---:|---:|---:|
| total | 31.240 | 27.340 | 22.580 | 8.595 | 1.270 | 860 |

Junior and Kids exist only from June to August — they are the colónias.
