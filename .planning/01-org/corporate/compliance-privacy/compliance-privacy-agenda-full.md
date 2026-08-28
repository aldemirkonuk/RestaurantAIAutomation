---
type: agenda-full
division: corporate
department: compliance-privacy
status: active
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, privacy.store_inventory_coverage, compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, nf_b.research_store_erasability, regops.trigger_check_freshness]
updated: 2026-08-28
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-premortem]]", "[[compliance-privacy-directive]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-schedule]]", "[[compliance-privacy-agent-stack]]", "[[compliance-privacy-questions]]", "[[compliance-privacy-agenda-board]]", "[[privacy-engineering-charter]]", "[[privacy-engineering-agent-stack]]", "[[regulatory-posture-charter]]", "[[regulatory-posture-agent-stack]]", "[[regulated-operations-charter]]", "[[customer-relationship-research-charter]]", "[[media-brand-charter]]", "[[guest-identity-consent-charter]]", "[[guest-experience-charter]]", "[[taste-fingerprint-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[reliability-sre-charter]]", "[[commercial-workforce-agreements-charter]]", "[[legal-charter]]", "[[security-charter]]", "[[client-surfaces-charter]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[0006-neural-footprint-architecture]]", "[[0029-p3-plan-of-record]]", "[[0035-wave2-seam-reconciliation]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0039-activation-plan-of-record]]", "[[corporate]]"]
---

# Compliance & Privacy — Full Agenda

**Dated 2026-08-28.** Written under [[0039-activation-plan-of-record]] Track B and
`foundation/GENERATION_BRIEF.md` §8. This replaces the 2026-08-24 provisional
forecast. Every task below names a doneability, a close_time and the evidence that
makes it real; every reach item is graded, and the ones that are aspiration pending
a decision say so in the same sentence.

---

## 0. What changed since the last agenda, and why the shape is different

The 2026-08-24 agenda had four items. **One of them closed, and it closed the way
it was supposed to.**

- Item 4 was *"force the research-store erasability question into a dated decision —
  not resolve it, escalate it."* It escalated, and on 2026-08-28 the founder locked
  [[0037-nfb-erasure-is-crypto-shredding]]: NF-B's research store is designed for
  **crypto-shredding**, per-guest keys, erasure = key destruction. [[0035-wave2-seam-reconciliation]]
  had already assigned the orphaned `nfb-research-store-erasability` loop to
  [[privacy-engineering-charter]]. The department's largest open question is now a
  *design brief with an owner*, which is a different kind of work and gets its own
  programme below (§D).
- This also retires **RT-2** in [[compliance-privacy-questions]] — red team's finding
  was "register the fork"; the fork is decided, not registered. That file is outside
  this wave's write scope ([[0039-activation-plan-of-record]] §8.4), so the close is
  recorded here for whoever batches the questions files. **DO-7 is still live** and
  §C3/§C4 below are its answer.
- The other three items did not close and are not restated as if they had. They are
  §B, §C and §E, now with producers named and dates attached.

**Two things this session re-verified rather than transcribed, and both moved:**

1. **Every PII citation in this department's own documents has drifted.** The charter
   cites `constraint_engine.py:28-36`; `PII_PATTERNS` now lives at `:52-60` and is
   applied at `:137-138` (charter says `:113-117`). `provider_communication_agent.py`
   is applied at `:833`, not `:725-733`. `research_tasks.py`'s patterns are at
   `:102-103` and `_has_pii` has **two** call sites (`:801`, `:1116`), not one. Only
   `20260805000000_baseline_from_production.sql:1080` still lands where the charter
   says. This is a department whose entire product is citations, and its citations
   rotted in four days ([[0025-citations-must-disagree-loudly]] is the locked ADR for
   this exact class of failure). §B1 is the consequence.
2. **The department has been under-counting its own headline finding.** Not three
   definitions across four guards — see §B2. A fourth definition is running in
   production today and ships personal data off-box.

---

## 1. The spine — five programmes, one dormant track

