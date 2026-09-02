# 0020 — A surface with no data says so; it never invents one

- **Status:** Locked
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — standing instruction; applied here to a specific class of defect
- **Keywords:** hollow, fabricated, mock, honesty, reports, AI command palette, one-tap, empty state
- **Links:** [[0018-p2-plan-of-record]], [[0019-p2-build-scope]], [[0016-ledgers-must-express-unknown]], `.planning/06-pages/PAGES-MAP.md`

## Context

The page-dossier pass (46 pages, four parallel agents, 2026-08-26) classified
**7 pages broken and 8 hollow**. *Hollow* was defined as: renders convincingly
while the data or action behind it is fake, mocked, or never persists. The
instances were not edge cases:

- **`/reports` ⌘K palette** answered from `generateMockAnswer` — hand-written,
  *specific, numeric* business advice ("Tuesday's revenue was ~18% below weekly
  average", "Prosecco +72% margin") that never touched the restaurant's data.
  Only a source comment marked it.
- **`/reports` Generate** did not merely `console.log`; it simulated the whole
  flow client-side — a fake "ready" status, a `Math.random()` file size, an
  `alert()` download.
- **Dashboard One-Tap** approve/reject made zero server calls, fabricated
  `ORD-<timestamp>` ids into `localStorage`, and ended in a 300ms `setTimeout`
  "for visual feedback".
- **Dashboard "Total Revenue"** summed `procurement_orders.total_cost` — money
  paid to vendors — and displayed it as money earned.
- **`/inventory-legacy` "Reset All Stock"** mutated React state, called
  nothing, and alerted "logged to the audit trail".
- **`/calendar`** discarded reminders and a location field the user had filled
  in, and reported success.
- **`/studio-certify`** fired `toast.success` on an HTTP 404.

The common shape is not "unfinished". It is **software that reports success it
did not achieve**, which is the one failure this product cannot carry: the
entire claim is trustworthy operational data for people making money decisions.

## Options considered

1. **Label the mocks** — a "demo data" caption on fabricated output. Cheap, and
   rejected: a caption does not undo a number the owner has already read and
   acted on, and every one of these surfaces already had a source comment
   saying it was fake. Comments are not user-facing.
2. **Build the real thing everywhere first.** Correct in the long run, but it
   converts a one-day honesty fix into an open-ended feature programme, and
   leaves the lies in production meanwhile.
3. **Make each surface honest now, at whatever level it can actually support.**
   Chosen.

## Decision

**No surface may present a value, a success, or an analysis it did not obtain.
Where the real thing does not exist yet, the surface says so plainly and offers
what it genuinely can.**

Applied concretely:

- Fabricated analysis is **deleted, not labelled.** The ⌘K palette became a
  search over the engine's real computed insights, and states in the panel that
  it does not answer free text yet. No input can reach an invented figure.
- Actions that cannot complete **refuse out loud and keep the card** — the three
  One-Tap actions with no viable endpoint (reorder lacking a real `providerId`
  and unit price, stock-receipt sourced from `localStorage`, "Report Issue" with
  no endpoint) now say so rather than animating success.
- Optimistic UI is allowed; **an optimistic update that fails must revert and
  tell the user.** Never a fabricated id, never a silent success.
- A mislabelled number is a fabrication. Spend is called spend
  (`totalProcurementSpend`, "Vendor Spend (30d)"), including the user-visible
  label, not only the identifier.
- **An error must never render as emptiness.** "No deliveries", "no agents
  running", "no insights" and a green "All clear" badge over a failed request
  were all found; a failed fetch says it failed, with a retry.
- A control that cannot work is **disabled and explained**, not wired to a
  simulation.

## Consequences

**Easier.** The product stops asserting things it cannot support, which is a
precondition for putting it in front of a paying restaurant. Every hollow
surface now names its own gap, so the backlog is legible instead of hidden
behind convincing UI.

**Harder / given up.** Several screens are visibly emptier. `/reports` no
longer appears to answer questions; the archive admits it holds no files. That
is the honest state, and it was always the state — the difference is that it is
now visible to us rather than only to a user who trusted a number.

**Not done here, deliberately.** Real revenue reporting is available
(`pos_checks.total`, `voided = false`) and was NOT built — that is a feature
decision. Report generation has no producer at all (OD-81). The remaining
hollow surfaces are filed as OD-79 through OD-83 rather than papered over.

**Revisit when:** a surface needs an exception — for a demo, say. The answer is
still no by default: use a seeded demo tenant with real machinery, never a mock
answer inside the product.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | Page-dossier pass | 7 broken / 8 hollow of 46 pages; this ADR generalises the fixes |
| 2026-08-26 | Verification | The ⌘K palette's replacement is guarded by tests asserting the mock generator and raw `fetch` cannot return |
| 2026-09-01 | `/recommendations/catalog` coverage meter | Same class, found live: "computable now" filtered the 573-type catalogue on data availability alone and ignored whether a generator existed, so a fully-connected restaurant was shown 573 against 24 real — ~24x. Fixed by counting implemented ∧ data-available, with the implemented set guarded against the generator source (`insight-implementations.spec.ts`). The catalogue stays visible as "catalogued"; "not built yet" is now said out loud. Two catalogue rows also understated their data needs (`goal_pace` reads `analytics_goals`, `basket_affinity` reads `pos_checks.items`) and are corrected. Stale "375" copy removed from the ⌘K palette — a generated count may not be hard-coded in prose |
| 2026-09-01 | Mobile `PulseStrip` (Today tab) | Same class, masked by a Toast mock path that always returned a number so `revenueToday` was effectively never `null`; PR #223 removes that mock, making the branch reachable. `apps/mobile/src/components/today/PulseStrip.tsx:63-69` (pre-fix) fell through to `pendingDecisions === 0 ? "All clear" : ...` whenever `revenueToday == null` — a genuinely-unavailable revenue figure rendered as the exact "green 'All clear' badge over a failed request" this ADR names. Fixed on `fix/pulsestrip-unavailable-is-not-all-clear`: revenue-known and revenue-unavailable are now distinct view states (`apps/mobile/src/components/today/pulseStripView.ts`), the unavailable state says so in the voice of the sibling `insights.tsx:233` degradation ("Connect Toast on the web dashboard to see live sales here."), and "All clear" is only ever rendered when revenue is actually known — decisions-pending reporting is otherwise unchanged and still shows when revenue is unavailable. Guarded by `apps/mobile/src/components/today/__tests__/pulseStripView.test.ts` |
| 2026-09-01 | Toast data paths | Same class, found live in **production**. `TOAST_MOCK_MODE` defaults TRUE (`toast.service.ts:72`) and is **not set** in the production Railway environment, so five endpoints served fabricated data gated on the flag alone: `GET /toast/menus`, `GET /toast/menus/:menuId`, `POST /toast/orders`, `GET /toast/orders/:orderId`, `GET /toast/sales`. `POST /toast/orders` is the acting-path case this ADR forbids outright — it returned a `mock-order-<ts>` guid with status OPEN, reporting an order placed at a vendor that was never placed. The production close written for webhook signatures on 2026-08-25 (`enforceSignature`, `:121`) had never been applied to the data paths; it now is (`mockDataAllowed`, `:146`), and refusals are spoken 503s rather than empty lists. Two further fabrications found in the same pass and fixed: `getMenus` and `getSalesData` **caught** an orchestrator failure and returned mock data with mock mode correctly OFF, so one network blip fed invented menus and invented revenue into analytics unmarked. Guarded by `toast.service.spec.ts` (8 assertions, each proven to fail on the pre-fix tree) |
