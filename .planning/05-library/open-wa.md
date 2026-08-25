---
type: reference
name: "@open-wa/wa-automate"
category: messaging
url: https://github.com/open-wa/wa-automate-nodejs
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[hermes-agent]]"]
---

# open-wa / wa-automate-nodejs

## What it is

Verified 2026-08-24 against the repository, its README, and GitHub metadata.

- A **Node.js/TypeScript toolkit for WhatsApp Web automation** — turns a WhatsApp account
  into a local HTTP API ("Easy API"), an embedded runtime, a webhook source, a plugin host,
  or an **MCP server** for agents. Ships a Chatwoot bridge.
- **Licence: Hippocratic + Do Not Harm v1.0** — *not* OSI-approved open source. GitHub
  reports it as `NOASSERTION`. This is an ethical-use licence with usage restrictions, and
  it is a legal review item, not a formality.
- The README also gates parts of the product behind a **`licenseKey`** (`--license-key`),
  so some capabilities are paid.
- The project states plainly: **unofficial, not affiliated with or endorsed by WhatsApp or
  Meta, "use it at your own risk"**, and using it means agreeing to its own Terms of Service.
- Contains cryptographic software with an ECCN 5D002 export-control notice.

**Identity check — this is the right repo.** A GitHub search for `wa-automate` returns
`open-wa/wa-automate-nodejs` (3,647 stars, pushed 2026-08-18) plus the same org's Python,
Docker, and socket-client repos (all last pushed 2022–2024). The smaller same-named
projects the founder was right to be wary of are mostly stale org-siblings, not
competitors — but the version to use is the `nodejs` one, actively maintained.

Also verified from the README: **v5 is in alpha and has a known gap** — the CLI parses
`--webhook` but warns that CLI webhook registration parity is not restored, so that flag
does not enable source-backed delivery; webhooks must be configured in `wa.config.*`.

## Why it might matter here specifically

WhatsApp is the default vendor-communication channel in large parts of the restaurant supply
trade, and this project's procurement stack is currently **email-shaped**: the vendor-reply
AI (`apps/api-gateway/src/communications`, the inbound-email intelligence work) understands
and drafts email, never sends automatically, and requires one-tap human approval.

If WhatsApp becomes a channel, the guardrail that matters is the one already established for
email: **draft, never auto-send, human approves**. A WhatsApp bridge that can send
autonomously would silently break a guardrail this project chose deliberately.

## What adopting it would cost

Highest-risk item in this library, and the risk is not technical:

- **Account risk.** It automates WhatsApp Web with an unofficial client. Ban risk is real
  and falls on whatever number is used — potentially a real vendor-facing business number.
- **Licence review.** Hippocratic + Do Not Harm is a restricted-use licence; Legal has to
  read it before anything ships. A paid `licenseKey` may also be required.
- **The supported alternative is the WhatsApp Business Platform (Cloud API)**, which is
  official, has message-template approval and per-conversation pricing. Choosing `open-wa`
  is choosing to avoid that cost and those constraints, and to accept ban risk instead.
  That trade-off should be an ADR, not a default.
- Session persistence, QR re-auth, and a browser runtime to operate.
- Overlaps [[hermes-agent]], which lists a WhatsApp gateway of its own.

## What decision it bears on

None open. **Should have one** — "unofficial WhatsApp automation vs the official Business
Platform" is exactly the shape of decision CLAUDE.md §0.1 says must not be defaulted.

## Status

`candidate` — repo identity, licence, and maturity verified. Not adopted; legal and
account-risk review are prerequisites.
