---
type: premortem
division: corporate
department: knowledge-documentation
team: standards-verification
status: provisional
metrics: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.docs_past_60_day_rule]
updated: 2026-08-24
links: ["[[standards-verification-charter]]", "[[standards-verification-loops]]", "[[standards-verification-directive]]", "[[knowledge-documentation-premortem]]", "[[decision-office-charter]]", "[[positioning-fundraise-readiness-charter]]"]
---

# Standards & Verification — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. The corpus is authoritative in tone and stale in fact, and agents are
acting on it. Here is how, most likely first.

---

## M1 — Standards shipped as a style guide nobody runs

**What happened.** The team's first deliverable was a documentation quality bar: structure,
tone, citation format, a checklist. It was well written. It was also unexecutable, so
nothing ever failed it. Meanwhile `standards.stale_claim_rate` was never instrumented,
because instrumenting it is hard and writing guidance is not. Twelve months later the corpus
still held three different counts of its own insight engine, `md/DOCUMENTATION_INDEX.md`
passed its 19-month anniversary of being wrong, and the team's output was a document about
documents.

This is the failure `corporate.md:223-226` predicts by name, and it is first here because
it is the *comfortable* one — every day spent writing guidance feels like the job.

**Earliest observable signal.** `standards.stale_claim_rate` has **no value** after 60
days. Not a bad value — no value. The tell is a metric that was never instrumented while
adjacent documents multiply.

**What would have prevented it.** Sequencing the mechanism ahead of the guidance, enforced
by [[standards-verification-directive]]: **the team may not publish a standard it cannot
check.** Concretely, the first deliverable is claim-pinning on the insight-count case — a
test that fixes the number, then a regeneration of the documents quoting it — not a page
explaining why numbers should be pinned.

---

## M2 — The team decided the truth instead of reporting the disagreement

**What happened.** Under pressure to close the 375/573/348 contradiction, the team picked
one. It chose 573, because two documents said it and one said 375, and majority felt like
evidence. It was wrong — the number had drifted with an edit to `DIMENSIONS` months
earlier — and now a wrong number was *endorsed* rather than merely repeated. The YC
narrative carried it (`YC_WEDGE_PLAN.md:324`). A partner asked. The team that had been
founded to prevent unverified claims had authored one.

**Earliest observable signal.** Any correction commit from this team that changes a domain
value without a link to an assertable source or a decision from the owning unit. Visible in
review, every time.

**What would have prevented it.** The hard rule in [[standards-verification-directive]]:
**this team proves disagreement and unassertability; it never adjudicates domain truth.**
The output for the insight count is *"three documents disagree; the source is computed at
import time; the only test asserts `>= 200`; here is what would pin it"* — and the number
itself is set by whoever owns `insight-catalog.ts`, with the external-facing decision
routed to [[positioning-fundraise-readiness-charter]].

---

## M3 — Verification became a sampling ritual with no teeth

**What happened.** The weekly claim sample ran. It produced a rate. The rate was 18% and
stayed 18% for a year, because findings were raised against other departments and nothing
compelled anyone to act on them. This team had findings-only authority by analogy with the
advisory layer, no escalation clock, and a growing backlog that everyone had learned to
scroll past. The measurement was real and completely inert.

**Earliest observable signal.** `standards.correction_age_days` rising while
`standards.stale_claim_rate` is flat. Two flat lines and one rising line is the signature —
work is being found and not fixed.

**What would have prevented it.** The **age-based escalation** in
[[knowledge-documentation-loops]] L-KD-4: a correction raised against another unit and
unacknowledged for 30 days escalates to [[decision-office-charter]] *regardless of
severity*, because the failure is silence rather than disagreement. Findings-only authority
without an escalation clock is a suggestion box.

---

## M4 — The 60-day rule was applied to everyone except this department

**What happened.** The staleness sweep ran org-wide and produced a useful list. But the 21
provisional agendas inside Knowledge & Documentation were exempted — informally, never in
writing — because the department was "still standing up." By 2027 this department had the
oldest untouched agendas in the company, and the team enforcing the rule was the largest
violator of it. Every other unit noticed, and compliance elsewhere collapsed accordingly.

**Earliest observable signal.** **2026-10-23.** That is 60 days from the founding date of
these 28 documents, and it is written into [[knowledge-documentation-agenda-board]] as a
date rather than a rule so it cannot be quietly not-noticed.

**What would have prevented it.** The sweep running over `01-org/` and `02-advisory/`
without exclusions, this department's own documents appearing in the output first (they are
the oldest at any given moment because they were written first), and a standing rule that
this team's exemption requires a written founder decision — never a team judgement.

---

## M5 — The companion docs were hand-edited, and nobody could tell

**What happened.** `ENDPOINTS.md`, `PAGE_MAP.md`, and `EXTERNAL_CONNECTIONS.md` are
declared *"regenerated rather than hand-edited"* ([[README|foundation-README]] §0). Someone fixed a
typo in `ENDPOINTS.md`. Someone else corrected a route by hand. Then the generator was run
and silently reverted both — or worse, was never run again because its output no longer
matched and re-running it looked like a regression. The three documents drifted from the
scan that produced them, while carrying a header asserting they were generated. A generated
document that is secretly hand-maintained is the most trusted stale document in a corpus,
because its provenance claim is doing the lying.

**Earliest observable signal.** A diff to any of the three files that is not the output of
its generator. Detectable mechanically: re-run the generator in CI and compare.

**What would have prevented it.** The monthly regeneration job comparing generator output
against the committed file, and a per-PR check rejecting hand edits to the three. The
foundation document already made the claim; nothing enforced it — which is M1's pattern
appearing in a specific, high-trust place.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | Style guide nobody runs | no value for `standards.stale_claim_rate` at 60d | May not publish a standard it cannot check |
| M2 | Team adjudicated domain truth | a correction with no assertable source | Prove disagreement; never decide the value |
| M3 | Sampling ritual with no teeth | correction age rising, stale rate flat | 30-day age escalation to Decision Office |
| M4 | 60-day rule exempts its author | **2026-10-23**, a date already on the board | No exclusions; exemption needs a founder decision |
| M5 | Companion docs hand-edited | a diff that is not generator output | Regenerate-and-compare in CI |
