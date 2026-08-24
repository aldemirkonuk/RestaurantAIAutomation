---
type: premortem
division: platform
department: reliability-sre
team: state-integrity-invariants
status: provisional
metrics: [sre.mttd_silent_corruption, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-loops]]", "[[reliability-sre-premortem]]", "[[schema-migrations-charter]]", "[[agent-fleet-charter]]", "[[red-team-charter]]"]
---

# State Integrity & Invariants — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

---

### M1 — The detector worked perfectly and changed nothing

The seed mechanism, from the evidence pass: findings accumulate in `drift_findings` with
status `open` — correctly, since money and stock are never auto-applied
(`drift_agent.py:11-16`) — **nobody owns the queue**, and "open findings" becomes a number
that only goes up (`technology.md:829-832`). The agents run daily, the detection works, the
count climbs from 12 to 400, and at 400 nobody reads it at all because the queue is now
obviously unmanageable. The team built a perfect instrument and pointed it at a wall.

**Earliest observable signal.** `integrity.open_findings_count` rising for **three
consecutive close-times** with zero transitions to a resolved state. Earlier and cheaper:
`integrity.open_findings_oldest_age` exceeding one close-time even once, while the count is
still small enough to look harmless.

**What would have prevented it.** **Age, not count, is the metric on the board.** A named
triage cadence with a disposition for every finding — fixed, accepted-with-reason, or
invalidated — where *accepted-with-reason* is a legitimate outcome that closes the row. The
weekly `sre-unowned-queue-sweep` (L-SRE-4) escalates a rising count to the department, and
the escalation is explicitly about **ownership**, not about the findings: a queue that only
grows means nobody owns it, and no amount of better detection fixes that.

---

### M2 — Grep-shaped gates gave false comfort

Five of this team's six gates are shell scripts that grep source text:
`check_no_direct_stock_writes.sh` (which admits it at `:10`),
`check_no_direct_type_attributes_access.sh`, `check_no_raw_guest_channels.sh`,
`check_no_guest_name_matching.sh`, and `check_schema_parity.sh`. Each is honest about being
a grep. A write path that builds a table name dynamically, or lives in a Postgres function
rather than TypeScript, passes **all of them**. CI is green, the invariant is believed to be
enforced, and it is merely *usually* enforced. Add the two stub agents
(`ghost_inventory_agent.py`, `shrinkage_detective_agent.py`, `technology.md:40-43`) counted
as coverage, and the mandate reads fully covered while half of it logs.

**Earliest observable signal.** A **non-zero divergence sample on a day with a green CI
run**. That exact combination — green guard, divergent data — is the tell, and it is how
the receiving-service bug behaved historically ([[engineering-premortem]] M4).

**What would have prevented it.** Every grep-gate is paired with a **data-side check that
measures the outcome rather than the syntax**: divergence sampling for stock, a labelled-set
count for identity, a cross-tenant row probe for leakage. The grep stays — it is cheap,
fast, and catches the common case — it is just never the only thing.
`integrity.invariants_with_outcome_side_check_pct` is on the board for this, and an
invariant with no outcome-side twin is logged as a gap, not as coverage. Separately: the two
stub agents are listed as **declared, not owned**, in
[[state-integrity-invariants-charter]] — counting a stub as capability is how M2 becomes
invisible.

---

### M3 — Author and auditor became the same afternoon

This team exists because of author ≠ auditor (`technology.md:860`). At one-founder scale
that separation is organizational fiction unless it is enforced by artifacts: the same
session writes the migration and, when the parity gate goes red, adjusts the gate. Perfectly
rational each time — the gate is "obviously" wrong, the migration is "obviously" right. Six
months later the gate encodes the drift instead of detecting it, and the 27-tables /
403-columns incident recorded at `scripts/check_schema_parity.sh:6-11` can happen again with
a green badge on top.

**Earliest observable signal.** **A single commit touching both `supabase/migrations/` and
a gate script or its workflow.** One commit, both sides of the seam. It is greppable, it is
unambiguous, and it costs nothing to check on every push.

**What would have prevented it.** Gate scripts and migrations are **never modified in the
same change** — a commit that touches both raises a finding into `OPEN-DECISIONS.md`
automatically. Where a *person* cannot be independent, the *artifact* can be: the verdict is
written by the job, not typed by the author, and
`schema.days_since_hand_applied_ddl` resets **publicly**. The red belongs to the auditor to
declare and to [[schema-migrations-charter]] to clear with a file.

---

### M4 — We measured what was measurable, and the number looked good

`sre.mttd_silent_corruption` is ≤24h for schema drift, because a daily cron exists
(`schema-parity.yml:26-28`). **Tenant leakage and stock divergence are unmeasured**
(`technology.md:825-827`). Reported as a single department number, MTTD reads "≤24h" and
looks like a solved problem — while the two failure modes that would actually end the
company (a restaurant seeing another restaurant's data; stock silently wrong for a month)
contribute nothing to it, because you cannot average over a set you have not measured.

**Earliest observable signal.** MTTD reported as **one number** anywhere — a board, a
summary, a slide. The aggregation *is* the failure; it happens the first time someone wants
a single cell in a table.

**What would have prevented it.** MTTD is reported **per invariant class**, always, with
unmeasured classes shown as **"unmeasured"** rather than omitted — the same discipline
[[observability-telemetry-plumbing-charter]] applies in refusing to conflate `0` with
`unknown`. An unmeasured class is a visible hole in the board, not a gap in a footnote.

---

### M5 — Tenant leakage was detected by an agent and read by nobody

`state_invariant_enforcer.py:1-30` includes **tenant leakage detection** — the single
highest-consequence check in the department. Its findings flow to `decision_log` and
`drift_findings` along with everything else: sync loops, double writes, LLM-output review
signals. A cross-tenant row appears, it becomes finding #217 in a queue of 400, and the one
finding whose correct response is "stop everything now" is indistinguishable from routine
drift. Twelve months later it surfaces via a customer, not via the detector that caught it
in March.

**Earliest observable signal.** A tenant-leakage finding sitting in the queue with the same
status, priority, and routing as a catalogue-drift finding — visible the moment the schema
is looked at, before any leak occurs.

**What would have prevented it.** **Severity is structural, not a column.** Tenant leakage
gets its own alert path — immediate, out-of-band, human, and separate from the findings
queue entirely — because a queue is the wrong shape for a signal that must never wait.
Everything else can share the weekly cadence; this one cannot, and the design has to say so
before the first leak rather than after it.

---

## Cross-cutting

- **OD-24 is load-bearing here** (`technology.md:848`). If [[agent-fleet-charter]] owns the
  guardian agents' code and this team owns their findings, then M2's stub problem has two
  owners and, per the department's own rule, therefore none. Closing OD-24 is cheap now —
  two of the four agents are stubs — and expensive later.
- **[[red-team-charter]] should attack M4**, because a good-looking aggregate is the most
  socially comfortable failure in this document and the least likely to be challenged
  internally.
- Every mechanism above has a close-time in [[state-integrity-invariants-loops]].
