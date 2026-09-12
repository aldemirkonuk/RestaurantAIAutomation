# 0086 — A count confesses what it could not count, and a sum without a unit is not a figure

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** sorting office, documents-reports, timeline, failed sources, absence as health, windowed count, floor, composite figure, double count, currency, unit, unreachable branch, pagination
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0016-ledgers-must-express-unknown]], [[0020-no-fabricated-answers]], [[0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero]], [[0062-a-quantity-declares-its-unit]], `.planning/06-pages/documents-reports.md`, `scripts/check_windowed_figures.py`

## Context

`/documents-reports` — the Sorting Office, Direction D, built 2026-08-31 — is a
page whose entire subject is counts. Six defects were found in it and in the two
gateway services behind it, and five of the six are the same fault: **a number
that cannot say what it does not know.**

- `logs-timeline.service.ts` caught each of its six sources to `[]` and returned
  200 (`:112,149,192,231,271,308` pre-fix). A source that 500s contributed zero
  events, the request *succeeded*, the page's `settledError` stayed false, and
  the failure rendered as **a smaller number with no banner**. This is the
  `absence-reported-as-health` fault in its purest form: the only party that
  knew a register was missing was the server log.
- The same file's merge sorted with `b.occurredAt.localeCompare(a.occurredAt)`
  **outside every try/catch** (`:72` pre-fix). `procurement_documents.created_at`
  and `system_audit_log.created_at` are both nullable in the baseline
  (`20260805000000_baseline_from_production.sql:4461` and `:5567` — each
  `DEFAULT now()` with no `NOT NULL`), so one explicit NULL threw a
  `TypeError` past all six per-source guards and 500ed the whole feed.
- `DocumentsReportsNext.tsx:733` rendered `{data.todayRoutine.count} entries`
  with no `≥`, from a 100-row window — twelve lines below the page's own
  sentence promising that a filled window renders as a floor. The four drawers
  and the header all carried the mark; this one strip was missed by review.
- `DocumentsReportsNext.tsx:436-449` summed house reports + vendor paper +
  conversation threads + timeline events into one "In the registers" figure.
  `procurement_documents` is one of the timeline's six sources, so every vendor
  document in the recent window was counted **twice**, and each re-file inflated
  it again through `system_audit_log`.
- `useSortingOfficeData.ts:138` printed a tie-out gap with a hardcoded `$` while
  `procurement_documents.currency` has existed since the baseline
  (`:4442`, `varchar(3)` defaulted to `'USD'`), returned by the list endpoint's
  `select("*")` and simply absent from the client type.
- And `reports.service.ts:76-81` read `generated_reports` with **no `.limit()`
  at all**, so every caller downloaded the whole table to render twenty rows.

One defect is not of that family and is recorded separately below: two branches
in the reading pane that production cannot reach.

## Options considered

**For the timeline seam:**

1. **Let a failing source 500 the request.** Honest, and wrong: one dead source
   would take the other five down, and the page would show nothing rather than
   most of the truth.
2. **Keep catching to `[]`, and log.** What it did. The log is for us; the
   caller is the one rendering the number.
3. **Return the events *and* the sources that failed, and let the page raise its
   existing banner.** Chosen.

**For the "In the registers" composite:**

1. **Subtract the overlap.** De-duplicate `procurement_documents` out of the
   timeline slice before summing. Costs a join the page does not have, and
   leaves the deeper problem untouched.
2. **Keep it, redefined as something real** — e.g. "documents on file". Would
   need a unit the four addends do not share.
3. **Delete it.** Chosen.

**For the unreachable reading-pane branches:**

1. **Keep both, with a comment.** Defends a `NOT NULL` column.
2. **Delete the client-side pre-check; render the server's nullable answer as
   the unknown.** Chosen.

## Decision

**A count says what it could not count; a figure without a unit is not
published; and a defence of a state the schema forbids is not a test.**

Concretely, and each with the reasoning that carried it:

1. **`GET /logs/timeline/:restaurantId` returns `events`, `sourcesQueried` and
   `failedSources`.** The page treats a non-empty `failedSources` as a failed
   register — labelled by the sources that broke, raising the banner that
   already exists and is already branch-aware — and marks every count derived
   from that window as a floor, because a source that contributed nothing makes
   the count an undercount. `sourcesQueried` is reported too, so the deliberate
   omission (`event_store` is not restaurant-scoped and is read only when a
   `correlation_id` names the rows) is *stated* rather than inferred from a
   short list. That is the specific lesson of the
   `absence-reported-as-health` memory: a system reporting on itself must be
   forced to prove presence, not merely fail to report absence.

