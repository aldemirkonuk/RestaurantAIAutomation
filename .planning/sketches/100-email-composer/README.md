---
sketch: 100
name: email-composer
question: "How does the house write its own mail — and whose name does the letter leave in?"
winner: null
tags: [communications, email, templates, insights, provenance, sender-identity, connections]
---

# Sketch 100 · The house writes its own mail

## Design question

The founder, 2026-09-03: *"include template for emails and inhouse email creations to
sending emails (editing the emails — creating data from our insights), have it connected
with the email account to connect with there."*

Two questions, answered together: **how a letter carries a figure honestly**, and
**which address it leaves from**.

## How to view

```
open .planning/sketches/100-email-composer/index.html
```

Renders at 1440 from `file://`, no server. Both grounds via `prefers-color-scheme`.

## The rule this sketch proposes

> **A figure carries its provenance, or it goes into the letter as words.**

And its corollary, which changed the design mid-sketch: **the unit of insertion is a
sentence the engine already computed**, not a figure scraped back out of one. A bare
figure field exists only for things that are literally a stored column — an order total,
a PO number, a delivery date.

Ten products were surveyed. Every one answers a missing merge value by substituting a
plausible one — a default, a silent blank, or a fluent prediction. That is *absence
reported as health*, written into a letter a vendor keeps.

## The founder's sender decision, 2026-09-03

A house sends from **its own connected mailbox** or from **a Mudavym subdomain address we
provision** — a paid, per-house line. **Never** from the mailbox shared with every other
house on the deployment, which is what every letter uses today.

## Files

- **`index.html`** — the three states in one strip; what Send does and does not do; the
  build plan (what exists, what is missing, and the migration each missing piece needs);
  the order to build in and why; five forks for the founder.
- **`compose.html`** — the letter as a **wide sheet (640px)** over the conversation book:
  sender line first, two insight sentences with provenance chips, one withheld figure
  written out in words, the commitment-language guardrail run over the *human's* draft,
  and the seal on Send. Plus the sender's other two states, including the honest
  "no identity — Send disabled" state. Plus the same sheet reached from a recommendation.
- **`templates.html`** — seven house-owned templates with their merge fields and the
  figures each may insert; a stated warning that three of six columns cannot be stored
  today; the in-house creation flow that starts from an insight; and the ten-product
  merge-field survey.
- **`account.html`** — the founder's two options drawn side by side with their real costs,
  the sender obligations that come with sending for many houses on one domain, a measured
  "what exists today" register, and where the row belongs (Connections, per §6b / sketch 097).

## What to look for

- Is the provenance chip readable in the body, or does it break the letter?
- The seal on Send: right ceremony, or too much for a manager writing eight letters a day?
- `account.html` option B is a **product decision with a price**, drawn as a shape because
  none of it is built. Is that the right shape?

## The one thing this sketch asks of sketch 099

A `wide` sheet at 640px. Nothing else about the primitive changes.

## Every claim is cited

Each page ends with the `file:line` it was drawn from (re-verified 2026-09-03 on
`feat/mudavym-design-p4`) and a URL for every product claim. No file under `apps/` was
changed by this sketch.

**Example data, not a tenant** — Lokanta Müdavim, its vendors, figures, addresses and
dates are invented for the drawing; the repo and product facts are not.
