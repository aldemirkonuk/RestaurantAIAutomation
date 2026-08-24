---
type: charter
division: corporate
department: compliance-privacy
status: partial
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, nf_b.research_store_erasability]
updated: 2026-08-24
links: ["[[compliance-privacy-premortem]]", "[[compliance-privacy-directive]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-schedule]]", "[[compliance-privacy-agenda-full]]", "[[compliance-privacy-agenda-board]]", "[[privacy-engineering-charter]]", "[[regulatory-posture-charter]]", "[[regulated-operations-charter]]", "[[legal-charter]]", "[[commercial-workforce-agreements-charter]]", "[[security-charter]]", "[[access-control-tenant-isolation-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[customer-relationship-research-charter]]", "[[action-safety-the-human-gate-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[ORG_STRUCTURE]]", "[[corporate]]", "[[0006-neural-footprint-architecture]]"]
---

# Compliance & Privacy — Charter

> **The code is ahead of the paper, and the schema is ahead of the code.**
> That double asymmetry is the whole reason this department exists in the shape it
> does. Read §Evidence today before reading anything here as a going concern.

## Mandate

Compliance & Privacy is accountable for **the legal basis under which personal data
moves through this system, and for proving that the controls which enforce it
actually do.** Two halves that fail independently: *technical controls* — consent
lifecycle, erasure execution, PII guards, the data-flow inventory, and the consent
gate that gates all guest research — and *regulatory obligation* — GDPR/CCPA and
state-privacy duties mapped to named controls with citations, the content of the DPA
and BAA, the subprocessor register, and keeping the privacy notice tied to what the
code does.

The department also carries a third, dormant track: **operational regulatory
exposure** — alcohol licensing and excise — which shares only the word "compliance"
with the rest of the mandate and is therefore named, gated, and unstaffed rather
than folded into a team whose subject is privacy law ([[regulated-operations-charter]]).

## What this department absorbed

**Ethics & Responsible AI was proposed as a fourth advisory function and was not
adopted** ([[ORG_STRUCTURE]] §3, struck row, 2026-08-24). Its scope did not
evaporate; it fell here, into the line. Concretely, this department owns:

- **Agent-autonomy limits** — the boundary of what an agent may do to a person's
  data without a human in the loop. The mechanism belongs to
  [[action-safety-the-human-gate-charter]]; the *rule about personal data* is ours.
