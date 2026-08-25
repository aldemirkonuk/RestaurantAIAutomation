---
type: agenda-full
division: commercial
department: growth
team: content-production
status: provisional
metrics: [content.published_units_per_week, content.faq_orphan_pages, content.first_pass_clear_rate]
updated: 2026-08-24
links: ["[[content-production-charter]]", "[[content-production-premortem]]", "[[content-production-loops]]", "[[content-production-directive]]", "[[content-production-schedule]]", "[[content-production-agenda-board]]", "[[growth-agenda-full]]", "[[search-demand-research-charter]]", "[[editorial-gate-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[brand-identity-charter]]", "[[OPEN-DECISIONS]]"]
---

# Content Production — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

G2 has written nothing and cannot publish anything. There is no content repository, no CMS,
and no route that serves an article. The work ahead is therefore in an order that looks
wrong for a writing team and is correct for this one:

1. **Where content lives**, as files. Not the hosting decision — that is
   [[growth-agenda-full]] item 1 and belongs to the department — but the **repository
   shape**: are articles markdown in this repo, and what carries the provenance record and
   the gate verdict alongside them?
2. **The two page templates.** Long-form and ~120-word answer. Written once, argued over
   once, then reused.
3. **One complete unit**, end to end: brief → draft → gate → publish → ten answer pages →
   link graph verified. One, done completely, before a second is commissioned.

## How

**Content as files in the repo, until something forces otherwise.** The provenance record,
the gate verdict, and the draft need to live together and be diffable; a CMS separates them
and makes a bypass invisible. This is a proposal, not a decision — it belongs in
[[OPEN-DECISIONS]] alongside the publishing-target question, because the two answers
constrain each other.

**The long-form template.** Answer-first, because the strategic target is being extracted
and cited, not being read top to bottom:

- The question, answered in the first paragraph, in plain language, quotable standalone.
- Then the mechanism. **This is where the original content goes** — the thing this company
  knows and a general search does not ([[content-production-premortem]] M3).
- Headings that are the questions a reader would actually type.
- Every claim carrying a source in the provenance record, not a footnote in the prose.
- **No em dashes, no buzzwords** ("streamlined" is the named example), and it must not read
  as a press release. G2 writes to that constraint; [[editorial-gate-charter]] enforces it.
  The banned-construction linter is a pre-filter for the writer's convenience and is never
  the gate.

**The answer-page template.** ~120 words, plain, answering one question completely, with a
back-link to the parent article. One page per question, per the founder's specification, and
each page must contain something the article does not.

**Sequencing inside a unit.** The article publishes and is indexed **before** its answer
pages ship. Ten thin pages pointing at a URL that is not yet indexed is the doorway-page
shape at its most obvious, and the delay costs nothing.

**On Claude as the drafter.** Founder-specified, replacing ChatGPT. Recorded as a
specification, not a preference. The practical consequence G2 owns: model choice and routing
belong to [[model-routing-inference-economics-charter]], spend lands in
`services/agent-orchestrator/services/spend_logger.py`, and G2's job is the brief and the
revision, not the sampling parameters.

## Why now

- **The templates are cheapest before there is a corpus.** Every structural decision made
  after twenty articles exist has to be retrofitted to twenty articles.
- **One complete unit is the only honest test of the pipeline.** Six stages have never been
  run once. Running one end to end will surface the actual failure — most likely that the
  publishing target does not exist, which is worth discovering on unit one rather than
  unit fourteen ([[growth-premortem]] M1).
- **The voice guide is being written now.** [[brand-identity-charter]] owns it. G2 drafting
  before it exists means the gate enforces an opinion, and an opinion loses an argument with
  a deadline.

## Next steps

1. Propose the content-repository shape in [[OPEN-DECISIONS]], paired with the
   publishing-target decision.
2. Draft both templates. Have [[editorial-gate-charter]] and
   [[technical-seo-ai-answer-surface-charter]] mark them up before anything is written into
   them.
3. Take the first brief from [[search-demand-research-charter]] — the invoice-discrepancy
   topic, which is the wedge and where the original content already exists.
4. Write one article. Send it to the gate. **Expect a return, and treat a first-pass
   clearance on unit one as suspicious rather than good.**
5. Do not commission unit two until unit one's link graph is verified at zero defects.

## Questions for the founder

1. **Markdown in this repo, or a CMS?** G2's preference is files, so the draft, its
   provenance, and the gate verdict are one diffable object. Your call.
2. **Length.** "Long-form" is unspecified. Answer-surface extraction favours a tight,
   well-structured 1,200 words over a 3,000-word sweep. Is there a length you expect?
3. **The ten answer pages: separate URLs on the same site, or a distinct section?** The
   founder's specification says one page per question; the URL structure is still open and
   affects the link graph.
4. **Who signs off the voice guide** if [[brand-identity-charter]] and the gate disagree?
   G2 needs one document to write to, not two opinions.
5. **Do we publish under `wineops.ai` or wait for the migration?** Publishing under a name
   we are leaving spends credibility twice.
