---
type: premortem
division: commercial
department: media-brand
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[brand-identity-premortem]]"
  - "[[narrative-collateral-premortem]]"
  - "[[social-community-premortem]]"
  - "[[customer-relationship-research-premortem]]"
  - "[[commercial]]"
---

# Media & Brand — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this unit has failed. What happened?

Five mechanisms, most likely first. Each is a department-level failure — the team-level
ones live in the four team premortems and are not repeated here.

---

### 1. The department became Design by drift

With one person and no second designer, "brand" absorbed product interface work, because
restyling a component is more immediately satisfying than deciding a name. The Product →
Design boundary written into [[media-brand-charter]] was never disputed, argued, or
overruled. It was simply not enforced, and after six months nobody could say which unit
owned the sidebar.

**Earliest observable signal.** The first M1 deliverable is a visual change to an
authenticated surface — a token, a component, a layout — rather than a decision about the
name or the voice. Concretely: a diff touching `apps/web/src/components/layout/` or
`apps/mobile/src/design/tokens.ts` that is filed as brand work.

**What would have prevented it.** M1's founding assignment is scoped to a defect list with
`path:line` citations and a CI check, not to a surface. Anything outside that list is a
boundary dispute and goes to [OPEN-DECISIONS.md](../../../decisions/OPEN-DECISIONS.md) in
writing before it is done. The seam is already stated concretely enough to arbitrate:
on `AuthShell.tsx`, the wordmark and the sentence are ours, the form is Design's.

---

### 2. The rename was declared complete at the doc layer. Again.

This has already happened once. The company renamed itself to Mudavym in its planning
corpus and left the product calling itself WineOps to every human and machine that touches
it. The failure mode repeats because the doc layer is where the rename *feels* done: the
charters say Mudavym, so the rename is done. Twelve months on, a vendor receives mail from
`notifications@wineops.ai`, an operator installs an app called WineOps, and the company has
two names in front of the two audiences it has.

**Earliest observable signal.** A commit or PR titled "rebrand" whose diff touches only
`*.md` files and `apps/web`. Or, more precisely: any report of the legacy-reference count
that quotes **10** or **33** — those are the host-scoped and domain-scoped numbers, and
both are structurally blind to the name-only surfaces
(`apps/web/index.html:7,15`, `apps/web/public/manifest.json:2,3`, `apps/mobile/app.json:3`).

**What would have prevented it.** The department's first metric is a count over shipped
surfaces, not a checklist, and it is defended by a CI check rather than a memory. The scan
matches the **name** and the **domain** as two separate patterns and reports two numbers,
because one pattern has already missed the more visible half once.

---

### 3. The department published before Growth produced

M2 built a deck and M3 opened accounts while the article pipeline had produced nothing and
G3's gate did not exist yet. The company's public presence became a set of claims with no
substantiating content behind them, and the first person who checked found a feed of
product screenshots and a deck citing a recovery number nobody had verified.

**Earliest observable signal.** Any outward artifact dated before the first article clears
G3. For M3 specifically the trigger is explicit; the signal is a post existing at all.

**What would have prevented it.** M3 is chartered dormant with a named entry trigger
(fork **CM-F6**), and every M2 artifact carrying a number routes through G3's fact-check.
[YC_WEDGE_PLAN.md:31-33](../../YC_WEDGE_PLAN.md) is unambiguous that "dollars recovered"
currently means *we asked*, not *we received*; publishing the stronger claim is not gloss,
it is false, and it would be this department that published it.

---

### 4. The consent gate was treated as paperwork

M4's instruction — research only customers who have **explicitly approved** having their
public web presence reviewed — was read as a formality rather than a gate, because the data
in question is publicly available and "it's public" is a very easy argument to make at
speed. One research pass covered a customer who had not approved. The failure is not a weak
quarter; it is a privacy incident attached to a company with one customer.

**Earliest observable signal.** A finding that cannot name where its subject's approval is
recorded. Today that signal fires immediately, because **no approval register exists** —
the shipped consent columns at
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64` are for guests
and for `service_personalisation`, not for customers and not for research.

**What would have prevented it.** No research runs before the register exists and
[[compliance-charter|Compliance & Privacy]] has signed off the mechanism. The gate is the
register, not the publicness of the data — the founder's instruction is quoted verbatim in
[[customer-relationship-research-charter]] precisely so it cannot be paraphrased into
something weaker.

---

### 5. Four agendas, one person, and all four went stale at once

The department looked substantial on paper — four chartered teams, twenty-eight documents —
and produced one real deliverable. Because nothing had a close-time that anyone watched, the
staleness was invisible: every agenda still said "provisional", which is indistinguishable
from "untouched".

**Earliest observable signal.** Two or more agendas unchanged for 60 days while `updated:`
still reads `2026-08-24`. The [foundation §3.3 and §6](../../../foundation/README.md)
anti-sprawl rules already name the threshold; the failure is nobody applying it here.

**What would have prevented it.** M3 chartered dormant on purpose, so only three mandates
are live. Every loop in [[media-brand-loops]] names a close-time. And the department's
monthly agenda sync is a scheduled job whose own anti-sprawl rule applies to it: three runs
with no action and it is downgraded or deleted.

---

## What this premortem does not cover

Team-specific mechanisms — the Expo slug hazard in the rename, the internal-deck-becomes-
external-deck failure, the squatted handle, purpose drift in the consent schema — live in
the four team premortems. Read those before acting on any one team's plan.
