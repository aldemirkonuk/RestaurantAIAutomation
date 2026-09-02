# 0077 — There is no payment-due reminder, because there is nothing in the schema to remind about

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** scheduled tasks, cron, dead path, payment due, accounts payable, procurement_orders, procurement_documents, payment_terms, swallowed error, 42703, absence reported as health, deletion
- **Links:** [[0058-order-status-is-an-enum-not-a-string]] (dead cron #1), [[0061-recurring-reminder-reads-the-recurrence-table]] (dead cron #2, PR #227), [[0065-a-conversation-log-names-real-columns-and-refuses-a-missing-body]] (the write half of the `procurement_conversations` pair repaired here), [[0067-a-failed-read-is-never-an-empty-one]] (the swallowed-read ratchet, unmerged), [[0074-a-read-names-columns-that-exist]] (the read-column ratchet whose debt entries this change retires, unmerged), [[0020-no-fabricated-answers]], [[0022-scheduled-jobs-run-per-tenant]] / OD-87

## Context

`ScheduledTasksService.sendPaymentDueReminders()` ran at 09:00 daily, per tenant,
and filtered `procurement_orders` on `payment_due_date`:

```ts
.not("payment_due_date", "is", null)
.lte("payment_due_date", threeDaysFromNow.toISOString())
.gte("payment_due_date", now.toISOString());

if (!invoices || invoices.length === 0) return;
```

**`payment_due_date` is declared by no table in the schema** — not by
`procurement_orders`, not anywhere. PostgREST answers `42703` and fails the whole
query. supabase-js does not throw on that; it returns `{ data: null, error }`. The
caller read only `data`, found it falsy, and returned as though nothing were due.
The job has never sent one payment reminder, and never logged one line saying so.

**This is the third cron in this one file to die exactly this way**, and the
repetition is the finding:

| ADR | The job | What was wrong | How it survived |
|---|---|---|---|
| 0058 | recurring-order reminder | `status = 'RECURRING'`, not a member of `ProcurementOrderStatus` | matched zero rows; empty result read as "nothing to do" |
| 0061 | recurring-order reminder | pointed at `procurement_orders`, a table holding none of the three fields it read | same |
| **0077** | payment-due reminder | filtered on a column no table declares | **query error** read as "nothing due" |

All three are the same defect wearing three faces: **a query that cannot succeed,
wired to a caller that cannot notice.** The project memory note
`absence-reported-as-health` names the general form — *a system reporting on itself
reports absence as health unless something forces it to prove presence.* A cron is
the purest case, because "no email today" and "no email ever" are the same
observation from outside.

### The column was not the only thing missing

The reported defect was one column. Reading the rest of the job showed that
**every field it touches beyond `order_number` is imaginary**, which is what turned
a repair into a deletion:

| What the job read | Reality, measured against `supabase/migrations/` |
|---|---|
| `procurement_orders.payment_due_date` | declared by **no table in the schema** |
| `procurement_orders.payment_terms` | not a column here. `providers.payment_terms` exists (free text, default `'Net 30'`, baseline `:4899`) |
| `procurement_orders.final_price_per_bottle` | no such column; the table has `final_price`, `quoted_price`, `negotiated_price`, `total_cost` |
| `procurement_orders.negotiated_price_per_bottle` | no such column — so the emailed amount is `quantity × 0` = **$0.00** |
| `actionUrl: "/orders?status=invoiced"` | `invoiced` is not a member of `ProcurementOrderStatus` (`procurement.dto.ts:18-32`) |
| any paid/settled state | **no `paid`, `paid_at`, `payment_status` or `amount_paid` column exists on any table** |
| any due date at all | `grep 'due_date\|due_at' supabase/migrations/*.sql` returns **nothing** |

Nor is there a consumer: no accounts-payable surface exists in `apps/web` or
`apps/mobile`. The *invoice* half of AP is real and shipping —
`procurement_documents` (`doc_type = 'invoice'`, `doc_date`, `total`), the
`POST /procurement/documents` intake, `/receipts` with its credits tab, and
`procurement_credits`. The *payment* half does not exist in any form.

So this is not a column somebody forgot to add. It is a stub written against an
imagined accounts-payable module, in a file where the imagined thing was never
built. That distinction is what separates it from ADR 0061, where the three phantom
fields all had a real home on `recurring_orders` and repointing was a determination
rather than a guess.

## Options considered

1. **Add `payment_due_date` to `procurement_orders` in a migration.** Rejected.
   Nothing would populate it, and the three price/terms columns the same job reads
   are equally absent, so the reminder would still mail `$0.00` to a link that goes
   nowhere. This is inventing a schema for a feature no one has specified — the
   thing [[0001]]'s "nothing is decided until it is decided together" exists to stop.
2. **Repoint at `procurement_documents` + `providers.payment_terms`, gated dark,
   the ADR 0061 shape.** Rejected, and this was the strongest candidate — it needs
   no migration, since a due date *is* derivable as `doc_date + parse(payment_terms)`.
   Two things kill it. First, **nothing records that an invoice was paid**, so the
   job could not be a reminder; it would nag about every invoice ever received,
   forever. Second, the parse is not a detail: `payment_terms` is free text
   (`"Net 30"`, `"2% 10 net 30"`, `"prepaid"` — `commercial-terms.ts:33`), and this
   project's own research says the real due date is a *computed*,
   jurisdiction-and-category-dependent field — NY 30 days for wine vs 12–26 for
   beer, TX semi-monthly windows, MD counting from invoice date
   (`07-reference/INVOICE_DOC_UX_RESEARCH.md:309,466`). Guessing that inside a cron
   fix would be a worse defect than the one being repaired, because it would be
   confidently wrong instead of silently dead.
3. **Delete the job. Chosen.** Nothing that ever worked is lost. A tombstone
   comment holds its place, this ADR holds the evidence, and a test asserts it
   stays gone so a future session cannot re-add the stub without meeting it.
4. **Leave it and only fix the error handling.** Rejected: the job would then log a
   fresh `42703` every morning, for a feature nobody is building, in a file whose
   whole problem is noise that nobody reads.

## Decision

**`sendPaymentDueReminders()` and `triggerPaymentDueReminders()` are deleted.** The
delivery half is deliberately kept — `paymentDueTemplate`,
`GmailService.sendPaymentDueReminder` (covered by `email-e2e.spec.ts:306`), the
`payment_due` notification type and its icon in `Notifications.tsx` — so that
whenever AP is built it starts from a working, tested mailer rather than from
nothing. Keeping a proven output path costs nothing; keeping a query that cannot
run costs a daily lie.

**No flag is introduced and none is flipped.** PR #227 added
`RECURRING_ORDER_REMINDERS_ENABLED` for the sibling reminder; that flag is
untouched and stays off. A deleted job needs no gate.

### And underneath it: a failed read is never an empty one

The column was the symptom. **Every read in `scheduled-tasks.service.ts` discarded
its `error`** — seven of them, found independently by the new test's own extractor:

```
:435 recurring_orders   :537 procurement_orders   :609 procurement_orders
:731 calendar_events    :785 custom_reminders     :1239 providers
:1390 notification_preferences
```

All seven now run through `readRows()`, backed by a pure module
`communications/scheduled-db.ts`:

- **`interpretRead()` returns a discriminated `ReadOutcome`** — `{ok:true, rows}`
  or `{ok:false, reason}`. There is deliberately no third state meaning "null, make
  of it what you will"; that ambiguity *is* the defect. `data: null` with no error
  is read as a failure, not an empty list, because a client that returned neither
  rows nor an error has not answered the question.
- **`describeReadFailure()` says the failure in words** — job, table, PostgREST
  code translated into what it means (`42703` → "the query names a COLUMN that does
  not exist"), details, hint, and the clause that is always true and was always
  missing: *this is a FAILED read, not an empty one; nothing was sent, and the
  absence of a notification today does not mean there was nothing to send.*
- **It logs at ERROR, not WARN.** A scheduled job that cannot read is not degraded,
  it is not running.
- Two call sites keep their existing fallback and gain only the log, on purpose:
  `notification_preferences` still defaults to on when unreadable (a preferences
  outage must not silence every notification), and a failed `providers` lookup no
  longer silently becomes `"Unknown Provider"` for every row ([[0020]]).

### And the writes, which were worse

The founder extended the scope after the read fix landed. **All six writes in the
file discarded their error too**, inside a `try/catch` that reads as covered and
is inert: supabase-js *returns* `{error}` rather than throwing, so there is
nothing for the catch to catch. They now go through `wrote()`, over
`interpretWrite()` / `describeWriteFailure()` in the same pure module.

Two are `notifications` inserts — the class the memory note calls **O, silent
omission**: no row is corrupted, a good row is simply never written, and nothing
records it. That damage cannot be enumerated or repaired afterwards, so the log
line has to enumerate it *at the moment it happens*. `describeWriteFailure()`
therefore takes a `what`: not "a write failed" but *"3 in-app notification row(s)
of type payment_due for restaurant `<id>` was NOT saved"*. For the bulk insert in
`persistRestaurantNotification` that count matters — one failure loses the signal
for every member of the restaurant at once.

**The other four are worse, and were found by looking rather than by being
reported.** They are the `custom_reminders` updates that advance `next_fire_at`
or set `is_active = false`. The cron runs `*/15 * * * *` and selects
`is_active = true AND next_fire_at <= now`, so **those updates are the only thing
that stops a reminder re-firing.** A silent failure does not lose a
notification — it emails the manager the same reminder every fifteen minutes,
indefinitely. Their messages say so: *"it stays due, so the 15-minute cron will
send it again"*. All the columns they write are real; this was purely the
swallowed error. They were fixed alongside the two the founder named, because
repairing a lost inbox row while leaving a live mail loop next to it would not
have been a defensible reading of the ask.

`23503` gets named specially in the write-side code table, pointing at
`public.users(user_id)` versus `auth.users`: those two carry **disjoint** id
sets, an actor FK aimed at the wrong one fails on every write, and CI cannot
catch it because a fresh database has no rows to violate.

The sweep found a **fourth** phantom read in the same file, which is also fixed
here: the weekly report selected `procurement_conversations.message_body` and
`subject`. The table has neither — it has `message_text` (NOT NULL) and keeps the
subject inside the `email_headers` jsonb. **This is the read half of the pair
[[0065]] repaired on the write side**, left behind at the time; so every weekly
report has been summarising an empty conversation list. `message_body` is dropped
rather than renamed, because nothing downstream ever read it; `subject` now comes
from `email_headers`.

## Verification

A test that could not fail is not evidence, so the spec was written and run against
the **untouched** tree first. `git stash` was not used at any point (it is
repo-global across worktrees); the one revert-in-place check restored the file by
`git checkout HEAD -- <path>` and copied the working version back, and
`git stash list` was compared before and after to prove the stack was untouched.

`apps/api-gateway/src/communications/scheduled-reads-are-not-silent.spec.ts` parses
`supabase/migrations/` as its oracle — a test checking the code against column names
typed into the test is a test that agrees with its author — and refuses to be
vacuous: no migrations, no declared columns, or fewer than `MIN_READ_SITES = 6`
read sites all fail.

| Run | Tree | Result |
|---|---|---|
| 1 | untouched `origin/main` (`e3acc79a`) | **4 of 5 failed.** Columns: `payment_due_date` at `:609`, `message_body` and `subject` at `:1209`. Reads: all seven sites. Writes: all six sites. Non-vacuity check passed, correctly. |
| 1b | the read-fix commit (`baa450a2`), writes not yet fixed | **exactly 1 of 5 failed** — the write test, naming `:787 :795 :846 :881 :889 :1374`. A second baseline, because a test that only fails on a tree where *everything* is broken has not shown it discriminates. |
| 2 | this branch | 5 of 5 pass |
| 3 | this branch, whole api-gateway suite | **1658 passed**, 133/135 suites (2 skipped, pre-existing) |
| 4 | this branch, `tsc --noEmit` | clean |
| 5 | this branch, eslint on the four changed files | 0 errors; one `'month' is unused` warning **proved pre-existing** by reverting the file to `HEAD` and re-linting (`:949` there, `:920` here) |

`scheduled-db.spec.ts` adds 12 unit tests on the pure module, including the one
assertion the whole ADR reduces to: an empty result and a failed result must not be
the same value.

**The spec caught itself twice, which is why it is worth trusting.** Its first
draft matched against the raw file, so the tombstone comment naming
`payment_due_date` failed the deletion test, and a comment containing the word
"error" *passed* a write site that handled nothing. Both are the same fault the
ADR is about — a check satisfied by prose rather than by the thing it claims to
measure. It now runs against a comment-blanked copy that preserves newlines, so
line numbers still match the real file.

## Guard interaction — three entries to retire, not one

[[0074]] (`scripts/check_read_columns_exist.py`, on `claude/busy-boyd-cf57be`, not
yet pushed) carries a `KNOWN_BAD_READ_COLUMNS` ratchet that is shrink-only **in both
directions**: an entry nothing reads any more fails the build exactly like a new
violation. Run against this branch, it names three:

```
KNOWN_BAD_READ_COLUMNS lists procurement_orders.payment_due_date, but nothing
  under apps/api-gateway/src reads it any more. Delete the entry.
KNOWN_BAD_READ_COLUMNS lists procurement_conversations.message_body, ... Delete.
KNOWN_BAD_READ_COLUMNS lists procurement_conversations.subject, ... Delete.
```

The peer session's own hand-off predicted one. It is three, because the
`procurement_conversations` pair went with the same sweep. **All three entries must
be deleted when the two changes meet**, in whichever order they land. They are not
edited here: the guard file belongs to that branch and is not in this tree. Its
`CLAIMS.jsonl` entry asserts `<= 17` and this takes it to 13, which passes by
construction.

Independently, that guard reports two findings this branch does not touch and does
not own: `procurement.service.ts:1102` and `:2006` both select
`calendar_events.tags`, which no migration declares.

## Consequences

**What becomes easier.** The file can no longer lose a job silently. Any read that
fails now names itself, its table, and the reason, at ERROR — which is the signal
that was missing every time one of the previous two died. The failed-vs-empty
decision is a pure function with no DI, so it is directly testable.

**What is given up.** There is no payment reminder. That is not a regression: there
has never been one. Three planning documents assert or imply otherwise and are
corrected in this change — `06-pages/notifications.md:166` (eight crons, one of them
this), `foundation/EXTERNAL_CONNECTIONS.md:94`, and
`01-org/commercial/finance-pricing/finance-pricing-agenda-full.md:100`, which
states `payment_due_date` "drives a live daily cron, per tenant". That last one is
the register-rot this repo's §5b was written about: a true-sounding sentence, cited
to a line number, checked exactly once — on the day it was written.

**What this change does NOT cover, stated plainly.**
- `notifications` is **not** in `check_orders_column_writes.py`'s table registry,
  so nothing mechanically checks that these insert payloads name real columns.
  They were checked by hand against `supabase/migrations/` here and all 15 keys
  are real, but registering the table is a separate change with its own measured
  floors and debt decision.
- `delivery.wine_name` in the delivery-ETA job is a phantom property read off a
  `select("*")`, so it degrades to `|| "Wine"` rather than killing the query. Left
  as-is: repointing it means adding an `inventory:inventory_id(wine_name)` embed,
  which changes that job's query shape and belongs with whoever owns that job.
- The shape test cannot catch **conflation** — `if (error || !rows || !rows.length)`
  reads the error and then throws the distinction away. The
  `procurement_conversations` site did exactly that and was fixed by hand here; a
  future one would not be caught by this spec.

**What must be true before an accounts-payable reminder can exist** — none of it is
true today, and this list is the point of writing the ADR rather than deleting the
job quietly:

1. **A payment obligation has to be a record.** Today an invoice is a
   `procurement_documents` row with a `total` and a `doc_date` and no notion of
   being owed or settled.
2. **A due date has to be derived and stored, not guessed at read time.** It is a
   computed field, and per `INVOICE_DOC_UX_RESEARCH.md:309` its rule varies by state
   and product category. `providers.payment_terms` is free text and is an input to
   that computation, not the answer to it.
3. **Paid state has to exist**, or a reminder is a nag.
4. **A surface has to consume it.** `/orders?status=invoiced` was never real; AP
   would need its own view, or a tab on `/receipts` beside credits.
5. **The recipient question from [[0022]] / OD-87 still applies.** 6 of 10
   production restaurants are owner-only and `RecipientRole` has no `"owner"`, so a
   manager-addressed AP mail reaches nobody at those tenants.

**What would trigger revisiting this.** An accounts-payable milestone. At that
point the honest starting point is this ADR plus the surviving template, and the
first thing to delete is the fourth test in
`scheduled-reads-are-not-silent.spec.ts`.
