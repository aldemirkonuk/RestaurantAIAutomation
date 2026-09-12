---
type: tombstone
title: Toast Platform Integration Report (retired)
status: retired — superseded
updated: 2026-09-02
links:
  - "[[TOAST-ACTIVATION-READINESS]]"
  - "[[TOAST_API_DEVELOPER_GUIDE]]"
  - "[[0032-vault-cleanup-cut-line]]"
---

# Toast Platform Integration Report — retired 2026-09-02

Retired under the retire-to-write rule (CLAUDE.md §4) by
[`04-specs/TOAST-ACTIVATION-READINESS.md`](../04-specs/TOAST-ACTIVATION-READINESS.md).

**Why.** The filename promised configuration and the file contained none. Its 64 lines
were a summary of Toast's *public vendor API* — OAuth 2.0, the menu hierarchy, the orders
endpoint, webhook event types — with nothing about how this system is configured, which
keys it reads, or what is set where. It was also a strict subset, in substance, of
[`TOAST_API_DEVELOPER_GUIDE.md`](TOAST_API_DEVELOPER_GUIDE.md) sitting beside it.

That combination made it a trap: anyone asking "how is Toast configured here?" landed on a
file that answered "here is how OAuth 2.0 works," and left believing they had checked.

**Where the content went**

| Topic | Now at |
|---|---|
| Toast vendor API — auth, menus, orders, webhooks, data models | [`TOAST_API_DEVELOPER_GUIDE.md`](TOAST_API_DEVELOPER_GUIDE.md), which covers all of it at greater depth |
| How *this* system is configured for Toast — required settings, presence per environment, merchant status, activation checklist | [`04-specs/TOAST-ACTIVATION-READINESS.md`](../04-specs/TOAST-ACTIVATION-READINESS.md) |

**The three lines that were not duplicated anywhere**, carried here so nothing is lost —
Toast integration best practices, as recorded by the retired doc:

- **Idempotency:** always use unique `externalId`s for orders, to prevent double-charging.
- **Rate limiting:** cache menu data; do not fetch the full menu for every order.
- **Error handling:** treat HTTP 4xx (bad data) and 5xx (server issues) distinctly.

**Recovering the retired text.** Citations of the form `TOAST_API_CONFIGURATION.md:<line>`
refer to the retired version, not to this stub:

```
git log --oneline -- .planning/07-reference/TOAST_API_CONFIGURATION.md
git show <commit>:.planning/07-reference/TOAST_API_CONFIGURATION.md
```