- **Guest-data use** — whether a purpose recorded as `service_personalisation` may
  be reused for marketing, research, or model training. The schema records the
  purpose precisely so this cannot happen by accident
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58`).
- **Personalization fairness** — whether a taste fingerprint that varies its
  recommendations by inferred region, language, or spend is doing personalization
  or discrimination. [[taste-fingerprint-charter]] builds the model; the question of
  what it may not condition on is ours.

This paragraph exists because a reader who only knows the privacy mandate would find
"personalization fairness" arbitrary. It is not arbitrary; it is inherited, and the
inheritance is documented in the org's own strike-through.

**One consequence worth stating:** an advisory function reviews and does not block
([[ORG_STRUCTURE]] §3, findings-only). A line department can refuse. Ethics scope
landing in the line therefore made it *stronger*, not weaker — but it also removed
the independence argument, so this department reviews its own use of guest data.
That is a real structural weakness and it is [[compliance-privacy-premortem]] M5.

## Boundaries

Owned outright:

- **The consent record and its lifecycle.** Purpose, notice version, capture
  channel, capture time, withdrawal time — as a *record with a version, not a
  boolean* (`20260819000000_guest_identity_minimal_slice.sql:54`). Who may rely on
  a given consent, for what, and when it expires.
- **Erasure execution and its proof.** The tombstone design exists
  (`:79-82`). Executing it, receipting it, and *proving* absence across every store
  is ours and is currently unbuilt.
- **The definition of PII, singular.** Four independent guards exist and no two
  agree (§Evidence). One definition, one module, one CI guard is a deliverable of
  this department, not a nice-to-have.
- **The data-flow inventory** — which of the 50 runtime hosts in
  [`EXTERNAL_CONNECTIONS.md`](../../../foundation/EXTERNAL_CONNECTIONS.md) receive
  personal data, and under what instrument.
- **The obligation register** — each named legal duty → a named control → a
  `file:line` or an owner.
- **The consent gate.** Only a guest whose consent record is live and whose purpose
  covers research may be researched. [[customer-relationship-research-charter]] is a
  consumer of this gate and never an owner of it ([[corporate]] §8).
- **The privacy notice's accuracy** — `apps/web/src/pages/Privacy.tsx` states claims
  about code behaviour; keeping those claims true is a compliance function, not a
  content function.
- **Regulatory obligation for regulated operations** — dormant, gated
  ([[regulated-operations-charter]]).

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Drafting the instrument** — the DPA, BAA, MSA clauses as executable documents | [[commercial-workforce-agreements-charter]] (Legal) | Legal drafts instruments; we own what the Annex must be able to say. A signed Annex naming controls we cannot evidence is [[compliance-privacy-premortem]] M2, and it is prevented at the register, not at the signature. |
| **Access control, authn, authz, RLS, secrets** | [[security-charter]] → [[access-control-tenant-isolation-charter]] | Security decides *who may reach* the data. We decide *what may be done with it and on what basis*. `TenantGuard` returning `true` for an unauthenticated user ([[README]] §2.3) is a Security defect, not a privacy one — even though its consequence is a disclosure. |
| **The guest identity model** — merge keys, refusal-to-merge, `display_label` discipline | [[guest-identity-consent-charter]] (Product → Guest Experience) | They own *who this guest is and when not to merge*. We own *what they were told, whether it still holds, and proving deletion*. Same migration file, opposite questions. **This seam is not fully settled — see §Contested seams.** |
| **Building the taste fingerprint** | [[taste-fingerprint-charter]] | They model. We say what the model may not condition on and what happens to it on erasure. |
| **Doing customer research** | [[customer-relationship-research-charter]] (Media & Brand) | They own the questions and the findings. We own the gate they must pass. |
| **The human-in-the-loop mechanism** for agent actions | [[action-safety-the-human-gate-charter]] | They build the gate. We write the rule that personal data crosses it. |
| **Security testing, red-teaming, attacking decisions** | [[security-charter]], [[red-team-charter]] | Different discipline entirely. |
| **NF-A/NF-B schema columns** | [[neural-footprint-instrumentation-charter]] / OD-11 | We are a requesting consumer: erasability is a requirement we place on their schema, not a column we get to add. |

### Contested seams — named, not resolved

1. **Guest consent capture.** `consent_captured_via` is CHECK-constrained to four
   channels — `reservation_form`, `in_venue_card`, `staff_verbal`, `loyalty_signup`
   (`:60-62`) — and **none of them has an implementation**. Whoever builds the
   capture UI arguably owns the consent record. Proposed here: Product builds the
   surface, this department owns the record's contents and its validity rules.
   That is a proposal, not a decision — raised in [[compliance-privacy-agenda-full]].
2. **DPA/BAA ownership** — already staged as **OD-C2** ([[corporate]] §7):
   Legal owns the instrument, we own the obligations. Confirm or collapse.
3. **Is Regulated Operations Corporate's at all** — staged as **OD-C4**. It may
   belong to Product once a licensing feature exists.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `privacy.erasure_completeness` | For one erasure request, % of stores where absence is **proven by a test**, not asserted | **0%** — no erasure function, no receipt table, no test |
| `privacy.pii_definition_count` | Number of independent definitions of "PII" in the codebase. **Target 1.** | **3 distinct** across 4 guards (§Evidence) |
| `privacy.consent_call_sites` | Application call sites that read or write the consent record | **0** — the schema has no callers at all |
| `privacy.consent_gate_denials` | Research requests refused at the gate per quarter. A gate that never denies is not a gate. | undefined — no gate is running |
| `compliance.obligation_coverage` | % of named obligations mapped to a control with a citation | **0%** |
| `compliance.subprocessor_classification` | % of the 50 runtime hosts classified as personal-data-receiving or not | **0 / 50** |
| `compliance.notice_accuracy` | Claims in `Privacy.tsx` verified against current code behaviour | unverified; brand is wrong in ≥3 places |
| `nf_b.research_store_erasability` | Whether a guest's rows in the append-only research store can be removed on request | **unanswered — the department's most important open question** |

## Evidence today

Graded per [[corporate]] §0: **EXISTS** = running with an artifact · **PARTIAL** =
stub or fraction of mandate · **NEW** = proposal only.

**Roll-up: PARTIAL, with an unusual internal shape.** One team's evidence is the
strongest in its entire division; another team's is a verified zero; a third is a
declared stub. Averaging those into one grade would hide the finding.

### EXISTS — the consent and erasure schema, and it is genuinely good

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`, 564 lines,
three tables (`guests:40`, `guest_identifiers:122`, `guest_check_links:206`):

