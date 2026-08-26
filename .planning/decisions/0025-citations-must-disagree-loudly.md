# ADR 0025 — Citations must disagree loudly

- **Status:** Proposed — needs the founder's lock (§0.1)
- **Date:** 2026-08-26
- **Supersedes:** nothing. **Retires:** see §7 — this ADR names its own retirement.
- **Related:** [0016](0016-ledgers-must-express-unknown.md) (dated-source rule),
  [0020](0020-no-fabricated-answers.md), `CLAUDE.md` §5b (claims must be re-checkable)

---

## 1. The decision in one line

**A citation must carry two independent anchors that a machine can compare — an id
and a line — and CI must fail when they disagree.** A single anchor cannot rot
loudly, and rot that is not loud is the whole problem.

---

## 2. What forced this

Three defects found by hand on 2026-08-26, then measured across the corpus.

| # | Defect | Why it survived |
|---|---|---|
| 1 | `studio.md` claimed a gateway route did not exist. It was added by the **same commit** that wrote the claim; production returns 401, not 404. | The OD id it cited had been renumbered on rebase. **The citation still resolved** — to a different, closed decision. |
| 2 | `settings.md` §10/§12/§13 still describe 22 dead toggles and say `enable_ai_autonomous_send` has no UI. OD-86 shipped both. | Every `file:line` in the paragraph resolved. The **prose** was what lied. |
| 3 | `privacy.md:59` anchors OD-27 at `OPEN-DECISIONS.md:27,74` → OD-05 and OD-81. | The anchor was **never** correct, and nothing ever re-read it. |

Each failed differently, and no single mechanism catches all three. That is the
finding — not "add a checker".

---

## 3. The measurement that decides it

All re-derived in this worktree; commands in
`.planning/decisions/evidence/0025-citation-rot.md`.

| Measure | Value |
|---|---|
| `OPEN-DECISIONS.md:N` citations across `.planning/` | **74** |
| …that also name an OD id next to the line | 23 |
| …where the line and the id **agree** | **0 of 23** |
| Register length (it is small — locating is not the problem) | 128 lines |
| Locators in `.planning/06-pages/` alone | 1,892 |
| Citations broken by one 6-line insert into `commands.ts` (`39abb348`) | all of them, still broken at HEAD |
| `OPEN-DECISIONS.md` — citations in, commits since Aug 1 | 74 in · **57 of 255 commits (22%)** |

**Read the first three rows together.** Line anchors into the register are
*100% wrong* — and that is the good news, because it is *measurable*. An id alone
is unfalsifiable: OD-83 renumbered to OD-88 and kept resolving, which is precisely
what hid defect #1 for a day. So the answer is not to pick the better anchor. It is
to **carry both and diff them**, converting a silent failure into a loud one.

---

## 4. What was rejected, and why

Four candidates were designed, then attacked by a dedicated adversarial pass whose
brief was to kill them (§3 of `CLAUDE.md`). Two died.

### Rejected — move defect state out of dossiers into the register

Motivating case was **misdiagnosed**: `87107109` shows the register *did* carry the
studio defect; the failure was the renumber. Measured cost: ~812 new register rows
(a 902% increase) funnelled into the single most-churned file in `.planning/`,
which has a documented history of silent id collisions. It converts 47
conflict-free dossiers into one maximally contended table. **Prevents nothing
measurable, costs the most.**

### Rejected — replace line anchors with ids or headings

The assigned attack on this (that headings are ambiguous) **failed honestly**:
headings are 99.88% unique. It dies for a better reason. Ids in this repo
renumber — `OD-58→61`, `OD-83→OD-88` — and a renumbered id **still resolves**.
This trades a detectable rot mode for an undetectable one. Rejecting it is the
direct lesson of defect #1.

### Downgraded to advisory — symbol-anchored citations

Diagnosis sound, enforcement not justified. Ceiling is ~21% true symbols and ~51%
unique strings; ~28% can be neither. The hypothesis that ranges drift worse than
points was tested and came back **false** (30.6% vs 30.7%), so the half a blocking
checker would exempt is *indistinguishable in risk* from the half it polices. A
gate that exempts half the corpus gets routed around. Advisory only.

### Adopted — make an unrunnable claim a failure

See §5. It survived attack and costs one line.

---

## 5. Adopted — Layer 0: a claim that cannot run is a FAILURE

`scripts/check_decision_claims.sh:149`:

```bash
if bash -c "$verify" >/dev/null 2>&1; then holds="yes"; else holds="no"; fi
```

For `status: open`, `holds="no"` counts as **passing**. A missing file (exit 2), a
typo (127), a renamed symbol and a deleted file are indistinguishable from "the bug
is still present". The script's own header already promises the opposite —
*"NEVER VACUOUS: a claim whose command cannot run is a FAILURE, not a skip."*
The implementation does not honour its own contract.

Two live instances:

- `CLAIMS.jsonl:25` (OD-78) greps `.env.example`, which **has never existed** in
  this repo (`git rev-list --all --objects -- .env.example` → empty; the real file
  is `env.example`). It is counted inside today's green `68 checked, 68 holding`.
