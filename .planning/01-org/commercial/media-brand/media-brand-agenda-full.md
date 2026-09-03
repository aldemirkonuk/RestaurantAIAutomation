---
type: agenda-full
division: commercial
department: media-brand
status: active
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-28
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-premortem]]"
  - "[[media-brand-directive]]"
  - "[[media-brand-loops]]"
  - "[[media-brand-schedule]]"
  - "[[media-brand-agent-stack]]"
  - "[[media-brand-questions]]"
  - "[[media-brand-agenda-board]]"
  - "[[brand-identity-agenda-full]]"
  - "[[narrative-collateral-agenda-full]]"
  - "[[social-community-agenda-full]]"
  - "[[customer-relationship-research-agenda-full]]"
  - "[[0039-activation-plan-of-record]]"
  - "[[0025-citations-must-disagree-loudly]]"
  - "[[0020-no-fabricated-answers]]"
  - "[[editorial-gate-charter]]"
  - "[[compliance-privacy-charter]]"
  - "[[engineering-charter]]"
  - "[[design-partner-operations-charter]]"
---

# Media & Brand — First Agenda

**Dated 2026-08-28.** Written under [[0039-activation-plan-of-record|ADR 0039]] Track B by
this department's own agent. Every task below names its doneability, its close_time, and the
line that makes it real. Nothing here is done; several things here are *forbidden*, and those
are marked as loudly as the scheduled ones.

---

## §0 State of the department, measured today

Four things were re-measured against the working tree on **2026-08-28**, not carried forward
from the founding audit. Three of them had moved.

| What | Founding (2026-08-24) | Today (2026-08-28) | Delta |
|---|---|---|---|
| Legacy **name** `WineOps` in shipped surfaces | 351 lines / 193 files | **360 lines / 195 files** | **+9 lines, +2 files** |
| Legacy **domain** `wineops.ai` in shipped surfaces | 33 lines / 25 files | **39 lines / 27 files** | **+6 lines, +2 files** |
| Guards preventing either from growing | 0 | **0** | — |
| Skills owned by this department | 0 | **0** (`.claude/skills/` now holds 4 real skills, none ours) | — |

Both counts use the exclusions the charter fixed so they stay reproducible — `md/`,
`md_files/`, `.planning/`, `*.md`, `pnpm-lock.yaml`, `node_modules` — and both patterns are
run separately, because one number has hidden half of this problem twice already
(`brand-identity-charter.md:55-68`).

**The headline is not the size. It is the sign.** The department's one measurable metric moved
**away from** its target, in four days, with nobody editing brand strings on purpose. A surface
with no ratchet does not hold still; it accretes. That single fact reorders this agenda: the
guard is scheduled before the sweep, and it is scheduled in the first week.

Two smaller findings from the same pass, both of which change what gets scheduled:

- **The tier-1 citation table is rotting under itself.** Of eleven `path:line` rows spot-checked
  from `brand-identity-charter.md:74-104`, **three no longer resolve to the string they name**:
  `gmail.service.ts:78 → :79`, `vendor-page-extractor.service.ts:17 → :26`,
  `push.ts:32 → :33`. Four days.
- **A card citation has rotted *and inverted*.** `narrative-collateral-agent-stack` consumes
  "`PROJECT.md:101` — DEP-06 (Toast credentials for the design partner), **still unchecked**".
  `PROJECT.md` contains no `DEP-0` string at all; DEP-06 lives at
  `07-reference/REQUIREMENTS.md:333` and is recorded **`- [x]` checked**. The card names a
  blocker that its own source says is cleared. (Whether the credential is live in Railway today
  is not verifiable from the repo, and this agenda does not claim it is.)

---

## §1 The spine: the brand-voice guide

[ADR 0039](../../../decisions/0039-activation-plan-of-record.md) re-confirmed that
**brand and landing visuals stay held**. The hold's own wording is the assignment: *"Blender /
landing-page visuals: **hold** until structure + brand exist"* (`decisions/README.md:76`,
2026-08-24). Media & Brand owns the second half of that release condition. The brand does not
exist yet — not because no one has drawn it, but because **no one has written what it says or
what it is called in each of the sixteen places it speaks**.

