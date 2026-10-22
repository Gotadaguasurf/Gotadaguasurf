# Gota d'Água — Design System (v3, 22 Oct 2026)

The one visual language of the app. It lives in `/lib/app-shell.css` (loaded by every page
**before** its own `<style>`) and `/lib/app-shell.js` (header, icons, toast).
Direction: contemporary and calm — Linear / Stripe Dashboard / Mercury. One sans-serif,
a tight type scale, 8px spacing, hairline borders, no resting shadows, the same navy /
ocean / foam palette as before.

Page agents: follow this file literally. Use the class names below; add page CSS only for
what is truly page-specific, and never redefine a shell class to a different look.

---

## 1. Tokens (`:root` in app-shell.css)

| Token | Value | Use |
|---|---|---|
| `--navy` | `#28394b` | header, titles, primary text on dark |
| `--navy-deep` | `#1c2b3a` | hero gradient end |
| `--ocean` | `#1e6fa8` | the accent: primary buttons, active tabs/pills, links |
| `--ocean-dark` | `#185d8d` | primary hover |
| `--ocean-soft` | `#e6f1fa` | blue tint (badge-blue, status-info, current menu item) |
| `--foam` | `#eef5fb` | light blue surface (legacy hover) |
| `--ink` | `#16243a` | body text |
| `--muted` | `#64748b` | secondary text, labels |
| `--muted-2` | `#98a3b3` | placeholders, disabled, tertiary |
| `--bg` | `#f6f8fb` | page background |
| `--surface` | `#fff` | cards, inputs, modals |
| `--surface-2` | `#f8fafc` | table header, row hover, modal footer |
| `--border` | `#e5eaf0` | every hairline |
| `--border-2` | `#d5dde8` | control borders (buttons, inputs, pills), hover border of cards |
| `--green` / `--green-bg` / `--green-border` | `#1a7a40` / `#eaf8f0` / `#bfe8d0` | positive, paid, ok |
| `--red` / `--red-bg` / `--red-border` | `#b42318` / `#fdeeec` / `#f3c2bd` | negative, error, danger |
| `--amber` / `--amber-bg` / `--amber-border` | `#9a6700` / `#fdf5e1` / `#f0dca0` | attention, review, pending |
| `--r` / `--r-sm` / `--r-lg` / `--r-xs` | `12px` / `10px` / `16px` / `6px` | cards / controls / hero+modal / badges |
| `--sh` | `none` | **cards have no resting shadow** |
| `--sh-soft` | 1–3px, 5% | elevated surfaces only (dropdown menus, login card) |
| `--sh-hover` | `0 4px 14px rgba(22,36,58,.08)` | hover on clickable cards/rows only |
| `--sh-lg` | `0 24px 56px rgba(22,36,58,.18)` | modals, toasts, menus |
| `--ring` | `0 0 0 3px rgba(30,111,168,.18)` | focus ring on every control |
| `--sp-1…7` | 4 / 8 / 12 / 16 / 24 / 32 / 48 px | the spacing scale |
| `--card-pad` | `20px` | inside cards |
| `--h-btn` / `--h-input` / `--h-pill` / `--h-row` | 36 / 38 / 32 / 42 px | control + table row heights |

Aliases kept for older pages: `--radius`, `--shadow`, `--shadow-lg`, `--card`, `--green-text`,
`--red-text`, `--amber-text`, `--accent`, `--accent-soft`, `--ocean-light`, `--sand`, `--sand-dark`.

Semantic colour rule: one meaning per hue. Green = money in / paid / ok. Red = money out /
error / destructive. Amber = needs a decision. Ocean = interactive / selected. Never use colour
for decoration.

## 2. Typography

Font: **Outfit** for everything (Google Fonts, weights 300–800 — keep the `<link>` the pages
already load; `DM Serif Display` is no longer used anywhere and may be dropped from the link).
`DM Mono` only through `.mono` (ids, references, raw codes) — never for amounts.

| Role | Class | Size / weight / tracking |
|---|---|---|
| Page title | `.page-title`, or `.section-head.page-head .section-title` | 24px / 700 / −0.02em |
| Section title | `.section-title`, `.ov-section-title` | 18px / 700 / −0.01em |
| Card title | `.card-title` | 15px / 700 |
| Modal title | `.mhdr-title` | 16px / 700 |
| Form title | `.form-title` | 24px / 700 / −0.02em |
| Body | (default) | 14px / 400 / line-height 1.5 |
| Secondary | `.hint`, `.section-sub`, `.card-hint`, `.kpi-sub` | 12.5px / 400 / muted |
| Micro label | `.micro`, `.eyebrow`, `.kpi-label`, `.section-lbl`, `.field label`, `th` | 11px / 600 / uppercase / +0.06em / muted |
| KPI value | `.kpi-value`, `.summary-val` | 28px / 700 / −0.02em / tabular |
| Hero value | `.hero-val` | 48px / 700 / −0.03em / tabular (40px ≤700px) |
| Table cell | `td` | 13px |
| Button / pill | `.btn`, `.pill` | 13px / 12.5px, 600 |
| Code / id | `.mono` | DM Mono 12px |

