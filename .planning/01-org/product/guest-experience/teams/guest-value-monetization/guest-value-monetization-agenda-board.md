---
type: agenda-board
division: product
department: guest-experience
team: guest-value-monetization
status: provisional
metrics: [nf_b.ops_conversion, nf_b.k_anonymity_pass_rate, nf_b.photo_consent_rate]
updated: 2026-08-24
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-agenda-full]]", "[[guest-value-monetization-premortem]]", "[[guest-value-monetization-directive]]", "[[guest-experience-agenda-board]]", "[[compliance-privacy-charter]]", "[[OPEN-DECISIONS]]"]
---

# Guest Value & Monetization — Board

> **PROVISIONAL — no work done yet.**

⬦ **UNSTAFFED.** Three entry conditions, none satisfied.
**Pricing is founder-deferred — no model proposed anywhere in this unit.**

**`nf_b.ops_conversion` = 0.** Zero means the guest side is the social network
[[FUTURES]] §10 forbids.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/product/guest-experience/teams/guest-value-monetization"
WHERE type != "agenda-board"
SORT type ASC
```

## Upstream — nothing to aggregate until these move

```dataview
TABLE team, status, updated
FROM "01-org/product/guest-experience"
WHERE type = "charter" AND team != this.team AND team
SORT status ASC
```

## Entry trigger — all three required

- [ ] `nf_b.subject_coverage` non-zero, and a segment clears the k-threshold **without lowering it**
- [ ] NF-B events emitting above a completeness floor
- [ ] **OD-22 resolved** — this team here, or in Commercial

## Available now, gated on nothing — the counter-pressures that only work first

- [ ] **k-threshold as a code constant + CI guard** · not config, not a flag, not a per-restaurant override
- [ ] **Sub-k empty state designed** · *"not enough data yet"* as a normal shippable state
- [ ] **Advertising boundary statement** written against `ServicesPermissions.tsx:41,249`

## Status by component

- [ ] Segment insight — **PARTIAL as design**: `NEW-659` `660` `661` `664` `665` · `880` `882` `883` `885` · none built
- [ ] Photo-as-promotion — pipeline **EXISTS**, consent-to-reuse plumbing **does not** · capability without permission
- [ ] Advertising — **NEW, zero groundwork** · grepped `advertis|sponsored|ad_slot|ad_campaign`: nothing
- [ ] ⚠️ Written promise already in the product: `ServicesPermissions.tsx:41` (exclusions) and `:249` (no ad cookies)
- [ ] ⚠️ `provider_promotions` is **supply-side**, not advertising · `/promotions` · `provider-intelligence.service.ts:135-222` · dormant

## Metrics

- [ ] `nf_b.ops_conversion` — **0** · the number that judges the sub-layer
- [ ] `nf_b.k_anonymity_pass_rate` — undefined · must be **100%**, no admin exception
- [ ] `nf_b.sub_k_render_attempts` — undefined · the **early warning** for threshold pressure
- [ ] `nf_b.photo_consent_rate` — undefined · consent plumbing does not exist
- [ ] `nf_b.segment_to_decision_latency` — undefined

## Escalate on sight

- [ ] The k-threshold appearing as an **env var, settings row, or per-restaurant override** — configurability is the mechanism
- [ ] `nf_b.sub_k_render_attempts` rising — pressure is measurable *before* anyone proposes anything
- [ ] Any guest photo reaching enrichment before `nf_b.photo_consent_rate` exists
- [ ] Photo consent scoped as a **boolean** rather than an enumerated purpose
- [ ] Any ad design referencing `provider_promotions` or `provider-intelligence.service.ts`
- [ ] `nf_b.ops_conversion` replaced by a testimonial in any review
- [ ] Any ad implementation work while the boundary statement is unwritten

## Reviewed by, never self

- [ ] Every privacy gate → [[compliance-privacy-charter]] · [[ORG_STRUCTURE]] §3
- [ ] Photo licence → [[legal-charter]]
- [ ] Pricing → Commercial, and founder-deferred
