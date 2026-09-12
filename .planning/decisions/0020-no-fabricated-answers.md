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
| 2026-09-01 | Toast data paths | Same class, found live in **production**. `TOAST_MOCK_MODE` defaults TRUE (`toast.service.ts:72`) and is **not set** in the production Railway environment, so five endpoints served fabricated data gated on the flag alone: `GET /toast/menus`, `GET /toast/menus/:menuId`, `POST /toast/orders`, `GET /toast/orders/:orderId`, `GET /toast/sales`. `POST /toast/orders` is the acting-path case this ADR forbids outright — it returned a `mock-order-<ts>` guid with status OPEN, reporting an order placed at a vendor that was never placed. The production close written for webhook signatures on 2026-08-25 (`enforceSignature`, `:121`) had never been applied to the data paths; it now is (`mockDataAllowed`, `:146`), and refusals are spoken 503s rather than empty lists. Two further fabrications found in the same pass and fixed: `getMenus` and `getSalesData` **caught** an orchestrator failure and returned mock data with mock mode correctly OFF, so one network blip fed invented menus and invented revenue into analytics unmarked. Guarded by `toast.service.spec.ts` (8 assertions, each proven to fail on the pre-fix tree) |
| 2026-09-01 | Mobile `PulseStrip` (Today tab) | Same class, masked by a Toast mock path that always returned a number so `revenueToday` was effectively never `null`; PR #223 removes that mock, making the branch reachable. `apps/mobile/src/components/today/PulseStrip.tsx:63-69` (pre-fix) fell through to `pendingDecisions === 0 ? "All clear" : ...` whenever `revenueToday == null` — a genuinely-unavailable revenue figure rendered as the exact "green 'All clear' badge over a failed request" this ADR names. Fixed on `fix/pulsestrip-unavailable-is-not-all-clear`: revenue-known and revenue-unavailable are now distinct view states (`apps/mobile/src/components/today/pulseStripView.ts`), the unavailable state says so in the voice of the sibling `insights.tsx:233` degradation ("Connect Toast on the web dashboard to see live sales here."), and "All clear" is only ever rendered when revenue is actually known — decisions-pending reporting is otherwise unchanged and still shows when revenue is unavailable. Guarded by `apps/mobile/src/components/today/__tests__/pulseStripView.test.ts` |
| 2026-09-01 | `GET /toast/statistics` | The other half of this ADR, and the half that is easy to miss. This endpoint calls `/api/v1/toast/statistics` on the orchestrator — one of six Toast calls to a router that **has never existed** (`git log --all -S"/api/v1/toast"` returns no orchestrator commit; the calls arrived in `91b75dd1`, 2026-04-13, when the orchestrator already shipped eight route modules and none was Toast). It is the only one of the six with no mock branch, so it goes upstream in every configuration and has never once succeeded. Its catch returned HTTP **200** with `{mode, status: "unknown", error}`: honest about the *value* — it refused to invent a statistic — but not about the *surface*, because a 200 tells every health-style caller a permanently dead route is reachable. An action that cannot complete must refuse out loud, so it now answers **501 Not Implemented** — not the 503 used for "Toast is not connected", because that condition is fixable by the owner and this one is not; 503 would promise a future in which this succeeds and invite a monitor to retry forever. `toast.controller.ts` was also flattening the status to a hardcoded 500, alone among its handlers. Guarded by `toast-dead-surface.spec.ts`, which also ratchets the dead-call list so a seventh cannot land quietly. **Retirement of the surface is NOT decided here** — a web client (`apps/web/src/services/api/toast.ts`) and the published OpenAPI spec both reference it |
| 2026-09-02 | Toast → orchestrator failure status | The refusal for the six `/api/v1/toast/*` calls was **written**, not derived: the row above hardcoded 501 in `getStatistics`, and the other five forwarded `error.response?.status`, so the orchestrator's bare 404 reached the caller as "not found" — a route that was never built and a record that does not exist gave the same answer. `getStatistics` is the one Toast path with no mock branch, so it is live in production in every configuration, and its constant said "never implemented, and retrying will not help" for **any** failure — including an orchestrator outage, which is absence reported as certainty in the opposite direction to the usual one. Derived once now, in `toast-upstream.ts`, from what the orchestrator actually answers: no response at all → **503** (we never reached it, so we know nothing about its routes and must not claim it lacks one); a 404 on a collection path → **501**; an ambiguous 404 on an id path → one memoised confirming request; and a probe that **cannot** be made leaves the verdict `unknown` and forwards the upstream status unchanged — a guard that cannot check does not get to conclude. Any other status is forwarded verbatim, so once the router exists and says 503 "Toast is not connected", the party that diagnosed the condition is the one that names it. Every branch throws a refusal; none returns a body. The verdict expires after 60s, so a router that lands is picked up without a redeploy and without editing any of the six call sites. Guarded by `toast-upstream.spec.ts` (30 assertions, 15 proven to fail on the pre-change tree) |
| 2026-09-03 | Orchestrator `/api/v1/toast` mock switch (PR #236) | The refusal this ADR asks for **could not be reached**, because the switch that selects it was overridden one line below where it was read. `create_toast_client_from_settings()` ended with `if strict: mock_mode = False`, and `get_toast_client()` — the router's sole production caller — always passes `strict=True`, so `TOAST_MOCK_MODE` could not gate the router at all. Measured on the pre-fix tree with the switch at its documented safe value and egress recorded at the **socket layer** (below httpx/httpcore/anyio): `settings.toast_mock_mode = True`, `client.mock_mode after factory = False`, `EGRESS ATTEMPTED: DNS for ws-api.toasttab.com:443`. Two further findings that the summary of this defect did **not** contain, and that only measurement produced. (a) **Deleting the line was not sufficient.** The fallback was `not (client_id and client_secret)`, which is False whenever credentials are set, so the line-only tree still attempted DNS — measured as a separate control. Credentials being *present* is not consent to *use* them; the fallback is now `True`. (b) **The parse was fail-open.** `os.getenv("TOAST_MOCK_MODE", "true").lower() == "true"` made `=yes`, `=1` and `=""` all mean LIVE — a typo bought billable third-party calls. Only the literal `false` now disarms it, so unset AND malformed both mean mock. Why this is load-bearing rather than theoretical: measured the same day against the live Railway `production` environment, `TOAST_MOCK_MODE` is **absent from both services** while `TOAST_CLIENT_ID` and `TOAST_CLIENT_SECRET` **are set on `services/agent-orchestrator`** — so on the pre-fix tree this router would have gone live on its first request, `POST /orders` included. Post-fix, an unset switch gives 503 with **zero outbound packets**; `=false` reaches the real host. The reasoning for the deleted line was that strict-plus-mock is a contradiction only a 503 can resolve. It is, and 503 **is** the correct resolution: an operator who asked for mock and got a refusal was told the truth; one who asked for mock and got a live vendor call was overruled by code they could not see. Strict is a promise never to *fabricate*, never a licence to *connect*. Guarded by `tests/test_toast_routes.py` §8 — 8 assertions proven to fail on the pre-fix tree, each asserting the **packet**, not the flag (a flag assertion would have passed on the pre-fix tree while the process resolved ws-api.toasttab.com) — and by `scripts/check_toast_mock_switch.py`, proven to exit 1 on the pre-fix tree, on each half of the fix reverted alone, and 2 when it cannot check |