| # | Programme | Owner | Why it is on this agenda now |
|---|---|---|---|
| **A** | **The consent-gate SPEC** | [[privacy-engineering-charter]] | [[customer-relationship-research-charter]] is scheduling against it *this wave*. Our close_time is literally their dependency. |
| **B** | **One PII definition** | [[privacy-engineering-charter]] | The founding finding, now measured as worse than recorded. Three definitions are mergeable; a fourth that exports email is a live flow. |
| **C** | **The obligation register + the notice's first real defect** | [[regulatory-posture-charter]] | `compliance.obligation_coverage` is still a verified 0%, and the public notice omits an entire data flow. |
| **D** | **Crypto-shredding key management** | [[privacy-engineering-charter]] | ADR 0037 locked the mechanism and named key management as the cost it owns going in. NF-B stays **HELD** — this is design, not build. |
| **E** | **The discovered denominator + first erasure drill** | [[privacy-engineering-charter]] | The primary metric has no producer. The missing piece turns out to already exist in CI. |
| **F** | **Regulated operations** | [[regulated-operations-charter]] ⏸ | Dormant behind its trigger. **One** task: run the check that keeps *dormant* from becoming *forgotten*. |

**Sequencing claim, unchanged from 2026-08-24 and now with a date on it:
prove → define → register.** The intuitive order writes the policy first because a
policy is what a counterparty asks for; that order produces
[[compliance-privacy-premortem]] M2, a register describing controls nobody has
exercised. What is *new* is that D and E have become cheap simultaneously — the
erasability mechanism is decided (ADR 0037) and the store-inventory publisher turns
out to already exist (§E1) — so the expensive half of "prove" is smaller than it was
four days ago.

**Grading key.** `COMMITTED` — evidence in hand, a named producer, no open fork.
`REACH` — real and worth attempting, but it needs another unit's agreement.
`ASPIRATION` — recorded because recording it now is cheap and later is not; it does
not proceed until a named decision lands.

---

## A. The consent-gate SPEC — the dependency Media & Brand is scheduling against

> **The finding that reframes this programme.** The department has been treating
> "the consent gate" as one thing. It is two, and the half that blocks Media & Brand
> is **not** the half the good schema solves.
>
> [[customer-relationship-research-charter]] gates on two subjects
> (`customer-relationship-research-charter.md:56-62`): **guests**, covered by the
> shipped consent columns, and **customers** — restaurants, whose public web presence
> may only be reviewed with their explicit approval, against *"an approval register
> that does not exist yet"*. The 564-line migration
> (`20260819000000_guest_identity_minimal_slice.sql`) is entirely about guests. The
> record that blocks their research is **B2B and unbuilt**, and nobody has said so in
> one sentence before this one.
>
> That is good news for a schedule: the blocking half is small, has no ML cost, no
> append-only tension, and no NF-B dependency.

### A1 — Consent-gate SPEC v1, both subjects, one document · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]], reviewed against [[compliance-privacy-directive]] §The gate |
| **Doneability** | [[customer-relationship-research-charter]] can write their eligibility check with **zero follow-up questions**: the SPEC names, per subject, (a) the record and where it lives, (b) the purpose vocabulary, (c) what withdrawal does and how fast, (d) the answer shape — `allow` / `deny` + a reason code from a closed set — and (e) who may call it. A SPEC that produces one clarifying question has failed its own test. |
| **close_time** | **2026-09-11** (14 days). This date is a commitment to another department, not an internal estimate. |
| **Evidence** | `customer-relationship-research-charter.md:29-46` — the gate is ours to design and *"today, the correct output of this team for every research request is: no"*; `:95-101` — their hard-fail metric is zero customers researched off-register. `loops.json` → `consent-gate`, owner `privacy-engineering`, `close_time: per-event`, `status: blocked`. |
| **Moves** | unblocks `privacy.consent_gate_denials` from *undefined* to *has-a-producer* |
| **Carried by** | `pii-store-classifier` (privacy-engineering card) consumes the guest schema already; the gate answer is a new emit on that card. |

### A2 — The customer-approval register: record design, not a migration · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] owns the record's contents and validity rules; **[[customer-relationship-research-charter]] proposes the operational shape** — their charter already commits them to that split and forbids them claiming ours. |
| **Doneability** | A table shape + purpose vocabulary + withdrawal path, run through [[compliance-privacy-directive]]'s gate diagram end to end and delivered as a **proposed** migration. Not applied — application needs a caller, and a caller is Product's. |
| **close_time** | **2026-09-18** |
| **Evidence** | `customer-relationship-research-charter.md:59-60` — the register *"does not exist yet"*; charter §Contested seams 1 — capture ownership is proposed, not decided. |
| **Grade note** | The *record* is committed. **Who builds the capture surface is still the open seam** — see §Questions 1. This task deliberately stops at the record so the seam does not have to be resolved to make progress. |

