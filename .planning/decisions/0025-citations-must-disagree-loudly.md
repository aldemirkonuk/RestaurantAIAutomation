# ADR 0025 — Citations must disagree loudly

- **Status:** **Locked** — all three §8 questions answered by the founder 2026-08-26.
- **Date:** 2026-08-26 (proposed and locked the same day)
- **Supersedes:** nothing. **Retires:** 469 archive files — see §7, now executed.
- **Related:** [0016](0016-ledgers-must-express-unknown.md) (dated-source rule),
  [0020](0020-no-fabricated-answers.md), `CLAUDE.md` §5b (claims must be re-checkable)

**What the founder decided, 2026-08-26:**

| § | Question | Answer | Where it lives now |
|---|---|---|---|
| 6 | The pairing rule | **Locked** | `scripts/check_citation_pairing.py`, wired into the `decision-claims` CI job |
| 5 | Strict mode for unrunnable claims | **Ship now**, not bundled | `scripts/check_decision_claims.sh` |
| 7 | The 469 archive twins | **Delete** | done; 53 non-identical files kept |

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
| 3 | `privacy.md:59` anchors OD-27 at `OPEN-DECISIONS.md:27,74` → **as measured 2026-08-26** those lines held OD-05 and OD-81. <!-- cite-example: this row quotes a defect; the anchors are wrong on purpose --> | The anchor was **never** correct, and nothing ever re-read it. |

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
| **Re-derived at lock time** (`origin/main` = `4c6eb6d2`, five PRs later) | **78** citations, **36** unanchored, **38** id-paired, **0 of 38** agreeing |
| Locators in `.planning/06-pages/` alone | 1,892 |
| Citations broken by one 6-line insert into `commands.ts` (`39abb348`) | all of them, still broken at HEAD |
| `OPEN-DECISIONS.md` — citations in, commits since Aug 1 | 74 in · **57 of 255 commits (22%)** |

The last row is the same measurement taken again at lock time rather than copied
forward (§5b). The extraction is wider — it pairs a locator with the nearest id
anywhere on its line, not only one immediately before it, and it scans source
files too — which is why 23 became 38. **The headline is unchanged: still zero.**

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

> **SHIPPED 2026-08-26.** Founder answered §8.2 "ship now", not bundled.
> `scripts/check_decision_claims.sh` now captures stderr and fails at exit 2 on
> exit 126/127 or a cannot-run signature, whatever the claim's own exit code
> says — and rejects any `verify` containing `2>`, because a claim that muzzles
> itself defeats the classification. **Cost on arrival: 0 of 94 claims**, not
> the 1 of 68 measured below; the OD-78 instance had already been repointed by
> `fix/dossier-rot-sweep`, exactly as the note at the end of this section
> predicted. One claim changed: OD-93 lost the `2>&1` from `>/dev/null 2>&1`.
>
> **Four cannot-run states were run against the guard before it was changed,
> not assumed.** Malformed JSON already exited 2 and was left alone. The other
> three all passed and turned the whole run green: an `open` claim grepping a
> missing file (grep exit 2), a `resolved` claim whose leading `!` inverts a
> missing-file error into exit 0, and an `open` claim whose command does not
> exist (exit 127). All three now exit 2. The negation case is why exit status
> alone cannot carry this rule.

`scripts/check_decision_claims.sh:149` as it stood when this was written:

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

> **LOCKED and SHIPPED 2026-08-26.** Founder answered §8.1 "lock".
> `scripts/check_citation_pairing.py`, wired as a second step of the
> `decision-claims` job in `.github/workflows/ci.yml`. It enforces **both** rules
> below, not only rule 2: a pair-only check is routed around by dropping the id,
> which is the same "gate that exempts half the corpus" objection §4 uses to
> reject symbol anchors. Exit 2 — never 0 — when the register is missing, parses
> to fewer than 50 rows, or the scan finds fewer than 20 citations.
>
> **The checker this ADR called "already written" did not exist in the tree.** It
> lived only in the transcript of the session that produced the 0-of-23 figure,
> which is an instance of the failure this ADR is about. It has been rewritten as
> a file.
>
> **74 citations were repointed** to satisfy it. Three are not fixed: two in
> `06-pages/privacy.md` and one in `06-pages/settings.md`, owned by a concurrent
> branch. They sit on `PAIRING_DEBT` in the checker, with their correct anchors,
> and in `.planning/04-specs/HANDOFF-adr-0025.md`. That list is a two-PR handoff
> and shrinks to nothing; it is **not** a permanent debt ratchet, and unlike
> `KNOWN_MISSING` a stale entry there is a notice rather than a red build,
> because the whole point is that another PR is fixing those lines right now.

