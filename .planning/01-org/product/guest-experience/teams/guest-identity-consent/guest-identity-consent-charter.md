---
type: charter
division: product
department: guest-experience
team: guest-identity-consent
status: exists
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.refusal_count, nf_b.consented_link_rate]
updated: 2026-08-24
links: ["[[guest-identity-consent-premortem]]", "[[guest-identity-consent-agenda-full]]", "[[guest-identity-consent-agenda-board]]", "[[guest-identity-consent-directive]]", "[[guest-identity-consent-loops]]", "[[guest-identity-consent-schedule]]", "[[guest-experience-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[guest-value-monetization-charter]]", "[[compliance-privacy-charter]]", "[[security-charter]]", "[[data-charter]]", "[[red-team-charter]]", "[[product]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]"]
---

# Guest Identity & Consent — Charter

> **The only team in this division whose errors are irreversible.** Everything in
> this charter follows from that one fact, including the metric it is judged on.

## Mandate

Own the guest identity spine: **who this guest is, by what verified key we know it,
what they were told, and — above all — when not to merge.**

The asymmetry is the mandate. A false bottle merge is a data-quality error with a
bounded monetary cost. A false guest merge is a **disclosure** of one person's
dining history, spend, allergies and companions to another person, and to every staff
member reading the profile — and no un-merge reverses a disclosure
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:31-35`). So
there is **no threshold here at all — not a high one.** Exact verified key, a human
assertion, or nothing (`:35`).

That is why this team is measured on **refusals**, not on match rate. It is the
opposite incentive from every other identity team in the company, and the inversion
is deliberate: the team that owns the irreversible error must not be rewarded for
producing more of the thing that causes it.

## Boundaries

Owned outright:

- **The three tables** — `guests` (`:40`), `guest_identifiers` (`:122`),
  `guest_check_links` (`:206`) — and the reasoning encoded in their comments, which
  is currently the only place that reasoning lives.
- **`guest_link_identifier()`** (`:375-427`), the single legal write path for a
  contact channel. Plaintext enters as an *argument* and never becomes a column, a
  log line, or a jsonb payload — so erasure is a `DELETE` with nothing left to shred
  rather than a hunt through `pos_checks.raw`, `events`, `notifications`,
  `decision_log`, `event_store`, `analytics_cache` (`:429-435`).
- **The versioned consent record** (`:54-64`) — purpose, notice version, capture
  channel, capture time, withdrawal time. Its shape and its integrity; not its legal
  wording.
- **The erasure tombstone** (`:70-82`, `:112-117`) and the rule that
  `guests` must never grow a `deleted_at` — the app connects as `service_role`
  (`rolbypassrls`), so a soft-deleted guest would still be returned by every query
  the application makes (`:71-78`).
- **The four PII guards**, listed in §Evidence, and the authority to block any change
  to any of them.
- **The zero-false-merge CI gate** — `guest_copresence_negatives` (`:519-540`) and
  `scripts/eval_guest_merge_policies.py`.
- **The refusal log.** Every declined link, with its reason. This team's primary
  output artifact.
- The consent UX contract behind `NEW-658`, `NEW-662`, `NEW-663`, `NEW-666`
  (`UX_PATHS_CATALOG.md:1483-1491`) and `NEW-879`, `NEW-884` (§AB).

## Why distinct

**From [[taste-fingerprint-charter]]:** 2.1 answers *who*, 2.2 answers *what they
like*, and they have **opposite risk postures**. This team is measured on refusing to
guess; that one is measured on modelling. One team holding both lets the model's
appetite for data set the merge threshold — the exact conflict [[ORG_STRUCTURE]] §3
cites for keeping Red Team out of Security. The separation is not tidiness; it is the
only structural defence against [[guest-identity-consent-premortem]] F1.

**From [[compliance-privacy-charter]]:** they own what the notice must say and the
legal basis for saying it. This team owns whether the record proves it was said —
per guest, per version, per date. Different failure: theirs is a wrong promise, ours
is an unprovable one.

**From [[security-charter]]:** they defend the perimeter. This team's entire threat
model is a change that passes every security review because it is *correct code doing
the wrong merge*. No perimeter control detects that.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| Preference aggregates, taste modelling, any model over guest behaviour | [[taste-fingerprint-charter]] | Deliberately absent from the shipped slice (`:22-25`) and it stays absent here. |
| Consent notice wording, legal basis, GDPR/CCPA interpretation | [[compliance-privacy-charter]] | We own the record's shape and its provability. |
| Cross-restaurant identity sharing | **Nobody — it is founder-only** | Prevented today by arithmetic, not policy: the per-restaurant pepper (`:338-367`) makes the same phone at two restaurants hash differently. Undoing it is a deliberate migration, which is the moment the legal question gets asked (`:195-201`). |
| A merge queue, a resolution UI, fuzzy candidate generation | **Nobody, on purpose** | `:22-25` lists these as *"can wait"*. Building the queue is how the threshold arrives — the queue needs candidates, and candidates need a similarity score. |
| Points, ratings, the consumer app | [[consumer-app-points-economy-charter]] | We provide the subject; they provide the signal. |
| k-anonymity on restaurant-facing views | [[guest-value-monetization-charter]] | We control who *is* a subject; they control what is *shown* about groups of subjects. |
| The `recommendation_actions` operator signal | **Unhomed — see [[guest-experience-charter]]** | An operator is not a guest. Named because it has no `subject_type` slot, not claimed. |

## Metrics it moves

| Metric | Definition | Today | Gate |
|---|---|---|---|
| `nf_b.subject_coverage` | % of `pos_checks` carrying a **consented** `guest_check_links` row | **0%, structurally** | This is the denominator of every NF-B metric in the sub-layer |
| `nf_b.false_merge_count` | Guests merged without an exact verified key or a human assertion | 0 | **Hard gate: 0, permanently.** Not a target — a gate |
| `nf_b.refusal_count` | Links declined because no verified key proved them | 0 (nothing runs) | **Reported as output, not as friction.** A quarter with rising coverage and zero refusals is a quarter to audit |
| `nf_b.consented_link_rate` | Share of links whose guest has a live, unwithdrawn consent record | undefined | A link without consent is not an NF-B subject |
| `nf_b.unverified_identifier_share` | Share of `guest_identifiers` rows with `is_merge_eligible = false` | undefined | Expected to be **high**. A falling number is a signal to investigate, not to celebrate |

## Evidence today — **EXISTS**

Shipped, deliberately minimal, commit `ce65715`. 564 lines. Verified in this session
against the working tree.

**The scope test that produced it** (`:16-25`): *build exactly what cannot be
backfilled, and nothing that can.* Cannot be backfilled — the guest row, its
restaurant scope, the hashed verified identifier, the check↔guest link with
provenance, consent captured at capture time. Can wait — resolution beyond exact
keys, a merge queue, preference aggregates, any model, cross-restaurant sharing.
All four of the second list are **deliberately absent**.

### The four independent PII guards — verified

Each closes a different hole. None depends on another holding.

1. **`display_label` is never a match key.** Declared at `:44-52` with the reason
   that the wine analogue misleads: `master_wine_library.name` *is* part of a match
   key because producer + name + residual tokens identify a product, whereas *"John
   Smith" is a collision class and the information that distinguishes two John Smiths
   is not in the string at all, so no tokenisation recovers it.* Enforced by
   `scripts/check_no_guest_name_matching.sh` — pattern at `:34` (comparisons,
   `similarity`, `levenshtein`, `fuzzy`, `soundex`, `metaphone`, `ilike`), `rg` sweep
   over `apps/ services/ scripts/` at `:52-53`, `exit 1` at `:74`. The allowlist at
   `:37-38` is **empty**, and the comment states the design rule: *"a false positive
   is one line in the allowlist below, a false negative is a disclosure"* (`:32-33`).
2. **Plaintext never lands anywhere.** `guest_link_identifier()` (`:375-427`) takes
   the raw value as an argument and persists only
   `hmac(canonical, per-restaurant pepper, sha256)` (`:405-411`). Code-layer guard:
   `scripts/check_no_raw_guest_channels.sh`. Payoff stated at `:429-435`.
3. **`guest_identifiers` is closed by grants as well as by policy.** `:477-485` —
   **no `authenticated` policy at all**, plus `revoke all ... from authenticated,
   anon`. The comment gives the reason the belt needs braces: *"RLS-enabled-with-no-policy
   is closed only by ABSENCE, and the next person to add a policy would silently open
   the whole table."*
4. **Cross-restaurant linkage is arithmetic.** `guest_pepper()` (`:338-367`) derives
   a per-restaurant HMAC key from one vault secret, so the same number at two
   restaurants produces two different hashes and cannot be joined even by accident
   (`:195-201`). It **raises** rather than falling back to a constant when the secret
   is missing (`:353-359`) — *"a predictable pepper on a phone-number hash is a
   rainbow table, and failing loudly is the only honest behaviour."*

### Four more properties worth the same protection

- **Merge eligibility is generated, not conventional** — `:168-169`,
  `GENERATED ALWAYS AS (verified_at is not null and identity_status = 'normal')
  STORED`, chosen over a trigger so a direct write fails at 42601 instead of silently
  vanishing on the next trigger fire (`:164-167`).
- **`card_fingerprint` is quarantined regardless of verification** — `:414-420`.
  It is *"perfectly verified and completely wrong about what it identifies. It
  identifies a HOUSEHOLD OR COMPANY"* (`:156-160`). A joint card merges a marriage
  into one guest.
- **Incompleteness fails toward a SPLIT** — `guest_channel_canonicalise()`
  (`:268-336`) returns NULL for anything it does not recognise; a phone without a
  country code is **refused rather than guessed**, because *inferring the country is
  inventing identity, not normalising spelling* (`:285-289`).
- **`guest_check_links` is many-to-many on purpose** (`:214-218`). A check has
  `covers` people, not one, and one-guest-per-check *"bakes in a falsehood on day one,
  and it is the specific falsehood that HIDES the joint-card and corporate-card
  merges: they stop looking like errors and start looking like one guest with a rich
  history."*
- **The evaluation gate shipped before the data.** `guest_copresence_negatives`
  (`:519-540`) — every check with n≥2 links emits C(n,2) free negatives, the direct
  analogue of the 732,874 free negatives the wine work harvested. Ships **empty**,
  because register A6 records what happens when the gate arrives after the data
  (`:513-518`).
- **RLS carries a `valid_until` check no other policy in this repo has** (`:465-475`).
  All 14 live `user_restaurant_access` rows are `is_active=true, valid_until NULL`, so
  the deactivation path has never executed — *"for inventory that is an annoyance; for
  a guest list it is an ex-employee retaining the customer database"* (`:450-454`).

### ⚠️ Three gaps, stated plainly

1. **Zero application callers.** Grepped `apps/api-gateway/src`, `apps/web/src`,
   `apps/mobile/src` for `guest_check_links`, `guest_link_identifier`,
   `guest_identifiers`, `from("guests")` — **no matches**. The schema is complete and
   the write path is empty. `nf_b.subject_coverage` is not slow, it is **structurally
   zero**. This is the team's first job and it is smaller than it sounds.
2. **The CI gate is available, not wired.** `scripts/eval_guest_merge_policies.py`
   exists; nothing in `.github/workflows/` runs it. A gate that shipped before the
   data must be *wired* before the data too, while it still passes trivially.
3. **`consent_notice_version` has no process that bumps it.** The column exists
   (`:59`); no job, no skill, no review step increments it or preserves prior notice
   text. A version column nobody increments is a boolean with extra steps.

**No `NEW` claims in this charter.** Everything above was read this session.

## Entry trigger

**None — this team activates now.** It is the only team in the sub-layer with shipped
code, and per [[product]] §5.3 it *"needs an owner to defend it, not to extend it."*
Its first three acts are gap 2, gap 1, and gap 3, in that order.
