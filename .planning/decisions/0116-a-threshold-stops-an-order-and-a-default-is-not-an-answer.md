# 0116 — A threshold stops an order, and a default is not an answer

- **Status:** Locked — the founder decided all three on 2026-09-03, in session
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** approval thresholds, enforcement, approveOrder, manager_ceiling, new_vendor, price_jump, role gate, owner, manager, column default, lead_time_days, payment_terms, timezone, delivery days, regions_covered, vendor terms, absence-reported-as-health
- **Links:** [[0020-honesty-first]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0088-record-do-not-restrict]], [[0070-a-quantity-states-its-own-unit]],
  [[0016-ledgers-must-express-unknown]], [[0022-scheduled-jobs-serve-every-tenant]],
  [[0077-accounts-payable-is-a-module-not-a-column]],
  `supabase/migrations/20260903170000_a_default_is_not_an_answer.sql`,
  `supabase/migrations/20260904190000_a_report_has_no_default_clock.sql`,
  `.planning/06-pages/settings.md` §13.32 (drop the snapshot, 2026-10-04),
  `apps/api-gateway/src/procurement/order-approval-gate.ts`,
  `scripts/list_weekdays_in_regions_covered.py`,
  `.planning/06-pages/settings.md` §9.12–9.14 / §13.23 / §13.25 / §13.26,
  `.planning/06-pages/providers.md`, `.planning/06-pages/orders.md` §9

## Context

Three findings from the settings register's fourth pass were filed rather than
built, because each was outside that pass's paths. The founder decided all three
in one sitting on 2026-09-03. They are one ADR because they are one fault seen
from three sides: **a value nobody stated, treated as though somebody had.**

**1. The thresholds enforced nothing.** `/settings` `?tab=thresholds` shipped on
2026-09-03 with `restaurant_approval_thresholds`, a `decideApproval` pure
function and a retrospective counting how often each rule would have fired over
the house's own orders. Its opening sentence, rendered from
`enforcement.enforcedBy` being empty, said that nothing read any of it:
`ProcurementService.approveOrder` wrote `status`, `approved_at` and `approved_by`
and consulted neither a role nor an amount, and
`POST /procurement/orders/:id/approve` carried `JwtAuthGuard` alone. Anyone who
could reach the endpoint could seal any figure, and `/orders` rendered
`HoldToApprove` on every pending row. The founder's phrase for the register when
it was built was *"the hold-to-approve ceremony exists and has no policy behind
it — this is the policy"*; the policy still had nothing behind IT.

Worse than absent: `PUT /settings/approval-thresholds` had no role check either,
so the person a ceiling stopped could raise the ceiling. That is not a weaker
policy than none — it is a policy that reports itself as holding while it is not.

**2. Three column defaults asserted facts nobody stated.** Measured against
`supabase/migrations/20260805000000_baseline_from_production.sql`:
`providers.lead_time_days DEFAULT 7` (`:4864`),
`providers.payment_terms DEFAULT 'Net 30'` (`:4897`),
`restaurants.timezone DEFAULT 'America/Los_Angeles'` (`:3575`). Each makes every
row carry an answer to a question nobody was asked, and **none can be told apart
from a real answer** — which is the definition of the fault, not a side effect of
it. `restaurant_vendor_terms` (migration 20260903140000) was built *around* this
rather than fixing it: `leadTimeCell` and `paymentCell` compared the stored value
against the default and reported a match as UNKNOWN.

**3. The delivery-days checkbox wrote into the geography column.**
`AddProviderModal.tsx` collected weekdays; `pages/Providers.tsx` sent them as
`statesOrRegionsServed`; `services/api/providers.ts` mapped that to
`regionsCovered`; the gateway wrote `providers.regions_covered` — the column the
provider map and the territory filters read. The sibling `deliverySchedule` field
was declared on the web DTO and never reached a payload at all. Ticking "Monday,
Wednesday, Friday" had exactly one persisted effect: three weekday names joined
the list of regions the vendor covers. And `EditProviderModal` read
`regionsCovered` back INTO the delivery-days picker, so opening and saving the
dialog wrote them again.

