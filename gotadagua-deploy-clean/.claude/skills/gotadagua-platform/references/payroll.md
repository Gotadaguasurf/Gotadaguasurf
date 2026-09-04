# Payroll — the payslips are the source of truth

`Recibo_Geral` PDFs in the Drive expenses folder carry **both the salaries and the
meal cards**. Every payroll question is answered there, not by inference from the
bank. Two recurring files, one per company:

| File | NIF | Company |
|---|---|---|
| `292_515059927_Recibo_Geral.pdf` | 515059927 | **WATER MOVEMENTS, LDA.** |
| `315_502379723_Recibo_Geral.pdf` | 502379723 | MANJAR ALENTEJANO — UNIPESSOAL, LDA. |

**Only Water Movements payroll goes in the app.** Manjar is a separate company
(kitchen and waiting staff) — do not import its payslips. What belongs in
`hq_invoices` is the catering Manjar *invoices to* Water (a Water expense, supplier
`manjar alentejano`), nothing else.

## Reading a payslip

Three numbers per person, and confusing them is the classic error:

```
Sub-total            955,27   ← the NET salary. THIS is the hq_invoices row.
Cartão refeição      193,80   ← rubrica 101, its OWN row (Benefits)
TOTAL DO RECIBO(€) 1.149,07   ← net + card. NEVER book this as salary.
```

Booking the recibo total as salary double-counts the meal card. It had happened for
Pedro Barata in Feb (1.149,07) and Mar (1.179,67); both were corrected to 955,27 on
3 Sep 2026.

**The meal card is `days × €10,20`, so it changes every month** — do not carry a
value forward:

| | days | value |
|---|---:|---:|
| Fevereiro 2026 | 19 | 193,80 |
| Março | 22 | 224,40 |
| Abril | 21 | 214,20 |
| Julho / Agosto | 23 | 234,60 |

## The Water Movements payroll (2026)

Net salaries, stable Feb–Jul 2026 — **the monthly batch is exactly €12.116,96**.
If a month does not total that, something is wrong.

| Payslip name | In the app as | Net | Meal card | Location |
|---|---|---:|:---:|---|
| Pedro Filipe dos Santos Paiva | `pedro paiva` | 1.888,25 | yes | general (HQ) |
| Gonçalo Correia Pereira | `goncalo pereira` | 1.888,25 | yes | general (HQ) |
| **José Miguel Correia Pereira** | `miguel pereira` | 1.888,25 | yes | general (HQ) |
| Ricardo Nuno Carvalho Jesus | `ricardo` | 1.888,25 | yes | general (HQ) |
| João Maria Beirão Gilbal | `joao girbal` | 1.411,67 | yes | general (HQ) |
| Maxime Serge Nikita Dergatcheff | `maxime` | 1.247,75 | yes | portugal |
| Jenny Amélia Pedro de Carvalho | `jenny amelia…` | 955,27 | yes | portugal |
| Francisco Duarte … Guimarães | `francisco duarte` | 949,27 | **NO** | sri-lanka |
| Pedro Silva Barata | `pedro barata` | 955,27 | yes | morocco |

**Everyone is paid by HQ (`paying_company = water-movements`), but `location_slug`
is the camp they work at, not who pays them.** Barata was Morocco, Francisco Duarte
is Sri Lanka, Shenal de Almeida is Sri Lanka — all on the HQ payroll. The five HQ
staff sit in `general`; Maxime and Jenny in `portugal`.

**Seven meal cards, not eight** — Francisco Duarte has no rubrica 101 on any payslip.

**Miguel is `José Miguel Correia Pereira` on the payslip.** Same person as
`miguel pereira` in the app; there is no separate José.

**`ricardo` and `ricardo nuno carvalho` are two different lines for the same man:**
the first is his €1.888,25 salary, the second the €1.462,50 **rent** for the V1 paid
to him by standing order. Never merge them, never categorise the rent as Salary.

## Who was there when

- **Pedro Silva Barata** (funcionário 10, admitted 09/05/2022) is on the payroll
  Jan–May 2026 and gone by July. The €955,27 slot for **Feb, Mar, Abr, Mai is his**.
- **Jenny** was admitted **01/06/2026**. She holds the €955,27 slot from **June**.
  Any Jenny row before June is a phantom — two such rows in March were deleted.
- João Girbal's contract shows `Fim contrato 31/07/2026`; Francisco's `01/09/2026`.

The two share one salary value, so an importer that matches on amount alone will
attribute Barata's months to Jenny. **Match on the payslip, never on the amount.**

## Checks before touching payroll

1. Net salaries of the month sum to **12.116,96** (Jan 2026 is 11.923,38 — Maxime
   was still on 1.054,17).
2. Meal cards = **7 × that month's value**, and the value equals `days × 10,20`.
3. A batch line in the bank (`LOTE TRF CRED SEPA+ -Salarios <mês>`) reconciles
   against the **sum** of the eight rows, never one-to-one.
4. When the payslip for a month is not yet in Drive, book the batch as one row with
   `needs_review`, and split it once the PDF arrives.

## Reconciling a batch against the statement (verified 3 Sep 2026)

A batch never matches one-to-one — check the **sum**:

| Bank line | App |
|---|---|
| 28/08 `LOTE TRF CRED SEPA+ -Salarios Agosto-D484P277` €12.122,96 | 8 salary rows, sum €12.122,96 ✓ |
| 31/08 `LOTE TRF CRED SEPA+ -Agosto-D485A330` €1.499,40 | 7 meal cards × €214,20 ✓ |
| 31/08 `TRANSF. CRÉDITO SEPA+ (CARTÃO REFEIÇÃO)` €14,99 | the batch fee, its own row |
| 31/08 `IMP.SELO LOTE` €0,60 | ignore (stamp duty) |

August ran €6,00 above the €12.116,96 standard; without the August payslip the €6
cannot be attributed, so it sits on Francisco Duarte's row with `needs_review`.

**Still missing from the app:** the meal-card batches for March, April, May and June
2026 — no rows exist at all. Their values are known from the payslips (Mar €224,40,
Abr €214,20) but the batches need the statements for those months to confirm.
