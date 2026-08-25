---
type: loops
division: commercial
department: media-brand
team: brand-identity
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[brand-identity-charter]]"
  - "[[brand-identity-directive]]"
  - "[[media-brand-loops]]"
  - "[[editorial-gate-loops]]"
loop_count: 5
loop_ids: ["legacy-name-burndown", "legacy-domain-burndown", "brand-guard-regression", "voice-guide-conformance", "reference-shortlist-verification"]
loop_close_times: ["weekly", "weekly", "per-pr", "monthly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Brand Identity (M1) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

---

## 1. Legacy-name burndown

```yaml
type: loop
id: legacy-name-burndown
owner: brand-identity
measures: [brand.legacy_name_refs_shipped, brand.tier1_rows_open_by_class]
changes: [source.display_strings, source.transmitted_strings]
inputs_from: [engineering]
outputs_to: [media-brand, engineering, sales, growth]
close_time: weekly
status: proposed
```

**Measures per surface class, never as a total.** Classes: transmitted mail, transmitted
documents, third-party logs, published API metadata, rendered UI, OS-level. A total would
show healthy progress while an entire class sat untouched, which is precisely failure
mechanism 1 in [[brand-identity-premortem]].

**Baseline 2026-08-24:** 351 lines / 193 files for the name pattern; tier-1 rows as tabled
in [[brand-identity-charter]].

**Weekly while burning down.** Retires when tier 1 reaches zero — at which point loop 3
takes over and weekly reporting would produce no action, which the anti-sprawl rule would
delete anyway.

---

## 2. Legacy-domain burndown

```yaml
type: loop
id: legacy-domain-burndown
owner: brand-identity
measures: [brand.legacy_domain_refs_shipped]
changes: [source.addresses, source.hosts, config.env_defaults]
inputs_from: [engineering, compliance-and-privacy]
outputs_to: [media-brand, sales]
close_time: weekly
status: proposed
```

**Deliberately a separate loop from 1**, not a sub-metric of it. The two have different
prerequisites: a display string can be renamed today, an address cannot be renamed until a
mailbox exists and mail routes to it. Merging them would let the fast half mask the blocked
half.

**Baseline 2026-08-24:** 33 lines / 25 files.

**Blocked input:** replacement addresses for `support@`, `notifications@`, `admin@`, and a
decision on whether `/bot` must resolve under the new name.

---

## 3. Brand-guard regression watch

```yaml
type: loop
id: brand-guard-regression
owner: brand-identity
measures: [ci.brand_guard_failures, ci.brand_guard_bypasses]
changes: [ci.brand_guard, source.display_strings]
inputs_from: [engineering]
outputs_to: [media-brand]
close_time: per-pr
status: proposed
```

**The fastest loop this team owns, and the only one that survives the burndown.** It closes
inside a single pull request: a legacy reference is introduced, the build fails, the author
fixes it. That is a complete cycle in minutes.

**Also measures bypasses,** because a guard that is routinely skipped is worse than no guard
— it produces a green signal nobody believes and nobody removes. Two bypasses in a quarter
is a decision to escalate, not a number to note.

**Covers generated output.** `apps/api-gateway/openapi.json` and `dist/` regenerate from
source; a source fix that missed one call site produces a clean rebuild carrying the old
name.

---

## 4. Voice-guide conformance

```yaml
type: loop
id: voice-guide-conformance
owner: brand-identity
measures: [editorial.first_pass_clear_rate, editorial.rejections_citing_a_clause]
changes: [brand.voice_guide]
inputs_from: [editorial-gate, content-production]
outputs_to: [editorial-gate, narrative-collateral, social-community]
close_time: monthly
status: proposed
```

**The loop runs backwards from how it looks.** G3 rejects drafts; M1 reads the rejections;
the *guide* changes. A rejection that cannot cite a clause is a defect in the guide, not in
the writer. `rejections_citing_a_clause` is therefore the health metric, and it should
approach 100% while `first_pass_clear_rate` is allowed to be low.

**Monthly**, matched to publishing cadence. A weekly loop over a pipeline producing nothing
yet would be three empty runs and an anti-sprawl deletion.

**Not runnable until the guide exists.** Stated rather than modelled as zero.

---

## 5. Reference shortlist verification

```yaml
type: loop
id: reference-shortlist-verification
owner: brand-identity
measures: [brand.references_unverified, brand.references_adopted]
changes: [brand.reference_shortlist]
inputs_from: []
outputs_to: [media-brand, design]
close_time: quarterly
status: proposed
```

**Twelve entries at founding; five spellings unconfirmed, two with no URL.** The loop's job
is to keep `references_unverified` visible rather than let an unverified name quietly become
a dependency. An entry that stays unverified for two consecutive runs is dropped, not
carried.

**Quarterly.** Nothing about this decays fast, and a faster loop would manufacture urgency
around an evaluation list.