### What was measured, and where

Local Postgres (`supabase_db_exzueerziesmczwlhomd`, the full 113-migration tree),
the migration applied inside a transaction and rolled back:

| Probe | Result |
|---|---|
| The three defaults, before | `lead_time_days` → `7`; `payment_terms` → `'Net 30'::text`; `timezone` → `'America/Los_Angeles'::character varying` |
| The three defaults, after | all three `NULL`, all three columns still `is_nullable = YES` |
| Rows the UPDATE touches, empty DB | `0 / 0 / 0` |
| Rows the UPDATE touches, 3 seeded providers + 1 restaurant | `2 provider row(s)`, `2 provider row(s)`, `1 restaurant row` — and the provider seeded with a stated `21` days / `'2% 10 net 30'` **kept both** |

**Production counts were NOT measured.** This session had no production database
access; the migration counts what it clears and raises it as a `NOTICE` at apply
time, which is where the real number will appear.

**`payment_terms` does not currently reach a vendor's inbox.**
`06-pages/settings.md` §9.12 named
`communications/email-templates/payment-due.template.ts:108` as the escape route
and that was the strongest argument for the migration — but two things are true
of it that were not stated before: the field was already `string | undefined` and
already emitted only when truthy (an absent term has always printed nothing), and
**nothing calls the mailer**. `GmailService.sendPaymentDueReminder`'s only
invocation in the repository is `tests/email-e2e.spec.ts`; the cron that would
have called it was deleted and the note where it stood is
`communications/scheduled-tasks.service.ts:596-619`. Both facts are now pinned in
`payment-terms-are-not-fabricated.spec.ts`.

## Options considered

### On enforcement

1. **Warn only.** Let the seal go through and file a notice that a rule was
   exceeded. Appeals because it can never block a kitchen at 6pm on a Friday.
   **Rejected**, and it is the option worth arguing with: a warning that does not
   stop anything trains people to ignore it within a week, and the register would
   still be describing a gate that is not a gate. It also cannot answer the
   question the founder actually asked — *"only certain high tier like manager or
   owner can adjust it"* — because a warning has no notion of who may proceed.
2. **Enforce at the endpoint, refuse with a generic 403.** **Rejected**: a person
   told only "forbidden" learns exactly one thing — split the order in two. The
   refusal has to name the rule, the number and who may sign, or the policy
   teaches evasion.
3. **Enforce, refuse with the whole sentence, park the order where it is
   waiting.** **Chosen.** The founder's words: *"do option 1"*.

### On the defaults

1. **Leave them and keep comparing.** The vendor-terms register already reported
   a value equal to a default as unknown, which was honest. **Rejected**: it is
   honest only where somebody wrote that comparison. `providers.service.ts:1374`
   and `:1382` map both columns straight onto the API, and every future reader
   would have to remember. The fault has to be removed at source, not routed
   around at each site.
2. **Drop the defaults, keep the existing rows.** **Rejected**: it fixes new rows
   and leaves every existing one asserting a fabricated answer forever, with no
   query that can ever separate the fabricated from the real.
3. **Drop the defaults and NULL every row that equals one.** **Chosen**, with the
   cost stated plainly rather than buried: this erases real answers too — a
   vendor who genuinely quoted seven days, a house genuinely in Los Angeles. It
   is the only honest option available, because a default is indistinguishable
   from an answer and there is no query that separates them. Dropping is
   recoverable (a person states the term again, and `restaurant_vendor_terms` now
   records who and when, so the second telling is provable in a way the first
   never was); keeping is not.

   **Amended 2026-09-04, at the founder's instruction: take a snapshot first.**
   The migration now photographs the pre-change values into
   `public.tmp_dropped_column_defaults_20260903` before the UPDATE, and asserts
   per column that the photograph caught exactly the rows the UPDATE then
   cleared. This does **not** weaken the decision and is not a restore path — a
   value equal to a default is unattributable, so the snapshot cannot separate
   the real from the fabricated either, and restoring it wholesale would restore
   the fault. It buys one thing: the erasure becomes **inspectable**. A person
   can ask "which vendors lost a lead time, and do any look deliberate?" and get
   an answer, rather than a count in an apply log and no way back to the
   question. The counter-argument that carried it: the snapshot costs nothing and
   its absence is irreversible, while its presence is reversible on a date.

