---
type: premortem
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: partial
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-loops]]", "[[action-safety-the-human-gate-directive]]", "[[ai-orchestration-premortem]]", "[[harness-runtime-charter]]", "[[design-charter]]", "[[compliance-privacy-charter|compliance-and-privacy-charter]]", "[[red-team-charter]]", "[[technology]]"]
---

# Action Safety & the Human Gate — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this team has failed. What happened?

### 1. The gate was architecturally present and behaviorally absent

The seed premortem, `technology.md:447-449`: *"'Human-gated' degrades into a
confirmation dialog the founder clicks through fifty times a day; approval becomes
reflex; the gate is architecturally present and behaviorally absent — and the audit
trail says a human approved it."*

Expanded, because the mechanism is not laziness — it is **rational adaptation**. The
proposals were right about 94% of the time. Reading each one carefully cost fifteen
seconds. Fifty a day is twelve minutes of reading to catch three errors, most of them
trivial. So the founder stopped reading, and that was, locally, the correct decision.
The gate did not fail; it was **out-economized**.

Then a proposal was wrong in a way that mattered — a reorder against a provider whose
terms had changed, on a lot that had already been counted — and the audit trail said,
truthfully and uselessly, that a human approved it at 09:14:22.

**Earliest observable signal.** `safety.median_time_to_confirm`, and more sharply the
**shape of its distribution**. A healthy gate has a long tail: most confirmations fast,
some slow, because some were actually thought about. When the tail disappears and the
distribution collapses to a spike near zero, approval has become reflex. A second
signal: `safety.rejection_rate` approaching zero. **A gate that never rejects anything
is not gating.**

**What would have prevented it.**
(a) **Instrument time-to-confirm from day one, before the volume arrives.** Retrofitting
it after the habit forms measures the habit, not the gate — and the data needed already
exists at `one-tap-actions.service.ts:245-246`.
(b) **Per-family autonomy tiers**, so low-stakes families (navigation assist, calendar
drafts) stop competing for the same attention as money and stock. Fifty confirmations a
day is the disease; five is a gate.
(c) **A deliberate friction floor** on the families `FUTURES.md` §8.2 gates hardest.
Friction is a cost, and it is the cost this team exists to spend correctly.

---

### 2. A new feature wrote to stock and nobody remembered the convention

The guarantee is currently upheld by **four independent conventions, not one
mechanism** (`technology.md:441`): `drift_agent.py:8-12`'s tiered autonomy, the
one-tap action center, the vendor-reply never-auto-send rule, and the UX optimizer's
never-auto-apply rule. Each is real. Each is a convention a competent engineer can
follow only if they know it exists.

Eighteen months in, a bakery-inventory feature shipped with a service that adjusted
stock directly. Not maliciously — the author had never touched `one-tap-actions/`, the
new code path was in a different module, and there was no check that would have
objected. `scripts/check_no_direct_stock_writes.sh:1-13` guards direct writes to the
stock tables, so the write went through `apply_stock_movement` and was, by that gate's
standard, correct. What was missing was the **confirmation**, and nothing tested for
that.

**Earliest observable signal.** `safety.schema_coverage` — the share of mutation entry
points behind the single action schema. Today it is partial by construction: four
conventions, four places. Every new mutation path that does not go through the schema
lowers it, and that is visible at PR time rather than at incident time.

**What would have prevented it.** A CI check in the shape of the ones that already
work — `check_no_direct_stock_writes.sh` proves the pattern is viable in this repo. The
new check asks a different question: not *"did this write go through
`apply_stock_movement`"* but *"is there a confirmation record upstream of this
mutation"*. Same mechanism, different invariant.

---

### 3. `recurring_order_agent` auto-executed and the approval was theoretical

`agents/recurring_order_agent.py:14` is a plain class, registered nowhere, referenced
by nothing but its own test — and its feature list includes **"Auto-execution with
manager approval"** and *"Daily checks for due orders"*. Somebody wired it up. The
"manager approval" turned out to be a flag on a database row set at configuration time
— a standing approval for a class of future orders, not a confirmation of any
particular one.

That is a defensible product decision. It is not the guarantee in `FUTURES.md` §8.1,
which says *"AI never silently mutates stock, money, or outbound vendor email"* —
and a standing pre-approval for orders not yet composed is exactly a silent mutation
with paperwork.

**Earliest observable signal.** Available **today**, before it is wired up: an
auto-execution path outside the one-tap action center, in a module with no harness
guarantees. It is a code-reading finding, not a metric.

**What would have prevented it.** A definition, written down before it is contested:
**a confirmation is a human decision about a specific, composed action.** A standing
approval for a class of future actions is an **autonomy tier**, not a confirmation, and
it belongs in the allowlist with its own risk assessment. Both can exist. Conflating
them is what fails.

---

### 4. The allowlist grew until it allowed everything

`FUTURES.md` §8.2 defines seven action families and gates five things harder: *"mass
deletes, changing billing, granting permissions, sending email without draft review,
guest PII exports."* Over a year, each addition to the allowlist was individually
reasonable and had a customer behind it. Nobody ever removed one. By month eighteen the
allowlist described the whole product, "allowlisted" meant "implemented", and the
distinction that made it a safety control was gone.

**Earliest observable signal.** The **ratio** of allowlist additions to removals over a
quarter. An allowlist that only grows is a feature list with a safety-sounding name.
The first quarter with additions and zero removals is the signal — the same shape
[[skills-charter]] uses for `skills.deletions_per_quarter`.

**What would have prevented it.** Every allowlist addition names **what it would take
to remove it**, and the five hard-gated families of `FUTURES.md` §8.2 require an
ADR to move — not a PR. Plus a standing review that asks which families have not been
used, because an unused allowlisted family is pure risk with no benefit.

---

### 5. The audit trail recorded the click and lost the context

Every execution had `executed_by` and `executed_at` (`one-tap-actions.service.ts:245-246`)
and emitted an `action_executed` event (`:267`). Then a disputed order arrived, and the
question was not *who clicked* but **what they were shown when they clicked**. The
proposal had been generated from a prompt, a model, a set of retrieved facts, and a
confidence score, none of which were captured alongside the confirmation. The audit
trail could prove a human approved something. It could not reconstruct what.

This is the same failure the neural footprint exists to prevent —
[[README]] §4.1 defines it as *"enough signal to model why it chose what it chose, not
merely what it chose."* A confirmation without its proposal context is a footprint with
the reasoning cut out.

**Earliest observable signal.** Any confirmation record that cannot answer *"what was on
the screen"*. Checkable today, on the existing `one-tap-actions` rows.

**What would have prevented it.** The confirmation record links to the **proposal
snapshot**: the rendered summary, the model and prompt version, the confidence, and the
facts retrieved. `drift_agent.py:17` already does the analogous thing — *"Every run and
every finding writes a `decision_log` row."* The pattern exists in the repo. It just
does not extend to the moment that matters most.

---

**For [[red-team-charter]]:** the highest-value attack here is not a bypass of the
gate. It is #1 — demonstrate that the gate is passed reflexively — and the cheapest
demonstration is a distribution plot of `time_to_confirm` once it exists.
