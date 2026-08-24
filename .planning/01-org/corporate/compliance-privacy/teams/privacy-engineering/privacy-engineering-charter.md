---
type: charter
division: corporate
department: compliance-privacy
team: privacy-engineering
status: exists
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, privacy.store_inventory_coverage]
updated: 2026-08-24
links: ["[[privacy-engineering-premortem]]", "[[privacy-engineering-directive]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-schedule]]", "[[privacy-engineering-agenda-full]]", "[[privacy-engineering-agenda-board]]", "[[compliance-privacy-charter]]", "[[regulatory-posture-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[customer-relationship-research-charter]]", "[[security-charter]]", "[[access-control-tenant-isolation-charter]]", "[[ai-surface-security-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[schema-migrations-charter]]", "[[corporate]]", "[[0006-neural-footprint-architecture]]"]
---

# Privacy Engineering — Charter

> **`status: exists`, and it is the strongest evidence in the Corporate division —
> with one qualification that changes how to read it.** The controls are committed,
> argued in-file, and CI-enforced. They also have **zero application call sites.**
> Both facts are true and neither cancels the other.

## Mandate

Privacy Engineering owns **the technical controls that make a privacy claim true**:
the consent lifecycle as executable code, erasure and tombstone execution with a
receipt, the single definition of PII and the guards that enforce it, the inventory
of every store personal data reaches, and the **consent gate** that
[[customer-relationship-research-charter]] must pass before researching any
individual.

Its artifacts are migrations, guards, and tests. That is the whole distinction from
its sibling and it is a distinction of *material*, not of seniority.

## Why distinct from [[regulatory-posture-charter]]

A control with no obligation behind it is guesswork; an obligation with no control is
a lie. Both are true and they are built by different work: this team writes SQL,
Python and bash; that team writes registers and mappings. The department's founding
observation is that **one team would keep doing whichever half it was better at** —
and the measured evidence is that this is exactly what already happened. Four PII
guards and a genuinely well-designed consent schema exist; zero occurrences of "GDPR"
or "CCPA" exist. The split is a response to a gap that has already opened once.

## Boundaries

Owned outright:

- **The consent record's mechanics.** Reading it, writing it, validating it,
  expiring it. `consent_purpose`, `consent_notice_version`, `consent_captured_via`,
  `consent_captured_at`, `consent_withdrawn_at`
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64`).
- **Erasure execution.** The tombstone (`:79-82`), the receipt (**no receipt table
  exists yet** — `erasure_receipt_id` is a bare `uuid`), and the test that proves
  absence store by store.
- **The store inventory.** Which tables, caches, logs, embeddings, and external
  services personal data reaches. Discovered from a live catalogue, never from a
  hand-written list.
- **One definition of PII**, in one module, imported everywhere — plus the CI guard
  that makes divergence a failing build rather than a discovery.
- **The consent gate** as a callable check with a real denial path.
- **Privacy-by-construction review of migrations** — the argument that a plaintext
  channel must never become a column (`:131-138`) is a schema-design rule this team
  enforces at review time, in partnership with [[schema-migrations-charter]].
- **Erasability requirements placed on other people's schemas** — including NF-B.
  We do not own those columns; we own the requirement.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Obligations, registers, DPA/BAA content, subprocessor classification** | [[regulatory-posture-charter]] | We build the control; they say which duty it discharges. |
| **Drafting the instrument** | [[commercial-workforce-agreements-charter]] (Legal) | Legal drafts; we evidence. |
| **Access control, authn, authz, RLS, secrets, tenant isolation** | [[access-control-tenant-isolation-charter]] (Security) | They decide *who may reach* data. We decide *what may be done with it, on what basis, and how it is removed*. The `TenantGuard` returning `true` for an unauthenticated user ([[README]] §2.3) is theirs even though its consequence is a disclosure. |
| **Prompt-injection, model-surface attacks, jailbreaks** | [[ai-surface-security-charter]] | Adjacent and often confused with us. An agent tricked into leaking PII is their attack and our control; the guard is ours, the exploit is theirs. |
| **Guest identity resolution and merge refusal** | [[guest-identity-consent-charter]] (Product) | They own *who this guest is* and *when not to merge*. We own *what they were told and proving deletion*. Same file, opposite question. |
| **Building the taste fingerprint** | [[taste-fingerprint-charter]] | They model; we constrain and erase. |
| **NF-A/NF-B schema columns** | [[neural-footprint-instrumentation-charter]] / OD-11 | We are a requesting consumer, not an author. |

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `privacy.erasure_completeness` | **Primary.** For a guest erasure request, % of stores where absence is *proven by test*, not asserted | **0%** — schema supports it, nothing proves it |
| `privacy.pii_definition_count` | Independent definitions of PII in the tree. Target **1** | **3 distinct across 4 guards** |
| `privacy.consent_call_sites` | Application call sites reading or writing the consent record | **0** |
| `privacy.consent_gate_denials` | Research requests refused per quarter. Zero over a quarter means unused or misconfigured | undefined — no gate |
| `privacy.store_inventory_coverage` | % of stores in the live catalogue classified as personal-data-bearing or not | **0%** — no inventory |
| `privacy.guard_allowlist_size` | Entries in the guard scripts' allowlists. Growth is the erosion signal | **0** — both allowlists are empty today |

## Evidence today

**EXISTS**, verified this session against the working tree rather than transcribed.

### The consent and erasure schema — 564 lines, three tables, argued in-file

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`:

