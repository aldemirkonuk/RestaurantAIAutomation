## The Running low panel still says "Unnamed wine" — OPEN — 2026-10-02

Filed by `claude/pensive-bardeen-b57esh` (ADR 0258). The finding came from the tour-text adversarial pass, and I re-read the code to check it. The founder picked "Debt entry here".

**What.** DASH-W37 says the dashboard counts "items", never "wines". Its §14 row on `fix/review-dashboard` (PR #579) fixed "Unnamed wine" in `WaitingOnYou.tsx` and `DayDetail.tsx`. It missed the third one: `apps/web/src/pages/dashboard/next/RailPanels.tsx:191` at `origin/fix/review-dashboard` (`3a72c2f`) still prints `Unnamed wine` in the Running low list when an item has no name.

**Fix.** On #579, or after it merges: `Unnamed item`, the same as its two siblings, with a test. This branch may not edit that file while #579 is open.

## A held order says "Waiting on a manager" where an owner may also approve — OPEN — 2026-10-02

Filed by `claude/pensive-bardeen-b57esh` (ADR 0258), from the same adversarial pass, re-read.

**What.** On `origin/fix/review-dashboard`, `WaitingOnYou.tsx:221` prints `Waiting on ${requiredRole === 'owner' ? 'an owner' : 'a manager'}`. The gateway's own phrase for a manager-level rule is "a manager or an owner" (`apps/api-gateway/src/procurement/order-approval-gate.ts:57`, `approverPhrase`). An owner may seal it too (`roleSatisfies`, same file), so the card names fewer people than the rule does.

**Fix.** Say "a manager or an owner" for a manager-level rule, or reuse the gateway's phrase. This is #579's file, so it lands there or after it merges.

## The dashboard half of "Two tour lines say wine" is fixed — CLOSED — 2026-10-02

Filed by `claude/pensive-bardeen-b57esh` (ADR 0258).

**What.** This partly closes `tech-debt.d/2026-10-01-feat-tours-on-live-anchors-1.md:1`. Its dashboard line, "Wines below their minimum…", now reads "Items below their minimum…" (`apps/web/src/guidance/content/dashboard.ts`), following DASH-W37. The entry's providers half (`apps/web/src/guidance/content/providers.ts`, the `scope-menu` step) is untouched and stays **OPEN** there.