### A3 — A denial that can be counted · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | Every gate answer emits a verdict with a reason code; `privacy.consent_gate_denials` reads a real number. **A gate whose denial count is zero over a quarter is either unused or misconfigured, and both look identical from a dashboard** — [[compliance-privacy-loops]] L3's health test, which is the same failure shape as `compliance_agent.py`'s stub consuming events and producing nothing. |
| **close_time** | **2026-10-02**, and thereafter the L3 close_time (real-time on the gate, weekly on the audit) |
| **Evidence** | L3 health test; `compliance-privacy-loops.md:110-114`. |

---

## B. One definition of PII — and the count was wrong

### B1 — Re-measure the census, then never measure it by hand again · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | Every PII citation in the charter, loops, agent-stack and this agenda is re-verified against `HEAD`, **and** the census is produced by a script rather than by a person, so the next drift is a diff and not a discovery. `pii-definition-audit` is [[compliance-privacy-schedule]]'s one §3.3-eligible skill candidate; its own note says the correct home is `scripts/check_single_pii_definition.sh` in CI, because *a skill that duplicates a CI guard is sprawl with extra steps*. |
| **close_time** | **2026-09-04** (7 days — this is a grep, and it is embarrassing while it is open) |
| **Evidence** | Verified 2026-08-28: `constraint_engine.py:52-60` (charter says `:28-36`), applied `:137-138` (charter says `:113-117`); `provider_communication_agent.py:41-49`, applied `:833` (charter says `:725-733`); `research_tasks.py:102-103`, `_has_pii:201-203`, applied at **`:801` and `:1116`** (charter names one call site); `20260805000000_baseline_from_production.sql:1080` — unchanged, the only citation that held. |
| **Moves** | `privacy.pii_definition_count` gains a trustworthy denominator before anything tries to reduce it |

### B2 — The fourth definition, found this session, running in production · `COMMITTED`

> **`apps/web/src/contexts/AuthContext.tsx:208-218` sends the signed-in user's
> `email`, `name` and `restaurantId` to Sentry on every authenticated session**,
> gated only on `VITE_SENTRY_DSN` being set (`apps/web/src/lib/error-tracking.ts:109-120,154`).
> On the gateway side, `apps/api-gateway/src/common/error-tracking/sentry.service.ts:47-54`
> filters exactly two things — the `authorization` and `cookie` headers — and
> `captureException` forwards `extra: context` unfiltered (`:83-85`), while
> `setUser` forwards the email explicitly (`:117-132`).
>
> That is a **fourth definition of PII**, unwritten and implicit: *auth headers are
> sensitive; an email address is not.* It disagrees with guard #3
> (`research_tasks.py`, for which an email **is** PII) inside the same product.

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] classifies; the `beforeSend` change is engineering's, routed through [[client-surfaces-charter]] and the gateway |
| **Doneability** | The census counts it (so `privacy.pii_definition_count` states the true number before it states a target), **and** the flow resolves one of two ways: a `beforeSend` scrub keyed to the single definition, or a written accepted gap with a named owner and a date. Per [[compliance-privacy-directive]], a control we cannot express as a check goes in as a **known gap**, never as a silent allow. |
| **close_time** | **2026-09-11** for the classification and the register row; the code change is not ours to date |
| **Evidence** | the four `file:line`s above, all read 2026-08-28; `foundation/EXTERNAL_CONNECTIONS.md:48` already lists Sentry with both DSN vars — the register's raw material and this finding are the same row |
| **Why it matters beyond the count** | It is the first *provable* personal-data export to a subprocessor. §C2 stops being a classification exercise and becomes a list with a known first entry — and there is no DPA with Sentry, because there is no DPA with anyone. |

