---
type: premortem
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-schedule]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-charter]]", "[[narrative-collateral-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[red-team-charter]]", "[[OPEN-DECISIONS]]"]
---

# Positioning & Fundraise Readiness — Premortem

> Written at founding, before success is assumed.

The department premortem ([[strategy-fundraising-premortem]]) covers the five ways the
*function* fails. This file covers the five ways the **work** fails — the operational
mechanisms that sit inside them. They are not restatements: M1–M5 describe what the outside
world sees; P1–P5 describe what happens at the desk to produce it.

The inherited line from `corporate.md:453-456` — *the deck outruns the build* — is
department-level M1. Everything here is upstream of it.

---

## P1 — The register is written once and never re-read

**It is 12 months from now.** The claim register exists. It was built in week two, seeded
with seven claims, and it is complete and beautiful and **eleven months old**. Nobody
consults it before sending, because consulting it is a step and sending is a deadline. It
has become a document *about* the discipline rather than the discipline itself.

This is the most likely single failure in this file, and the reason is structural: a
register is a **noun**, and the thing that actually prevents overstatement is a **verb**.
Every register that has ever gone stale went stale this way.

**Earliest observable signal.** The gap between an artifact's send date and the most recent
`last_verified` date on any claim it contains. If that gap is ever greater than zero for a
claim whose source has changed, the register is decorative. Measurable from the first send.

Second signal, cheaper: **the register's own file has not been modified in a month while
outward artifacts have been produced.** That is a two-line `git log` comparison.

**What would have prevented it.** The register is only ever touched **as part of sending**
— never as a maintenance task ([[positioning-fundraise-readiness-directive]] R1). There is
no "register upkeep" job on [[positioning-fundraise-readiness-schedule]] separate from the
send checklist, deliberately: a maintenance cadence would let the register be current while
the practice is dead, which is the worst of both. If nothing is being sent, the register is
*correctly* untouched, and the 60-day staleness sweep reads that as a true signal rather
than a defect.

---

## P2 — Verification degrades into a timestamp

**It is 12 months from now.** Every claim in the register carries a `last_verified` date.
Every date is recent. And several are wrong, because "verify" came to mean *re-read the
claim and agree with it* rather than *re-execute the check against the source*. The register
records confidence, not evidence.

**This has already happened once, in this repo, on this department's founding document.**
`YC_WEDGE_PLAN.md:404` reads *"all re-confirmed 2026-07-27"* against an assertion that
`apps/api-gateway/src/ux-optimizer/` has zero `@UseGuards`. The controller now carries
`@UseGuards(JwtAuthGuard)` at `:55`, and the **same document** marks that very track ✅
secured at `:339`. The re-confirmation was sincere and the sentence outlived it. That is not
a warning about a possible failure; it is a completed instance of it, sitting in the file
this team inherits.

**Earliest observable signal.** A verification event with **no recorded output**. A real
re-verification produces a result — `holds`, `drifted to :N`, `inverted`, `gone`. A date
alone is the tell, and it is visible in the register's own schema.

Second signal: a `citation-reverify` run reporting **zero drift** across a document older
than a month. The founding artifact drifted at three points in under a month of commits; a
clean sweep more likely means the checker failed to resolve the paths than that nothing
moved ([[positioning-fundraise-readiness-schedule]]).

**What would have prevented it.** Verification writes a **result**, not a date — the schema
makes a bare timestamp impossible to record. Citations carry the **symbol** alongside the
line (`ReceivingWorkspace.tsx` → the `invoiceQty` input), so drift degrades into a search
instead of a falsehood. And behavioural evidence is preferred over positional: a demo that
runs cannot silently drift; a line number always can.

---

## P3 — The team writes the deck instead of checking it

**It is 12 months from now.** A deadline arrived, [[narrative-collateral-charter]] was
mid-sprint, and this team wrote the slides "just this once" because it knew the argument
best. It did that four more times. Now Media & Brand builds collateral this team has
already drafted, this team reviews its own copy, and the check that gave the department its
independence has quietly stopped existing — because **you cannot audit your own claim**.

The pull toward this is strong and worth naming: this team holds the sharpest version of the
argument, and holding it makes writing it feel efficient. Efficiency is exactly the disguise.

**Earliest observable signal.** Any outward artifact whose author and whose verifier are the
same unit. One instance is the signal; it does not need to recur to be diagnosed.

Second signal, earlier still: a file **in this team's own directory** that contains slide
copy, tagline drafts, or a narrative arc rather than claims and evidence. The Dataview query
in [[positioning-fundraise-readiness-agenda-board]] watches for it inside our own vault,
which is the cheapest place to catch it.

**What would have prevented it.** [[positioning-fundraise-readiness-directive]] R5, stated
as a hard separation rather than a preference: **this team never authors an outward
artifact.** It supplies the sentence, the claims, and the evidence; M2 writes. When M2
cannot meet a deadline, the correct outcome is the artifact slipping, not the check
dissolving. That trade is written down now, while no deadline exists, precisely because it
will not feel obvious on the day.

The same logic already governs its Legal sibling: [[instruments-equity-charter]] owns **no
generative drafting skill at all**, for the same reason — the class of document where a
plausible draft does the most damage is the class where the checker must not also be the
author.

---

## P4 — Readiness is measured by document count

**It is 12 months from now.** The diligence pack is "80% complete." It contains eighteen
documents. A term-sheet conversation opened, the investor asked four questions, and **three
of them are not answerable from the pack** — because completeness was measured by slots
filled rather than by questions answered. Meanwhile `strategy.claim_to_evidence_coverage`
never moved, because the year went into filling slots.

This is the operational shape of department-level M3, and it is also how the deferred
second team grows inside the first one without ever being chartered: not by a decision, but
by a metric that rewards volume.

**Earliest observable signal.** Two metrics moving in opposite directions in the same
quarter — `strategy.diligence_pack_completeness` rising while
`strategy.claim_to_evidence_coverage` does not. Readable as a chart before it is readable as
a lost meeting ([[positioning-fundraise-readiness-loops]] L-PFR-5).

Second signal: a diligence artifact existing **before the split trigger has fired**. There
is exactly one that is defensible in advance — a one-page index of where things would live.
A second one is the symptom, not a head start.

**What would have prevented it.** Two counter-pressures:

1. **R4** — beyond the one-page index, nothing is built before the trigger
   (`corporate.md:457-458`). Readiness is triggered; claim work is continuous.
2. **Completeness is defined by answerability, not by slots.** The metric's denominator is a
   list of *questions a diligence reader would ask*, each with a named answer location — not
   a list of documents. A pack that is 40% complete against real questions is worth more
   than one that is 100% complete against a template, and the metric has to be able to say
   so.

---

## P5 — Truth is enforced downward and not upward

**It is 12 months from now.** This team has reviewed sixteen blog posts, flagged four
overstatements, and built a genuinely working editorial discipline with Growth. It has never
once flagged the founder's verbal pitch — which carries the strongest claim the company
makes, to the highest-stakes audience, with no artifact and therefore no gate. The register
covers everything except the thing that matters most.

**The mechanism is not cowardice; it is surface.** Written claims produce a file to check.
Spoken claims produce nothing. A process built around artifacts is structurally blind to the
channel where the biggest claims travel first, and this team reports to the person making
them.

**Earliest observable signal.** The register contains **zero rows with `channel: spoken`**
after any month in which an external conversation happened. A pitch is a publication with no
artifact; an empty spoken column is not evidence of restraint, it is evidence of a blind
spot.

Second signal: a number appears in an external conversation that is **not in the register at
all** — discovered afterwards, from a follow-up email quoting it back. By then the claim is
in somebody else's notes.

**What would have prevented it.** Three things, all of which are cheap now and awkward later:

1. **R6 — spoken claims are claims.** After any external conversation where a number was
   given, it is entered within 24 hours with its evidence. Retroactive entry is a weaker
   control than a gate, and it is the only one available for a channel with no artifact.
2. **R7 — the rule points upward**, in writing, before the next send. Written down at
   founding, while nobody is defending a specific claim.
3. **The founder is asked to confirm R7 explicitly** — [[strategy-fundraising-agenda-full]]
   Q4. An assumption that this team may correct the founder is worth converting into an
   answer while it costs nothing.

[[red-team-charter]] is the natural backstop: advisory is findings-only
([[ORG_STRUCTURE]] §3), and a team whose independence depends on its own willingness to be
awkward needs an external reader who does not.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| P1 | Register written once, never re-read | Send date newer than the claim's `last_verified` on a changed source; register file untouched while artifacts ship | Register is touched **only** as part of sending; no separate upkeep job |
| P2 | Verification degrades into a timestamp | A verification event with no recorded result; a zero-drift sweep on a month-old doc | Verification writes a result, not a date; symbols travel with line numbers; demos over positions |
| P3 | The team writes the deck | Author and verifier are the same unit; slide copy inside this team's directory | R5 — never author an outward artifact; the artifact slips, the check does not |
| P4 | Readiness measured by document count | Completeness rises while claim coverage does not; any diligence artifact before the trigger | R4 — one-page index only; completeness measured by answerability |
| P5 | Truth enforced downward only | Zero `channel: spoken` rows after a month with external conversations | R6 spoken-claim capture; R7 upward rule; founder confirms R7 |
