---
type: page
route: /logs
slug: logs
softwares: [reports-analytics]
component: apps/web/src/pages/LogsTimelinePage.tsx # legacy; `next` is apps/web/src/pages/logs/next/LogsNext.tsx behind `mudavym_design_logs`
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-12
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]", "[[0086-a-count-confesses-what-it-could-not-count]]", "[[0112-one-modal-policy-three-shapes-one-primitive]]", "[[0133-the-public-door-has-one-switch]]"]
---

# /logs

> **Part of** [[08-softwares/reports-analytics|Reports & Analytics]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

**Legacy face** (flag off) — (no outbound navigation — dead-end page).

**`next` face** (flag on), computed per row from its register
(`pages/logs/next/lg-format.ts:294-316`):

- "Open the document" → `/documents/:id` · "Open in receipts" → `/receipts?doc=:id` (whichever face of that page is on)
- "Open the stock ledger" → `/inventory`
- "Open the till log" → `/simpos/:restaurantId/orders` (development builds only; in production the row says so in words)
- "Open the orders" → `/orders` · "Open the reports" → `/documents-reports` · "Open the features" → `/settings?tab=features` · "Open the team" → `/team` (audit rows, by `entityType`)
- A register with no page of its own renders a sentence saying so — never a dead control

## Correlation ownership correction — 2026-09-13

The gateway now scopes event_store rows by the production writer's
`payload.restaurant_id` as well as correlation_id, before applying the page window.
A correlation id alone is not an ownership key; shared and foreign correlations
must never return another house's event metadata. Unattributed historical rows
are withheld rather than guessed. The service tests cover shared/foreign ids,
unattributed rows, and pagination after the tenant predicate.

## 1. Purpose
Read-only correlated timeline for the active restaurant across six sources: POS checks, agent decisions, stock movements, procurement documents, audit log, and (when filtered) the event store (`LogsTimelinePage.tsx:1-35,45-51`). Filter by correlation id via `?correlationId=` or the search box; clicking any event's correlation id pivots the whole timeline onto that thread (`LogsTimelinePage.tsx:363-376`). This is the "show your working" surface for anything an agent did to inventory.

## 1a. Features

Two faces, one route, one flag (`mudavym_design_logs`, OFF by default —
`App.tsx:386`). The legacy face is `LogsTimelinePage.tsx`; everything marked
**(next)** is the rebuilt `pages/logs/next/` and exists only behind the flag.

- Read-only correlated timeline across six registers: POS checks, agent decisions, stock movements, procurement documents, audit log, event store
- Search or deep-link by correlation id (`?correlationId=`) — the URL is the only source of truth for thread state, so a thread is shareable and survives a refresh
- Click any event's correlation id to pivot the whole timeline onto that thread
- Names, in words, any source the gateway could not read — and shows `—` rather than a count for it (ADR 0086)
- States which registers were read at all, so a deliberate skip (`event_store` without a correlation id) is stated rather than inferred
- Renders an undated event as "not recorded", never as "Invalid Date"
- **(next)** The window is marked and walked: `LOGS_SERVER_WINDOWS.TIMELINE` cites the clamp that imposes it, every count carries `≥` while rows remain beyond it, and "Read older entries" walks the gateway's exact `hasMore`/`nextCursor` a page at a time. A page that cannot advance says so rather than looping
- **(next)** The timeline has a way out: a row's register decides where it leads (document, receipts, stock ledger, till log, orders, reports, features, team); a register with no page of its own says so in a sentence, never as a dead control
- **(next)** A thread reads like a ledger page — oldest first, numbered, ruled off under a double rule, with its span and register count stated
- **(next)** An entry opens in a Sheet (ADR 0112, 440) carrying its facts and its raw payload, with **Earlier / Later** stepping that never leaves the sheet and says in words when it has reached the end of the page
- **(next)** Without the mouse: `j`/`k` walk the entries (and the open sheet), `Enter` opens one, `f` follows its thread, `/` jumps to the correlation box, `Esc` backs out one step at a time. The key map is printed on the page
- **(next)** A failure is struck, not dimmed: the band that names an unreadable register precedes the strip it explains, the failed cells carry the same double rule, and the register tally names them by name
- **(next)** A register still being asked draws a waiting bar, never the em dash — the dash is kept for "asked, and there is no answer"
- **(next)** Sticky day headings, so a timestamp forty rows down still has a date
- 🚧 The register choice is a sieve over the loaded page, not a scoped read — see §9

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_logs`)

> **Chrome (2026-09-06).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree. Chrome is excluded from §Surface by
> PAGE-CONTRACT, so it is named here and nowhere else in this note; its motions
> live in `components/mudavym/MOTIONS.md`, not the table below.

| id | token | curve / ms | when it fires |
|---|---|---|---|
| `lg-arrive` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the opening, on mount, once — opacity + 6px rise |
| `lg-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the ledger, when a thread is entered or left — **on the frame the new reading lands**, not on the frame the URL changed |
| `lg-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states, and the keyboard cursor's rule and ground as the reader walks |
| `lg-tally` | `tally` | sampled overdamped spring (120/26) · 840ms | the register counts, counting to each new figure as pages are read |
| entry sheet | `tuck` | sampled spring (380/32) · 300ms | the primitive's own enter motion; this page adds nothing to it, and stepping inside the sheet never re-runs it |

**No wax.** No `pour`, no `stamp`: the page writes nothing, and a read is not a
commitment. Eight deliberate non-motions — including why an unknown never
animates, why the cursor does not slide, and why the sticky day heading does not
cross-fade — are argued in `apps/web/src/pages/logs/next/MOTIONS.md`, which is
canonical; this table is its mirror.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/logs`** — One overlay, built. The thread is NOT an overlay and never was — following a correlation id turns the page itself, through `?correlationId=`, so it is shareable and survives a refresh.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/logs` | The entry | sheet | Built | One row of the ledger is one object, and its payload is arbitrary JSON that needs a scroll of its own. The list stays readable beneath. | `pages/logs/next/EventSheet.tsx:96` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry
Sidebar "Logs" entry (`Sidebar.tsx:136-141`) — **[PAGE_MAP](../foundation/PAGE_MAP.md) lists `/logs` as having no inbound link; that is stale**, the sidebar link exists. Deep-linkable with `?correlationId=` (the intended cross-page pivot from notifications/documents).

## 3. Files
- Route binding: `apps/web/src/App.tsx:386` — `PageGate(page="logs", legacy=LogsTimelinePage, next=LogsNext)` (lazy, `App.tsx:118-119`)
- **`next` face** (behind `mudavym_design_logs`):
  - `apps/web/src/pages/logs/next/LogsNext.tsx` — the page, its one stylesheet, the register strip, the row, the window foot, the key map
  - `apps/web/src/pages/logs/next/EventSheet.tsx` — the one overlay (Sheet 440, ADR 0112), with Earlier/Later stepping
  - `apps/web/src/pages/logs/next/useLogsNextData.ts` — the walked read: `LOGS_SERVER_WINDOWS`, the three states, the de-duplicating cursor walk, the stall
  - `apps/web/src/pages/logs/next/lg-format.ts` — the pure vocabulary: `EM`, `GE`, the register names, the time words, the way out
  - `apps/web/src/pages/logs/next/MOTIONS.md` — canonical motions; §1b mirrors it
  - tests: `LogsNext.test.tsx` (37), `useLogsNextData.test.tsx` (8), `lg-format.test.ts` (12) — **57**
  - guard: registered as `/logs` in `scripts/check_windowed_figures.py` (§9)
- **Legacy face:** `apps/web/src/pages/LogsTimelinePage.tsx` (390 lines, self-contained)
- `apps/web/src/pages/LogsTimelinePage.test.tsx` — the honesty contracts of
  §10: a failed source is named and shows `—`, a skipped source says so, an
  undated row renders `—`, a source this file has not mirrored still shows a
  label and is counted by the same list the chips come from, and a gateway that
  reports neither field makes the page claim nothing. Six of the seven fail
  against their own pre-fix page; the seventh passes on both by design, because
  it pins what the page must *not* start saying

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | `LogsTimelinePage.tsx:144-145` (legacy) | ENDPOINTS.md:276 |
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100&before=<cursor>` | `useLogsNextData.ts` (`next`) — one request per page walked; the answer carries `window`, `hasMore` and `nextCursor` (`logs-timeline.service.ts:141-143`) | ENDPOINTS.md:276 |

The endpoint takes **no source parameter** (`logs.controller.ts:63-65`). That is
why the register strip is a sieve and not a scope — §9.

## 5. Signals
**none.** (The page *reads* signals; it emits none of its own.)

## 6. Tier cut
Core observability over S04 (POS → inventory depletion) and S09 (webhook drops/desyncs) — it is the page where a desync is *seen*. Also the WineOps-side counterpart of the SimPOS order log (`SimposOrderLogPage.tsx:2-3` names the distinction).

## 7. Rebrand surface
**0** user-visible WineOps strings.

## 8. State & config
- Requires `activeRestaurantId` from auth context — query disabled without it (`LogsTimelinePage.tsx:159`).
- `limit` hard-coded to 100 (`LogsTimelinePage.tsx:145`); no pagination.
- `TimelineEvent` / `TimelineResponse` are **restated** on the page
  (`LogsTimelinePage.tsx:45-72`), not imported: the web app has no import path
  into the gateway. They mirror
  `apps/api-gateway/src/logs/logs-timeline.service.ts` and have to be kept in
  step by hand — the only thing that notices drift today is
  `LogsTimelinePage.test.tsx`.
- Drift is made **visible rather than silent**: a source the gateway names and
  this file has not mirrored gets a chip, a count and an event badge carrying
  its raw key (`:112-127`), because a label lookup that returns `undefined`
  renders an **empty badge** — an unknown printed as nothing, one field below
  the fault this page exists to fix. The chip row and the register tally are
  driven by the same `displaySources` list (`:190-193,288,322`), so they cannot
  disagree about how many registers there are.

## 9. Gaps

- ~~No pagination/infinite scroll — the 101st event is invisible, and nothing on
  the page says the feed is a window.~~ **Closed on the `next` face** (2026-09-06):
  the gateway measures `hasMore` exactly by reading one row past the window
  (`logs-timeline.service.ts:111-112,132`), hands over a `nextCursor`, and the
  page walks it. Still open on the legacy face, which is what a house with the
  flag off sees.
- ~~No links *from* events to their subject pages~~ **Closed on the `next` face**
  (`lg-format.ts:294-316`). Still open on the legacy face.
- ~~`/logs` is **not** a `PAGES` entry in `scripts/check_windowed_figures.py`~~
  **Closed 2026-09-12.** It is registered, with the fixtures the guard's own
  docstring demands rather than as a drive-by: a `PageSpec` naming both
  renderers, `CLEAN_LOGS_HOOKS` / `CLEAN_LOGS_RENDERER` / `CLEAN_LOGS_SHEET`
  plus their `_scaffold` writes, and **eighteen** self-test cases — two W1, two
  W2, three W3, three W4, one W5, two W6 and five `cannot-check` anchors. The
  `ADR-0086` entry in `CLAIMS.jsonl` is `resolved`, and its verify now runs
  `--self-test` as well as grepping `name="/logs"`, so both halves of the claim
  — "the page is in scope" **and** "the guard can still fail" — are executable.
  **/logs is the first page here whose cache is a `useInfiniteQuery`**, and the
  guard's own anti-vacuity branch tested `"useQuery"` as a *substring* until
  2026-09-12 — which never occurs inside `"useInfiniteQuery"`, so that branch
  was structurally dead on this page. It is matched as an identifier now, and a
  case proves it fires.
  **What this does and does not hold, precisely:** the declared cap still
  matches the clamp that imposes it; the register is consumed and its renderers
  carry `GE`; no measured zero is folded into an unknown, on the page *or* on
  the sheet; the seven unknown-capable fields on `LogsNextData` and
  `FailureVM.status` keep their `| null`; and the query key names the tenant.
  It does **not** trace a `.limit()` to a JSX node — undecidable — and W7
  evaluates **zero** hooks here because the page declares none, which the guard
  prints on every clean run rather than folding into the tick.
- **The register choice is a sieve, not a scope.** Choosing a register filters
  the rows already loaded (`LogsNext.tsx`, `visible`); the gateway takes no
  source parameter at all (`logs.controller.ts:63-65`) and merges every register
  *before* it slices the window (`logs-timeline.service.ts:131,133`). So a busy
  till can crowd the agents off the page entirely, and "read older entries"
  fetches 100 more *mixed* rows to maybe surface two more. The page now says
  this in the empty state rather than printing "nothing from the agents" over a
  crowding-out — but the honest fix is a scoped read plus multi-select, which is
  a gateway change and a decision, not a polish. **Open.**
- **Nothing in the product produces a `?correlationId=` link.** Measured
  2026-09-12: zero producers outside `pages/logs/**`; the only two inbound links
  are bare `to="/logs"` (`DocumentsReportsNext.tsx:716,765`). §12's design
  intent is "reachable in one click from the thing that surprised you", and the
  one act this surface has that nothing else does is inbound-dead. Roadmap 4.
- **No entry is addressable and nothing is copyable.** Reading an audit log
  means quoting it; there is no `?entry=`, no permalink and no copy control for
  an id. Deliberately left: `?entry=` would be a second URL parameter beside
  `?correlationId=`, and one that names a row outside the loaded window has to
  say so in words rather than open an empty sheet — worth doing, worth doing
  properly.
- **Mobile chrome is heavy.** At 390px roughly 690px of header, lede, register
  strip and search sits above the first entry. The strip alone is ~370px at
  2-up and is least useful at that width. Not changed in the 2026-09-12 pass:
  cutting it means cutting the page's voice or collapsing the strip, both of
  which are the founder's call.

**Closed on `main`** (ADR 0086, `LogsTimelinePage.test.tsx`): a whole-request
failure no longer renders as "No events", an undated row renders `—` instead of
"Invalid Date", and a failed source is named rather than counted as zero. All
three merged in **PR #262** (`4d0f6c50`, 2026-09-02) alongside the gateway
change that makes the third reportable. PR #253 carried this work first and was
**closed unmerged**; #262 rebased and carried it, so a reference to #253
anywhere is a reference to a branch that will never land.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Stock register reads 56 against 55 `wine_consumption_log` rows — one row unexplained, not chased.

## 10. Maturity

### The Mudavym rebuild, and the 2026-09-12 pass

**Built** on `feat/mudavym-new-pages` (ADR 0133's new-pages wave), behind
`mudavym_design_logs`, OFF by default: `pages/logs/next/` — `LogsNext.tsx`,
`EventSheet.tsx`, `useLogsNextData.ts`, `lg-format.ts`, `MOTIONS.md` — wired at
`App.tsx:386` through `PageGate`. The founder's verdict on the makeover was
KEEP. The legacy face is untouched and is what a house with the flag off sees.

**The 2026-09-12 pass** took it from functionally correct to the house bar. It
registered the page in `check_windowed_figures.py` (§9), and it fixed five
things that were wrong rather than merely absent — each is a defect, and each is
named here because a pass that only lists its additions is reporting absence as
health:

| Was | Now | Why it mattered |
|---|---|---|
| `.lg-row` declared **three** grid tracks below 720px and rendered **four** children | an explicit `.lg-tail` cell spanning `1 / -1` under 720px | grid auto-placement put the way-out control (`Open the stock ledger`, `no page of its own`) in an implicit row **at column 1** — a 74px `nowrap` track — so on every phone it rendered underneath the timestamp, detached from the summary it belonged to |
| `lg-turn` depended on `correlationId` alone | gated on the read being `ready`, with a `turned` ref | the page's one signature motion animated the **loading skeleton**; the thread it was written for arrived with no motion at all. `MOTIONS.md` described a behaviour the page did not have |
| the register tally read "Read 4 of 6 registers" and named nobody | it names the failed registers and the skipped ones separately | a **failed** register is in `sourcesQueried` — it *was* asked — so it never appeared in the `skipped` set the line was built from. The count fell silently; only the banner said who |
| `--ink-3` on the mono eyebrows and the sheet's field labels | `--ink-4` everywhere, with all four grounds re-measured in the header | `#7C7365` on `#FAF7F1` is **4.37:1**, under the 4.5:1 floor, and the large-text exemption starts at 18.66px bold, not 9.5px. The file's own header asserted it "was measured to hold" — a false measurement, which is the shape this page exists to refuse. **The same comment's second number was also wrong** and the first pass carried it forward unchecked: `--ink-4` on charcoal is **7.36:1**, not the 7.46:1 it claimed. Caught by the Sonnet audit, which re-derived every figure rather than reading them |
| every register cell drew the em dash while the first page was in flight | a static `lg-figure--wait` bar | `MOTIONS.md` has always said a skeleton and a dash "are never the same element". For the whole of the load they were, and the dash meant "asking" — one field away from the fault ADR 0086 closed. The test that asserted the old behaviour is inverted, not deleted |

**Raised, not merely fixed:** the row lost its second line (the correlation id
had its own, where a 36-character identifier was wider and more chromatic than
the sentence above it — it now shares the tail with the way-out, ellipsised by
the box, whole on `title`, whole in the sheet), day headings stick, a failure is
struck rather than dimmed and precedes the strip it explains, the sheet steps
Earlier/Later without closing and says in words where the page ends, and the
page gained the house key map (`j`/`k`/`Enter`/`f`/`/`/`Esc`) modelled on
`NotificationsNext.tsx:283-356` with its typing and modifier guards. Tests:
**57** in `pages/logs/next` (38 before). Four of the new ones pin `lg-turn`'s
sequencing by spying `animate` and asserting which token fired on which render;
two of those four were run against the pre-fix effect and **fail** there, so
they are measurements rather than decoration.

**Considered and rejected in that pass, with reasons**, so they are not
re-proposed as oversights:

- **`placeholderData: keepPreviousData` on the pivot**, to make a thread read as
  a lens rather than a page load. Rejected: with the previous key's rows on
  screen under a *new* thread heading, the strip's counts and the window
  sentence would describe the old scope. A stale count under a new heading is
  precisely ADR 0086's fault. Making it safe means gating the strip, the foot
  and the heading on `isPlaceholderData` — at which point the figures are dashes
  anyway and only the rows survive. Worth doing as a shaped change, not as
  polish; the `lg-turn` fix takes most of the perceived win.
- **Truncating the correlation id to eight characters.** Rejected as the
  founder's call, not a builder's: the conservative form (full value, ellipsised
  by a CSS box that already did so at `lg-format`'s own `text-overflow`) gets the
  density without a page whose ethos is "print what you know" abbreviating an
  identifier.
- **Number keys for the registers, and a free-text filter over summaries.** The
  first is gold-plating; the second is genuinely useful but would inherit the
  sieve-not-scope overclaim in §9 unless labelled as page-scoped, and belongs
  with the gateway change rather than ahead of it.

> **On `main` since `4d0f6c50` (PR #262, 2026-09-02)** — the ADR 0086 half. Both halves — ADR 0086's
> `sourcesQueried` / `failedSources` on the endpoint
> (`logs-timeline.service.ts:66-69,123-128`) and this page reading them
> (`LogsTimelinePage.tsx:172-201`) — merged together. This section was written on
> the branch and said "nothing here is on `main` yet"; it was left saying so
> through the merge, which is the DOC-STALE shape §9's executable claim exists to
> avoid. The page is still written to survive meeting an **old** gateway — see
> the closing note of this section. That is a deploy-skew property, not a
> merge-order one, and it outlives the merge.

**partial.** Everything it renders is real, and as of 2026-09-02 the failure
modes are said in words rather than rendered as a smaller number. What remains
partial is the window: the feed is still capped at 100 with nothing on the page
admitting it.

The endpoint is genuine and JWT-guarded (`apps/api-gateway/src/logs/logs.controller.ts:21,26`)
and the service really does fan out over six tables
(`logs/logs-timeline.service.ts:103-115`). Five are restaurant-scoped; the sixth,
`event_store`, is not restaurant-scoped at all and is therefore returned **only**
when a correlation id is supplied, with the reasoning written down
(`:109-114,323-328`) — a deliberate, correct constraint. Since ADR 0086 that skip
is reported as a skip: the slot resolves to `null` rather than to an empty result,
so `sourcesQueried` can tell "read and found nothing" from "not read".

Three things used to be absent, each rendering as silence rather than as a
message. Two are now said out loud; the third is not:

| Gap | State | Evidence |
|---|---|---|
| A per-source failure is invisible | **Fixed** (PR #262) | Every fetch now goes through one `guard()` that names the failure instead of swallowing it (`logs-timeline.service.ts:131-145`), and the response carries `sourcesQueried` / `failedSources` (`:123-128`). The page names the failed registers in a banner, renders their chips as `—` rather than a fabricated `0`, and states how many were read at all (`LogsTimelinePage.tsx:172-201,267-326`) |
| A whole-request failure is invisible | **Fixed** (PR #262) | `query.isError` is branched: a red banner says the timeline could not be read, and the feed reads "The timeline is unavailable" rather than "No events" (`LogsTimelinePage.tsx:200,253-265,334-337`). Page-side only — it needs no gateway change |
| The 101st event does not exist | **Open** | `limit: 100` hard-coded (`:145`), server caps at 200 (`logs-timeline.service.ts:99`), and the merge slices *after* concatenating every source it read (`:118-121`) — so a busy source can crowd the others out of the window entirely. Nothing on the page marks the feed as a window |

**What the fix does not do, stated plainly:** `failedSources` and
`sourcesQueried` are typed **optional** on the page (matching
`useSortingOfficeData.ts:83-84`), because a gateway that does not send them has
told it nothing — and nothing is not "all six were fine". Against such a gateway
the page renders exactly as it did before: counts, no banner, no register line.
This is not merge-order caution, which the rebase settled; it is **deploy skew**.
The SPA and the gateway ship separately, so a new page meets an old gateway during
any rolling deploy, and writing `failedSources ?? []` there would turn "the
gateway did not say" into "nothing failed" — this ADR's own fault, one layer up.
The honesty here is therefore only ever as good as the gateway behind it, and the
page is built to say so by staying quiet rather than by guessing.

The dead-end observation in §9 is confirmed: the file contains no `Link`, no
`navigate`, and `useSearchParams` is used only to set `correlationId`
(`LogsTimelinePage.tsx:152,205-206,244,370`). You can pivot within the timeline, never out of it.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the one surface that states what it did not read on the page itself ("Read 5 of 6 registers · not read: the event store"); POS 44 = `pos_checks` exactly, Agent 0 correct with the orchestrator down.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/logs/timeline/:restaurantId?correlationId=&limit=100` | JWT (class, `logs.controller.ts:21`) | `:26` → `logs-timeline.service.ts:95-129` | `{events[], correlationId, sourcesQueried[], failedSources[]}` — merged, source-tagged, newest first with undated rows last, by the `newestFirst` comparator at `:82-87` (ADR 0086) |

(That four-field response landed with PR #262; see the note at the head of §10.)

`occurredAt` is `string | null` on both sides: `procurement_documents.created_at`
and `system_audit_log.created_at` are nullable in the baseline, so an undated
event is a real row, not a bug. The gateway returns it and sorts it last; the
page renders it as `—` (`LogsTimelinePage.tsx:129-134,361`).

Note the `restaurantId` is taken from the **URL path**, not the JWT
(`LogsTimelinePage.tsx:144`, controller `:26`), unlike `/reports` and `/procurement/*`
which read it from `@CurrentUser()`. Worth a look during the tenancy pass; not
asserted as a hole here.

### Fed by

| Source | Producer | Live? |
|---|---|---|
| `pos_checks` | Toast webhook + SimPOS ingestion (memory: pos-bridge-state — bridge built and proven) | Yes, where a POS is connected |
| `decision_log` | Python agents via `BaseAgent.log_decision` (`services/agent-orchestrator/core/base_agent.py:785-787`) | Yes |
| `inventory_transactions` | `apply_stock_movement` — correlation id lives in `metadata->>'correlation_id'`, not a column (`logs-timeline.service.ts:8-11`) | Yes |
| `procurement_documents` | `@Cron("*/5 * * * *")` intake sweep (`procurement/documents/document-intake.service.ts:581`), which stamps one correlation id **per attachment** precisely so these rows are not NULL (`:626-632`) | Yes |
| `system_audit_log` | Gateway audit writes | Yes |
| `event_store` | RabbitMQ event persistence | Yes, correlation-filtered only |

This page is the only surface in the product that reads any of these six tables.
It is the payoff for the P1 correlation-id instrumentation.

### Writes

| Write | Downstream reaction |
|---|---|
| **none** — read-only by design (`LogsTimelinePage.tsx:1-3`) | — |

## 12. Design intent

**Should be:** "show your working" — the answer to *why did stock change / why did
the agent do that*, reachable in one click from the thing that surprised you.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `:330-333` |
| Empty | Yes, and no longer overloaded | `:338-343` — and it says "No events from the registers that could be read" when some register failed |
| Error (whole request) | Yes | `:253-265` banner + `:334-337` feed body |
| Error (one source) | Yes (PR #262, both halves) | `:267-284` banner naming the sources, `:286-316` chips as `—`, `:318-326` the register tally |
| Permission-denied | **Partially** | A 401/403 now reaches the whole-request banner rather than "No events", but the banner says the timeline could not be read — it does not say *why*, so a permissions problem still reads as an outage |

**Where the UI misleads**

1. ~~Source chips render `sources[s] ?? 0` — a source that failed and a source with
   nothing to report are the same `0`.~~ **Fixed** — a failed source renders `—`
   and is named in the banner; a source that was not queried renders `—` too
   (`:286-316`). Against an **older** gateway that reports neither field the
   chips still read `0`, deliberately, because the page has not been told
   otherwise — see the closing note of §10.
2. ~~"No events" is the answer to a broken query, an unauthorised query, and a
   quiet Tuesday.~~ **Fixed** for the broken query; an unauthorised one is now
   an outage message rather than a silence, which is better and still not right.
3. **Still true:** no indication that the feed is truncated at 100. Every other
   count on the page can now say it is a floor; the feed itself cannot.

## 13. Roadmap

1. ~~**Distinguish failure from silence**~~ — **done 2026-09-02** (ADR 0086),
   both halves: the service returns
   `sourcesQueried` / `failedSources` instead of catching to `[]` in silence, and
   the page branches `query.isError`, names the failed registers, and renders an
   undated row as `—`. **Merged to `main` in PR #262** (`4d0f6c50`); PR #253,
   which carried it first, was closed unmerged.
2. ~~**Mark the window.**~~ — **done** on the `next` face (2026-09-06), and the
   guard registered 2026-09-12. See §9.
3. ~~**Link out of the timeline**~~ — **done** on the `next` face
   (`lg-format.ts:294-316`).
4. **Link in**: notifications, receipts and orders should carry
   `?correlationId=` here. §2 already calls this the intended pivot; **measured
   2026-09-12, nothing produces the link** — zero producers outside
   `pages/logs/**`. This is now the largest open gap on the surface and it is
   other pages' work, not this one's.
5. ~~Cursor pagination~~ — **done** on the `next` face
   (`useLogsNextData.ts`, `logs-timeline.service.ts:370-395`).
5b. **Scope the read by register** — accept `sources[]` on the endpoint and make
   the strip multi-select, so "show me the agents" can go deeper than the mixed
   page. Needs a gateway change and an ADR; see §9.
6. Take `restaurantId` from the JWT rather than the path, matching the rest of the
   gateway.
7. Share the response type rather than restating it (§8). Until then the page and
   `logs-timeline.service.ts` drift silently apart.
