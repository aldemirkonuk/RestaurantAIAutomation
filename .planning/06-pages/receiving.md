---
type: page
route: /receiving
slug: receiving
softwares: [receiving]
component: apps/web/src/pages/receiving/ReceivingHome.tsx
audience: staff
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: broken
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[orders]]"]
---

# /receiving — Receiving home (role-split)

> **Part of** [[08-softwares/receiving|Receiving]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Delivery card** (staff view) → [[receiving-door]] `/receiving/:orderId/door`
- **Issue row** (manager view) → [[orders]] `/orders?order=<id>`

## 1. Purpose

"One event, three renderings, chosen by role" (`ReceivingHome.tsx:17-33`, echoed at
the route: `App.tsx:258`). Staff see *which delivery are you receiving* → the door
flow, **with no prices**; managers see *what needs a decision, worst money first*;
owners see one number — money that actually came back. Role is resolved
deterministically from auth (`ReceivingHome.tsx:66-71`); unrecognised roles fall to
the cost-free staff view on purpose.

## 1a. Features
One event, three renderings by role:
- **Staff**: pick which delivery you're receiving → the door flow; no prices shown
- **Manager**: the decision queue, worst money first
- **Owner**: one number — money that actually came back (recovered credits)
- 🚧 Nothing links here yet; the page is reachable by typed URL only (§9)

Honesty features, bound by [ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md)
and held by `scripts/check_windowed_figures.py` in CI:
- **The door's count is in bottles.** Rendered from the gateway's `bottlesTotal`
  ([ADR 0054](../decisions/0054-order-capture-and-unit-arithmetic.md)); when it
  is absent the card shows the em dash plus what was ordered **in its own unit**
  ("5 cases ordered · bottles —"). The page never multiplies a pack size.
- **`SERVER_WINDOWS`** — a register in `useReceivingNextData.ts` of every server
  cap a figure sits behind, each cited to the query that imposes it. Windowed
  figures render `≥`; where the gateway returns an exact `total`, that is used
  instead and no marker is needed.
- **Measured zero vs unknown.** `$0` is a measurement and renders as `$0`; an
  absent figure renders `—`. `openClaims` is a floor unconditionally — its cap
  is per-restaurant and unobservable from the client.
- **The uncounted strip has three states**, and the unknown one is words: a
  failed queue says so rather than rendering as "nothing uncounted".
- **403 is its own state** on all three renderings — names the permission, drops
  the retry that cannot help, prints the status and message. At the door it
  still sends the receiver to the paper record.
- **The outbox is tenant-scoped**: pins are keyed by restaurant, and pre-scoping
  pins are adopted marked `tenantUnknown` rather than discarded or re-attributed.
- **An offline non-attempt says "holding"**, never `sent 0 · failed 0`.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receiving`)

Canonical source with curves: `apps/web/src/pages/receiving/next/MOTIONS-receiving.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `receiving.risk.tally` | At-risk / recovered figures arrive | a figure changes while open — never first paint, never from an em dash |
| `receiving.lane.select` | Outcome lane select | accepted · short · refused lane press: colour + 2px underline |
| `receiving.row.settle` | Queue row expand | 0fr→1fr with the chevron on the same token; body carries the facts and the /orders + /receipts hand-offs |
| `receiving.credit.pour` / `.tuck` / `.stamp` | Hold-to-send → seal | the die on a drafted-unsent credit request — real open→requested transition; early release states what did not happen; the stamp is the only overshoot in the system |
| `receiving.draft.turn` | The draft's working turns in | "Show the working" on a --calm credit draft, slower than settle on purpose |
| `receiving.outbox.pin` | Nothing vanishes; the drop becomes a pin | a receipt flushDoorOutbox permanently dropped travels in on turn, lands on the stamp, and stays pinned by name until a person unpins it (inv-09) |
| `receiving.micro.ink` | Micro-states | hovers, hand-off press, retry buttons, the attempt counter; ≤2px travel |

Not used, on purpose: the queue item that stops existing gets no animation (the
absence is the defect — the motion budget goes to the pin arriving); no shake,
no bouncing checkmarks, no skeleton shimmer for unknowns.

## 2. Entry

**No inbound in-app link.** Not in the sidebar (`components/layout/Sidebar.tsx:58-184`),
not in the command palette (`components/command/commands.ts`), and a repo grep for
`'/receiving'` navigation finds nothing. Note: [PAGE_MAP](../foundation/PAGE_MAP.md):104-132
does **not** list it among entry points — that list undercounts; the map only records
this page's *outbound* edges (:86-87). Reached by typed URL today.

## 3. Files

- Route binding: `apps/web/src/App.tsx:259` (lazy import :79).
- `apps/web/src/pages/receiving/ReceivingHome.tsx` (355 lines) — all three views in one file
  (StaffView :75, ManagerView :135, OwnerView).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`), :420
(`procurement/receiving`), :370 (`procurement/documents/credits`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (deliveries to receive) | `ReceivingHome.tsx:88` |
| GET | `/procurement/receiving/queue` | `ReceivingHome.tsx:142` (manager decision queue) |
| GET | `/procurement/credits/stats` | `ReceivingHome.tsx:263` (owner recovered-money number) |

## 5. Signals

**None emitted.** Markup carries `data-ux-key="receiving:staff-order"` (:113) and
`"receiving:queue-row"` (:178), but the uxSignals reporter is dark
(`lib/uxSignals.ts:15`) with no page-level consumer — markers wait for a reporter.

## 6. Tier cut

**Core** — operate. This is the S02/S03 front door: PO-prefilled checklist and the
mismatch queue are ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Shared layout chrome
applies (see dashboard.md §7).

## 8. State & config

- Role gate from `useAuth` only — the file documents why the role must come from that
  source (`ReceivingHome.tsx:63-64`: "the staff view deliberately hides all money").
- No env vars, flags, or localStorage specific to this page.

## 9. Gaps

- **Unreachable by click** (§2): the S02 golden path starts at a URL nobody is linked
  to. Either a sidebar/palette entry or a dashboard hand-off is missing.
- PAGE_MAP's entry-point list omits this route (see §2) — the atlas undercounts
  orphans; worth a regeneration note there rather than a fix here.

## 10. Maturity

**broken.** The staff view — the S02 golden path and the only door into
[[receiving-door]] — cannot list a single delivery, for two independent reasons.

| Evidence | `path:line` |
|---|---|
| **1. It filters on a status that does not exist.** `StaffView` requests `/procurement/orders?status=SENT&limit=25`. `ProcurementOrderStatus` has 13 members and **`SENT` is not one of them** (PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED, CONFIRMED, IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED, REJECTED, FAILED). `OrderFilterDto.status` is `@IsEnum(ProcurementOrderStatus)` and the app runs a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` → **400 Bad Request**. | call `ReceivingHome.tsx:88-90`; enum `procurement/dto/procurement.dto.ts:15-29`; DTO `:271-275`; pipe `main.ts:69-73` |
| **2. Even on success it unwraps the wrong shape.** It reads `data?.items ?? data ?? []`. `listOrders` returns `{ orders, total, page, limit, hasMore }` — there is no `items`, so `orders` would be bound to the response *object*, `orders.length === 0` is `undefined`, the empty state is skipped, and `orders.map` throws. The shared client helper does this correctly (`response.data?.orders ?? …`) — this view bypasses it. | `ReceivingHome.tsx:91`; server `procurement.service.ts:508-514`; correct unwrap `services/api/orders.ts:56` |
| **The failure is invisible.** `useQuery` is destructured as `{ data: orders = [], isLoading }` with no `isError` branch, so a 400 renders the reassuring empty state: *"Nothing is out for delivery right now."* | `ReceivingHome.tsx:85,102-106` |
| **Manager and owner views are correct.** `/procurement/receiving/queue` and `/procurement/credits/stats` both exist, are JWT-guarded, and return real aggregates. | `receiving.controller.ts:114-153`; `documents/credits.controller.ts:89-123`; `receiving.service.ts:309-370` |
| The role split itself is well built — role comes from `useAuth` (documented as load-bearing), and unknown roles fall to the cost-free view. | `ReceivingHome.tsx:61-72` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/procurement/orders?status=SENT` | JWT (class) | `procurement.controller.ts:65` | **400** — invalid enum (§10) |
| GET `/procurement/receiving/queue` | JWT (class) | `receiving.controller.ts:153` → `receiving.service.ts:309` | `{ items, unverified, totalAtRisk }` — non-`matched` orders joined to open/requested/promised `procurement_credits`, sorted by dollars at risk then by provability |
| GET `/procurement/credits/stats` | JWT (class) | `documents/credits.controller.ts:123` | `{ recovered, outstanding, promised, rejected, openClaims, oldestOpenDays, settlementRate, selfEvidencedOpen }` |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Open deliveries (staff list) | POs created on [[orders]] and the recurring-order cron | `procurement/recurring-orders.service.ts:225,271` |
| `match_status` / `discrepancy_notes` (manager queue) | the four-way match run from [[inventory]]'s `ReceivingWorkspace` | `ReceivingWorkspace.tsx:274` → `procurement.controller.ts:244` → `procurement/invoice-match.ts` |
| `procurement_credits` (both manager and owner numbers) | `openCreditClaim`, opened from a match verdict — never sent, only opened; dedup on `23505` | `procurement.service.ts:1104-1140` |
| `unverified` strip | door receipts with a case count and no bottle count, aged | `receiving.service.ts` `listUnverified`; door writes at `receiving.controller.ts:119` |
| Invoice documents that make the match possible | 5-minute `@Cron` sweep over `conversation_attachments` → `procurement_documents`, content-addressed | `procurement/documents/document-intake.service.ts:581-620` |

**Finding:** the manager and owner views depend entirely on a match that is only
triggerable from a *different page* ([[inventory]]). Nothing on `/receiving` starts the
process it reports on, and nothing links to `/receiving` in the first place (§2).

### Writes

**None.** This page is read-only in all three renderings — every button navigates.

## 12. Design intent

**Should be:** the delivery front door. One event, three renderings by role, with the
staff path deliberately money-free so a porter never argues with a driver.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ all three views | `:100,165,273` |
| empty | ✅ *by text*, ❌ *by truth* — staff's "Nothing is out for delivery right now" is currently a lie (§10); manager's "Nothing to chase" and owner's "No discrepancies found yet" are honest | `:102-106,167-171,318-324` |
| error | ❌ | no `isError` branch anywhere in the file — the reason the 400 is invisible |
| permission-denied | ✅ **best in the repo** — the role split *is* the permission model, and unrecognised roles fail toward showing less | `:61-72` |

The owner view is a model of honest numbers: `recovered` counts only issued credit memos,
money asked for is shown separately and never added in, and the settlement rate supplies
the denominator (`:251-258,298-304`). Keep that discipline when touching this page.

**Where the UI misleads:** the staff empty state (§10) — it reports a healthy quiet
delivery day while the request behind it is rejected.

## 13. Roadmap

1. **Fix the staff query.** Use `getOrders({ status: … })` from `services/api/orders.ts`
   (which maps to the backend enum and unwraps `.orders`), with a real status —
   `CONFIRMED` and/or `IN_TRANSIT` are the "out for delivery" states. Two bugs, one fix.
   *Blocker: none, but it needs a decision on which statuses count as "arriving today".*
2. **Add an error branch to all three views** so a failed request never renders as an
   empty one. This is the defect that let #1 hide.
3. **Make the page reachable** — a sidebar entry, a command-palette command, or a
   dashboard hand-off. Today S02 begins at a URL nothing links to (§2, §9), which also
   orphans [[receiving-door]].
4. Link the manager queue's rows to the match workspace on [[inventory]] rather than to
   `/orders?order=` — the decision the row asks for is made there.
5. Turn on the reporter for the two `data-ux-key` markers already placed (§5).

<!-- MERGE NOTE: `docs/receiving-review` (PR #216) adds its own "## 14. Pipeline
     review — 2026-09-01" here. The two sections are ADDITIVE and cover different
     layers — that one the pipeline underneath both renderings, this one the view
     layer of the rebuilt surface. On conflict, keep both and renumber whichever
     lands second to §15. Do not merge them into one section. -->

## 14. Page-honesty pass — 2026-09-01 (`fix/receiving-page-honesty`)

Ten defects measured on the rebuilt `receiving/next` surface against
[ADR 0051](../decisions/0051-rebuilt-pages-show-live-data-only.md), the day
after 0051 locked. Decision recorded as
[ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md).
Line numbers are pre-fix, against `origin/main` at `5d3dbe7e`.

| # | Defect | Where | Status |
|---|---|---|---|
| F1 | `procurement_orders.quantity` is denominated in `unit_type`, and was rendered as bottles — a five-**case** order told the door five bottles were expected. `mapOrderRow` already emitted `bottlesTotal` (`procurement.service.ts:1913-1914`); it was unused | `useReceivingNextData.ts:111`, `RcStaffLane.tsx:135` | ✅ fixed |
| F2 | `vendor` always null — the hook reads `providerName`, which `mapOrderRow` never emits | `useReceivingNextData.ts:107` | ⚠️ client half done; **gateway TODO** |
| F3 | Outbox not tenant-scoped: one global `localStorage` key, so restaurant A's dropped receipt rendered as a `role="alert"` under restaurant B | `useReceivingNextData.ts:373` | ✅ pins fixed; ⚠️ **queue TODO** |
| F4 | An offline non-attempt stamped as a clean sync — `last sync 14:32 · sent 0 · failed 0` under a header reading "offline — holding" | `doorOutbox.ts:94` → `:491` → `RcOutboxRail.tsx:260-262` | ✅ fixed consumer-side |
| F5 | Six windowed figures rendered as totals; **not one `≥` on the page** | `RcStaffLane.tsx:181`, `RcManagerQueue.tsx:91,121,390`, `RcOwnerLedger.tsx` | ✅ fixed |
| F6 | A measured `$0` and an unknown both rendered as `—`, beside a literal `0` — one row could read `$— · 0 open claims` | `RcManagerQueue.tsx:261,313,314` | ✅ fixed |
| F7 | The uncounted strip rendered only when non-empty and the hook set `[]` on failure — a failed query read as "nothing uncounted" | `RcManagerQueue.tsx:403`, `useReceivingNextData.ts:250` | ✅ fixed |
| F8 | 403 indistinguishable from 500; two of three renderings never printed the message | `RcStaffLane.tsx:37-53`, `RcOwnerLedger.tsx:105-125` | ✅ fixed |
| F9 | The credited-list query had no error branch — honest by accident, indistinguishable from "no credited claims yet" | `useReceivingNextData.ts:349-359` | ✅ fixed |
| F10 | `/receipts` hand-off dropped the order id its sibling passed; `settlementRate` (settled ÷ all resolved) sat under "They refused" | `RcManagerQueue.tsx:342`, `RcOwnerLedger.tsx:152-165` | ✅ fixed; `?order=` inert until `ReceiptsNext.tsx` reads it |

### The server windows this page renders behind

Registered in `useReceivingNextData.ts` as `SERVER_WINDOWS`, cited to the query
that imposes each. CI (`check_windowed_figures.py`) fails when a declared cap no
longer matches its source.

| Window | Cap | Query | Observable from the client? |
|---|---|---|---|
| `QUEUE_ITEMS` | 100 | `receiving.service.ts:375` | **Yes** — a full page proves more may exist, so the floor is conditional |
| `UNVERIFIED` | 500 | `receiving.service.ts:271` (receipt events) | No — the derived list is shorter than the window |
| `LINKED_CREDITS` | 200 | `receiving.service.ts:384`, **no `.order()`**, capped per *restaurant* not per order | No — hence `openClaims` is a floor unconditionally |
| `RECOVERY_STATS` | 5000 | `credits.controller.ts:137`, **no `.order()`** | No — aggregates only, so every owner figure is a floor |
| `CREDITS_LIST` | 200 | `credits.controller.ts:113`, ordered **oldest-first** | No — and the ordering means a busy restaurant's *recent* settlements fall outside the month-on-month trend entirely |

### What was already honest and was preserved verbatim

Named here so a later pass does not "tidy" any of it away: `rc-format.ts:8-44`
(`num()` rejecting NaN/empty/non-finite); `RcStaffLane.tsx:37-53` — *"there may
well be a truck outside. Write the delivery down on paper."*, now the 5xx branch;
`useReceivingNextData.ts:465` + `RcOutboxRail.tsx:179-182` (a thrown IndexedDB
read → `null`, rendered "unknown, not zero"); `RcOutboxRail.tsx:127-132` (the pin
that audits its own inference); `RcTally.tsx:40-41` (a dash→number transition
does not animate — knowledge arriving is not a value changing);
`RcOwnerLedger.tsx:101-103` (`recovered` sums `creditedAmount`, never
`claimedAmount`); `RcCreditDrafts.tsx:34-43,179` (no optimistic state in the
approve path).

### Still open after this pass

1. **`mapOrderRow` maps no provider name** (`procurement.service.ts:1906-1928`).
   Until it does, the door cannot see which distributor is in front of it — the
   card now says so explicitly instead of showing the wine in the vendor slot.
   The client reads `providerName` and `provider.name` defensively, so the fix is
   one join and one mapped field, with no web change.
2. **The door outbox queue carries no restaurant id.** `doorOutbox.ts` writes
   every receipt under the single mutation type `receiving.door` and
   `QueuedDoorReceipt` is `{orderId, orderLabel, body}`, so a queued receipt
   cannot be attributed to a tenant from the consuming side at all. The pinned
   *drops* are scoped; the *queued* list is not. The consuming filter is written
   and inert until the write side stamps the field.
3. **`ReceiptsNext.tsx:447` reads only `?tab`**, so the order id this page now
   passes to `/receipts` does not yet select anything there.