### On delivery days

1. **Delete the control.** Filed as a live option in §13.25. **Rejected**: the
   days are real information a person is trying to record, and deleting the field
   loses the intent along with the bug.
2. **Repoint it at `PUT /vendor-terms/:providerId`.** **Chosen.**
3. **Clean up `regions_covered` in the same change.** **Rejected**, deliberately.
   `regions_covered` is free text and nobody can prove from the database that a
   "Sunday" in it came from the picker rather than from a person who meant a
   place — Sunday is a town in Louisiana. Removing an entry would be destroying a
   row of somebody's data on an inference. A **listing** was built instead:
   `scripts/list_weekdays_in_regions_covered.py` proposes and has no `--apply`.

## Decision

**One.** `approveOrder` reads the order, reads this house's thresholds through
the same `decideApproval` the settings register renders, resolves the actor's
role at this restaurant, and refuses the seal when the actor ranks below what the
rule demands — with the rule, the number and who may sign in one sentence, as a
403 the page prints verbatim. The refused order is parked in `APPROVAL_NEEDED`
(an existing `ProcurementOrderStatus` member; the column is a plain `varchar(50)`
with no CHECK, so no migration), and the refusal is filed in `system_audit_log`
as `order_approval_refused`. **A house with no rule keeps exactly today's
behaviour**, and says `"no threshold is set for this house"` rather than implying
a policy. An **unreadable** policy REFUSES: a table that cannot be read has not
said "anyone, any amount".

**Two.** Only an owner or a manager may write a threshold, checked server-side in
`SettingsController.setApprovalThreshold` via the existing
`OrganizationsService.assertCanManageRestaurant`. This is the opposite call from
the one vendor terms made under ADR 0088 (*record it, do not restrict it*), and
it is opposite on purpose: a cutoff is knowledge about the world that whoever
phones the vendor should be able to write down; a threshold is the house's own
limit on what may be spent without a second signature, and a limit anybody may
raise is not a limit.

**Three.** The three column defaults are dropped and every row carrying one is
set to NULL. An unset value reads as unknown everywhere.

**Four.** The provider form's delivery-days picker writes
`PUT /vendor-terms/:providerId` and nothing else; `regions_covered` stops
receiving weekdays; the edit dialog seeds the picker from the terms register
rather than from the geography column.

## Consequences

### What becomes easier

- The thresholds register's opening sentence flips itself. It renders from
  `enforcement.enforcedBy`, which is MEASURED — the day the gate is removed, the
  page goes back to admitting nothing stops an order.
- A term on a vendor record now means something. A `7` in `lead_time_days` is a
  seven somebody typed, so `leadTimeCell` and `paymentCell` lost their
  default-equality branches entirely.
- Delivery days have a home that records who said them and when, and the calendar
  / orders contract (§13.24) has real data to read when it is built.

### What becomes harder, or is given up

- **The first reader sweep claimed four runtimes and covered three, and the
  omission was an outage.** Corrected 2026-09-04 by the audit. The sweep grepped
  the three TypeScript trees for the COLUMN NAMES and read
  `services/agent-orchestrator`'s two hits as inert. They were not: the
  orchestrator does not read these columns by name, it validates rows into a
  Pydantic model, and **that model is a reader of every column it names**.
  `Provider.lead_time_days` was declared `int = 7` — non-Optional, unlike
  `payment_terms` two lines below — so after this migration a NULL lead time
  raises `ValidationError` in `model_validate`;
  `BaseRepository.find_many`/`get_by_id` catch **only `APIError`**, so it escaped
  the repository; and `RFQAgent._select_competitor_vendors` swallowed it in a bare
  `except Exception` and returned `[]`. Symptom: **every restaurant reports no
  active vendors, permanently**, behind one ERROR line. Proven against a HEAD
  copy of the model (`Input should be a valid integer … input_value=None`).
  Fixed at both levels — the fields are Optional, and `find_many` now validates
  per row and names the row it drops, so the next model/schema disagreement
  costs one row rather than the whole query. 17 tests in
  `services/agent-orchestrator/tests/test_dropped_column_defaults.py`.