2. **The merge comparator is null-safe and undated rows sort last.** An event
   with no timestamp is not dropped (that would decide it did not happen) and
   not floated to the top (that would claim it is the most recent thing that
   did). `TimelineEvent.occurredAt` is now `string | null` and says so.

3. **The routine strip carries the floor mark, on a condition the four drawers
   do not use.** `capped = windowFull && the oldest event still in the window is
   itself from today`. The drawers count the window itself, so a full window
   means rows were cut and their count is a floor. This strip counts a *subset*
   of the window — today's slice of a newest-first feed — and the feed is cut
   from the **old** end. If the oldest surviving event predates today, the cut
   happened entirely before midnight and every one of today's entries survived
   it: the count is **exact** even though the window is full. Only when the
   oldest survivor is itself from today can today's entries have been truncated.
   Marking on `windowFull` alone would print `≥` over a figure we know exactly,
   which is its own small dishonesty.

4. **"In the registers" is deleted.** Not de-duplicated: fixing the double count
   would have left a number that still adds a report, an invoice, a thread and
   an audit line and calls the result a quantity. It has no unit, so it cannot
   be right or wrong about anything, and a figure that cannot be wrong is not a
   measurement — it is decoration with a monospace font. The header keeps
   "Needs a human", which counts one kind of thing (rows awaiting a person), and
   the four drawers below each carry their own count with their own floor
   semantics. This is the founder-facing loss in the change and it is
   deliberate: the page shows one fewer big number and every number it shows
   means something.

5. **Money declares its currency.** `fmtMoney(amount, currency)` uses
   `Intl.NumberFormat` with the document's own ISO code; a row that records no
   currency prints the digits and says the unit is missing rather than borrowing
   one (ADR 0062). `currency` was added to the web `ProcurementDocument` type;
   the endpoint already returned it.

6. **`GET /reports` is bounded (default 100, max 200, `offset` supported).**
   `count: "exact"` counts the whole filtered set rather than the page, so the
   drawer's figure stays the **exact** total and never degrades into a page
   length — the mistake ADR 0051 clause 2 exists to stop.

7. **The reading pane's `hasPeriod` pre-check and its two unreachable branches
   are deleted, along with the test that pinned them.**
   `generated_reports.report_period_start` and `report_period_end` are
   `date NOT NULL` (baseline `:3078-3079`), so `hasPeriod` was true for every
   row the table can hold: the `enabled` gate never gated and the "names no
   period" prose could never render. A test asserting a state production cannot
   produce is worse than no test — it makes the suite look like it covers
   ground it has never walked. What replaces it is not a defence but the
   ordinary honesty rule: the server's `paper`/`conversations` are declared
   nullable in the DTO, and a null register renders as `—`, never as `0`
   (`conversations?.count ?? 0` was printing an unknown as a measured zero one
   line below the paper side that got it right).

8. **The pane's failure sentence is gated on the same `settledError` as the page
   banner.** Measured rather than assumed: on `@tanstack/react-query` 5.90.16 a
   refetch after an error resets `status` to `pending`, so `isError && isFetching`
   **does not arise today** and the reported "flashes mid-retry" symptom does not
   reproduce. This change is therefore a consistency fix, not a bug fix — the
   value is that one screen stops holding two different definitions of "failed",
   so a version bump or a `placeholderData` option cannot reintroduce the flash
   on one branch only. Recorded as measured, because reporting it as a fixed bug
   would be a claim the evidence does not support.

9. **`scripts/check_windowed_figures.py` gains `/documents-reports` as a fourth
   `PAGES` entry**, not a second script. (Written as "third"; `/communications`
   landed on `main` and merged in before this branch did, so the ordinal moved
   under it — measured against the merged file, which carries `/receiving`,
   `/receipts`, `/communications` and `/documents-reports`.) The page declares `SO_SERVER_WINDOWS`
   (PAPER / TIMELINE / REPORTS, each citing the gateway query that imposes it),
   exports a `SortingOfficeData` interface whose eight unknown-capable fields
   must keep their `| null`, and uses a named `GE` export so a deleted `≥` is
   visible to the guard.

## Consequences

- **Easier:** a failed log source is now a sentence on the page instead of a
  quieter number; the report list stops shipping an unbounded table; a
  euro-denominated invoice stops reading as dollars.
- **Harder / given up:** the page shows one fewer headline figure, on purpose.
  A caller of `GET /reports` that assumed the whole table now gets 100 rows
  unless it asks for more — `total` still tells it what it is not seeing.
