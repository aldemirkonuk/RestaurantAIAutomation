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