- **Consent as a versioned record.** `:54` states the intent in the file itself —
  *"Consent is per GUEST and it is a record with a version, not a boolean… A boolean
  cannot answer 'what was this person told, on what date, and can we prove it'."*
  Columns at `:58-64`: `consent_purpose` (default `service_personalisation`),
  `consent_notice_version`, `consent_captured_via` (CHECK over four channels),
  `consent_captured_at`, `consent_withdrawn_at`.
- **Erasure as a tombstone, for a mechanical reason.** `:70-82` — the app connects
  as `service_role`, which holds `rolbypassrls`, so *every* `deleted_at IS NULL`
  predicate lives in a policy the application never evaluates. A soft-deleted guest
  would still be returned by every query the app makes. So `erased_at` marks a
  tombstone: identifiers hard-deleted, label and consent nulled.
- **Plaintext never becomes a column.** `guest_identifiers.channel_hash` is an HMAC
  under a per-restaurant pepper (`:131-138`); `guest_link_identifier()` (`:375`)
  takes the plaintext as an argument and persists only the hash, so *"erasure is a
  DELETE with nothing left to shred, rather than a hunt through `pos_checks.raw`,
  events, notifications, decision_log, event_store and analytics_cache for copies"*
  (`:429-435`). Execute is revoked from public and granted narrowly (`:504-506`).
- **Consent is scoped to one restaurant on purpose** (`:99-105`): the same human at
  two restaurants is two rows, because *sharing across restaurants is a new
  disclosure to a new controller requiring its own legal basis*.

### EXISTS — two CI-enforced guard scripts, correctly reasoned

- `scripts/check_no_guest_name_matching.sh` — `display_label` may never resolve,
  match or merge a person. Its header carries the argument rather than the rule:
  *"'John Smith' is a collision class… A false guest merge is a DISCLOSURE… No
  un-merge reverses that."*
- `scripts/check_no_raw_guest_channels.sh` — a raw channel may only enter as an
  argument to `guest_link_identifier()`. Names the six sinks that would swallow it
  silently and states why the rule is *"free to enforce now and impossible to
  enforce later"*.
- Both are wired into CI on push, pull request, **and** a daily cron —
  `.github/workflows/schema-parity.yml:19-27, 152-154`, alongside
  `scripts/eval_guest_merge_policies.py:149`. These are real, running controls.

### PARTIAL — four PII guards, three definitions, zero shared module

| # | Guard | Definition of PII |
|---|---|---|
| 1 | `services/agent-orchestrator/services/constraint_engine.py:28-36`, applied `:113-117` (C-21/C-08, *"highest priority — never log sensitive content"*) | 7 regexes: SSN, 9-digit routing, Visa, Mastercard, Amex, "routing number", "social security" |
| 2 | `services/agent-orchestrator/agents/provider_communication_agent.py:40-48`, applied `:725-733` (`_classify_message_sensitivity` → discrete mode: no body logging, no embedding, no summarization) | **The same seven patterns, copy-pasted and re-compiled.** No shared import. |
| 3 | `services/agent-orchestrator/jobs/research_tasks.py:101-102`, `_has_pii:200-202`, applied `:744-751` (blocks snippets from `evidence_citations`) | **Email and phone only.** |
| 4 | `supabase/migrations/20260805000000_baseline_from_production.sql:1080` — `AND sensitive = false -- D-12: PII never returned in search results` | A boolean column, set by guard #2's classifier. |