### B3 — The single module and the guard that makes it stay single · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | `privacy.pii_definition_count` == **1**, imported by `constraint_engine.py`, `provider_communication_agent.py` and `research_tasks.py`, enforced by `scripts/check_single_pii_definition.sh` wired into CI on push, PR **and** the daily cron — the shape `.github/workflows/schema-parity.yml:35,207,211-212` already runs for the two guest guards. The guard **exits 2 when it cannot check** rather than passing vacuously, which is this repo's stated convention (`scripts/check_log_sanitizer_usage.py:20-22`: *"Exit 2 = the guard could not run, which is a failure, not a skip"*), and it is proven against the pre-fix tree before it is trusted. |
| **close_time** | **2026-09-25** |
| **Evidence** | L2 `pii-definition-convergence`, `close_time: per-pr` — deliberately per-merge, because a convergence loop that closes weekly lets a week of divergent guards ship first. Two of the four guards are byte-identical copies with no shared import, so the divergence event is a single one-sided edit and nothing observes it. |
| **Anti-goal** | Target is 1 and 1 is the only acceptable value. **Two definitions is not redundancy, it is a disagreement nobody has had.** |

### B4 — "Log safety" does not mean what its name implies · `REACH`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] proposes; the module is engineering's |
| **The finding** | `services/agent-orchestrator/services/log_safety.py:18-29` — `sanitize_for_log` escapes backslashes and CR/LF and truncates at 128 chars. It **redacts nothing**. Its docstring is about log-injection (CodeQL `py/log-injection`), which it handles well; a reader who sees a "sanitised" value in a log line and infers PII safety has inferred something the function never claimed. C-21's *"never log sensitive content"* is enforced only inside the drafting path (`constraint_engine.py:137-138`). Everywhere else, PII in a log line is unguarded. |
| **Doneability** | Either the sanitiser gains a redaction pass keyed to the §B3 module, **or** its docstring states plainly what it does not do and the gap is a register row with an owner and a date. Both are acceptable closes; silence is not. |
| **close_time** | **2026-10-02** |
| **Grade note** | `REACH` because widening the sanitiser touches every log call site in `services/agent-orchestrator` and needs engineering's agreement on cost. The *docstring-and-gap* half is cheap and unilateral and is the fallback. |

---

## C. The obligation register, and a public promise with a hole in it

### C1 — Obligation register v1: ten duties, each to a control or a named gap · `COMMITTED`

| | |
|---|---|
| **Owner** | [[regulatory-posture-charter]] |
| **Doneability** | Ten named duties, each mapped to a `file:line`, a passing test, or a named owner with a date. The card's own anti-gaming rule holds: *"'Handled by our architecture' scores 0 — and an honest gap scores 0 too, but the gap is the useful one."* `compliance.obligation_coverage` moves from *0% with no producer* to *a number with a method*. |
| **close_time** | **2026-09-30**, then the L4 monthly sweep |
| **Evidence** | Re-verified 2026-08-28: `grep -riE "gdpr\|ccpa\|data subject\|right to erasure"` over `apps/ services/ supabase/ scripts/` returns **0**. The zero has not moved in four days, and the known false positive (`CCPAE`, the Catalan organic-agriculture council, in `datasets/planning-exports/`) is recorded in this department's memory so it is not re-discovered as a hit. |
| **Sizing honesty** | A one-page register that arrives before the first counterparty beats a complete one that arrives after signature ([[compliance-privacy-premortem]] M2). Ten rows, not a programme. |

### C2 — Fifty hosts, and the first row is already proven · `COMMITTED`

| | |
|---|---|
| **Owner** | [[regulatory-posture-charter]] |
| **Doneability** | **50/50** hosts in `foundation/EXTERNAL_CONNECTIONS.md:145` classified as personal-data-receiving or not, each classification citing the flow's `file:line` rather than the vendor's category. **`unknown` counts as FAIL, never as not-personal** — the store-inventory rule from `pii-store-classifier`'s quality bar, applied to hosts. |
| **close_time** | **2026-10-09**, then the quarterly reclassification |
| **Evidence** | `EXTERNAL_CONNECTIONS.md:145` — *"50 distinct runtime hosts · 80 environment variables"*; `:48` Sentry, with §B2's flow now traced end to end. |
| **Why the ordering changed** | This was mechanical busywork on the last agenda. §B2 makes it not: we now have one host that provably receives operator personal data, no instrument covering it, and a notice that does not mention it. The register is the artifact that makes those three facts sit next to each other. |

### C3 — The notice omits an entire data flow · `COMMITTED`

