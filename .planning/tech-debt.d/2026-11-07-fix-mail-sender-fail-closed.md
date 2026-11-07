## Inbound mail is attributed to a vendor without checking SPF, DKIM or DMARC — OPEN — 2026-11-07

Filed by `fix/mail-sender-fail-closed` (stacked on #948, QA round 22 N-1 tail). Claim `MAIL-ATTRIBUTION-IGNORES-AUTHENTICATION` in `claims.d/fix-mail-sender-fail-closed-agent.jsonl` (lands with the Python half, stacked on this branch).

**What is true.** Both consumers of `email.inbound.received` decide which vendor wrote a letter from the syntax of its From header and nothing else: the gateway bridge (`rabbitmq-bridge.service.ts handleInboundEmail`, `parseSender` then `providers.ilike("contact_email", …)`) and the Python `EmailParsingAgent` (`_extract_email` then `_find_provider_by_email`). A plain `From: sales@bigdist.com` sent from any server is filed against that vendor's open order. The parser fix (#948 and this branch) stops a forged display name, comment, group, trailing address or injected line from becoming the sender. It does not stop a forged envelope From. An authentication result is read only by the responder's `sender_unverified` guardrail, which forces a manager to approve the reply (`inbound-responder.service.ts` `computeGuardrails`), and by the promotion extractor's trust weight (`promotion-extractor.service.ts:102`).

**Why this branch did not gate attribution on it (the session's call under the 2026-11-07 /goal).** The only authentication source the gateway reads today can be forged by the sender, so a gate on it would be passed by one extra header line:

- `deriveTransportSignals` (`email-triage.ts`) greps the first `spf=` / `dkim=` / `dmarc=` in `Authentication-Results` + `ARC-Authentication-Results` and never checks the authserv-id, so it cannot tell the receiving server's verdict from one the sender wrote into the message.
- Both header maps keep the **last** value of a repeated header (`house-inbox.service.ts` builds it with `Object.fromEntries`, `inbound-email.controller.ts normalizePayload` assigns in a loop). A receiving server prepends its own `Authentication-Results` (RFC 8601 §5), so a sender-supplied one further down is the one the map keeps.
- `ARC-Authentication-Results` is believed without validating the ARC chain.
- Postmark's inbound webhook does not, as far as this branch could see in the code, carry an `Authentication-Results` verdict at all, so "where the provider supplies one" is today only the Gmail path. Not checked against a real Postmark payload.
- There is no place to hold an unattributed letter for a person. The bridge returns (`not attributed`, a warn log) for a From it cannot attribute. A gate that fails closed must hold the letter, never drop it, and that needs a surface the house can see.

Gating on this source would make the gap look closed while leaving it open, which is worse than recording it.

**What closes it.**

1. Read the receiving server's own verdict: the topmost `Authentication-Results` from the raw header list (not the last-wins map), accepted only when its authserv-id is the ingress's own (`mx.google.com` for the Gmail paths; Postmark's, if it has one).
2. Require `dmarc=pass` with `header.from` equal to the parsed From domain, or `dkim=pass` with an aligned `header.d`. `spf=pass` alone is not enough, since it can pass without alignment.
3. When that ingress gives a verdict and it is not a pass, store the letter **unattributed and held for a person** (a held row the manager sees in Communications, with a notification), never dropped. When the ingress gives no verdict, keep today's behaviour and show the letter as "sender not verified".
4. Apply the same rule in `EmailParsingAgent._process_inbound_email`.
5. Flip the claim to `resolved`.
