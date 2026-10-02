# 0258 — The dashboard tour speaks one text, true for every role

- **Status:** Locked
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** dashboard, tour, guidance, roles, staff amounts, approval hold, items not wines, role-neutral
- **Links:**
  - [[0257-dashboard-walk-through-r1-rulings]] (DASH-W21, W22 and W37). It is on `fix/review-dashboard`, PR #579, until that PR merges. Its evidence is in `06-pages/dashboard.md` §14 on the same branch.
  - [[0251-tips-are-a-margin-note-and-the-rail-says-what-each-room-is-for]] (D3: steps follow the job; on `docs/houses-decisions-0251-0253`, not yet on main). The tour text came in with PR #571 (`e39935fbc`).
  - [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (roles).
  - `tech-debt.d/2026-10-01-feat-tours-on-live-anchors-1.md:1` (the "two tour lines say wine" entry; its dashboard half is fixed here).

## Context

The dashboard tour (`apps/web/src/guidance/content/dashboard.ts`, from PR #571) broke three founder rulings from the /dashboard walk-through of 2026-10-01:

- **W22, staff see counts, never money.** The KPI step told every role "what you have paid vendors". On #579, staff get "Deliveries · today" and "Bottles in · month" in place of the two spend tiles (`KpiRow.tsx:133-168` on that branch).
- **W21, the hold only for a role that may approve.** The Waiting-on-you step told everyone to "hold to approve it".
- **W37, items, never wines.** The Running-low step said "Wines below their minimum".

Two more claims were not true. An independent adversarial pass found them; I checked both:

- **"Each figure opens its page."** On #579, staff's "Bottles in · month" tile has no link (`KpiRow.tsx:162-168` there).
- **"Inventory opens the full list."** /inventory is not filtered to low stock. It reads only `verify` and `wine` (`InventoryCommandPage.tsx:422, 440`).

## Options considered

1. **One role-neutral text, in `content/dashboard.ts` only.** Only the tour's words change. The cost is that owners lose the word "paid" in step 1.
2. **Role-aware text, picked by `activeRole`.** `TourStep` gets a variant, `startTour` gets a context, and `GuidanceProvider` reads `useAuth()`, which `useAuthStore` cannot give it. These parts are shared by all ten tours. It goes wrong in reachable cases:
   - The page follows the gateway's `amounts`, not the role (`DashboardNext.tsx:78-79` on #579).
   - `activeRole` is null while it loads, after a failed fetch, and for a member with no role. A no-role member sees counts, while an owner whose fetch failed sees money. No mapping of null is right for both.
   - The text is picked once, when the tour starts.
   - The money-by-role rule would be copied into the client.
3. **Neutral now, exact after #579.** The page would hand guidance its own `seesAmounts`, so the role text is never wrong. This needs an edit to `DashboardNext.tsx`, which is #579's file, plus the shared engine change. That makes a second PR.
4. **Role-aware text for the approval step.** Not possible. `mayApprove` is decided per order by the house's thresholds: `decision.requiredRole === null || roleSatisfies(...)` (`procurement.service.ts:4571-4573`). Staff may approve an order no rule catches, and a manager is held on an owner-only one.
5. **Do nothing.** Staff are told about money the page withholds from them, and every role is told to hold a die that #579 shuts for them.

## Decision

The founder's picks, verbatim, 2026-10-02:

| Step | Ruling | Text shipped |
|---|---|---|
| 1 KPIs (W22) | "Role-neutral (Recommended)" | "What the cellar holds, what is running low, what waits on you, and what has come in from vendors. Most figures open their page." |
| 2 Waiting on you (W21) | "Conditional hold (Recommended)" | Title "See what waits for approval": "Orders that need approval land here. Open one; if you may approve it, hold to approve." |
| 3 Running low (W37) | "Items + every item (Recommended)" | "Items below their minimum, the furthest below first. Inventory opens every item." |
| Two page findings for #579 | "Debt entry here (Recommended)" | `tech-debt.d/2026-10-02-claude-pensive-bardeen-b57esh.md` |

*What follows is my reasoning, not the founder's words.* One text is true on main today and on #579's page for:

- owner, manager and staff;
- a caller with no house role;
- a gate or stats read that is loading or has failed.

Spend and the staff counts both count delivered orders, so "what has come in from vendors" fits both. "Land here" stays true when the panel is empty or cannot be reached. Rejected: option 2, which goes wrong when `activeRole` is null and widens shared code. Option 3, which waits on #579 to fix a sentence that one neutral line already makes true. Option 4, which cannot be built.

## Consequences

- Only `content/dashboard.ts` changes. The engine, the registry, the provider and the dashboard's own files are untouched.
- Owners no longer read the word "paid" in the tour. The tiles still say it.
- The tip body ("what the cellar holds…") and the one-tap step were checked and stay. W37 keeps "In the cellar" until food lands.
- Claims `claims.d/claude-pensive-bardeen-b57esh.jsonl` pin all three rulings, and the guard blocks a regression.
- **Revisit when:** a tour step truly needs a per-role sentence (the signal is a step whose neutral form is false for some role). Then build option 3, where the page publishes what it shows, rather than option 2.
- **Not verified:** the tour was not run live in a browser for each role. The text was checked against the code on main and on #579, and by the adversarial pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | Adversarial subagent (one pass, read-only) | Proposed text survived; added the "land here" and "every item" wording and the two #579 page findings |
| 2026-10-02 | Aldemir (founder) | Locked: all four recommended options |