- A **resolved** claim written with a leading `!` also passes on a missing file:
  `! grep -A 3 'def redeem_invite' <missing>.py | grep -q 'require_studio_role'`
  exits **0**. That is `CLAIMS.jsonl:38`, a **security** claim — renaming
  `studio_routes.py` leaves it green forever.

**Cost of the fix, measured:** strict mode breaks **exactly 1 of 68** claims —
OD-78, the one nobody has been checking. This is not a noise generator.

> **Note on the OD-78 example.** `fix/dossier-rot-sweep` repoints that one claim at
> the templates that exist, so once it merges `CLAIMS.jsonl:25` no longer names
> `.env.example`. That fixes the *instance*; it does not touch the blindness
> described above, which is what this section proposes to fix. The instance is
> quoted here as it stood when measured — the structural defect outlives it.

Note the trap found while measuring: classifying by stderr returns **0 of 68**,
because the only broken claim carries its own `2>/dev/null`. Only 2 of 68 claims
self-silence, and one of them is the broken one. **The fix must therefore strip or
forbid claim-level stderr suppression**, or it will certify the exact claim it was
built to catch.

---

## 6. Adopted — the pairing rule

1. A citation into a decision document carries **both** the id and the line:
   `OD-88 (OPEN-DECISIONS.md:63)`. Neither alone is admissible.
2. CI parses each pair, reads that line, and **fails if the row's id is not the
   cited id**. Renumber → caught. Row moves → caught. Both → caught.
3. Source citations stay as they are, with the symbol preferred where one exists
   (advisory, not blocking).
4. **Prose claims remain the job of `CLAIMS.jsonl`.** No locator mechanism can
   catch defect #2 — every anchor in it resolved. A quarter of dossier assertions
   state an *absence*, which no line-checker can verify at all.

The checker is ~15 lines and already written (§3 produced the 0-of-23 figure with
it). It is hermetic, needs no network, and runs in well under a second.

**What this does not solve, stated plainly:** it does not make prose true. Defect
#2 — a dossier describing shipped work as outstanding — passes every mechanism in
this ADR. That class is bounded only by `CLAIMS.jsonl` coverage and by not filing
defect state in prose that nothing re-reads.

---

## 7. Retire-to-write (§4)

This ADR adds two files (itself and its evidence note). It names for retirement,
with a measurement rather than a promise:

**469 of 522 files in `.planning/archive/` (89.8%) are byte-identical duplicates of
a live file — 6.4 MB of the 6.9 MB archive.** Retire-to-write has been satisfied by
*copying* documents into `archive/`, not by retiring them. Deleting the byte-identical
twins retires 469 documents against the 2 added here and costs nothing: every byte
is still present at the live path, and in git history regardless.

That is a bigger finding than the citation rot it was discovered beside, and it is
the founder's call whether to act on it — recorded here rather than acted on.

---

## 8. Open questions for the founder

1. **Lock or reject** the pairing rule (§6). It makes 23 existing citations fail
   immediately; they are all genuinely wrong, but someone must fix them.
2. **Strict mode (§5)** — ship now as a one-line change plus the OD-78 fix, or
   bundle it with §6?
3. **The 469 archive twins** — delete, or leave and drop the retire-to-write rule
   as unenforced? It currently scores ~1.2% (4 deletions against 347 additions in
   48 hours), which is a rule in name only.

---

## 9. Consequences

- Every decision citation gets two anchors; writing one costs a few seconds more.
- One CI job gains a check that fails 23 times on day one.
- `CLAIMS.jsonl` gains a real contract: an unrunnable claim stops the build.
- The corpus loses ~469 duplicate files, if §8.3 is answered yes.
- Dossier **prose** remains unguarded. Nothing here changes that, and pretending
  otherwise would repeat the mistake this ADR exists to correct.

---

## 10. Amendment, 2026-08-26 — a line anchor has a shelf life of hours

Added by `docs/adr0025-prose-corrections`. This section records two things the ADR
did not price: what the pairing rule costs to *keep* green, and what the sweep it
forces turns up on the way.

### 10.1 The enforcement landed elsewhere, deliberately

§6.2's checker ships in [#110](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/110)
as `scripts/check_citation_pairing.py`. A second implementation was built in parallel
in this worktree — same rule, different name — and was **discarded rather than merged**:
two checkers enforcing one rule is the duplication §4 and `CLAUDE.md` §4 exist to
prevent, and neither was better enough to justify the other's removal. The cost of
finding out was one wasted branch; the cost of *not* finding out would have been a
silent double-guard, which is the same class of failure as the OD-id collisions in
`CLAUDE.md` §5b. **Check the open PRs before building a guard.**

### 10.2 The measurement §3 missed

§3 reports "74 citations, 23 id-paired, **0 of 23 agree**" and reads the unpaired
remainder as merely unchecked. Re-measured across all of `.planning/`:

| Measure | Value |
|---|---|
| Register anchors in the corpus | **78** |
| …carrying an id within 120 chars, so mechanically checkable | 35 |
| …carrying a line and **no id** | **43** |
| …of those 43, pointing into the register's **preamble block quote**, not at any row | **26** |