Numbers: always `font-variant-numeric: tabular-nums` (`.num`, `.tabular`, `td.r`, KPI and hero
values already have it). Amounts right-aligned in tables (`th.r` + `td.r`).

## 3. Spacing & layout

- 8px scale only: 4, 8, 12, 16, 24, 32, 48.
- Page: `.container` / `main` — max 1320px, padding 32px 24px 64px (16px sides ≤700px).
- Between sections: 32px (`.ov-section` margin, `--section-gap`).
- Inside cards: 20px (`.card-pad`, `.card-body`, `.card-hdr`, `.mbody`); 16px ≤700px.
- Grids: `.g2` `.g3` `.g4` (gap 16, collapse to 2 columns ≤900px and 1 column ≤700px);
  `.summary-grid` auto-fit 180px tiles, gap 12.
- Helpers: `.stack` (column, gap 12), `.row` (inline, gap 8, wraps), `.grow`.

## 4. Components (class names are the contract)

### Header — `AppShell.mount(el, opts)` → `.app-nav`
Navy, 60px, sticky. Logo · app switch pill · tabs `.nav-tabs > .ntab` (pills, active = ocean) ·
`.nav-actions` (`.user-chip`, `.nav-action-btn`, `.save-pill`). Secondary header text is
`#a9c4da`. ≤820px the tabs move to the drawer (`.nav-mob-drawer`, `.ntab-m`).
Rule: never add a second navigation bar under the header; tabs live in the header only.

### Page head — `.section-head.page-head` / `.ov-section-head.page-head`
```html
<div class="ov-section-head page-head">
  <div><div class="ov-section-title">Expenses</div><div class="ov-section-sub">Santander · Oct 2026</div></div>
  <div class="ov-filters">…period picker, one primary button…</div>
</div>
```
Rule: one page title per view (24px); everything under it is a section title (18px).
Controls sit to the right, bottom-aligned; they wrap under the title on narrow screens.

### Section head — `.section-head` / `.ov-section-head` (title + sub + controls), `.section-lbl`
`.section-lbl` is the quiet micro-label that splits a card body into groups ("Revenue",
"Expenses"). Rule: a section title is text only — no icons, no emoji, no counts in the title.

### Card — `.card` + `.card-hdr` (`.card-title`, `.card-hint`, actions) + `.card-body` / `.card-pad`
White, radius 12, 1px `--border`, no shadow. `.card.clickable` or `.card[onclick]` gets the
hover shadow + `--border-2`. Rule: no cards inside cards; no coloured left borders; no
gradient headers (except `.hero-profit`).

### KPI tile — `.kpi` / `.summary-box` + `.kpi-label` `.kpi-value` `.kpi-sub` (HQ: `.summary-lbl` `.summary-val` `.hint`)
```html
<div class="kpi"><div class="kpi-label">Net revenue</div><div class="kpi-value pos">€12,480</div><div class="kpi-sub">+8% vs Sep</div></div>
```
Value colours: `.pos` green, `.neg` red, `.kv-amber`, `.kv-ocean`; `.summary-box.neutral` navy.
Rule: label → value → one line of context. A tile with `onclick` is a shortcut, so it hovers.

### Hero — `.hero-profit[.pos|.neg]` + `.hero-lbl` `.hero-val` `.hero-sub` `.hero-delta`
Navy gradient, radius 16 (top corners only when it heads a card; add `.standalone` for all four),
48px number. Rule: at most one hero per page, always the single most important number.

### Attention strip — `.health-strip` + `.health-lbl` + `.health-chip`
Quiet amber pills, 32px, one sentence each, each one is a link to the fix.
`.digest-strip` + `.digest-btn[.primary]` is the same pattern for actions.
Rule: no coloured bands or banners; attention is a row of chips.

### Table — `.tbl-wrap > table` or `table.tbl` (also `.card > table`)
13px, 42px rows, light sticky header (`--surface-2`, micro-label), hairline rows, hover row,
**zebra off**, numbers right (`th.r`/`td.r`, tabular), `tfoot` bold on `--surface-2`,
`tr.click` for clickable rows, `td .cell-sub` for a muted second line, `tr.empty-row` for
"nothing here".
Rule: the first column is the name, the last columns are the amounts, actions are icon
buttons (`.btn.btn-sm.btn-icon`) at the far right. Never wrap amounts.

### Badges & chips
- `.badge.badge-green|red|amber|blue|grey|navy` — 22px, radius 6, 11px/600. A **state**
  (Paid, Review, Draft).
- `.chip.chip-normal|review|personal` — 20px pill, uppercase 10.5px. A **category tag**.
- `.status-dot.green|red|amber|ocean` — 8px dot before text in dense lists.
Rule: one badge per cell; the badge text is a word, not a sentence.

