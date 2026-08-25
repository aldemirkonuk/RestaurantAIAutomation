---
type: loops
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: provisional
metrics: [seo.indexed_pages, seo.soft_404_rate, seo.title_in_source_pct, answer_surface.assistant_citations, seo.checklist_items_green, seo.unowned_requirements]
updated: 2026-08-24
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-premortem]]", "[[technical-seo-ai-answer-surface-directive]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[growth-loops]]", "[[content-production-loops]]", "[[search-demand-research-loops]]", "[[conversion-funnel-loops]]", "[[client-surfaces-charter]]", "[[security-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_ids: ["g4-crawl-surface-census", "g4-extraction-citation", "g4-requirement-ownership", "g4-exposure-review"]
loop_close_times: ["weekly", "monthly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Technical SEO & AI Answer Surface — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-G4-1 — Crawl-surface census

```yaml
type: loop
id: g4-crawl-surface-census
owner: technical-seo-ai-answer-surface
measures: [seo.soft_404_rate, seo.title_in_source_pct, seo.public_routes_crawlable, seo.indexed_pages]
changes: [seo.crawl_directives, seo.requirement_set]
inputs_from: [client-surfaces, release-engineering, security]
outputs_to: [client-surfaces, growth, security]
close_time: weekly
close_time_note: "weekly, and per deploy"
status: proposed
```

Probes the **deployment**, not the repo. Three nonexistent URLs for status codes, three real
routes fetched without JS for titles, and the three crawl files requested by name. Everything
G4 currently believes comes from reading source, and source diverges from production exactly
where a CDN config lives — which is exactly where the worst defect is
(`vercel.json:12-15`).

Per deploy as well as weekly, because a rewrite rule or a header change can silently undo the
crawl floor and nothing else in the company would notice.

**Runnable today**, and it is the only Growth loop that will produce a real number this week.
Its first run replaces the asserted `seo.soft_404_rate` = 100% with a measured one.

**Counters:** [[technical-seo-ai-answer-surface-premortem]] M2.

---

## L-G4-2 — Extraction and citation

```yaml
type: loop
id: g4-extraction-citation
owner: technical-seo-ai-answer-surface
measures: [answer_surface.assistant_citations, answer_surface.extracted_passage_count, seo.indexed_pages]
changes: [seo.markup_policy, content.page_shape, answer_surface.llms_txt]
inputs_from: [content-production, search-demand-research]
outputs_to: [content-production, search-demand-research, growth]
close_time: monthly
status: proposed
```

G4's half of [[growth-loops]] L-GRO-3, and the loop the founder actually asked for. Each
month, ask a fixed set of the corpus's own questions of the major assistants and record
whether a Mudavym URL is cited and **which passage was lifted**. The second half is the part
that changes anything: it tells [[content-production-loops]] which heading shapes and which
opening paragraphs survive extraction.

**Sampled, not enumerated, and labelled so everywhere.** There is no impressions report for
an AI answer. A month with zero citations and a growing indexed count is information, not
failure — it means the extraction hypothesis is wrong and the page shape should change.

Monthly because assistant indexes refresh on the order of weeks, and because the measurement
is manual until it earns automation.

**Blocked by:** zero published pages.
**Counters:** [[technical-seo-ai-answer-surface-premortem]] M3.

---

## L-G4-3 — Requirement ownership

```yaml
type: loop
id: g4-requirement-ownership
owner: technical-seo-ai-answer-surface
measures: [seo.unowned_requirements, seo.requirement_age_days, seo.checklist_items_green]
changes: [growth.escalation_queue, decisions.open_queue]
inputs_from: [client-surfaces, release-engineering, product-vision]
outputs_to: [growth, decision-office, architecture-review]
close_time: weekly
status: proposed
```

The loop that exists because of what this team **is**: a requirements-and-measurement
function with nothing it can merge. It measures the one number that predicts G4's failure —
requirements with **no named Engineering owner** — and it treats age as the signal rather
than progress. A requirement moving slowly is normal; a requirement with no owner is
permanent.

Escalates at one close-time for *unowned* and two for *blocked*. Sustained blockage is not a
backlog state: it is an implicit decision that the company is not doing content marketing,
and [[technical-seo-ai-answer-surface-directive]] routes it to `OPEN-DECISIONS.md` so the
decision is made rather than absorbed.

**Runnable today.** G4 has no requirements filed yet, so the first reading is honest and
uncomfortable: zero requirements, zero owners.

**Counters:** [[technical-seo-ai-answer-surface-premortem]] M4.

---

## L-G4-4 — Exposure review

```yaml
type: loop
id: g4-exposure-review
owner: technical-seo-ai-answer-surface
measures: [seo.sitemap_routes_unclassified, platform.unguarded_reachable_routes]
changes: [seo.sitemap_contents, seo.robots_policy]
inputs_from: [security, platform-api]
outputs_to: [security, growth, red-team]
close_time: monthly
status: proposed
```

Every route G4 lists in a sitemap is checked against [[security-charter]]'s classification.
Target: **zero unclassified entries.** The loop exists because the SEO win and a security
incident arrive through the same door — this codebase has 137 endpoints with no
`JwtAuthGuard`, and `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true`
when there is no authenticated user, so an unguarded route is internet-reachable rather than
merely undocumented.

G4 raises classification requests and never makes the call. `robots.txt` is written as an
allow-list, because a deny-list would require enumerating 448 endpoints correctly, forever.

**Counters:** [[technical-seo-ai-answer-surface-premortem]] M5.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-G4-1 crawl-surface census | weekly + per deploy | premortem M2 | **Yes** — and it will report red |
| L-G4-2 extraction and citation | monthly | premortem M3 | No — zero published pages |
| L-G4-3 requirement ownership | weekly | premortem M4 | **Yes** — first reading: zero requirements, zero owners |
| L-G4-4 exposure review | monthly | premortem M5 | Partly — nothing is exposed yet, so the target is trivially met |

**G4 owns two of the three loops in Growth that can close this week.** That is a consequence
of being a measurement team: measuring does not require permission. Shipping does, and every
row in [[technical-seo-ai-answer-surface-agenda-full]] that requires shipping is waiting on
[[client-surfaces-charter]].