So the unpaired half is not unchecked — it is *demonstrably wrong*, and more wrong
than the paired half. The honest headline is **75 of 78 anchors wrong**, not 0 of 23.
That is why §6.1 was enforced as blocking rather than left advisory.

### 10.3 What this actually costs, measured twice in one hour

A line anchor into the register is invalidated by **any** concurrent merge that
inserts a row above it. This is not hypothetical; it happened twice while this
amendment was being written:

- Sweep A anchored OD-21 at `:127`, correct against the register at `c6e0477a`
  (98 rows). PR #107 merged five new Open rows; OD-21 moved to `:132` and
  **31 anchors on #110 went red** — caught by #110's own check, which is the rule
  working as designed.
- This branch then rebased onto `9e2dfdaf` and **17 of its own anchors** shifted by
  the same +5. They were re-pointed mechanically before commit.

The register took **57 commits in August** and five rows in forty minutes. Every PR
that adds a decision row turns every other open PR's citations red.

**This reopens §4's rejection of id-only anchors.** That rejection rests on "a
renumbered id still resolves" — but the pairing rule *already checks the id*, so
that failure mode is closed by §6.2 regardless of what the second anchor is. The
line is now the only half that rots, and it rots on every merge. A stable second
anchor (the row's heading text, or a `<a id>` the register carries itself) would be
diffable *and* immune to insertion. **Not proposed here** — that is a decision, and
§0.1 says it is not made until it is written. Filed so the next session does not
have to rediscover the cost.

### 10.4 What the sweep found in the prose

The anchors are the cheap half. Checking each citing sentence against the row it
names turned up claims that were wrong regardless of where they pointed — defect
class #2, which §6.4 says no locator can catch. The corrections in this PR:

| Document | The prose said | The register says |
|---|---|---|
| `harness-model-routing-agenda-full.md` | "**OD-20 is open and urgent** — an unguarded route drives paid Opus calls" | OD-20 ✅ closed by PR #31 on 2026-08-24 |
| `model-routing-inference-economics-agenda-full.md` | "Locked pricing is $20–50/mo" | OD-23: "it called $20–50/mo **locked** — **no ADR records any pricing**" |
| `ai-orchestration-charter.md` + 3 more | "OD-04 is explicitly downstream of OD-03" | OD-04's row no longer names OD-03 as blocker; its unblocker is now a job→model registry |
| `knowledge-documentation-charter.md` | five "open forks", incl. OD-08/OD-14/OD-21/OD-22 | four of the five sit in the **Resolved** table |
| `security-charter.md` | "the backlog has **not** been recounted"; 94 canonical | OD-19 re-measured 2026-08-26: the 94 arithmetic is struck, the figure is **40** |
| `architecture-review-charter.md`, `-agenda-board.md` | AR-4 "blocked: OD-11"; OD-20 open | both resolved; the founder dependency is gone |
| `OD-59-READOUT-AUDIT.md`, `OD-59-PYTHON-AUDIT.md` | two sentences quoted verbatim "from" the OD-59 row | that row was rewritten wholesale by `426984b3`; neither quote exists in the register any more |
| `intelligence.md` | "OD-19 and `foundation README.md:34-36` both say ~86 / ≈51" | neither ever said that; both said 94 / 32 |
| `design-charter.md` | "OD-23 (\$20k MRR)" | that is the claim OD-23 exists to retract |
| `product-vision-loops.md` | "3 forks, all with colliding OD ids" | resolved — renumbered PROD-F1/F2/F5 |

Ten documents, ~12 corrections. **None of them would have been found by the checker**,
and none would have been found without it either: the checker is what made someone
re-read the sentence. That is the argument for the sweep, and it is not an argument
the checker can make for itself.

### 10.5 Left open, named rather than fixed

- `product-vision-charter.md:135-139` cites the register as bare `(:24)`…`(:27)` with
  no `OPEN-DECISIONS.md:` prefix. **The checker's regex cannot see these**, and they
  are wrong. A prefix-less anchor is a hole in §6.2, not an exemption from it.
- The "~86 / ≈51" endpoint figures are load-bearing in ~14 further documents, all now
  downstream of an OD-19 that says **40**. `foundation/ENDPOINTS.md` is stale on the
  same point, which OD-19's own row states.
- The AR-0 seven-vs-eight-artifact cascade: OD-41 resolved it, three architecture-review
  documents still treat it as the open blocker in five places. None carries a register
  anchor, so nothing mechanical will surface it.
- **Two anchors in this very file are still wrong, and are left wrong on purpose.**
  §2's defect-#3 row exhibits a broken anchor as evidence (repairing it deletes the
  finding, so it needs an exemption marker, not a fix), and §6.1's own example cites
  OD-88 at a line that is no longer its row — the rule's illustration fails the rule.
  Both are pre-existing on `main` and both sit inside the edit range #110 is holding;
  fixing them here would conflict with it for no gain. Named so that "the ADR is
  clean" is not inferred from this PR.