| | |
|---|---|
| **Owner** | [[regulatory-posture-charter]] |
| **The finding** | `apps/web/src/pages/Privacy.tsx:5-12` sets the standard in its own header — *"Written to match what the code actually does rather than boilerplate… If any of those change, this page has to change with them."* The page then enumerates five flows: cookies (`:29-32`), Google sign-in (`:34-38`), connected integrations (`:40-44`), product analytics (`:46-50`), partner sharing (`:52-56`). **Error tracking is not among them**, and the analytics section's careful list of what leaves the browser — *"a page name, an event type, an optional element name, and a number"* — is scoped to interaction telemetry while a second exporter ships the user's email address (§B2). The brand is also still "WineOps" at `:23`, `:31`, `:43`, four days after it was recorded as stale. |
| **Doneability** | The notice either discloses the error-tracking flow accurately or the flow stops; the brand strings are corrected in the same PR. `compliance.notice_accuracy` gets its first measured value with a defect count that is **not** just the brand string. |
| **close_time** | **2026-09-11** |
| **Grade note** | The most concrete deliverable on this agenda: a public-facing promise, a verified omission, and a one-file fix. It is also this department's cleanest evidence that the L4 loop is worth building — the loop caught it, before a user did. |

### C4 — Turn `Privacy.tsx:5-12` from a comment into a check · `REACH`

| | |
|---|---|
| **Owner** | [[regulatory-posture-charter]], with [[client-surfaces-charter]] |
| **Doneability** | A guard that fails a PR touching a claim-bearing path without touching `Privacy.tsx` — the *per-PR obligation that is currently written as a comment and enforced by nothing*. It answers **DO-7** in [[compliance-privacy-questions]] structurally rather than by remembering: cookie/telemetry/tracking changes and the public promise become one edit. |
| **close_time** | **2026-10-16** |
| **Grade note** | `REACH`. The guard is easy; **the claim→path map is the hard part and it does not exist yet** — §C1's register is its input, which is why this is dated after it. If the map proves unbuildable, the honest fallback is a monthly read-through, and that is a downgrade to state out loud rather than a silent slip. |

---

## D. Crypto-shredding — the design questions ADR 0037 leaves open

> **NF-B stays HELD** ([[0029-p3-plan-of-record]], zero callers). [[0037-nfb-erasure-is-crypto-shredding]]
> is explicit: *"nothing is built while NF-B is HELD"*, and the department owns the
> key-management design **at activation time**. Everything in §D is a document.
> [[guest-experience-charter]] owns the NF-B *activation-readiness dossier*
> (GENERATION_BRIEF §8.3); this is the *key-management design* that dossier will need
> and must not duplicate — the seam is stated here so two units do not write the same
> page.

### D1 — The derivation trap: this repo's only key precedent cannot do crypto-shredding · `COMMITTED`

> **`guest_pepper()` (`20260819000000_guest_identity_minimal_slice.sql:338-367`)
> derives a per-restaurant key by HMAC from ONE vault master secret**
> (`vault.decrypted_secrets`, name `guest_identifier_pepper`), and raises rather than
> falling back to a constant (`:349-355`), because *"a predictable pepper on a
> phone-number hash is a rainbow table."* It is the only use of Supabase Vault in the
> entire migration corpus.
>
> **A derived key cannot be destroyed independently.** You cannot forget one output
> of a deterministic function; destroying the master shreds every subject under it.
> So ADR 0037's per-guest keys must be **stored, not derived** — structurally the
> opposite of the single key-management precedent this repo has, and the precedent is
> the thing an implementer will reach for first.

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]]; adversarial pass by [[architecture-review-charter]] |
| **Doneability** | A design note that states (a) the storage shape — a key table under a KEK vs. N vault rows — with the per-row overhead at a stated row count, (b) why derivation is rejected, in the terms above, and (c) what a key's own lifecycle is (create-on-first-write, rotate, destroy). Done when architecture-review has attacked it and the note survives or is amended. **Not done when it merely exists.** |
| **close_time** | **2026-10-02** |
| **Evidence** | the migration lines above, read 2026-08-28; ADR 0037 §Decision — *"per-guest keys, erasure = key destruction… at activation time, the key-management design"*; ADR 0037 §Consequences names key infrastructure as an activation prerequisite. |
| **Why now, with NF-B held** | This is the cheapest it will ever be and the answer is counter-intuitive, which is the combination that produces a wrong default. An implementer copying `guest_pepper()` at activation time would build a store that cannot shred, and would not find out until the first erasure request. |