### Buttons — `.btn` + one variant
`.btn-p` primary (ocean) · `.btn-s` / `.btn-ghost` secondary (white, `--border-2`) ·
`.btn-g` green · `.btn-r` / `.btn-d` / `.btn-danger` red · `.btn-a` amber · `.btn-link` text.
Sizes: default 36px; `.btn-lg` 44px; `.btn-sm` 30px; `.btn-icon` square; `.btn-block` full width.
Icons: `${AppShell.icon('plus')} New expense` — icon first, 16px, 6px gap.
Rule: **one primary button per view**; everything else is secondary. Destructive actions are
`.btn-danger` and never primary. Buttons are verbs ("Save", "Send invoice"), never nouns.

### Filters — `.ov-filters` / `.hq-filters` row of:
- `.period-picker` (`.period-picker-lbl` + `<select>`/`<input>`) — 36px, radius 10.
- `.pill` / `.pill.active` (also `.hq-pill`, `.area-pill`) — 32px toggle pill; active = ocean.
  Group them in `.pills`. `.pill .count` for a small count.
- `.hq-chip` — removable active-filter chip (26px, red on hover).
- `.search` / `.hq-search` — 36px, radius 10, 260px.
- `.select` / `.hq-select` — 36px select with the chevron.
Rule: filters are one row under the page head, period first, search last, same height.

### Fields — `.field` (grid/label above) and `.mfield` (modal, margin-bottom 16)
`<div class="field"><label>Supplier</label><input></div>` — micro label, 38px control, radius 10,
`--border-2`, focus = ocean border + `--ring`. `input[type=number]` and `.r` are right-aligned
tabular. Textareas 96px min. Disabled = `--surface-2`.
Forms: `.form-head` (`.form-title` + `.form-sub`), `.fblock` + `h4`, `.frow` (label · input ·
input rows with hairlines), `.fgrid` (4 columns), `.sumbox` (navy total box).
Rule: labels above fields, never placeholders as labels; one column on phones.

### Status message — `.status-msg.status-ok|err|warn|info`
Tinted surface + hairline of the same hue, 13px. Rule: one line, says what happened and what
to do next; no left bar, no icon needed.

### Modal — `.overlay(.open) > .modal > .mhdr (.mhdr-title, .mhdr-sub, .mclose) + .mbody + .mfooter`
White header with a bottom hairline (sticky), 16px title; footer on `--surface-2` with the
buttons right-aligned (primary last). Max 640px, radius 16.
Rule: a modal does one thing; its title is the verb ("Add expense").

### Toast — `AppShell.toast(msg, 'ok'|'err')` → `.toast(.show)`
Navy (green ok / red err), bottom centre, 3.2s. Rule: one sentence, past tense ("Saved").

### Empty state — `.empty-state`
```html
<div class="empty-state">${AppShell.icon('inbox')}<div class="empty-title">No invoices yet</div><p>Upload a PDF or import the bank statement.</p></div>
```
Rule: icon + one line + optionally one sentence + at most one button. In tables use
`<tr class="empty-row"><td colspan="n">Nothing here.</td></tr>`.

### Loading — `.loading` (pulsing muted sentence) or `.skeleton` blocks (`.skeleton.lg`, `.skeleton.row`)
Rule: never a spinner emoji; keep the layout height stable while loading.

### Splash — `AppShell.splash(title, text)` → `.splash` (access denied / sign-in).

## 5. Icons — `AppShell.icon(name, cls?)`
Feather-style 24-grid line icons, `currentColor`, 2px stroke, 16px (`.ic`). The only icons of
the app; emoji in buttons/titles/chips are flattened at runtime (`AppShell.flattenEmoji`).
Available: `upload download package file-text alert zap bar-chart search home folder tent card
users check x clock settings edit trash link external plus refresh mail receipt truck paperclip
inbox euro wave chevron-down chevron-up chevron-left chevron-right arrow-right arrow-left
arrow-up arrow-down archive calendar info eye eye-off filter map-pin user lock unlock logout
login minus more copy printer phone tag globe bell send save list grid star check-circle
x-circle help image sun coffee music briefcase book trending-up trending-down`.
Rule: an icon never stands alone without a label except in `.btn-icon` with a `title`.

## 6. Do / Don't

**Do**
- Outfit everywhere; titles 24 / 18 / 15, body 14, secondary 12.5, micro 11 uppercase.
- 8px spacing, 20px inside cards, 32px between sections.
- Hairline `--border` on every box; shadow only on hover (clickable) or elevated (menus, modals).
- Numbers tabular and right-aligned; amounts with currency, two decimals.
- One primary button per view; icon + label on buttons; `.btn-sm.btn-icon` in table rows.
- Pills for filters (active = ocean), badges for states, chips for categories.
- Page head → filters row → KPI tiles → cards/tables, in that order.
- Phone first: ≤820px tabs in the drawer, ≤700px one column, inputs full width.

**Don't**
- No emoji, no serif, no DM Mono for amounts, no italics.
- No coloured left borders, no gradient card headers, no coloured bands behind text.
- No zebra tables, no bold whole rows, no centred numbers.
- No cards inside cards; no boxes just to group two fields.
- No new colours; no decorative colour; no `!important` to restyle a shell class.
- No more than one hero per page; no KPI tile without a label.
- No invented features: restyle what exists, keep ids and behaviour.