- **The same funnel had a second mouth, and it is closed too** (re-audit,
  2026-09-04). `RFQAgent._select_competitor_vendors` still caught bare
  `Exception` and returned `[]`. The `ValidationError` could no longer reach it,
  but a dropped connection, an expired service key or a PostgREST 500 still
  could — and each was reported to the caller as an empty vendor list and logged
  as *"No vendors found for X"*, which is a claim about the HOUSE rather than
  about the request. It now raises `VendorSelectionUnavailable` (a type, so a
  caller cannot forget to check it) carrying the cause and its class;
  `_build_rfq_plan` catches it, fails closed exactly as before — this agent is
  propose-only and contacts nobody either way — and logs which of the two
  happened. 6 tests in `tests/test_rfq_vendor_selection_failure.py`, one of
  which executes the pre-fix shape to show it still swallows the failure, so
  the fix cannot quietly stop being a fix.
  **The lesson is the one above, restated:** fixing the loudest way into a
  funnel is not fixing the funnel.

### The test figures, corrected

The commit message for the blocker fix quoted **1,336** orchestrator tests. That
was the marker-filtered run (`-m "not e2e and not prod_e2e and not slow"`:
1,336 passed, 4 skipped, 53 deselected) reported as though it were the whole
suite. The re-audit's full run was **1,339 passed, 54 skipped**, and it was
right. With this pass's six additions the full run is **1,345 passed, 54
skipped** (`python3 -m pytest tests/ -q`, no deselection). Recorded here rather
than left in a commit message because a number quoted outside its own scope is
how a true figure becomes a false claim.
  **The durable lesson:** a reader sweep that greps for column names is blind to
  a runtime that reads columns through a schema.
- **Real answers equal to a default were erased.** Stated in the migration, in
  its `NOTICE`, and here. There is no way to recover which were real — the
  snapshot below records WHAT was erased, not WHICH of it was deliberate.
- **The two report-timezone defaults went too** (founder, 2026-09-04, after
  reading the reader list): `manager_preferences.report_timezone` and
  `manager_report_profiles.timezone`, migration
  `20260904190000_a_report_has_no_default_clock.sql`, same snapshot shape. They
  were **not the same case**: the second has zero readers of the column and 0
  rows in production, so it was free; the first had the fabricated answer
  hard-coded twice more in Python, and dropping the column default alone would
  have been cosmetic. `agents/reporting_agent.py:_should_generate_report` — the
  line that decides **whether a manager's report fires now** — now refuses in
  words rather than assuming California. `ManagerPreferencesRepository.is_quiet_hours`
  is **dead code** (zero callers; the only other `is_quiet_hours` in the tree is
  `NotificationAgent._is_quiet_hours`, a different method reading a different
  table) and was made safe and recorded as dead rather than quietly repaired.
- **The weekday cleanup became a MOVE** (founder, 2026-09-04). The listing was
  read and the days are recovered rather than deleted:
  `scripts/list_weekdays_in_regions_covered.py --apply-move` writes them into
  `restaurant_vendor_terms.delivery_weekdays` with `notes = "recovered from the
  regions column"` and `stated_by` left ABSENT — nobody said this, it was mined,
  and attributing it to an operator would invent a witness — then clears them
  from `regions_covered`. **It is two writes, not a transaction**, because
  PostgREST exposes none; the ordering is the guarantee (term first, so a
  failure loses nothing and re-running retries) and the header says exactly that
  rather than claiming atomicity. Still dry-run by default; 24 tests pin the
  matcher and the payload, including that the upsert can never carry a key that
  would erase a cutoff, a minimum, a lead time or payment terms.