### D2 — A shred that survives a restore, or the receipt is a lie · `REACH`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] with [[reliability-sre-charter]] |
| **The question** | Destroying a key in the live database does not destroy the copy inside a PITR window or a nightly backup. Crypto-shredding's real advantage is that the *backup* also becomes noise — **but only if the key was never in the backup in the same restorable form.** That is a placement decision, and it is the sharpest unanswered question ADR 0037 leaves. |
| **Doneability** | A written statement of where key material sits relative to the backup boundary, **plus a joint drill design**: restore a backup, restore a shredded subject, assert the rows are noise. SRE's `days_since_verified_restore` currently has no value at all (GENERATION_BRIEF §8.3) — **one drill satisfies both departments**, and designing it once beats designing it twice. |
| **close_time** | **2026-10-16** — design only; the drill runs on SRE's cadence, not ours |
| **Grade note** | `REACH` — it needs [[reliability-sre-charter]] to agree the shared drill is worth their slot. Raised to their questions file rather than assumed here ([[0039-activation-plan-of-record]] §8.4: a cross-unit need is a task addressed to that unit, not a task we schedule for them). |

### D3 — Name the training paths now, while there are zero · `ASPIRATION`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] with [[neural-footprint-instrumentation-charter]] and [[taste-fingerprint-charter]] |
| **The problem** | ADR 0037's revisit clause fires when *"activation-time measurement shows the decrypt cost dominating a named training path"*, with a recorded fallback (aggregate-only inputs for that path, never for the store). **There are no named training paths.** A revisit condition whose denominator is defined at the moment of invocation is a condition the invoker defines. |
| **Doneability** | An enumerated list of the paths that would decrypt, agreed with the two consuming charters, so the revisit clause has a denominator that predates the pressure to use it. |
| **close_time** | **2026-10-23** |
| **Grade note** | `ASPIRATION` — honestly. NF-B's consumers do not exist; this is a list of hypotheticals agreed between three units, and it does not proceed if the other two would rather wait for activation. Recorded because it costs an afternoon now and a negotiation later. |

### D4 — One receipt schema that can express both a delete and a shred · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | A receipt schema giving `erasure_receipt_id` (`20260819000000_guest_identity_minimal_slice.sql:82` — a bare `uuid` with **no FK, because no receipt table exists**) something to reference, and expressing both erasure modes: the production tombstone (identifiers hard-deleted, label and consent nulled, `:79-82`) **and** a research-store shred (key id destroyed, time, store generations covered). Done when one row shape covers both without a discriminator that means "we did not think about the other one." |
| **close_time** | **2026-10-09** |
| **Evidence** | `:82`; ADR 0037 §Decision. |
| **Why one schema** | Two receipt tables means two answers to *"was this person erased?"*, and a subject-access request picks one. The same argument [[regulated-operations-charter]] makes about movement aggregates: two answers means the authority picks one. |

---

## E. The denominator, discovered — and the drill

### E1 — The missing publisher already exists in CI · `COMMITTED`

> **`scripts/check_new_tables_are_locked_down.py` already walks the whole migration
> corpus and enumerates every table created in `public`**, and it is wired into CI at
> `.github/workflows/ci.yml:281-283` with `if: !cancelled()` — *"a guard hidden behind
> another guard is not a guard."*
>
> The `table.created` topic is a **declared gap** on `pii-store-classifier`'s card
> (*publisher: NONE — the daily schema-parity rebuild detects drift but emits no
> event*). It does not need to be built. It needs to be **read from a guard that is
> already running for a different reason**, exactly as
> `foundation/EXTERNAL_CONNECTIONS.md` becomes the subprocessor register by being
> classified rather than rewritten.

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | A store-inventory report produced from the same corpus walk, every table classified person-bearing / not / unclassified, with **`unclassified` counted as FAIL**. `privacy.store_inventory_coverage` gets its first value, and the erasure denominator is **discovered, not declared** — a completeness metric over a hand-written list is a tautology ([[compliance-privacy-premortem]] M3). |
| **close_time** | **2026-09-18** |
| **Evidence** | `scripts/check_new_tables_are_locked_down.py` docstring §WHAT IT CHECKS; `.github/workflows/ci.yml:281-283`; `loops.json` → `store-inventory-currency`, owner `privacy-engineering`, `close_time: per-event`, `status: proposed`, and the declared gap on the card. |
| **Ambition note** | This is the agenda's cheapest large win. It converts a blocked loop into a running one by reusing an OD-72/OD-73 security ratchet for a privacy purpose neither OD anticipated. |

