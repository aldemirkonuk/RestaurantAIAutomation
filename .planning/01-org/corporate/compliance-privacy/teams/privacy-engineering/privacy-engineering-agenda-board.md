---
type: agenda-board
division: corporate
department: compliance-privacy
team: privacy-engineering
status: provisional
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.guard_allowlist_size, privacy.store_inventory_coverage]
updated: 2026-08-24
links: ["[[privacy-engineering-charter]]", "[[privacy-engineering-agenda-full]]", "[[privacy-engineering-premortem]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-schedule]]", "[[compliance-privacy-agenda-board]]", "[[customer-relationship-research-charter]]", "[[regulatory-posture-charter]]"]
---

# Privacy Engineering — Board

> **PROVISIONAL — no work done yet.**

## Team status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/compliance-privacy/teams/privacy-engineering"
SORT type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/corporate/compliance-privacy/teams/privacy-engineering"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Counters

- `privacy.erasure_completeness` — **0%** · no erasure function, no receipt table, no drill
- `privacy.pii_definition_count` — **3 distinct / 4 guards** · target **1**
- `privacy.consent_call_sites` — **0** · zero hits in `apps/` and `services/`
- `privacy.consent_gate_denials` — undefined · gate not built
- `privacy.store_inventory_coverage` — **0%** · no inventory
- `privacy.guard_allowlist_size` — **0** · both allowlists empty (the cheapest tripwire we have)
- Guard scripts running in CI — **2** · guest-name matching, raw guest channels
- Lines of consent/erasure schema with a caller — **0 of 564**

## Shipped and running (do not re-litigate)

- Consent as a versioned record — `20260819000000_guest_identity_minimal_slice.sql:54-64`
- Erasure as a tombstone, with the `service_role`/`rolbypassrls` reasoning — `:70-82`
- Channel plaintext never a column; HMAC + per-restaurant pepper — `:131-145`
- `guest_link_identifier()` the only write path, execute narrowly granted — `:375`, `:429-435`, `:504-506`
- Verified-only merge keys — `:146-152`
- Consent scoped to one restaurant, one controller — `:99-105`
- `check_no_guest_name_matching.sh` + `check_no_raw_guest_channels.sh` in CI on push, PR, daily cron — `.github/workflows/schema-parity.yml:19-27, 152-154`

## Blocking

- [ ] **Two byte-identical PII lists** — `constraint_engine.py:28-36`, `provider_communication_agent.py:40-48`. One-sided edit = silent divergence
- [ ] **A third, disjoint definition** — `research_tasks.py:101-102` catches email/phone only
- [ ] **No guard detects** a guest name, a hashed channel, or a taste vector
- [ ] No erasure function; `erasure_receipt_id` (`:82`) has no FK — no receipt table exists
- [ ] Store inventory does not exist → erasure denominator is undefined
- [ ] Consent gate not built → [[customer-relationship-research-charter]] is blocked on us
- [ ] No implementation for any of the four `consent_captured_via` channels (`:60-62`)
- [ ] NF-B erasability vs append-only research store — no dated decision

## Watchlist — tripwires, all currently free to arm

- [ ] First one-sided edit to a PII pattern list (M1)
- [ ] First erasure drill whose denominator is a constant, not a query (M2)
- [ ] `guard_allowlist_size` > 5, or an entry unreviewed for 2 quarters (M3)
- [ ] Person-shaped column appearing outside `guest_identifiers` (M4)
- [ ] First NF-B row written with no `OPEN-DECISIONS.md` entry on erasability (M5)

## Scope corrections carried forward

- `ConsentDialog.tsx` is **operator** consent for service permissions — **not** guest consent. Correct pattern, different subject. Do not cite as guest-consent evidence.
- The two CI guards protect a path with **no callers**. Green means no violation, not correct handling.
