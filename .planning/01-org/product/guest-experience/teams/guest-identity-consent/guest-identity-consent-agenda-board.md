---
type: agenda-board
division: product
department: guest-experience
team: guest-identity-consent
status: provisional
metrics: [nf_b.false_merge_count, nf_b.subject_coverage, nf_b.refusal_count]
updated: 2026-08-24
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-agenda-full]]", "[[guest-identity-consent-premortem]]", "[[guest-identity-consent-directive]]", "[[guest-experience-agenda-board]]"]
---

# Guest Identity & Consent — Board

> **PROVISIONAL — no work done yet.**

**`nf_b.false_merge_count` = 0. Hard gate, permanent.** Not a target — a gate.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/product/guest-experience/teams/guest-identity-consent"
WHERE type != "agenda-board"
SORT type ASC
```

## Sibling teams — the pressure comes from here

```dataview
TABLE team, status, updated
FROM "01-org/product/guest-experience"
WHERE type = "charter" AND team != this.team AND team
SORT status ASC
```

## State — **EXISTS**, and the only team in the sub-layer with shipped code

- [x] `guests` · `guest_identifiers` · `guest_check_links` shipped (commit `ce65715`, 564 lines)
- [x] Consent is a versioned record, not a boolean (`:54-64`)
- [x] Erasure is a tombstone, not a soft delete (`:70-82`)
- [x] Four independent PII guards in place (charter §Evidence)
- [x] `card_fingerprint` quarantined regardless of verification (`:414-420`)
- [x] Incompleteness fails toward a SPLIT (`:285-289`)
- [x] Free-negative view shipped **before** the data (`:519-540`)
- [ ] ⚠️ CI gate **available, not wired** — nothing in `.github/workflows/` runs `eval_guest_merge_policies.py`
- [ ] ⚠️ **Zero application callers** — verified by grep across all three apps
- [ ] ⚠️ `consent_notice_version` has **no process that bumps it**
- [ ] `guest_identifier_pepper` vault secret not provisioned — `guest_pepper()` raises until it is
- [ ] `erasure_receipt_id` (`:82`) is a column nothing writes

## Metrics

- [ ] `nf_b.subject_coverage` — **0%, structurally** (no write path, not slow adoption)
- [x] `nf_b.false_merge_count` — 0 · permanent gate
- [ ] `nf_b.refusal_count` — 0, because nothing runs · **reported as output, not friction**
- [ ] `nf_b.consented_link_rate` — undefined
- [ ] `nf_b.unverified_identifier_share` — undefined · expected **high**; a falling number is a signal to investigate

## Deliberately absent — do not build

- [ ] ~~Merge queue~~ · `:22-25` · **it is the threshold's delivery vehicle**
- [ ] ~~Resolution UI / candidate generation~~ · `:22-25`
- [ ] ~~Preference aggregates, any model~~ · [[taste-fingerprint-charter]]
- [ ] ~~Cross-restaurant linkage~~ · prevented by arithmetic (`:338-367`); founder-only to undo

## Escalate on sight

- [ ] The words **confidence · threshold · fuzzy · just for the pilot** near guest matching
- [ ] Any diff touching `guest_link_identifier()`, `guest_channel_canonicalise()`, `guest_pepper()`, `is_merge_eligible`
- [ ] A first entry in either guard script's allowlist (both are empty today)
- [ ] A design doc about guests that does not cite the migration

## Next three acts

- [ ] Wire the merge gate into CI while it still passes trivially
- [ ] Provision the pepper, then build **one** consent capture channel end to end
- [ ] Ship `consent-copy-diff`; archive current notice text under its version