So the spine of this agenda is the thing the hold names as its own prerequisite: **the voice
guide, plus the naming spine underneath it**. Prose and nomenclature. No mark, no palette, no
type specimen, no landing page, no commissioned visual of any kind.

The second thread is **customer research, and the only honest thing to schedule there is the
gate** — which this department does not own. Compliance & Privacy owns the consent-gate spec
([ADR 0039 §8.3](../../../foundation/GENERATION_BRIEF.md)); M4 writes requirements *against* it
and touches no person until it exists.

---

## §2 Task index

Rendered on [[media-brand-agenda-board]] by Dataview. This list is the single source; the board
does not restate it.

- [ ] **MB-1** M1 · Brand voice guide v1, clause-numbered · **14d — 2026-09-11**
- [ ] **MB-2** M1 · The naming spine: one row per outward name slot · **10d — 2026-09-07**
- [ ] **MB-3** M1 · `brand-surface-scan` as a real skill; the count becomes reproducible · **7d — 2026-09-04**
- [ ] **MB-4** M1 · `brand-guard-ci`: freeze the surface before renaming it · **7d — 2026-09-04**
- [ ] **MB-5** M1 · The tier model is wrong — five classes, not three · **10d — 2026-09-07**
- [ ] **MB-6** M1 · Re-anchor the citations, then stop hand-maintaining them · **7d — 2026-09-04**
- [ ] **MB-7** M1 · Tier-1 in-product copy corrections, first slice · **GATED — opens when MB-2 lands; 2026-09-21**
- [ ] **MB-8** M1 · Reference shortlist: verify or drop, adopt nothing · **21d — 2026-09-18**
- [ ] **MB-9** M2 · Freeze the sentence; write the story, structure only · **14d — 2026-09-11**
- [ ] **MB-10** M2 · The claim ledger, built before there is anything to audit · **14d — 2026-09-11**
- [ ] **MB-11** M2 · Demo script against the product that exists — **ASPIRATION** · **21d — 2026-09-18**
- [ ] **MB-12** M3 · The trigger watch runs. Nothing else runs · **weekly — first 2026-09-01**
- [ ] **MB-13** M4 · Approval-register requirements pack → Compliance & Privacy · **10d — 2026-09-07**
- [ ] **MB-14** M4 · The finding that outranks the register: consent columns are enforced by nothing · **7d — 2026-09-04**
- [ ] **MB-15** M4 · The refusal rule, written before the first request arrives · **10d — 2026-09-07**
- [ ] **MB-16** Dept · The first outward-surface inventory, run rather than described · **quarterly — first 2026-09-11**
- [ ] **MB-17** Dept · The board reads "not measurable" with a named dependency, never "0" · **weekly**
- [ ] **MB-18** Dept · `brand.surface_added` has no publisher: bound it or accept it in writing · **21d — 2026-09-18**

---

## §3 M1 — Brand Identity

### MB-1 · Brand voice guide v1, clause-numbered
*The spine. This is the artifact the visuals hold names as its own release condition.*