1. A citation into a decision document carries **both** the id and the line:
   `OD-88 (OPEN-DECISIONS.md:54)`. Neither alone is admissible. *(This example's
   own line number rotted from `:56` within the hour this guard shipped — a
   different session's checker caught it against `main` before the guard's own
   CI run did. Repaired here rather than left as a lesson: the id half held, the
   line half didn't, which is `§6.2`'s whole justification working exactly as
   argued.)*
2. CI parses each pair, reads that line, and **fails if the row's id is not the
   cited id**. Renumber → caught. Row moves → caught. Both → caught.
3. Source citations stay as they are, with the symbol preferred where one exists
   (advisory, not blocking).
4. **Prose claims remain the job of `CLAIMS.jsonl`.** No locator mechanism can
   catch defect #2 — every anchor in it resolved. A quarter of dossier assertions
   state an *absence*, which no line-checker can verify at all.

~~The checker is ~15 lines and already written (§3 produced the 0-of-23 figure with
it).~~ — **struck 2026-08-26: it was not written, it was transcript.** The real
one is `scripts/check_citation_pairing.py`. It is hermetic, stdlib-only, needs no
network, and runs in well under a second on the whole repository.

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

~~That is a bigger finding than the citation rot it was discovered beside, and it is
the founder's call whether to act on it — recorded here rather than acted on.~~

> **DONE 2026-08-26.** Founder answered §8.3 "delete".
>
> The count was **re-derived, not trusted**: every file under `.planning/archive/`
> hashed with SHA-256 and matched against a hash of the whole live tree at
> `origin/main` = `4c6eb6d2`, five PRs after the original measurement. It
> reproduced exactly — **522 archive files, 469 with a byte-identical twin at a
> live path today, 53 without; 6.4 MB of 6.9 MB.** The 469 are deleted in their
> own commit so the deletion can be reverted without touching the guards. The 53
> are untouched, including `ROADMAP-pre-P2-20260825.md` and
> `STATE-pre-P2-20260825.md`, which are the only archive files anything else
> cites (ADR 0018).
>
> Nothing is lost: every deleted byte is still at its live path and in history —
> verified by re-hashing one twin out of `git show HEAD^:<path>` after the delete.
>
> Retire-to-write is now paid several hundred times over: 469 retired against the
> 4 files this decision has added (itself, its evidence note, the checker, the
> handoff).

---

## 8. Answered — 2026-08-26

All three were put to the founder and all three came back the same day.

**1. The pairing rule (§6) — LOCKED.** Re-measured at lock time it was 74
citations to fix, not 23: the enforced rule covers unanchored locators as well as
disagreeing pairs, and the wider extraction found more of both. **74 were fixed in
this branch.** Three more were initially deferred as `PAIRING_DEBT` — a concurrent
branch owned the six page dossiers at the time, and two branches rewriting the
same lines produces a conflict rather than a fix. By the time this branch was
rebased for merge, #106 had landed and closed that ownership; re-checked, no open
PR touched those two files, so the debt was closed rather than carried: **all 76
are fixed, `PAIRING_DEBT` is empty.** `.planning/04-specs/HANDOFF-adr-0025.md`
keeps the record of what was deferred and why, for the next time this shape
recurs.

**2. Strict mode (§5) — SHIPPED NOW,** unbundled. It cost 0 build failures rather
than the 1 predicted, because the predicted instance had already been fixed
elsewhere. The measurement that mattered was not the cost but the *behaviour*:
three of the four cannot-run states were certifying themselves, including one on a
security claim.

**3. The 469 archive twins — DELETED.** Re-derived rather than trusted, and the
figure reproduced exactly at 469 of 522. See §7.

**What was NOT decided here, and stays open.** The escape hatch this guard needs —
a document that quotes a broken citation in order to explain it, as §2 row 3 of
this ADR does — is implemented as a `cite-example` marker with a hard ceiling of
two uses. That ceiling is a judgement made by a session, not a founder call. If
the corpus ever legitimately needs a third, raising it is a decision someone
should take deliberately rather than a number that drifts.

---

## 9. Consequences

- Every decision citation gets two anchors; writing one costs a few seconds more.
- The `decision-claims` job gained a second step. It failed **74 times** on day
  one, not 23 — every one of them a real defect, all 74 fixed here.
- `CLAIMS.jsonl` gained a real contract: an unrunnable claim stops the build, and
  a claim may no longer suppress its own stderr.
- The corpus lost 469 duplicate files and 6.4 MB.
- **A second shrink-only list now exists** (`PAIRING_DEBT`), and it is deliberately
  softer than `KNOWN_MISSING`: a stale entry is a notice, not a failure. That
  softness is a real cost, and it is bounded only by someone emptying the list once
  the concurrent branch merges. If it is still there in a week, it has become the
  thing it was built to avoid.