### E2 — Is the pepper even provisioned? · `COMMITTED`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]] |
| **Doneability** | A dated yes/no: does `vault.decrypted_secrets` hold a row named `guest_identifier_pepper` in production? `guest_pepper()` **raises** if it does not (`:349-355`), nothing in the repo provisions it, and nothing calls it — so the answer is currently unknown to everyone. |
| **close_time** | **2026-09-04** |
| **Why it is on a department agenda at all** | It is one query, and it is the first thing that will fail the moment §A's gate has a caller. A prerequisite nobody has checked, guarding a path nobody has walked, is the exact shape of [[compliance-privacy-premortem]] M1. |

### E3 — First erasure drill, end to end · `REACH`

| | |
|---|---|
| **Owner** | [[privacy-engineering-charter]]; **capture is [[guest-identity-consent-charter]]'s** |
| **Doneability** | Synthetic guest: create → consent captured via `staff_verbal` → linked through `guest_link_identifier()` → erased → stores enumerated from §E1's discovered inventory **plus** the six named sinks (`pos_checks.raw`, `events`, `notifications`, `decision_log`, `event_store`, `analytics_cache.data` — `scripts/check_no_raw_guest_channels.sh:13-14,75-76`) → absence asserted. `privacy.erasure_completeness` gets its first non-zero denominator. |
| **close_time** | **2026-10-30** |
| **Grade note** | `REACH`, and the reason is stated rather than buried: **this needs the schema to have a caller, and the caller is Product's to write.** `privacy.consent_call_sites` is still **0** — re-verified 2026-08-28, `grep` over `apps/` and `services/` for `consent_purpose`, `consent_withdrawn_at`, `guest_link_identifier`, `guest_identifiers`, `erasure_receipt` returns zero. The department can build the drill against a fixture and prove the *mechanism*; it cannot prove the *product* alone, and an agenda that dated this as if it could would be lying about who is blocked. |

---

## F. Regulated Operations — one task, and it is the whole staffing

### F1 — Run the quarterly trigger check for the first time · `COMMITTED`

| | |
|---|---|
| **Owner** | [[compliance-privacy-schedule]] / `cp-orchestrator` — **owned at department level because a team with no staff cannot own a job** |
| **Doneability** | A dated verdict answering both trigger conditions with evidence: (1) a customer in a jurisdiction where we hold or touch a licence, (2) excise reporting in a signed MSA. `regops.trigger_check_freshness` gets its first value; today it has never been checked. |
| **close_time** | **2026-09-30**, then quarterly |
| **Evidence** | [[compliance-privacy-schedule]] — the quarterly row, marked *the most important `NEW` row on this table, and the least interesting*; [[regulated-operations-charter]]'s own premortem is *the trigger fires and nobody notices, because a dormant team has no cadence*. `services/agent-orchestrator/agents/compliance_agent.py` is `IS_STUB = True` and the orchestrator refuses to start it. |
| **Cost** | Five minutes, quarterly. **A gated team and a forgotten team look identical until a customer's accountant tells the difference**, and this one job is the entire distinction. |

**Nothing else in §F is scheduled, on purpose.** Excise and licensing share only the
word "compliance" with the rest of this mandate. Staffing it before its trigger would
be the sprawl the gate exists to prevent.

---

## G. What this department is NOT doing, restated because it keeps being asked

| Not ours | Whose | Why the line holds |
|---|---|---|
| Drafting the DPA/BAA instrument | [[commercial-workforce-agreements-charter]] | We constrain what the Annex may claim; they draft it. **CORP-F2 is still open** — §Questions 2. |
| Access control, RLS, secrets, authn | [[security-charter]] | Who may *reach* the data vs. what may be *done* with it. |
| The guest identity model and the capture surface | [[guest-identity-consent-charter]] | Same migration file, opposite questions. |
| Building the taste fingerprint | [[taste-fingerprint-charter]] | They model; we say what it may not condition on. |
| Doing the customer research | [[customer-relationship-research-charter]] | They own questions and findings; we own the gate. |
| NF-A/NF-B schema columns | [[neural-footprint-instrumentation-charter]] | We are a **requesting consumer**, not a column owner. |
| Anything past a lock | — | The pricing model is deferred and brand/landing visuals are held ([[0039-activation-plan-of-record]], founder re-confirmed 2026-08-28). Nothing here assumes an unlock; §C3's brand-string fix is a **stale product name in a legal notice**, not a brand-visual decision, and it stays inside that line. |

