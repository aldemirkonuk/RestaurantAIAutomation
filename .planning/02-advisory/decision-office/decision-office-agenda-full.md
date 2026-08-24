---
type: agenda-full
division: advisory
department: decision-office
status: provisional
metrics: [decisions.open_count, decisions.unowned_count, decisions.median_age_days, decisions.namespace_collisions, decisions.unfiled_fork_count, triggers.dated_unwatched_count, loops.undefined_close_time_count, corpus.contradiction_count]
updated: 2026-08-24
links: ["[[decision-office-charter]]", "[[decision-office-premortem]]", "[[decision-office-agenda-board]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[OBSIDIAN_VAULT]]", "[[0002-documentation-first-operating-mode]]", "[[0007-org-structure]]", "[[foundation-README]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[standards-verification-charter]]", "[[knowledge-documentation-charter]]", "[[analytics-bi-charter]]", "[[skills-charter]]", "[[sales-charter]]", "[[legal-charter]]", "[[LOOP-MAP]]"]
---

# Decision Office — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The only work this
> function has performed is the audit recorded in [[decision-office-charter]]
> §Evidence today; nothing below has been executed.

## What

Three instruments, one purpose: **decisions close instead of drifting**.

1. **The ADR log** — kept accurate. Numbering, statuses, supersede chains, and an
   index that still matches the files on disk.
2. **The open-decision register** — given the three fields it has never had:
   **owner**, **filed-date**, **severity** — and therefore, for the first time, an
   *age* and a *drain rate*.
3. **Close-times** — the 396 loop blocks that claim one, and the six dated triggers
   that nothing currently watches.

**And a fourth thing that is not an instrument: restraint.** The office
tracks, surfaces, escalates. It does not decide. See
[[decision-office-charter]] §Authority and [[decision-office-premortem]] M3 —
the failure that would end this function is not slowness, it is helpfulness.

## How

**Weekly digest, oldest item first, shipped whether or not anything moved.** That
one sentence is most of the operating model, and each clause answers a specific
failure:

- *Weekly*, not daily — [[foundation-README]] §6 proposes a daily queue digest, and
  a 23-row register whose items unblock on scheduled sessions cannot change daily.
  A digest identical five days running gets deleted by §6's own three-runs rule.
- *Oldest item first*, not most tractable — otherwise metadata work occupies the
  top line forever ([[decision-office-premortem]] M4). OD-11 (**65 documents**) and
  OD-03 (**39**) are the two most-cited non-colliding open items in the corpus, and
  both are blocked on a session nobody has booked. That is the top line, not the fork numbering.
- *Whether or not anything moved* — a number that appears only when it changes
  cannot embarrass anyone (M2).

**Intake is never rejected.** A fork arrives in whatever shape it arrives and this
office does the normalising. `decisions.intake_returned_count` has a target of
**0**, not "low" (M1).

**Escalation carries its own close-time.** It closes on a terminal state —
actioned, deferred with a *new date*, or withdrawn. Deferral is an outcome;
silence is not (M5).

**Everything runs on a text file, a grep, and a calendar.** No loop here waits on
NF-A, on telemetry, or on another unit shipping. A governance function that cannot
run until someone else is unblocked has no standing to report on who is blocked.

## Why now

Because the inbox already exists and the function does not.

- **222 of 581 generated unit documents reference this office.** **329
  `[[decision-office-charter]]` wikilinks** resolved to nothing until this session.
  **168 loop blocks** route `outputs_to: [decision-office]`.
- **A parallel session assigned it work before it had a charter.** Register row
  **OD-30**, appended while these documents were being written, reads: *"Decision
  Office's first assignment; mechanical to fix."*
- **The register mutated under this session.** Rows OD-28 → OD-31 appeared
  mid-audit, and OD-23's text was rewritten in place from *"$20k MRR in 30 days"*
  to *"Revenue target and pricing, both unverified"* — while **51 documents cite
  OD-23** against the older text.
- **Two org-wide staleness events are already dated and unwatched.** All 581 unit
  documents carry `updated: 2026-08-24`, so [[ORG_STRUCTURE]] §4's 60-day agenda
  clock expires **together, around 2026-10-23**; four dated retirement triggers
  then land **together on 2026-11-24**.
- **[[0002-documentation-first-operating-mode]] wrote down the condition to watch**
  — *"the register's founder-queue grows faster than it drains"* — and it has never
  been computed once.

## Next steps

Ordered by what buys the most closure per unit of effort, **not** by tractability.

