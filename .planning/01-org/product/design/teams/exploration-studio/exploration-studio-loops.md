---
type: loops
division: product
department: design
team: exploration-studio
status: provisional
metrics: [design.resolved_question_rate, design.open_null_winner_count, design.sketch_index_completeness, design.winner_shipped_conversion, design.options_per_sketch_median]
updated: 2026-08-24
links: ["[[exploration-studio-charter]]", "[[exploration-studio-premortem]]", "[[exploration-studio-directive]]", "[[design-loops]]", "[[LOOP-MAP]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[decision-office-charter]]"]
loop_count: 4
loop_ids: ["exp-convergence", "exp-index-integrity", "exp-handoff", "exp-motion-corpus-drain"]
loop_close_times: ["fortnightly", "fortnightly", "fortnightly", "fortnightly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Exploration Studio — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops, on a **biweekly** base cadence. That is deliberate: weekly penalizes exploration
that is legitimately mid-flight, and monthly is slow enough for the null count to grow
before anyone looks — which is the documented history of this corpus.

---

## L-EXP-1 — Convergence

```yaml
type: loop
id: exp-convergence
owner: exploration-studio
measures: [design.resolved_question_rate, design.open_null_winner_count, design.options_per_sketch_median, design.questions_withdrawn]
changes: [sketches.manifest, exploration-studio.wip_limit, exploration-studio.queue]
inputs_from: [ux-path-burn-down, design-system-motion-substrate, activation-in-product-guidance, surface-portfolio]
outputs_to: [design, ux-path-burn-down, design-system-motion-substrate, decision-office]
close_time: fortnightly
status: proposed
```

The team's central loop, and it carries **four** numbers because two of them guard opposite
failures:

| Number | Baseline | Guards |
|---|---|---|
| `design.resolved_question_rate` | **15 of 43** | Premortem M1 — the gallery |
| `design.open_null_winner_count` | **28** | Premortem M1 — the debt itself |
| `design.options_per_sketch_median` | **uncounted** | Premortem M4 — convergence killing exploration |
| `design.questions_withdrawn` | **0** | Whether withdrawal is socially available at all |

That last one is the subtle one. **A withdrawal count that stays at zero forever means
withdrawal is not really allowed** — and the nulls will return, because a null is what
withdrawal looks like when withdrawal is forbidden. The loop reports it every cycle for
that reason alone.

Enforces the two-close-time rule: any row null at its second appearance is resolved, either
way.

---

## L-EXP-2 — Index integrity

```yaml
type: loop
id: exp-index-integrity
owner: exploration-studio
measures: [design.sketch_index_completeness, design.orphan_sketch_dirs, design.phantom_manifest_rows, design.duplicate_ids]
changes: [sketches.manifest, sketches.id_allocation]
inputs_from: [exploration-studio]
outputs_to: [design, knowledge-documentation]
close_time: fortnightly
status: proposed
```

Counters premortem M2, and reconciles **in both directions** — directories without rows,
and rows without directories. Baselines, all counted this session:

- **43 of 53** directories indexed
- **10 orphan directories** — 005, 011, 012, 013, 014, 015, 017, 018, 019, 049
- **1 phantom row** — `039` (`staff-performance-sidebar`, `MANIFEST.md:46`)
- **2 duplicate IDs** — `038`, `048`

Once the manifest is the ID authority ([[exploration-studio-directive]]), `duplicate_ids`
becomes a permanently-zero number, and a non-zero reading means the allocation rule was
bypassed rather than that a mistake was made.

---

## L-EXP-3 — Handoff

```yaml
type: loop
id: exp-handoff
owner: exploration-studio
measures: [design.winners_unqueued, design.winner_shipped_conversion, design.handoff_age_days]
changes: [sketches.manifest, ux-path-burn-down.queue, design-system-motion-substrate.queue]
inputs_from: [ux-path-burn-down, design-system-motion-substrate, activation-in-product-guidance]
outputs_to: [ux-path-burn-down, design-system-motion-substrate, design, decision-office]
close_time: fortnightly
status: proposed
```

Counters premortem M3 — winners resolved into a vacuum. Baselines: **at least 5** decided
winners are unqueued (050, 051, 048, 042, 033), and conversion to shipped surface is
**2 of 53**.

Escalates when a winner has been unqueued for two close-times. Two readings are possible
and they need different responses: the receiving team has no capacity (a department
allocation question) or the winner is not actionable (the question was not really
resolved). The loop must say **which**, because reporting only the age hides the
distinction.

`design.winner_shipped_conversion` stays deliberately **secondary**. Promoting it to
primary makes the studio optimize for shippable questions, which recreates precisely the
failure the two-team split was designed to prevent.

---

## L-EXP-4 — Motion-corpus drain

```yaml
type: loop
id: exp-motion-corpus-drain
owner: exploration-studio
measures: [design.motion_specs_with_winner, design.motion_spec_age_days]
changes: [sketches.manifest, design-system-motion-substrate.queue]
inputs_from: [design-system-motion-substrate, engineering]
outputs_to: [design-system-motion-substrate, decision-office]
close_time: fortnightly
status: proposed
```

A **time-boxed** loop with an explicit exit, aimed at one cluster: sketches **043, 044,
045, 046** — nine named motions, each with trigger / motion / haptic / **anti-gimmick**
specs, on a stack already chosen at sketch **042** (*H — RN Skia + Reanimated*), and
**0 of 4 winners**.

This is the highest-specification, lowest-conversion work in the department, and it is
perishable — a stack decision ages. The loop runs until all four resolve (winner or
withdrawal), then **closes permanently**. If it is still open after three close-times, it
escalates to [[decision-office-charter]]: an indefinitely-null motion corpus is a decision
failure, not a design one.

A loop with a defined end is unusual in this vault. It is correct here: the debt is
finite, countable, and either drains or is written off.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-EXP-1 convergence | biweekly | M1, M4 | **Yes** — the manifest is countable now |
| L-EXP-2 index integrity | biweekly | M2 | **Yes** — directories and rows are both on disk |
| L-EXP-3 handoff | biweekly | M3 | Partly — the manifest has no receiving-team column yet |
| L-EXP-4 motion drain | biweekly, **time-boxed** | M5-adjacent, and [[design-system-motion-substrate-premortem]] M5 | **Yes** |

Three of four can close on day one. That is unusually good for a founding unit, and it is
because this team's debt is **already enumerated** — the corpus counted itself, and nobody
had read the count.