**The finding, stated precisely:** an email address is PII to guard #3 and invisible
to guards #1 and #2. An SSN is PII to guards #1 and #2 and invisible to guard #3.
Guards #1 and #2 are byte-identical duplicates with no shared module, so they will
drift on the first edit that touches only one of them — and nothing in CI would
notice. **No guard detects a guest name, a hashed channel, or a taste vector.**
Four guards is not defence in depth; it is three definitions and a copy.

### NEW — every word of GDPR and CCPA

Verified this session, not transcribed: `grep -riE "gdpr|ccpa|data subject|right to
erasure"` across `apps/`, `services/`, `supabase/`, `scripts/` returns **zero
hits**. The single repo-wide match outside planning prose is
`.planning/stage1_producer_research_raw.json`, where **"CCPAE"** is the *Consell
Català de la Producció Agrària Ecològica* — the Catalan organic-agriculture council,
a substring collision, not a privacy statute. Obligation coverage is genuinely 0%.

There is **no policy, no DPA, no BAA, no data-processing record, no subprocessor
register, and no privacy programme document anywhere in this repository.**

### 🔴 The finding that reframes everything above: the schema has no callers

`grep` for `consent_purpose`, `consent_notice_version`, `consent_captured_via`,
`consent_withdrawn_at`, `erased_at`, `guest_link_identifier`, `guest_identifiers`,
`guest_check_links` across `apps/` and `services/` — **every `.ts`, `.tsx` and `.py`
in the product — returns zero results.**

564 lines of well-argued migration, three tables, one security-definer function, two
CI guards protecting it, and **not one line of application code writes or reads
it.** No consent has ever been captured. No erasure has ever been executed. The four
CHECK-constrained capture channels have no implementation. `erasure_receipt_id`
(`:82`) is a bare `uuid` with no foreign key, because **no receipt table exists**.

This is the department's actual starting position and it is better news than it
sounds: the correct design is already committed, argued, and CI-protected. What is
missing is execution and paper — in that order — and neither is blocked by a bad
decision that has to be unwound first.

### The tension this department must hold open

[ADR 0006](../../../decisions/0006-neural-footprint-architecture.md) locks the
neural-footprint research store as **append-only, deliberately wide, never
migrated**. That is excellent for ML and it is the reason NF-C can be added later
without a migration. Guest taste fingerprints (NF-B) are personal data.

**An append-only store that is never migrated has no defined mechanism for removing
one subject's rows.** The production store can tombstone; the research store's whole
value proposition is that old rows keep their shape forever. Erasure and append-only
are not obviously reconcilable, and the reconciliations that exist — crypto-shredding
per-subject keys, subject-level partitions, aggregate-only retention — are design
decisions with real ML cost that this department is not entitled to make alone.

**This is raised, not resolved.** It belongs in `OPEN-DECISIONS.md` alongside OD-11,
and it is the single most consequential thing in this charter, because it gets
harder every day the research store accumulates rows.

## Team roster

| Team | Status | Primary metric | v0 baseline |
|---|---|---|---|
| [[privacy-engineering-charter]] | `exists` | `privacy.erasure_completeness` | 0% — untested |
| [[regulatory-posture-charter]] | `new` | `compliance.obligation_coverage` | 0% |
| [[regulated-operations-charter]] | `new`, ⏸ **GATED** | — | not staffed |

**Three teams is the right number and the split axis is real**, not symmetry: team
one's artifacts are migrations, guards and tests; team two's are registers and
obligations; team three's subject is excise tax and shares nothing with either. The
department-level test in [[corporate]] §0 — *can this team say why it is distinct
from its sibling?* — is passed by all three, and the third answers it by declining
to exist yet.