**Doneability.** A committed guide that (a) states its scope on its first line — it governs
**published outward content**, not this planning corpus, which is full of the constructions a
naive guide would ban; (b) carries at least eight clauses, each with a stable id `VG-01…`, so
`voice-guide-check` can return *the clause violated* rather than a verdict
(`media-brand-schedule.md:83-91` makes that the skill's whole doneability); (c) rewrites three
**real shipped strings** as worked before/after examples — candidates:
`apps/web/src/pages/Privacy.tsx:31`, `apps/api-gateway/src/auth/auth.service.ts:710`,
`apps/web/src/pages/GetStarted.tsx:63`. Done when [[editorial-gate-charter|G3]] runs one draft
through it and produces a rejection that cites a clause id.

**close_time.** 14d — 2026-09-11.

**Evidence.** `media-brand-charter.md:70-72` (M1 writes the guide, G3 applies it; a guide whose
author is its enforcer is an opinion) · `voice-guide-conformance` loop, monthly, measures
`editorial.rejections_citing_a_clause` · `media-brand-schedule.md:88` — the skill is explicitly
**not built until the guide exists**, so this task unblocks a skill, not just a document.

**Lock.** Voice, not visuals. This task produces sentences and rules about sentences. It
produces no mark, no color, no type, no layout.

---

### MB-2 · The naming spine — one row per outward name slot
*Distinct from MB-1: MB-1 is how we write, MB-2 is what we are called, per surface.*

There are at least sixteen distinct slots where this company states a name to someone outside
it, and they do not agree with each other today. A voice guide that does not settle the
nomenclature underneath it will be argued with, once per slot.

**Doneability.** One table, one row per slot: browser title · PWA name · mobile app name ·
Face-ID prompt · Android notification channel · web push title · iCal `PRODID` · iCal feed name ·
mail `From:` display · Message-ID domain · crawler User-Agent · OpenAPI contact / license /
production server · support address · VAPID subject · telemetry `service_name` · externally-held
account identity. Each row carries: the current string with a **dated** `path:line`, its class,
its owner (M1 / Engineering under CM-F5 / a class MB-5 has yet to place), and either the intended
replacement or the word `DEFERRED — founder`. Done when every tier-1 row in
`brand-identity-charter.md:74-104` maps to exactly one slot and no slot is left unowned.

**close_time.** 10d — 2026-09-07. It gates MB-7 and feeds MB-16.

**Evidence.** The tier-1 table itself · the two unplaced classes MB-5 found · the fact that the
prior agenda's founder questions 2 and 3 (CM-F5, the Expo slug) are still open, so at least two
rows will legitimately close as `DEFERRED` rather than as a decision this department may make.

**Lock.** Naming is identity groundwork and explicitly permitted. Choosing a *wordmark* for the
name is not, and is not in this task.

---

### MB-3 · `brand-surface-scan` as a real skill
**Doneability.** `.claude/skills/brand-surface-scan/` exists alongside the four skills that
already live there (`fleet-census`, `harness-contract-audit`, `model-pin-census`,
`registry-index-refresh` — verified 2026-08-28); it emits **two** counts, never one, plus a tier
and a `path:line` per hit; a second run on the same tree yields byte-identical output; and it
reproduces §0's numbers — name 360/195, domain 39/27 — exactly. A run that emits one aggregate
number is a failed run.

**close_time.** 7d — 2026-09-04.

**Evidence.** `media-brand-schedule.md:57-69` (trigger, doneability, and a real past instance —
this scan has been wrong twice) · `scripts/render_system_atlas.py:109` already carries
`(r'wineops\.ai', 'wineops.ai', '⚠️ Legacy brand domain — pre-Mudavym')`: **the repo already has
one of the two patterns**, which is precisely how the name surface stayed invisible · the skills
mechanism now exists and this department owns none of it.

---

### MB-4 · `brand-guard-ci` — freeze the surface before renaming it
*The most consequential task on this agenda, and the argument for it was measured this week.*

**Doneability.** `scripts/check_brand_surfaces.py`, in the house style of the twenty existing
`scripts/check_*.py` guards, wired as a CI job beside `loop-contract`, `agent-card-contract`,
`decision-claims`, and `schema-code-parity` in `.github/workflows/ci.yml`. It must: fail a PR
that raises **either** count above the committed baseline; **exit 2 when it cannot check**
rather than passing silently; cover the generated artifact `apps/api-gateway/openapi.json`
(8 hits today, rebuilt not edited, so a green source tree can still ship a stale one); and be
**proven against a deliberate regression** before it is trusted. Done when a PR that adds one
`WineOps` string is red, and the guard's own failure message names the file and the tier.

**close_time.** 7d — 2026-09-04, in the same PR as MB-3's baseline.

**Evidence.** §0's measured growth: **+9 name lines and +6 domain lines in four days, with zero
guards**. `media-brand-schedule.md:71-81` — "a cleanup without a guard is a cleanup that gets
undone." The prior claim that the rename was complete survived 33 domain lines and 351 name
lines; it would now survive 39 and 360.

**Lock.** A ratchet is not the sweep. the id-less 'Rebrand posture' row, `OPEN-DECISIONS.md` Resolved table defers *execution* of the rename
until the brand direction exists; a guard that forbids the count from **growing** changes no
display string and presupposes no new name. Four days of unattended drift is the argument for
landing it before the direction rather than after.

**Cross-unit.** The CI job is Engineering's file. Filed as an ask to
[[engineering-questions]], not as a unilateral edit.

---

### MB-5 · The tier model is wrong — five classes, not three
*This is the quarterly inventory loop working on its first day, and it found what it was built
to find.*

`brand-identity-charter.md:70-139` sorts every legacy string into three tiers: display strings a
human or third-party machine sees (rename now), internal comments (bulk), identifiers
(Engineering, CM-F5). Two classes found on 2026-08-28 fit none of the three:

**Class 4 — externally-held account identity.**
`gmail-push@wineops.iam.gserviceaccount.com` and `wineops.ai@gmail.com`
(`apps/api-gateway/src/communications/communications-security.spec.ts:121,302`) name a **Google
Cloud project** and a **Gmail account**. Changing them is an account migration performed at
Google, not an edit performed here, and it invalidates every credential minted against them.
Not a display string; not a workspace scope.

**Class 5 — third-party observability identity.**
`service_name="wineops-agent-orchestrator"`
(`services/agent-orchestrator/core/observability.py:275,371`) and the AMQP `connection_name`
(`core/message_bus.py:442`) are the names this company appears under in a monitoring vendor's
dashboard. Renaming them **forks the time series** — the history does not follow the name.

**Doneability.** Each class is placed: either `brand-identity-charter`'s tier model gains it with
a named owner, or it is ruled out of this department's scope in writing with a named owner
elsewhere. `DEFERRED` is an acceptable close; silence is not.

**close_time.** 10d — 2026-09-07. It gates MB-2's slot table.

**Evidence.** The citations above, read 2026-08-28 · `media-brand-loops.md:120-129`: the
outward-surface-inventory loop exists because "each scan searched for what it already knew
about." It just did that again, and this is the correction.

**Cross-unit.** Charters are not editable in this wave. Filed to [[brand-identity-questions]]
and [[engineering-questions]] with a `MED-Q` id and a 42-day age-out.

---

### MB-6 · Re-anchor the citations, then stop hand-maintaining them
**Doneability.** Two parts. (a) Every `path:line` in `brand-identity-charter.md:74-104` resolves
to the string it claims, or is corrected — three known bad as of 2026-08-28, listed in §0.
(b) The table is **regenerated by MB-3's scan** rather than typed, so it cannot rot again. Done
when a run of the scan reproduces the table and a diff against the committed table is empty.

**close_time.** 7d — 2026-09-04, rides MB-3.

**Evidence.** §0's drift measurement · [[0025-citations-must-disagree-loudly|ADR 0025]] and
`scripts/check_citation_pairing.py`, which already enforce this discipline **for register
citations only** — line anchors into source are uncovered, and this department carries the
largest hand-typed `path:line` table in the vault.

---

### MB-7 · Tier-1 in-product copy corrections, first slice
*The schedulable half of the rename. Copy, not visuals.*

**Doneability.** The tier-1 rows whose replacement MB-2 marks as **decided** are corrected on one
dedicated branch, the guard stays green, and both counts fall. The pre-login `/privacy` page is
in the first slice — `apps/web/src/pages/Privacy.tsx:23,31,43` names a company that no longer
exists three times on the page a person reads to decide whether to trust this one. Nothing MB-2
marks `DEFERRED` is touched. Tier 3 is untouched. `apps/mobile/app.json:4` (`"slug": "wineops-ai"`)
is untouched — an Expo slug is an install identity, and editing it in a copy commit orphans
installed apps and push tokens. The retired root `SKILLS.md` tombstone is untouched: its
"WineOps AI" is a **historical quotation** and correcting it would falsify the record.

**close_time.** **GATED** — opens the day MB-2 lands; closes 2026-09-21.

**Evidence.** the id-less 'Rebrand posture' row, `OPEN-DECISIONS.md` Resolved table — *"planning starts now in Media & Brand; no execution
until the brand direction exists. The 336-line sweep is one dedicated branch later."* MB-1 and
MB-2 **are** the direction; this is that branch, and it is deliberately gated behind them rather
than started now.

---

### MB-8 · Reference shortlist — verify or drop, adopt nothing
**Doneability.** Each of the twelve named references resolves to a confirmed identity **and** a
need this department has today, or it is struck from the list in writing. The output is a
shorter list. **Zero adoptions.** Six of the twelve — Haikei, Motion Primitives, Animista,
Phosphor Icons, 21st.dev, Stitch — are visual or motion tooling and cannot be adopted at all
while the hold stands; confirming that they exist is groundwork, adopting one would be acting
past a lock. Five entries have unverified spellings and two have no URL, which is the finding
that motivates the task.

**close_time.** 21d — 2026-09-18; quarterly thereafter.

**Evidence.** `media-brand-directive.md:67` — *"Adopting a tool or a visual reference | M1, only
after identity verification and a named need | **Enthusiasm**"* · `reference-shortlist-verification`
loop, quarterly · the prior agenda's shortlist table, carried forward unchanged.

---

## §4 M2 — Narrative & Collateral

### MB-9 · Freeze the sentence; write the story, structure only
**Doneability.** A committed story artifact that leads with the sentence at
`YC_WEDGE_PLAN.md:312` **verbatim** (re-verified on the line 2026-08-28); every number in it
carries a source line or the number is cut; and it contains **no visual treatment** — no layout,
no imagery, no deck styling. Done when `nc-claim-warden`'s two declared outputs both pass:
leads-with-the-sentence = yes, and `MISSING` count = 0.

**close_time.** 14d — 2026-09-11.

**Evidence.** The card's own quality bar in `00-index/cards.json` (`nc-claim-warden`): *"whether
a claim is true is NOT this agent's bar; that is G3's, and a team may not fact-check its own
deck"* · `YC_WEDGE_PLAN.md:312, 315, 323`.

**Lock.** The visuals hold costs this task nothing, because the ordering of the argument is
reference-independent. The unreachable ElevenLabs reference blocks **styling only**, and styling
is not scheduled this cycle — so the blocked input blocks nothing that was going to happen.

---

### MB-10 · The claim ledger, built before there is anything to audit
*An inversion: the monthly headline-claim audit has no artifacts to audit
(`media-brand-schedule.md:32-36`). Rather than running an empty job three times and deleting it
under the anti-sprawl rule, build the thing the audit will read.*

**Doneability.** One committed table of every number this company would state outward — dollars
recovered, insight-type counts, UX-path counts, restaurant and tenant counts, POS adapter counts
— each with its source line and a status of `verified` / `we-asked-not-received` / `MISSING`.
Done when: the recovery number carries `YC_WEDGE_PLAN.md:31-33`'s distinction **in the ledger's
own words** — until a credit memo lands, "dollars recovered" means *we asked* — and no row is
blank. A `PRICING — DEFERRED (ADR 0039)` row appears in place of any price, so the lock is
visible in the artifact rather than remembered.

**close_time.** 14d — 2026-09-11.

**Evidence.** `media-brand-directive.md:71-77` — a number without a source line does not leave
this department · `claim-substantiation` loop, per-event, measures
`collateral.numbers_with_source_line` / `collateral.numbers_total` · the verified recovery number
is owned by [[design-partner-operations-charter|Sales S1]] and its loop has not closed once, so
that row opens as `we-asked-not-received` and stays there honestly.

---

### MB-11 · Demo script against the product that exists — **ASPIRATION**
**Doneability.** A sixty-second script in which every claimed on-screen step cites a live route
in `foundation/PAGE_MAP.md`, and any step the product cannot do today is marked `NOT BUILT`
**inside the script** rather than quietly omitted. Not recorded under this task.

**close_time.** 21d — 2026-09-18.

**Evidence and its correction.** `YC_WEDGE_PLAN.md` §3 is the sixty-second demo. The card's
recording blocker is **wrong**: it cites `PROJECT.md:101 — DEP-06, still unchecked`;
`PROJECT.md` contains no `DEP-0` string, and DEP-06 sits at `07-reference/REQUIREMENTS.md:333`
recorded as **checked**. Filed to [[narrative-collateral-questions]].

**Graded honestly.** This is **aspiration pending a decision**, and the decision is not this
department's: whether an uncredentialed or partially-built demo may be shown at all belongs to
[[strategy-fundraising-charter|Strategy & Fundraising]] and the founder. The script is written
either way; whether it is recorded is not ours to schedule.

---

## §5 M3 — Social & Community (dormant, and staying dormant)

### MB-12 · The trigger watch runs. Nothing else runs.
**Doneability.** One line per week, with a date and a named owner: has an article cleared G3 —
yes or no. Three consecutive weeks unrecorded means the watch is broken, and *that* is the
report. The team publishes nothing, reserves nothing, and opens no account.

**close_time.** weekly; first entry 2026-09-01.

**Evidence.** `social-entry-trigger-watch` loop, weekly · `media-brand-charter.md:134-138` —
chartered dormant, fork **CM-F6**, entry trigger is the first long-form article clearing G3 ·
`media-brand-schedule.md:40-42` explicitly exempts this watch from the three-runs-no-action
deletion rule: *its job is to fire once, and a watch returning "no" is doing what it was built
for.*

**Deliberately not a task.** Defensive handle reservation stays a **question**, not work.
Reserving a handle for a name MB-2 has not yet settled is how a company reserves the wrong one,
and the agent-stack gap table is explicit that G3 clearance is a chartered function with no
signal behind it — so there is nothing to react to either.

---

## §6 M4 — Customer Relationship Research (gated, and the gate is the work)

### MB-14 · The consent columns are enforced by nothing — file it first
*Scheduled ahead of MB-13, because MB-13 writes requirements against a gate, and a sweep on
2026-08-28 found there is no gate to write them against.*

**Doneability.** A written finding, filed to [[compliance-privacy-questions]] and
[[guest-experience-questions]] with a `MED-Q` id, a reproduction command, and a 42-day age-out,
stating what the sweep found: `consent_purpose`, `consent_captured_via`, and
`consent_withdrawn_at` (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64`)
appear in **exactly one file in this repository — the migration that creates them**. No code
under `apps/` or `services/` reads any of the three. Done when either (a) a code path is named
that does enforce them, correcting this finding, or (b) the gap is accepted in writing with an
owner and a date.

**close_time.** 7d — 2026-09-04.

**Evidence.** The sweep, run 2026-08-28 · the `crr-eligibility-gate` card in
`00-index/cards.json` consumes *"the consent gate owned by [[privacy-engineering-charter]] —
called, never reimplemented"*: **the card names a callee that does not exist**. The department
premortem's mechanism 4 assumed the gate was the missing *register*; the missing thing is one
layer lower.

**Hard line, unchanged.** This task touches no person's data. It reads source. Zero research
happens under it.

---

### MB-13 · Approval-register requirements pack → Compliance & Privacy
**Doneability.** A committed requirements document stating, per field, what a research approval
must record — subject, purpose, notice version, capture channel, capture time, withdrawal time,
and what a withdrawal **obliges us to do to findings already written**. Written as *requirements
on the gate Compliance & Privacy owns*, never as a schema this department implements, and
explicitly **not** by reusing the guest consent columns, whose purpose is
`service_personalisation` and whose subject is a guest. Done when it is filed into
[[compliance-privacy-questions]] with an id and an age-out, and `research-register-build`'s
`research.register_exists` has a source that can return **false** rather than nothing.

**close_time.** 10d — 2026-09-07.

**Evidence.** `crr-eligibility-gate`'s declared gap, verbatim in `cards.json`: *"the customer
approval register — publisher: NONE (gap — it does not exist; this is the whole finding)"* ·
[ADR 0039 §8.3](../../../foundation/GENERATION_BRIEF.md) assigns the consent-gate spec to
Compliance & Privacy · `media-brand-charter.md:77-79` — the legal shape is theirs, not ours.

---

### MB-15 · The refusal rule, written before the first request arrives
**Doneability.** One page stating exactly what `crr-eligibility-gate` returns when Sales asks
about a prospect who is not on the register: **`no register`, terminal — not a warning, not a
soft pass, and never accompanied by a suggested alternative** — plus where the refusal is logged
and who reads that log. Done when Sales can read it and cannot argue with it, and the refusal
log has a named destination that exists.

**close_time.** 10d — 2026-09-07.

**Evidence.** The card's quality bar (exactly one of `eligible` / `not eligible` / `no register`;
a gate that never denies is not a gate) · `media-brand-directive.md:86` escalates when M4 is
asked to research someone off-register, **including a Sales prospect** · the department
premortem's mechanism 4: *"it's public" is a very easy argument to make at speed* — which is why
the answer is written now, when nobody is asking, rather than in the moment when someone is.

---

## §7 Department level — the warden

### MB-16 · The first outward-surface inventory, run rather than described
**Doneability.** Every place a third party meets this company, enumerated with `path:line` and an
owning team — or the class named as **unenumerated**, which is a legitimate row. A count without
rows is a failed run. Must include the two classes §0 and MB-5 found that no prior scan covered.
Feeds MB-2's slot table.

**close_time.** quarterly; first run 2026-09-11.

**Evidence.** `outward-surface-inventory` loop, quarterly, the department's only owned skill row
in [[media-brand-agent-stack]] §3 · the loop's stated reason for existing
(`media-brand-loops.md:120-129`): push titles, Face-ID prompts, Android channels and iCal
`PRODID` headers were all outward surfaces no scan pattern covered.

---

### MB-17 · The board reads "not measurable" with a named dependency, never "0"
**Doneability.** Four team rows. Three read `not measurable` with the dependency named in the
same cell — product analytics for M3, the approval register for M4, an artifact to audit for M2.
M1's row carries **two numbers, never one**. Done when a reader can distinguish *unmeasured* from
*zero* at a glance, without opening another file.

**close_time.** weekly.

**Evidence.** `mb-outward-warden`'s quality bar, verbatim in `cards.json` · `media-brand-charter.md:99-104`
(three of four metrics are not currently measurable, and saying so is part of the charter) ·
[[0020-no-fabricated-answers|ADR 0020]] — substituting a number that exists for the one that
matters is the failure this rule exists to prevent.

---

### MB-18 · `brand.surface_added` has no publisher — bound it or accept it
**Doneability.** Either a publisher is named — a CI step that fires when a new outward surface
class appears (a new email template file, a new notification channel, a new feed, a new outbound
document type) — or the gap is **accepted in writing**, with the quarterly inventory stated as
its bound and a review date. Both are closes. Silence is not.

**close_time.** 21d — 2026-09-18.

**Evidence.** The declared gap, verbatim in `cards.json`: *"topic: brand.surface_added —
publisher: NONE (gap — nothing announces a new email template, notification channel, feed, or
handle)"* · [[media-brand-agent-stack]] §5: *"the quarterly inventory bounds the blind spot at
one quarter, which is long for a mail template."* §0 measured what a blind spot costs in four
days; a quarter of it is the thing being accepted.

---

## §8 What this agenda deliberately does not schedule

Recorded so that a later reader can tell a decision from an oversight.

| Not scheduled | Why |
|---|---|
| Any commissioned visual — wordmark refresh, palette, type specimen, landing page, Blender treatment | **Locked hold**, `decisions/README.md:76`, re-confirmed by the founder 2026-08-28 in [[0039-activation-plan-of-record]]. Voice and naming groundwork are permitted and are §1; commissioning is not, at any size. |
| Adopting any of the six visual/motion tools on the shortlist | Same hold. MB-8 verifies identity; adoption would be acting past the lock. |
| The full 360-line sweep, as one task, now | the id-less 'Rebrand posture' row, `OPEN-DECISIONS.md` Resolved table defers execution until the brand direction exists. Staged as MB-7 behind MB-1 and MB-2 instead of started. |
| Defensive social handle reservation | Reserving a handle for a name MB-2 has not settled reserves the wrong one. It is a decision, so it stays a founder question. |
| Any customer research, including "only public web pages" | The gate is the register, not the publicness of the data. MB-14 shows there is not even a gate to call yet. |
| Any priced or positioning collateral | The pricing model is deferred ([[0039-activation-plan-of-record]]). MB-10 carries a `PRICING — DEFERRED` row so the lock is visible in the artifact. |
| Renaming the GCP project, the Gmail account, or the telemetry service name | Not a string edit — an external account migration and a forked time series. Filed as MB-5, a classification finding, not a rename. |
| A tone-scoring brand linter | `voice-guide-check` must return the clause violated, not a verdict (`media-brand-schedule.md:88`), and there is no guide yet. No speculative skills. |
| Building the approval register ourselves | Compliance & Privacy owns the mechanism (`media-brand-charter.md:77-79`). MB-13 writes requirements, not schema. |
| Correcting "WineOps AI" in the retired root `SKILLS.md` tombstone | It is a historical quotation. Correcting it would falsify the record OD-14 was closed to preserve. |

---

## §9 Findings that are not tasks

Per [ADR 0039](../../../decisions/0039-activation-plan-of-record.md): *a task no card or loop
can carry is a finding, not a task.*

1. **Two surface classes have no owner** (MB-5). No card in this department or its teams can
   place them, because placing them edits a charter. Escalated, not scheduled.
2. **The department's declared metrics emit nothing.** `nf_b.choice` and `nf_b.context` are the
   department's frontmatter metrics; NF-B is architecturally locked and uninstrumented
   ([[media-brand-agent-stack]] §4). No card can carry a task whose measurement does not exist,
   so the board says `not measurable` (MB-17) and this agenda schedules no NF-B work.
3. **A card's own citation rotted and inverted in four days** (§0, DEP-06). This is not one bad
   line; it is the class ADR 0025 named for the register, now demonstrated in the card layer.
   The general fix is out of this department's scope; the local one is MB-6.
4. **Three metrics of four remain unmeasurable** and their dependencies are all owned elsewhere:
   product analytics (Growth G5), the approval register (Compliance & Privacy), an artifact to
   audit (which MB-9 and MB-10 will finally supply — the only one of the three this department
   can clear itself).

---

## §10 Questions for the founder

Carried forward and re-verified 2026-08-28; the last two are new.

1. **CM-F5:** does the rename stop at surfaces a human or third-party machine can see, or does it
   include `@wineops/*` workspace scopes, container names, and Railway/Vercel identifiers? Two
   rows of MB-2's slot table cannot close without this.
2. **Mobile install identity:** `apps/mobile/app.json:4` is `"slug": "wineops-ai"`. Changing it
   orphans installed apps and push tokens. In scope, or deferred?
3. **The approval register:** where does approval live, who captures it, and what exactly is the
   customer approving? The guest consent columns are a different subject and a different purpose
   and should not be reused.
4. **The visual references:** five of twelve have unverified spellings, two have no URL. Confirm
   or strike — MB-8 will strike by default.
5. **The ElevenLabs deck reference** remains unreachable (a personal Instagram save). It blocks
   styling only, and styling is not scheduled, so this is now a low-cost ask rather than a
   blocker.
6. **NEW — may the ratchet land before the direction?** MB-4 freezes the counts without renaming
   anything. the id-less 'Rebrand posture' row, `OPEN-DECISIONS.md` Resolved table defers execution; a guard is not execution, and four days of
   unattended growth is the argument. Confirm, and MB-4 lands in week one.
7. **NEW — who owns an externally-held identity?** The GCP project `wineops`, the Gmail account
   `wineops.ai@gmail.com`, and the telemetry service name are none of M1's, Engineering's CM-F5,
   or nobody's. MB-5 needs a destination.