| # | Step | Loop | Done when |
|---|---|---|---|
| 1 | **Retrofit owner + filed-date + severity onto all 23 open rows.** Bookkeeping — changes no row's meaning ([[decision-office-directive]] §Decision rights) | L1 | `unowned_count` = 0; `median_age_days` computable for the first time |
| 2 | **Ship digest #1** — oldest item first, with `open_count` and `intake_rate` on the same line | L1 | Founder has one page; a baseline exists to measure drain against |
| 3 | **Stand up the dated-trigger calendar.** Six triggers, `days_until` reported from this week | L2 | `dated_unwatched_count` 6 → 0 |
| 4 | **Fork-registry reconciliation, as a proposal.** Collision table + alias table + a namespace scheme. **Time-boxed to two close-times**, then abandoned rather than extended | L3 | In front of the founder as a new register row. **Not applied** — 51 documents cite OD-23; application is a decision |
| 5 | **File the unfiled.** OD-C1…C8, CM-F1…F6, F-1…F-5 — **≥19 forks** staged in documents and never entered in the register | L3 | Every staged fork has a row, or an explicit "not a decision" note |
| 6 | **File the four contradictions** (C1–C4) with a named owner each. **Including C3, where one side is provably right** — routing rather than ruling is the point | L5 | Each has an owner and an age |
| 7 | **First loop close-time audit.** 396 blocks; report the `exists`-ratio of **6 in 396** | L4 | Undefined close-times and status drift listed and routed |
| 8 | **First anti-sprawl pass**, dry-run against the 2026-10-23 cliff | L1 | The October staleness event is a calendar entry, not a surprise |
| 9 | **Hand L6 to [[red-team-charter]].** It is the one loop this office must not own | L6 | Red Team has accepted, or the gap is escalated as unowned |

Steps 1–3 need no permission from anyone and close nothing but bookkeeping. **If
only those three ever happen, the function has still done more than has ever been
done here.**

## Questions for the founder

Each is a fork this office **cannot** answer, by [[decision-office-directive]]
§Decision rights. Every one is filed rather than assumed.

1. **The fork-numbering scheme — do you ratify it?** Six IDs (`OD-19`…`OD-24`)
   carry two or three distinct meanings each across five divisions. The office can
   produce one authoritative scheme and an alias table; it **cannot apply it**,
   because reassigning `OD-23` rewrites what **51 existing documents** mean, and 177
   documents cite at least one of the six colliding IDs. Related:
   **OD-30**, already registered.
2. **Do staged forks get real IDs?** `OD-C1…C8` (Corporate), `CM-F1…F6`
   (Commercial), `F-1…F-5` (Intelligence) — **≥19 items** that are decisions in
   every respect except registration. Fold them into `OD-nn`, or bless the
   namespaces permanently? *(The two namespaced schemes worked. The three that
   reused `OD-nn` collided. That is evidence, not a recommendation.)*
3. **OD-26 — must every unit carry a merge trigger symmetric with its split
   trigger?** Corpus count: **11 documents with split triggers, 3 with merge
   triggers**. The register suggests this is *"likely a Decision Office standing
   rule."* **This office declines to write it as one.** A standing rule authored by
   its own enforcer has no independent author, and the six units that wrote
   themselves dated retirement triggers did so voluntarily — which is a better
   precedent than a mandate from us.
4. **OD-25 — Research & Math or Skills for the weekly skill-health job?**
   `foundation/README.md:269` vs `technology.md:497-498`. Registered, still unowned.
   Obvious-looking ties are exactly where M3 begins.
5. **The daily open-decision digest in `foundation/README.md:269` — reassign it?**
   It is assigned to Product & Vision at a *daily* cadence and predates
   [[0007-org-structure]], which created this office and gave it the register. Two
   foundation documents now disagree about who owns the queue. **Same shape as
   OD-25, and this office will not resolve its own.**
6. **The loop block is not machine-readable.** [[ORG_STRUCTURE]] §5 calls it
   *"machine-readable frontmatter"*; [[OBSIDIAN_VAULT]] §4 makes Dataview *"the
   anti-sprawl mechanism in practice."* All **396 blocks** — including the six on
   [[decision-office-loops]] — sit in fenced ` ```yaml ` regions in the document
   **body**, which Dataview does not index. So `[[LOOP-MAP]]` (**56 inbound links,
   file absent**) cannot be a query, and OD-12's *executable later* promise rests on
   a format that is not currently machine-readable. Move the blocks to frontmatter,
   or script LOOP-MAP and drop the Dataview claim? Corpus-wide;
   [[architecture-review-charter]] should see it.
7. **OD-C6 — [[standards-verification-charter]] under this office?**
   [[decision-office-charter]] **declines** in writing, before the pressure is real.
   Declining is ours; accepting is not. If the independence argument holds, the
   answer is a fourth advisory function or a different parent — not this one
   growing an org chart.
8. **Will you set dates for OD-11 and OD-03?** The two most-cited open items in the
   corpus — **65 and 39 documents** — are each blocked on nothing but *a session
   being scheduled*. They are the cheapest closes available and, on current
   evidence, the ones this office will otherwise report as ageing every week
   forever.