- **Consent as a versioned record, not a boolean.** `:54` — *"Consent is per GUEST
  and it is a record with a version, not a boolean. A boolean cannot answer 'what was
  this person told, on what date, and can we prove it'."* Columns `:58-64`;
  `consent_captured_via` is CHECK-constrained to `reservation_form`, `in_venue_card`,
  `staff_verbal`, `loyalty_signup` (`:60-62`).
- **Erasure is a tombstone for a mechanical reason, not a philosophical one.**
  `:70-82` — the app connects as `service_role` (`database.service.ts:15`), which
  holds `rolbypassrls`, so every `deleted_at IS NULL` predicate lives in a policy the
  application never evaluates. A soft-deleted guest would still be returned by every
  query the app makes. Hence `erased_at`: identifiers hard-deleted, label and consent
  nulled.
- **Plaintext never becomes a column.** `guest_identifiers.channel_hash` is an HMAC
  under a per-restaurant pepper with a `canonicaliser_version` (`:131-145`).
  `guest_link_identifier()` (`:375`) takes plaintext as an argument and persists only
  the hash — *"erasure is a DELETE with nothing left to shred, rather than a hunt
  through pos_checks.raw, events, notifications, decision_log, event_store and
  analytics_cache for copies"* (`:429-435`). Execute revoked from public, granted
  narrowly (`:504-506`).
- **Only a verified channel is ever a merge key** (`:146-152`) — an OTP, a
  confirmation click, a scanned card, a processor fingerprint. A host typing a phone
  number from memory is not verified.
- **Consent is scoped to one restaurant** (`:99-105`) because sharing across
  restaurants is a new disclosure to a new controller requiring its own legal basis.

### Two CI-enforced guard scripts, running today

- `scripts/check_no_guest_name_matching.sh` — `display_label` may never resolve,
  match or merge a person. Carries the argument, not just the rule: *"'John Smith' is
  a collision class, and which John Smith is not in the string at all"*; *"A false
  guest merge is a DISCLOSURE… No un-merge reverses that."* Deliberately broad
  pattern, *"a false positive is one line in the allowlist below, a false negative is
  a disclosure."* Allowlist currently empty.
