---
type: reference
name: Perplexity search harvesting
category: seo-analytics
url: https://www.perplexity.ai
status: unverified
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[answerthepublic]]", "[[google-search-console]]"]
---

# Perplexity search harvesting

> This is the one **unverified** item that gets its own note rather than a line in
> [[unverified-references]]. It earns the surface because it is not a half-remembered URL —
> it is a **load-bearing dependency of a pipeline that is already written into the org
> corpus**. If it does not work, that pipeline is missing an input.

## The claim being examined

The §12B content/SEO pipeline is described as depending on **harvesting the founder's own
Perplexity searches** as a demand signal. In the corpus:

- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-agenda-board.md:60`
  — "Intake finding not written — Perplexity search-set retrievability"
- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-directive.md:23`
  — the decision graph's first node accepts a term "from a harvest"
- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-charter.md:88`
  and `growth-charter.md:168` — no Perplexity key exists

## What is actually established — and what is not

**UNVERIFIED, and possibly not possible as described.** What a search pass found:

- Perplexity offers a **manual, user-initiated data export** (Settings → Account → Export
  Data) producing a JSON archive reported to include profile data, threads, collections and
  usage logs.
- **No evidence was found that the Perplexity API exposes a user's own search or thread
  history**, and no endpoint for it was located. The public API is a query/completion
  surface, not a history surface.
- All programmatic paths surfaced were third-party: browser extensions and scrapers that
  batch-export conversations from the web UI.

Two consequences the pipeline design has to absorb:

1. **A manual export is not a loop.** A recurring harvest that depends on a human clicking
   "export data" is a scheduled human task, not an automated signal. Any loop close-time
   claimed for it is fiction until this is settled.
2. **Third-party scraper extensions are not an option to adopt casually.** They handle an
   authenticated session for an account that also holds the founder's own research.

Nothing above is a refutation — it is the absence of confirmation. Someone with the account
should look at Settings → Account → API Access and the export payload directly. **Until
then, no document should state that Perplexity searches can be harvested programmatically.**

## What it would cost if it does work

At best: a manual export, a parser for the archive format, and storage for someone's
personal research history — which is a privacy question about the founder's own data before
it is a technical one.

## What decision it bears on

None open as an ADR, but it is an unwritten assumption inside Growth's search-demand loops.
Worth raising as an open decision if the pipeline is going to be built on it.

## Status

`unverified` — the capability the pipeline assumes has **not** been confirmed to exist.