---

## H. Cross-department dependencies — what we owe, with dates attached

| They need | From us | Was (2026-08-24) | Now |
|---|---|---|---|
| [[customer-relationship-research-charter]] | The consent gate as a callable check | *"not built — they are blocked"* | **SPEC 2026-09-11** (§A1), record design 2026-09-18 (§A2). They are scheduling against this date. |
| [[commercial-workforce-agreements-charter]] | Evidenceable DPA/BAA Annex content | *"not written"* | Register v0 **2026-09-30** (§C1); the Sentry row (§B2) is the first clause we could not evidence today. |
| [[taste-fingerprint-charter]] | What happens to NF-B on erasure | *"unanswered"* | **Answered** — ADR 0037, crypto-shredding. Key design **2026-10-02** (§D1). |
| [[security-charter]] | One definition of PII to protect | *"3 definitions, 4 guards"* | **4 definitions, 5 guards** (§B2). Single module **2026-09-25** (§B3). |
| [[reliability-sre-charter]] | — | not a dependency | **New:** the shared restore/shred drill (§D2), raised to their questions file. |
| [[guest-experience-charter]] | — | not a dependency | **New:** the NF-B readiness-dossier seam (§D) — theirs is readiness, ours is keys. |

---

## I. Questions for the founder

Carried forward, minus the one that closed. Each is genuinely the founder's call and
none is defaulted here ([[CLAUDE]] §0.1 — nothing is decided until it is written in
`.planning/decisions/`).

1. **Who owns guest consent *capture*?** `consent_captured_via` is CHECK-constrained
   to four channels (`:60-62`) and none has an implementation. Proposed: Product
   builds the surface, this department owns the record's contents and validity rules.
   §A2 is written so it makes progress either way, but §E3 cannot start until this
   is settled. Still needs an `OPEN-DECISIONS.md` row — outside this wave's write
   scope.
2. **CORP-F2 — the DPA/BAA split.** Confirm Legal-drafts / we-constrain, or collapse
   into one unit? The split is what makes an unevidenceable Annex catchable *before*
   signature; collapsing saves a handoff and loses that check.
3. **CORP-F4 — is [[regulated-operations-charter]] Corporate's at all?** Answering
   now costs nothing; answering after the trigger fires costs a re-org on a deadline.
4. **Does this department get to refuse a signature?** A veto over a revenue event
   needs explicit backing to survive contact with a live deal. §B2 makes this
   concrete for the first time: there is a real subprocessor receiving real personal
   data under no instrument, and the first DPA that asks about subprocessors will
   ask about it.
5. **Do guest-data-use widenings route through [[red-team-charter]]?** Ethics scope
   sits in this line, so the department reviews itself ([[compliance-privacy-premortem]] M5).
   A standing referral restores the independence the org knowingly gave up, at one
   referral per proposal. **Unchanged and still unanswered** — and §D1's design note
   is exactly the kind of document a self-reviewing department would grade generously.

---

## J. Honest grading of this agenda

- **Committed: 14.** A1, A2, A3, B1, B2, B3, C1, C2, C3, D1, D4, E1, E2, F1 — of
  which four (B1, E2, C3, B2's classification half) are days, not weeks.
- **Reach: 4.** B4, C4, D2, E3 — each names the other unit whose agreement it needs,
  and each names its fallback.
- **Aspiration: 1.** D3, and it says so in its own row.
- **Deleted rather than carried:** the 2026-08-24 "escalate NF-B erasability" item —
  it closed as ADR 0037, and restating a closed escalation as ongoing work is the
  precise dishonesty [[0039-activation-plan-of-record]]'s quality bar exists to stop.
- **The critical path is not ours.** §E3 and §A3's real value both wait on a consent
  *caller*, which Product writes. Everything in §B, §C, §D and §E1 is unblocked
  today, which is why the dates cluster there.
- **What this agenda still cannot say:** whether any of it survives contact with a
  week where the product's named blocker is data, not compliance. A department with
  zero mapped obligations competing against the actual blocker should expect to lose
  most weeks — which is why every committed item is sized in days and why §F stays
  gated rather than staffed.