- **What this guard does NOT hold, stated plainly:** the windowed-figures guard
  would **not** have caught the defect that motivated adding this page to it.
  A missing `≥` on one figure, in a file that carries `≥` on four others, is
  invisible to a rule that can only ask whether a floor marker exists somewhere
  in a renderer. The guard's own header already says it cannot prove the `≥`
  sits on the right figure; that limit is real and this page is an instance of
  it. What the entry does hold is the surrounding contract — cap drift against
  three cited gateway files, an unconsumed window, a lost `| null`, an
  untenanted query key, a discarded cardinality — proven to fire on each, on
  the real files.
- **~~Known gap, named~~ — CLOSED on this branch.** The gap was
  `apps/web/src/pages/LogsTimelinePage.tsx`: it read the same endpoint through
  its own local `TimelineEvent` type, rendered
  `new Date(e.occurredAt).toLocaleString()`, and read neither new field — so a
  dead log source stayed a quieter number there, and an undated row would have
  rendered "Invalid Date" where it previously got a 500. The file was owned by
  another lane during the seam fix and left alone deliberately. It has now been
  brought onto this branch (`fix(logs): the timeline names the register it
  could not read`): the type is widened, a null or unparseable `occurredAt`
  renders `—`, `failedSources` raises a banner naming the registers in words,
  and a failed or unqueried source's chip shows `—` rather than a fabricated
  `0`. Two things about that edit are worth recording here, because neither is
  obvious from clause 1:
    - **The two fields are typed OPTIONAL on the page**, matching
      `useSortingOfficeData.ts:83-84`. Not defensiveness for its own sake: the
      SPA and the gateway deploy separately, so a new page will meet an old
      gateway during any rolling deploy, and `failedSources ?? []` there would
      turn "the gateway did not say" into "nothing failed" — this ADR's own
      fault, one layer up. Absent is unknown; the page falls silent instead.
    - **One list drives the chip row and the register tally**, built as the
      union of the page's mirrored source list and `sourcesQueried`. The page
      restates these types rather than importing them (the web app has no
      import path into `apps/api-gateway`), so the gateway can grow a seventh
      source this file has never heard of. **The first version of this fix used
      the union for the denominator only, and an adversarial audit killed it:**
      it stopped the impossible "Read 7 of 6" and bought two new lies in its
      place — a tally counting seven registers over a chip row showing six, and
      an event badge that rendered **completely empty**, because
      `SOURCE_LABEL[unknown]` is `undefined`. An unknown printed as nothing is
      this ADR's own fault one field further down, introduced by the change
      meant to close it. Now every label, colour and long-name lookup falls
      back to the raw source key — ugly on purpose, never blank — and the two
      counts come from the same array, so they cannot disagree.
      `.planning/06-pages/logs.md` §8 records the mirror and §13 asks for it to
      be shared.
  `LogsTimelinePage.test.tsx` pins all of it — five of its six cases fail
  against the pre-fix page, and the sixth passes on both by design because it
  pins what the page must **not** start claiming.
- **Still open on /logs, named rather than fixed:** the feed is capped at 100
  with no floor marker anywhere on the page, and `/logs` is not a `PAGES` entry
  in `scripts/check_windowed_figures.py` — so the new "every count below is a
  floor" sentence, the `| null` on `occurredAt`, and the optionality of
  `failedSources` rest on that one test file. Recorded as `logs.md` §9 and
  roadmap item 2, not carried by this branch. The `PAGES` half is filed as an
  **executable** claim rather than prose (`CLAIMS.jsonl`, `ADR-0086`,
  `status: open`), because a "named, not fixed" bullet is a dated claim about a
  moving tree and rots faster than anything else in an ADR — twice today a gap
  named in an ADR was closed by another session before its own PR merged. The
  claim inverts that: the day someone registers `/logs`, an open claim starts
  holding, the guard goes red, and the bullet must be struck in that same
  change. The floor-marker half gets **no** claim, deliberately: its closing has
  no signature unique to it (`grep '≥'` would fire on any `≥` added anywhere for
  any figure), and a check whose green means something other than what the
  bullet says is worse than prose. It is also subsumed — registering the page
  requires declaring `floor_markers` on the `PageSpec`, so closing the first
  half makes the guard enforce the second.
- **Revisit when:** a caller needs more than the first page of reports (the
  `offset` is there and unused), or when `event_store` becomes
  restaurant-scoped and `sourcesQueried` stops having a skip to report.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created; six defects fixed, one recorded as not-reproducible, guard extended to a fourth page |
| 2026-09-02 | — | `/logs` brought onto the branch: the named gap in Consequences is closed, and the page's own window gap is filed in its place — as an executable `CLAIMS.jsonl` entry, not prose |
| 2026-09-02 | Sonnet (adversarial) | Audited the `/logs` close-out: found that the union-denominator fix had itself introduced a blank source badge and a tally the chip row contradicted, plus two stale citations. All fixed; verdict safe to merge |
