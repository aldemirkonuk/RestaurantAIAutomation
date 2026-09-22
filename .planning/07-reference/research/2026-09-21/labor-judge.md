# Labor / hourly-pay page: judge verdict

Judge pass over `labor-page.md` (and `areas-model.md` §A5, §B1-B4), 2026-09-21.
Read-only. Repo read at `origin/main` = `9cfc4e96d` (the same commit `wt-labor`
sits on, with no commits of its own). `wt-recs-cat` read at `1f52dd7f5`.

---

## 1. The plain answer: "we need that page no?"

**Yes, the house needs it. But it should be an hours page, not a pay page, and it
should not be built first.**

- **Why yes.** An owner has no way to see what their people cost against what the
  house sells. Mudavym already says so in two places: the goal engine refuses the
  labor-% goal (`apps/api-gateway/src/analytics/goal-scenarios.ts:412`), and the
  Reports chart draws labor as a flat 28% of revenue guess
  (`apps/web/src/components/reports/molecules/LaborSpendOverlay.tsx:15`).
- **Why not a pay page.** In Turkey the payroll (bordro), the SGK filings and the
  signed wage statement are done by the house's accountant (mali müşavir) or a
  payroll product. Kolay İK, for example, already sells shifts, attendance
  sheets (puantaj), leave and payroll in one product
  ([kolayik.com](https://kolayik.com/),
  [puantaj](https://kolayik.com/blog/kolay-ik-ile-puantaj-kaydi-nasil-tutulur)).
  If Mudavym works out pay, it creates a second pay figure that will differ
  from the real payroll. What Mudavym can do well is keep the hours and show
  them next to sales and purchasing. Then it hands the month's hours to whoever
  runs payroll.
- **Why not first.** It would open empty today. The one live house has **0 shifts
  and 0 schedules**. Its 11 roster rows are **8 owners + 3 managers with no
  `staff` account at all** (`.planning/decisions/README.md:113`, ADR 0089 row,
  measured 2026-09-02; `.planning/06-pages/team.md:958`). The 11 wage values are
  still ADR 0088's invented `$32/$28/$22` literals (`team.md:889`). **I did not
  re-measure these today:** this session has no database access, because the
  Supabase MCP is not authenticated. And `/team`, which the page would read from,
  has six defects of its own (§3.0) that would flow straight into a labor figure.

---

## 2. Adversarial pass on the recommended v1

`labor-page.md` §3 recommends four things. First, a labor-cost view over the
existing wage × scheduled-hours data, with the 45h/1.5x rule. Second, per-role
wage visibility. Third, a minimum-wage warning. Fourth, a staff self-view of
"own hours × own wage". Each attack below ends with a verdict.

### 2.1 Data Mudavym does not have. Verdict: the v1 core breaks

| Missing | Evidence | Effect on the page |
|---|---|---|
| **Pay basis** (monthly vs hourly vs daily) | The only pay field is `hourly_wage`. `employmentType` is a closed set `full_time/part_time/trial/borrowed` (`apps/api-gateway/src/team/dto/team.dto.ts:27,42`). No salary field exists. | Turkish pay is framed monthly: the minimum wage is monthly, and the legal 225-hour divisor turns it into an hourly rate ([tahanci.av.tr](https://www.tahanci.av.tr/part-time-saatlik-ucret/)). A monthly-paid person costs the same whether they work 4 shifts or 6 that week. So **hours × rate is structurally wrong for monthly staff**, every week. |
| **Worked hours** | No clock table. The code says so itself (`notifications/producers/shift-window.ts:44`, `roster.ts:16,76`). | Only planned cost can exist. The "actual" figure is missing. |
| **Breaks** | `hoursBetween()` (`team/schedule.service.ts:29-33`) is end minus start. The week read loads `shift_breaks` (`:108`), but `laborCost()` (`:442`) and `computeLabor()` (`:843`) never subtract them. | Under 4857 Art. 68, breaks are **not working time** (15 min / 30 min / 1 h by shift length, [bienmesse.com](https://www.bienmesse.com/is-kanunu-68-ara-dinlenmesi/)). Cost and overtime hours are overstated by up to 1 h per shift. For example, five 10h shifts with a 1h break are 45 worked hours, but they count as 50 and trip the overtime flag. |
| **Wage history** | `updateMember` overwrites `hourly_wage` in place (`team/team.service.ts:417`). There is no effective date and no audit row. | Nobody can answer "what was the rate in March" or re-cost a past month. |
| **Re-pricing on copy** | `copyWeek` (`schedule.service.ts:204`) copies `labor_cost: s.labor_cost` (`:292`). It does not re-price from the current wage. | After every January minimum-wage rise (27% for 2026), a copied week still shows last year's cost. |
| **Paid leave** | `time_off_requests` has `status` and a free-text `reason`, but no paid/unpaid type and no leave type (baseline `:5666-5677`). | Annual leave is paid (4857 Art. 53: 14/20/26 days by seniority), yet a person on leave has no shifts. hours × rate therefore books **zero cost** for their holiday week. This is the labor side of the founder's own vacation question. |
| **Other statutory pay** | Nothing models the weekly rest day, national-holiday (bayram) work, night-work limits, SGK employer share, meals, transport or severance accrual. | The labor % comes out low, and nothing on screen says so. |
| **Sales denominator** | Labor % needs complete sales for the same period. | POS coverage is partial according to project memory ("POS bridge 1.4%→67.4%"). **I did not re-measure this.** |
| **Currency** | `/team` formats labor cost as **US dollars**: `new Intl.NumberFormat('en-US', {currency: 'USD'})` (`apps/web/src/pages/team/next/tm-format.ts:24-28`). | A Turkish house sees `$` on its labor cost. **This is not tracked anywhere:** `USD` has no matching row in `v3.0-TECH-DEBT.md` or `OPEN-DECISIONS.md` (grepped today). |

### 2.2 Legal exposure under Turkish labour law. Verdict: the staff pay estimate is killed and the overtime rule is revised

- **Overtime is more than "over 45 at 1.5x".** Several rules apply:
  - Part-timers' hours between their contract and 45 are *fazla sürelerle
    çalışma*, paid at **1.25x**. `labor-page.md` §2.2 called this only
    "overtime-adjacent".
  - Weekly hours can be averaged over two months by agreement (denkleştirme,
    Art. 63). A single week over 45 is then not necessarily overtime.
  - Daily work is capped at 11 h and night work at 7.5 h. Overtime is capped at
    270 h a year.
  - Overtime needs the worker's **written consent, renewed at the start of every
    year** (Fazla Çalışma Yönetmeliği Art. 9, found through secondary legal
    sources in search, not the Official Gazette text).
    Mudavym cannot know whether that consent exists.

  **Revision:** v1 flags "over 45 this week, review" and never labels anything
  overtime pay. It prices extra hours only once hours are confirmed and the pay
  basis is known.
- **Mudavym's records become evidence.** Turkish labour courts accept puantaj,
  entry/exit records, internal messages and system logs as evidence of overtime.
  A signed payroll is strong evidence and can be contested only in writing
  ([prozon.net](https://prozon.net/sirkuler/imzali-ve-ihtirazi-kayitsiz-bordrolarin-fazla-calisma-ispatina-etkisi/),
  [adaso.org.tr](https://adaso.org.tr/Content/Files/Sunumlar/2022/3/7e76ffc3-dde6-4eb9-9006-d79756b744a2_Yavuz%20Ba%C5%9Ftemur.pdf)).
  **Revision:** every figure must say whether it is *planned* or *confirmed*.
  Confirmed hours are append-only, the same shape the recs lane already uses for
  dismiss labels. Retention follows the 5-year limit on wage claims, and that
  rule must be written down, not left to a default.
- **A "your pay" screen can be read as a wage statement.** 4857 Art. 37 requires
  the employer to give a signed statement listing every addition and deduction
  ([yaklasim.com](https://yaklasim.com/yaklasim-dergisi/4857-sayili-is-kanunu-cercevesinde-ucret-hesap-pusulasi-yukumlulugu/)).
  A Mudavym figure that differs from it gives a worker or a lawyer a second
  number to argue from. **Killed:** the staff self-view of "own hours × own
  wage" (`labor-page.md` §3.4). Staff see their own planned and confirmed hours
  and their leave, but no money.
- **A second record of pay.** If the wage typed into Mudavym differs from the
  wage on the payroll, for any reason, Mudavym holds a conflicting record of what
  someone is paid. The product should not ask for, compare or store a "declared
  vs actual" split. The pay-basis question in §4 needs to be answered with this
  in mind.
- **Minimum-wage warning.** The idea survives, but it must compare hourly rates.
  The 2026 hourly minimum is **₺146.80 gross / ₺124.78 net** (monthly ₺33,030 /
  ₺28,075.50 ÷ 225, corroborated independently of `labor-page.md` by
  [tahanci.av.tr](https://www.tahanci.av.tr/part-time-saatlik-ucret/)).
  The value must be a dated setting, not a code constant, because it changes
  every year. It would also flag all 11 of ADR 0088's leftover `$32/$28/$22`
  rows, so it doubles as a detector for them.

### 2.3 KVKK. Verdict: a precondition, not a feature

- The employer may process wages for the employment contract without consent
  (`labor-page.md` §2.3 is right about that). But the house is the data
  controller and Mudavym is its processor. The repo records **"no policy, no
  DPA, no BAA, no data-processing record, no subprocessor register"** and
  **0/50** runtime hosts classified
  (`.planning/01-org/corporate/compliance-privacy/compliance-privacy-charter.md:124,202`,
  last changed 2026-08-24, not re-measured).
- Staff must be told that their data is processed in Mudavym (a privacy notice,
  aydınlatma, KVKK Art. 10). `git grep -il "kvkk\|aydınlatma" origin/main --
  apps/web/src` returns **nothing**.
- **Transfers abroad:** KVKK Art. 9 was rewritten by Law 7499, in force since
  2024-06-01. Personal data sent abroad needs an adequacy decision or a
  safeguard, such as a standard contract notified to the Board within 5 business
  days ([kvkk.gov.tr](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim),
  [guzeloglu.legal](https://www.guzeloglu.legal/tr/haber-makale/kisisel-verilerin-yurt-disina-aktarilmasi-7499-sayili-kanun-ile-degisen-kvkk-madde-9-ve-yeni-aktarim-rejimi-4485.html)).
  **No ADR I found records where Mudavym's database physically sits.** Wages are
  not special-category data, but inside a crew of ten they are the data whose
  leak does the most harm.
- **Minimisation for v1:** no IBAN, no national ID number (TC kimlik no), no SGK
  number, no health reasons on leave rows.
- **GDPR houses (future):** the EU Pay Transparency Directive (2023/970) had to
  be in national law by **7 June 2026**. It gives workers the right to ask for
  average pay by category and bans pay-secrecy clauses
  ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2023/970/oj/eng)). That limits
  the *employer*. It does not change the rule that the *system* never shows one
  worker another's pay.

### 2.4 A wrong labor %. Verdict: the v1 display rule is revised

The number can be wrong in both directions at once:

- **Too low:** monthly staff are costed by the shift; leave weeks book zero; SGK
  employer share is left out. That share is roughly 20-24% on top, and sources
  disagree on the exact figure (`labor-page.md` §2.2 and
  [karekodgarson](https://karekodgarson.com/blog/restoran-maas-bordrosu-hesaplama-sgk-fazla-mesai-rehberi)
  say 20.5%). Bayram pay and meals are left out too.
- **Too high:** breaks are counted as work.
- **Either way:** sales may be partial, and the currency is wrong.

**Revised rule:** show labor % only when the wage side *and* the sales side are
both complete for the period. Extend the existing `costComplete` / `totalCost:
null` pattern (`schedule.service.ts:843-891`) to cover sales and pay basis.
Otherwise show the parts and say what is missing. Always label the figure
"wages only, excluding SGK, meals and bonuses".

### 2.5 Overlap with a payroll provider. Verdict: pay computation is killed

- `labor-page.md` benchmarked **seven US/AU tools and no Turkish one**. ADR 0103
  already recorded the same miss: *"the earlier research scanned nine US tools
  and no Turkish one"* (`.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:227`). US assumptions
  leaked into the proposal: hourly pay first, tips flowing into payroll, a 40h
  week.
- In Turkey the house already has someone who runs payroll and SGK (an
  accountant, Logo/Workcube, or Kolay İK). Mudavym working out pay competes
  with that person and loses on accuracy. The two do not overlap on "hours and
  labor cost next to purchasing, menu and sales in one place".
- **Revision:** v1 exports the month's confirmed hours in attendance-sheet
  form: days worked, hours, hours over 45, leave days. Whoever runs payroll
  takes it from there. Mudavym never produces a pay figure or anything shaped
  like a payslip.

### 2.6 Staff seeing each other's pay. Verdict: holds for staff, **leaks for managers today**

- **Holds:** staff read paths strip `labor_cost` (`schedule.service.ts:162-166`,
  `:737-740`). `shifts`, `team_members`, `team_settings` and `time_off_requests`
  have row-level security enabled with **zero policies**, so the browser cannot
  read them directly (baseline `:15047,:15125,:15131,:15137`; no `CREATE POLICY`
  matches for those tables).
- **Leak 1: `wage_visible` is defeated.** It nulls `hourly_wage` only in
  `listMembers` (`team.service.ts:156,211`). `getWeek` (`schedule.service.ts:90-133`)
  returns every shift's raw `labor_cost` to any manager, and `labor_cost ÷
  (end − start)` gives back the wage exactly. The switch also has no role check,
  so turning it off hides wages from the owner too.
- **Leak 2: a manager can set any wage, including their own.** `updateMember` is
  manager-gated (`team.service.ts:403`) and writes `hourly_wage` (`:417`) with no
  audit row and no history.
- **Leak 3: small crews reveal individual pay.** A per-area or per-day cost
  total, next to a visible schedule, gives away individual pay when one to three
  people share the slot, such as the one dishwasher. **Revision:** "sees labor
  cost" and "sees wages" are **one permission, not two**. A viewer without it
  sees hours only. This follows Deputy, where a denied role sees cost as 0.
- **Cross-lane:** the AREAS model (`areas-model.md` §A4-A5) sends cards to area
  members. The `staff_spread` rule already names a top-selling and an
  underperforming server (`wt-recs-cat`
  `apps/api-gateway/src/analytics/recommendations.service.ts:309-323`). Any
  future labor card (overtime, cost per cover) must be **management-only
  whatever its area**. Wage fields should carry the `data-secret` capture mask
  (project memory: rendered credentials vs screenshots).

---

## 3. Revised v1

### 3.0 Fix first, on `/team`, before any new page (defects, not features)

These need OD rows filed by a session that can write:

1. The USD formatter (`tm-format.ts:24-28`).
2. The `wage_visible` leak through `labor_cost` in `getWeek`
   (`schedule.service.ts:90-133`).
3. The `h > 40` overtime flag (`:872`). It should become "over 45, review", with
   no price attached.
4. Breaks are ignored in `hoursBetween` / `laborCost`.
5. Unaudited, history-less wage writes by managers (`team.service.ts:397-417`).
6. `copyWeek` carries forward a stale `labor_cost` (`:292`).

### 3.1 Then the page. It is owner-facing, and pay access follows §4 Q3

1. **Pay basis per person:** monthly, hourly or daily/extra, plus the amount,
   in TRY, with an effective-from date (history, not overwrite). A monthly
   person's cost for the period is their salary prorated. An hourly or daily
   person's cost is confirmed hours × rate.
2. **Confirmed hours:** at the end of each day, a manager marks each planned
   shift as worked, changed (start, end, break) or no-show. The record is
   append-only. This is the cheapest route to real hours without a clock, and
   it is the attendance sheet.
3. **Owner view** for a week or month:
   - planned vs confirmed hours;
   - hours over 45 per person, the 11-hour daily cap, and a running total
     against 270 h a year;
   - wage cost, sales and labor %, using the completeness rule in §2.4 and the
     "wages only" label;
   - paid leave counted as cost with zero hours.
4. **Month-end export** of confirmed hours for whoever runs payroll. It is not a
   payslip.
5. **Staff:** their own planned and confirmed hours and their own leave. No money.

**Not in v1:** payroll, SGK, tax, payslips, tips, clock hardware, bank or IBAN,
a declared-vs-actual split, or labor cost by area (it waits for the AREAS join,
and stays owner-only because of §2.6).

---

## 4. Founder questions

These are also returned in structured form.

1. **Should Mudavym work out pay, or hand the month's hours to whoever runs your payroll?** (Payroll)
2. **Should the page handle monthly salaries, not just hourly pay?** (Pay basis)
3. **Who may see wages and labor cost?** (Pay access)
4. **Should we fix the six /team defects before building the labor page?** (Timing)

---

## 5. Corrections to `labor-page.md`, and what I did not check

**Corrections:**
- The DTO path is `apps/api-gateway/src/team/dto/team.dto.ts`, not
  `team/team.dto.ts`. `employmentType` is a closed set of four values at the
  API, not free text.
- The overtime filter is at `schedule.service.ts:872`, not `:871`.
- The part-time rate for hours up to 45 is 1.25x.
- It missed the USD formatter, the `wage_visible` leak, the manager
  self-wage-write, break handling, `copyWeek` re-pricing, and that the roster is
  8 owners + 3 managers with no staff.

**Not verified:**
- Current production row counts (no database access this session).
- The 2026 SGK employer split, which sources still disagree on.
- The primary text of the Yargıtay tip-pool ruling.
- Where the database is hosted.
- POS sales coverage.
- Whether most people at the founder's own house are paid monthly. §4 Q2 asks
  this; the 225-hour divisor shows the *legal* frame is monthly, not what his
  house does.
- The overtime-consent rule and the Art. 69 night limit are cited from secondary
  sources, not the Official Gazette text.