- **A temporary table now exists and must be dropped on 2026-10-04.**
  `public.tmp_dropped_column_defaults_20260903` (RLS on, service_role only,
  `anon`/`authenticated` revoked, no column defaults of its own — all asserted in
  the migration). Filed as `.planning/06-pages/settings.md` §13.32 with the
  date and the one-line chore. **Left in place it becomes a second copy of the
  fabricated answers** — one no reader sweep covers, no guard checks, and the
  next person to find it will reasonably mistake for data. That is strictly worse
  than never having taken it, which is why the expiry is a filed item and a date
  rather than an intention. If the record is wanted beyond a month, the answer is
  a deliberate export stored outside the database, not an un-dropped table.
- **A manager can now be stopped at 6pm.** That is the point, and it is also the
  cost. The mitigation is that the refusal names the rule and the approver rather
  than saying "forbidden", and that the register shows a house how often each
  threshold WOULD have fired over its own last year before it sets one.
- **`vendor-terms.service.ts` is only correct on a migrated database.** Removing
  the default-equality test means a gateway running against an un-migrated
  database would report fabricated defaults as terms. Code and schema move
  together on merge (migrations auto-apply) and the migration asserts the dropped
  defaults in its own transaction, so this fails loudly at deploy rather than
  quietly at read — but it is a real coupling and it is named here.
- **A NULL timezone now propagates.** `ScheduledTenantsService` used to
  substitute `"America/New_York"`; it now carries `TIMEZONE_NOT_SET` (the empty
  string, which is not a valid IANA zone), so both consumers' existing
  unknown-zone branches fire and log before running that house's per-tenant work
  in UTC. More houses will hit that path after the migration than before.
- **`regions_covered` still holds whatever weekdays were already written.** The
  listing proposes; a person decides. Nothing was cleaned up.

### What would trigger revisiting this

- A house reports that an order was blocked by a rule nobody remembers setting.
  The `order_approval_refused` rows are what make that findable; if they are not
  enough to reconstruct why, the audit payload is wrong.
- The retrospective on a real tenant shows a threshold that would have fired on a
  large fraction of orders. That is a threshold set against the wrong house, and
  it is an argument for the per-vendor override the register deliberately does
  not draw.
- Somebody needs a lead time of exactly 7 or terms of exactly Net 30 restored in
  bulk. There is no way to do it — that is the cost accepted above, and if it
  bites hard enough the answer is a fresh statement per vendor, not a backfill.
- `manager_preferences.report_timezone` (`baseline:3692`) and
  `manager_report_profiles.timezone` (`baseline:3729`) carry the same fault and
  were NOT touched — they were not named in the decision. Filed in
  `06-pages/settings.md` §13.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | Aldemir (founder) | Decided all three in session; "do option 1" on enforcement, "only certain high tier like manager or owner can adjust it" on the write gate |
| 2026-09-04 | — | Written up; migration proven on local Postgres in a rolled-back transaction; production row counts NOT measured |
| 2026-09-04 | Sonnet re-audit | Two nits: the bare `except Exception -> []` in `_select_competitor_vendors` still turned a network or auth failure into "no vendors"; and the commit message's 1,336 was the marker-filtered run, not the suite. Both taken |
| 2026-09-04 | Sonnet audit | BLOCKER: the reader sweep missed `services/agent-orchestrator` — `Provider.lead_time_days: int = 7` would have made every restaurant report zero vendors. Fixed at the model AND the repository; proven against a HEAD copy |
| 2026-09-04 | Aldemir (founder) | Drop both report-timezone defaults and their two Python defaults; make the weekday cleanup a MOVE with provenance |
| 2026-09-04 | Aldemir (founder) | Asked for a pre-change snapshot before the UPDATE. Added with a per-column assertion; re-proven on local Postgres (3/3/2 cleared, snapshot matched exactly) and the assertion proven to FIRE against a deliberately broken snapshot. Expiry filed as settings.md §13.32 |