- `scripts/check_no_raw_guest_channels.sh` — a raw channel may only enter as an
  argument to `guest_link_identifier()`. Names the six sinks that would swallow it
  silently and states why the rule is *"free to enforce now and impossible to enforce
  later."*
- Both wired at `.github/workflows/schema-parity.yml:152-154`, on push to
  `main`/`develop`, on pull_request, and on `cron: "0 6 * * *"` (`:19-27`), alongside
  `scripts/eval_guest_merge_policies.py` (`:149`) which **fails loudly if its DB
  secret is unset rather than passing for the wrong reason** (`:143-147`).

### Four PII guards — and the gap between them, measured

| # | Location | Definition |
|---|---|---|
| 1 | `services/agent-orchestrator/services/constraint_engine.py:28-36`, applied `:113-117` (C-21/C-08, *"highest priority — never log sensitive content"*) | 7 regexes: SSN, 9-digit routing, Visa, MC, Amex, "routing number", "social security" |
| 2 | `services/agent-orchestrator/agents/provider_communication_agent.py:40-48`, applied `:725-733` (`_classify_message_sensitivity` → discrete mode: no body logging, no embedding, no summarization) | **The same seven, copy-pasted and re-compiled. No shared import.** |
| 3 | `services/agent-orchestrator/jobs/research_tasks.py:101-102`, `_has_pii:200-202`, applied `:744-751` (blocks snippets from `evidence_citations`) | **Email and phone only** |
| 4 | `supabase/migrations/20260805000000_baseline_from_production.sql:1080` — `AND sensitive = false -- D-12: PII never returned in search results (T-24-01-03)` | A boolean column, populated by guard #2's classifier |

**Precisely stated:** an email address is PII to guard #3 and invisible to #1 and #2.
An SSN is PII to #1 and #2 and invisible to #3. **No guard detects a guest name, a
hashed channel, or a taste vector.** Guards #1 and #2 will diverge on the first
one-sided edit and nothing in CI will notice. Four guards is three definitions and a
copy — not defence in depth.

### PARTIAL — the operator consent surface

`apps/web/src/components/settings/ConsentDialog.tsx:1-8` states a genuinely correct
principle — *"A toggle that flips silently is not consent — the user has to be told
what categories of data move, where they go, and be able to decline"* — with a typed
`ConsentCopy` contract (`dataCategories`, `exclusions`, `acknowledgement`) and a
required acknowledgement checkbox so *"a stray click on the switch"* is not a grant.
Used by `ServicesPermissions.tsx`.

**Scope correction, important:** this is **operator** consent for third-party service
permissions. It is *not* guest consent, it does not touch the `guests` table, and it
must not be cited as evidence that guest consent capture exists. It is the right
pattern, applied to a different subject.

### 🔴 NEW — the schema has no callers

`grep` across every `.ts`, `.tsx` and `.py` in `apps/` and `services/` for
`consent_purpose`, `consent_notice_version`, `consent_captured_via`,
`consent_withdrawn_at`, `erased_at`, `guest_link_identifier`, `guest_identifiers`,
`guest_check_links` returns **zero results**.

No consent has been captured. No erasure has been executed. None of the four
CHECK-constrained capture channels has an implementation. `erasure_receipt_id`
(`:82`) has no foreign key because no receipt table exists.

**This is why the team is `exists` and its primary metric is 0%.** The controls are
real; the exercise of them is not. Those are different claims and this charter
refuses to let the first stand in for the second.

## Entry conditions this team places on others

- **[[customer-relationship-research-charter]] may not begin** until the consent gate
  is a callable check with a denial path. They are blocked on us; we should say so
  loudly rather than let it read as their delay.
- **[[taste-fingerprint-charter]] may not accumulate NF-B rows** until the
  erasability question has a dated decision. See [[compliance-privacy-charter]]
  §"The tension this department must hold open" and
  [ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md).
- **Any new table carrying a person's attribute** widens the erasure denominator and
  must be declared to this team at migration review.
