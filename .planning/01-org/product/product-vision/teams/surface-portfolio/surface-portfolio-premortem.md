---
type: premortem
division: product
department: product-vision
team: surface-portfolio
status: provisional
metrics: [surface.unowned_surface_count, surface.untraceable_route_components]
updated: 2026-08-24
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-directive]]", "[[product-vision-premortem]]", "[[ux-path-burn-down-charter]]", "[[design-charter]]", "[[client-surfaces-charter]]", "[[red-team-charter]]", "[[PAGE_MAP]]"]
---

# Surface Portfolio — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — It became a spreadsheet-keeping function

The team's own named premortem (`teams/product.md:203-204`), and the default outcome for any
team whose input is a generated document. [[PAGE_MAP]] regenerates cleanly. Regenerating it
feels like work, produces an artifact, and can be done in an afternoon. Moving the number
cannot: it requires deleting a page someone built, or commissioning an endpoint someone else
must write, or telling Design that a route their deferred paths depend on is going away.
So the map gets regenerated monthly, `surface.unowned_surface_count` sits at 24 + 13 for a
year, and by foundation §3.3's own rule the agenda is fiction after 60 days.

**Earliest observable signal.** Three consecutive regenerations where the count moves by
fewer than 2 and **no route was killed or merged**. A sharper single-item version:
`/wine-agent` and `/wineagent` still both rendering `PlaceholderPage`
(`apps/web/src/App.tsx:293-294`) at the second regeneration. That one is decidable in an
hour by one person and needs nobody's permission.

**Counter-pressure.** The deliverable is a **verdict per route**, not a count. Regeneration
is the *measurement*; the loop only closes on the **diff between the map and the verdict
sheet** ([[surface-portfolio-loops]] L1). The three live duplications are due in the first
close-time precisely because they are the cheapest possible proof that this team can
actually decide something.

---

### M2 — The one measured number in the department became the department's alibi

This team owns the only metric in Product & Vision with a real reading. Four sibling teams
have none. That asymmetry creates a quiet gravitational pull: department reporting leans on
the number that exists, this team's small movements get outsized attention, and the team
starts optimizing for a legible count rather than for a usable product. The cheapest way to
move 24 + 13 is to reclassify — declare eight cold entries *intentionally-cold*, and the
number drops without a single user's experience changing.

**Earliest observable signal.** A close-time where the count falls and the number of
*killed* or *made-reachable* routes is zero. Reclassification-only movement is the tell.

**Counter-pressure.** The metric is reported **decomposed, never as one number**: killed /
merged / made-reachable / newly-declared-intentionally-cold / still-unowned. A drop driven
entirely by the fourth bucket is visible on sight
([[surface-portfolio-agenda-board]]). And every *intentionally-cold* verdict carries a
one-line reason and a re-check date — `/v/:slug` is correct because it is a deliberately
crawlable vendor portal; `/dev-sandbox` is a different case wearing the same label.

---

### M3 — Routes were killed that Design's deferred paths depended on

`UX_PATHS_CATALOG.md` holds 910 specified paths, and its Deferred Decisions Log records
*why deferred* and *unblocked by* per row — the repo's own doc calls that the rarest artifact
here. Many deferred rows are authored against pages this team is looking at as dead surface.
Kill `/documents-reports` because nothing links to it and you have silently closed a set of
paths [[ux-path-burn-down-charter]] is counting on, discovered months later when someone
tries to burn them down. The reverse failure is equally real and more likely: this team never
kills anything because *some* path might reference it, and M1 is the result.

**Earliest observable signal.** A kill verdict issued without a catalogue cross-reference.
Also: the first burn-down item that reports "blocked — page no longer exists".

**Counter-pressure.** A kill verdict requires a **path cross-reference**: which catalogue
rows target this route, and are they deferred, shipped, or dead? Kills that touch live paths
are a **joint department decision** with [[ux-path-burn-down-charter]]
([[surface-portfolio-directive]]). Critically, "a deferred path exists" is *not* an automatic
veto — deferred paths on a route nobody can reach are themselves candidates for deletion, and
saying so is this team's job.

---

### M4 — Untraceable stayed untraceable, because tracing is engineering work

Thirteen route components could not be resolved to a file — inline elements or non-standard
bindings ([[PAGE_MAP]]:151-167). Eleven of them are also cold entries, so they are doubly
unknown: unreachable *and* unmapped. Resolving them means reading `App.tsx` and following
dynamic bindings, which is [[client-surfaces-charter]]'s code, not this team's. So the 13
sits there, quietly making the 39-edge navigation graph a floor rather than a count, and the
map that the whole team's work rests on is known-incomplete in an unmeasured way.

**Earliest observable signal.** The untraceable count unchanged across two regenerations with
no ticket filed against [[client-surfaces-charter]].

**Counter-pressure.** The 13 are a **dated, named ask**, not a standing observation — the
same blocked-with-a-name rule [[service-floor-charter]] runs on. And they are tracked as a
**separate line** on the board rather than summed into the headline, because "unreachable"
and "unmapped" have different owners and different fixes. Note also that 11 routes appear on
both lists, so 24 + 13 is **26 distinct routes**, not 37 — a correction this team owes back
to [[PAGE_MAP]].

---

### M5 — Web was the portfolio, and mobile grew a second unowned surface

[[PAGE_MAP]] is generated from `apps/web/src/App.tsx`. `apps/mobile` has no route inventory
anywhere in the repo. This team's charter honestly scopes to web — which means that while
web surface gets governed, the native app accumulates exactly the same pathology
unobserved, and in two years someone regenerates a mobile map and finds its own 24.

**Earliest observable signal.** Any new mobile route or screen shipped with no inventory
entry — which today is *all of them*, because no inventory exists.

**Counter-pressure.** State the gap in the charter (done) and carry a **standing item**: at
what point does mobile need its own inventory, and who generates it —
[[client-surfaces-charter]] as the code owner, or this team as the portfolio owner? This is
a small fork, and small forks left implicit are how the 24 happened the first time.

---

## Cross-cutting counter-pressure

- **Verdicts, not counts.** The single rule that kills M1 and M2 together.
- **Decompose the metric on every report** — killed / merged / made-reachable /
  newly-intentionally-cold / still-unowned.
- **Kill verdicts carry a catalogue cross-reference**, and cross-team kills are joint
  decisions (M3).
- **Untraceable routes are a dated ask with a named owner**, tracked separately (M4).
- **[[red-team-charter]] should attack the *intentionally-cold* category** — it is the one
  classification that makes work disappear without anything changing. Findings-only
  ([[ORG_STRUCTURE]] §3).
- **Anti-sprawl:** this team's own document is subject to the 60-day rule it enforces on
  everyone else's pages (foundation §3.3).