- Dossier **prose** remains unguarded. Nothing here changes that, and pretending
  otherwise would repeat the mistake this ADR exists to correct. One live instance
  was found while fixing anchors and is recorded in the handoff: `security-charter.md`
  says the 94-endpoint figure is "canonical in" OD-19, and OD-19 now says 40. Every
  anchor in that sentence resolves. It is defect #2, still unsolved, by design.

---

## 10. Amendment, 2026-08-26 — a line anchor has a shelf life of hours

Added by `docs/adr0025-prose-corrections`. This section records two things the ADR
did not price: what the pairing rule costs to *keep* green, and what the sweep it
forces turns up on the way.

### 10.1 The enforcement landed elsewhere, deliberately

§6.2's checker shipped in [#110](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/110)
as `scripts/check_citation_pairing.py`, merged `c856b99e`. A second implementation was built in parallel
in this worktree — same rule, different name — and was **discarded rather than merged**:
two checkers enforcing one rule is the duplication §4 and `CLAUDE.md` §4 exist to
prevent, and neither was better enough to justify the other's removal. The cost of
finding out was one wasted branch; the cost of *not* finding out would have been a
silent double-guard, which is the same class of failure as the OD-id collisions in
`CLAUDE.md` §5b. **Check the open PRs before building a guard.**

### 10.2 What the unpaired half turned out to be

§3's original row reads "74 citations, 23 id-paired, **0 of 23 agree**" and treats
the unpaired remainder as merely *unchecked*. It is not. Measured independently in
a second worktree, over `.planning/` only, pairing an id **within 120 characters
before** the locator:

| Measure | Value |
|---|---|
| Register anchors in `.planning/` | **78** |
| …carrying an id within 120 chars, so mechanically checkable | 35 |
| …carrying a line and **no id** | **43** |
| …of those 43, landing on the register's **preamble block quote**, not on any row | **26** |

**On the split, this disagrees with §3's re-derived row (38 paired / 36 unanchored)
and §3 is the one to quote.** The two extractions differ by design: §3 pairs with
the nearest id *anywhere* on the line and scans source files too, so it classifies
more locators as paired. Both agree on the total (78) and on the headline (zero
agreeing), and neither split changes any decision here. Recorded rather than
silently reconciled, because two numbers quietly disagreeing inside one ADR is the
failure this ADR exists to make loud.

The finding that survives either split is the **26**: those anchors are not
unchecked, they are *demonstrably wrong* — they resolve to prose in the register's
header, not to a decision. That is the evidence for enforcing §6.1 as blocking
rather than advisory, and it is independent of where the paired/unpaired line falls.

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
- Then #110 merged, and **`main` itself went red inside the hour** — [#115](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/115),
  *"OD-88's own worked example rotted"*. The rule's illustration in §6.1 was the
  first casualty of the rule. Three independent instances, one afternoon.

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

> **Answered 2026-08-27, and the answer is no.** Filed as a question so evidence
> could settle it; it did, within a day, and against the idea.
>
> Two failures landed that a better anchor format cannot reach, because neither
> carried a line anchor to improve:
>
> - **OD-79 cited across 58 references in 52 files**, all naming the *resolved*
>   email-verification decision. The fork doing the citing had no register row at
>   all. A bare `(OD-79)` in frontmatter is not a citation under §6, so the pairing
>   rule never saw it. Filed as OD-106; `scripts/check_od_ids_exist.py` now blocks
>   the *names-nothing* half and says in its own docstring that it cannot catch
>   *names-the-wrong-thing*.
> - **An ADR-number collision deleted three locked decisions.** Squash-merge
>   dropped the files; concurrent sessions then spent 0012 and 0013 on different
>   decisions, and ADR 0015's four citations resolved to the wrong decision for two
>   days. Restored as 0030/0031/0014.
>
> Meanwhile the cost this section prices turned out to be **tooling-shaped, not
> format-shaped**: `check_citation_pairing.py --fix` reduced a 27-anchor shift to a
> non-event, and repointed 15 on this branch in one command. The tax is real and it
> is paid by a script.
>
> So the distribution of real failures is *single-anchor and no-anchor references*,
> not drifting line anchors — and the answer was a second guard plus "file the
> register row before citing it", not a better anchor. §4's rejection of id-only
> anchors **stands**. Recorded by the author of the question, conceding it.

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

The proof is in the merge. #110 repointed the anchors in **every one of these ten
documents** and left all twelve sentences standing — it had to, because each one's
anchors resolved. §9's last bullet names one of them (`security-charter.md`'s "94,
canonical in OD-19", against an OD-19 that now says 40) as a live, unsolved instance
of defect #2. **This PR closes that instance and the other eleven beside it.**

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
