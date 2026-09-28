---
sketch: 101
name: config-assistant
question: "The owner talks and the house configures itself — what exactly does the approval button approve?"
winner: null
tags: [settings, onboarding, assistant, ask-ai, seal, hold-to-approve, provenance, audit-trail, correlation-id, mcp, skip-semantics]
---

# Sketch 101 · The assistant configures the house, and the seal applies it

## Design question

The founder, 2026-09-03, on whether the notification producer defaults should be offered at
onboarding:

> keep as defaults, but while onboarding they have the option to do that. + it will be game
> changer let AI assistant talk with you and handle all the configs then approval button,
> research this and understand how should we approach this

Two asks, drawn together. The small one: onboarding **offers** the settings and keeps the
defaults if skipped. The large one: an assistant that configures the house by conversation,
ending in **one approval control**.

## How to view

```
open .planning/sketches/101-config-assistant/index.html
```

Renders at 1440 from `file://`, no server. Both grounds — `prefers-color-scheme` for the
page, plus an explicit `data-ground="charcoal"` specimen on every file.

## The rule this sketch proposes

> **The assistant may never write a value the owner did not see — and a value that arrives
> this way is a third kind of value, not the same as one somebody typed.**

This house already refuses to read a column default as an answer: `lead_time_days DEFAULT 7`
means a row reading 7 is *exactly as likely* to mean "nobody was ever asked" as "the vendor
said a week" (`vendor-terms/vendor-terms.service.ts:47-52`). An assistant that fills fourteen
registers in one sitting would turn every "nobody gave" into "somebody gave" and destroy that
distinction on the house's first day. So the design adds a **third provenance state**
(`unstated` · `stated` · `proposed_sealed`) rather than collapsing into the second.

## Files

- **`index.html`** — the hub. The three shapes weighed and the two rejected on measured
  facts; the four attempts to kill the chosen shape and what each one forced; everything that
  already exists versus the one thing that is missing and blocking; the MCP tool surface
  mapped onto the documented 42; five questions only the founder can answer; a six-step build
  order.
- **`conversation.html`** — the talk. Seven turns with the ledger of learned values filling
  beside it, including the two turns that carry the design: the one where the assistant
  **refuses** to set the market-price threshold (it is a deployment env var, not a register),
  and the one where it **contests** a value a person already stated rather than batching it.
- **`proposal.html`** — the document and the seal. Every value grouped by register, each row
  carrying its reason, its current value and where that current value came from; a dropped
  row; a browser-kept row that says it will not reach the server; the seal at the bottom; and
  the **receipt** after it — written · refused · not attempted — because the apply crosses six
  services with no shared transaction. Plus batch-undo, and why this house can do it when the
  field cannot.
- **`onboarding-step.html`** — the founder's smaller ask. Five short questions in the slot
  `GetStarted.tsx:256-286` already reserves, and the part that is actually the proposal: **a
  skip that is recorded**, with the audit row it writes and a before/after of what `/settings`
  shows for a register that was offered and declined.

## The four attempts to kill the chosen shape

Recorded because three of the four succeeded partially, and each amendment is load-bearing.

| # | The attempt | What it forced |
|---|---|---|
| 1 | The seal is a per-commitment ceremony; a forty-field batch devalues it | A register already holding a **stated** value never enters the batch — it is *contested* separately with its own seal |
| 2 | Notion, the closest analogue, forbids agents from workspace-level settings entirely | The line is drawn by **blast radius**, not by the word "settings": six of fourteen registers are permanently out of reach |
| 3 | The batch cannot be transactional across eight services | The seal **never reports a single "Done"** — every item carries its own outcome and reason |
| 4 | It destroys the honesty machinery it is built inside | A sealed value is its **own provenance class**, recorded with the utterance that produced it |

## What to look for

- Six rows is a document. Is twenty still a document, or a wall? If a real house produces
  twenty, the contest rule is doing less work than hoped and the batch needs a hard cap.
- The browser-kept row on `proposal.html` is the most honest row on the page and the most
  confusing. Worth showing, or worth putting `measurement` out of reach entirely?
- One seal at the bottom, or *no* batch seal at all and every row confirmed the way the
  contested rows are? The second is safer and is six ceremonies instead of one.

## The one thing this asks of the build, before anything else

`PUT /settings/approval-thresholds` carries `@UseGuards(JwtAuthGuard, TenantGuard)` and **no
role decorator** (`settings/settings.controller.ts:40,107`), so any authenticated member of
the tenant can today rewrite the policy that decides who may seal an order. `@Roles()` and
`RolesGuard` exist and are used on exactly two controllers. The assistant does not create
this hole, but it makes it reachable by sentence. **That gate ships first.**

## Every claim is cited

Each page ends with the `file:line` it was drawn from (re-verified 2026-09-04 on
`feat/mudavym-design-p4`) and a URL for every product claim. The full fifteen-product survey
is `.planning/06-pages/DESIGN-FOUNDATION.md` §6d; the decision is
`.planning/decisions/0113-the-assistant-proposes-the-seal-applies.md`. **No file under
`apps/`, `supabase/` or `services/` was changed by this sketch.**

**Example data, not a tenant** — Lokanta Müdavim, its vendors, staff, figures and dates are
invented for the drawing; the repo and product facts are not.
