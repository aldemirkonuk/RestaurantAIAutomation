# 0170 — A vendor email body is text, never markup

- **Status:** Proposed 2026-09-19. The founder locks it; an agent never does. The vendor-path half is built on `fix/email-html-escaping`. The template half is step 2, still open, and tracked by an `open` CLAIMS row.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder)
- **Keywords:** email, html, escaping, escapeHtml, textToEmailHtml, buildEmailHtml, vendor email, draft, approveDraft, modifiedContent, personalizeGreeting, applyEmailPlaceholders, sanitiser, allowlist, email-templates, baseTemplate, XSS, phishing
- **Links:** [[0100-security-alerts-triaged-and-closed]] (the precedent against hand-rolled HTML filters), [[0084-the-communications-gateway-says-what-it-did]], [[0013-one-commitment-guardrail]], `apps/api-gateway/src/common/html/escape-html.ts`, `apps/api-gateway/src/procurement/vendor-mail-is-escaped.spec.ts`, comms-templates research lane 2026-09-19 (session scratchpad `comms/2a-templates-ux.md`, `3-adversary-templates-ux.md`, `escaping-census.md`, which is ephemeral)

**Index row:** not added to `decisions/README.md` here. That file is gate-owned.

## Context

Every email Mudavym sends to a vendor gets its HTML from `ProcurementService.buildEmailHtml` (`procurement.service.ts:6081` on `origin/main` 1fba79f57). It has four callers:

| Caller (origin/main) | Path | Where the body comes from |
|---|---|---|
| `:5854` | `approveDraft`, the manager's one-tap approve | `dto.modifiedContent` (the manager's textarea edit, `DraftEmailApprovalPanel.tsx:334`) or the stored draft `content` |
| `:6398` | the scheduled auto-send sweep | stored draft `content` / `message_text` (LLM-drafted by `provider_conversation_agent.py`) |
| `:6580` | the manual reply to a vendor | the request's `content` |
| `:7145` | the deal confirmation | a sentence assembled in code from the vendor's `greetName`, the wine name and the terms |

`buildEmailHtml` had two faults:

1. **Pass-through.** Any body matching `/<[a-z][\s\S]*>/i` was sent verbatim as markup. If a draft, an LLM output or an edit contained `<a href="…">pay here</a>`, the vendor received a live link under the restaurant's name and from its Gmail. That is a phishing primitive aimed at the house's own suppliers.
2. **Unescaped text.** Plain text was split into `<p>` blocks without escaping. `Qty < 5 & price > $10` produced broken HTML, and any stray `<` opened a tag.

`sendProviderEmail` then passes the HTML through `applyEmailPlaceholders`, which splices two more data values into it: the vendor's first name (`personalizeGreeting`, taken from the `providers` row) and the sender name (from the `communication_templates` `sender_identity` body, the branding display name or the restaurant name). Neither value was escaped. The first name was also substituted as a `String.replace` pattern, so a `$&` in it would be expanded.

The gateway's system-mail templates (`communications/email-templates/*.ts`, about 450 `${}` sites, plus `email-templates-legacy.ts`) have no escaper at all, and no templating engine is installed. They are covered below as step 2.

**Evidence that plain text is the only real input.** On production (`exzueerziesmczwlhomd`, 2026-09-19), a read-only count of `procurement_conversations` rows whose `content` matches `<[a-z]…>` returned **0 of 17 outbound and 0 of 10 inbound**. The approval editor is a plain `<textarea>`. The Python draft writers store LLM *text* (`provider_conversation_agent.py:2522`). The Python composer's own HTML (`email_composer_service.py:710`) goes to a different gateway route and never reaches `buildEmailHtml`.

## Options considered

1. **Always treat the body as text: escape, then paragraphise.** *(chosen)* Nothing a draft contains can become markup. If an LLM emits a tag, the vendor sees the literal `<b>`. That looks odd, but it is safe and visible, and the evidence above says it does not happen today. No new dependency.
2. **Sanitise HTML bodies with an allowlist** (`sanitize-html` or DOMPurify on jsdom). This keeps `<b>` and `<a>` when they are wanted. It adds a dependency and a policy to keep correct forever, and ADR 0100 exists because hand-maintained HTML filters in this repo produced eight CodeQL findings. It also keeps `<a href>`, which is the phishing vector itself, unless links are stripped too. At that point it is option 1 with extra moving parts. There is no input that needs it: 0 of 27 production bodies contain HTML.
3. **Refuse an HTML-looking body** (400 on approve; skip in the sweep). This is loud, but it blocks a manager's one-tap approve over a stray `<` in "qty < 5", and in the unattended auto-send sweep a refusal becomes a stuck draft. It punishes the common harmless case to stop a case the escape already neutralises.
4. **Do nothing.** The pass-through stays live on every vendor send path.

## Decision

**A vendor email body is always text.** `buildEmailHtml` is `textToEmailHtml(rawBody)`. That function escapes `& < > " '` and only then writes `<p>` and `<br>`, so the only tags in the output are its own. Every data value spliced into vendor HTML afterwards (the vendor first name and the sender name) passes through the same `escapeHtml`, and is substituted with a replacer function, not a pattern string. There is one escaper, `apps/api-gateway/src/common/html/escape-html.ts`, and `experiment-ended.producer.ts`'s private copy now imports it.

If rich vendor mail is ever wanted (bold, a link), it comes from a **structured** body, meaning named slots rendered by our code and never from HTML inside a draft. That is the slot model the comms-templates lane is designing for editable templates.

## Step 2 — system-mail templates (open)

The gateway templates interpolate data with no escaping. They are **not** converted here, for two reasons:
- The ~450 sites mix data with HTML fragments built by other helpers (`tableRow`, `metricBox`, `alertBox`, `baseTemplate`'s `content`). Escaping at the wrong layer double-escapes live mail.
- They are about to be rebuilt anyway by the comms-templates lane (research 2026-09-19: a read-only catalogue first, then slot editing, rendered server-side and escaped).

The per-site census (class CONST / NUM / FRAGMENT / DATA / URL, with origins) is summarised under *Template census* below. CLAIMS row `ADR-0170-TEMPLATES-ESCAPE-DATA` is `open` and must **not** hold until the templates escape their data. It flips red the day they do, which forces this section to be struck.

## Template census

Sonnet census, 2026-09-19, read-only at 1fba79f57. Full tables are in the scratchpad `comms/escaping-census.md` (ephemeral). Summary:

- **Interpolations by class:** about 95 DATA, about 70 NUM, 14 URL, 3 FRAGMENT, and several hundred CONST style tokens.
- **Two chokepoints carry most of the DATA.** `tableRow`'s `value` (provider, driver and staff names and free-text notes, through the same parameter as currency output) and `alertBox`'s `message` (`notes`, `specialRequests`, `specialInstructions`, `threadSummary`). In every call site found, the value sits inside a `<td>` or `<p>` that the helper itself writes, and no caller passes markup. So **escaping inside those two helpers is the recommended first move of step 2.** `baseTemplate`'s `title`, `preheader` and `headerName` are plain-text slots and can be escaped the same way. `headerLogo` and `ctaButton.url` are URL slots: they need attribute escaping plus a scheme check, not text escaping.
- **Live internal paths with free text:** `custom-reminder.template.ts` (`title`, `description`, via `scheduled-tasks.service.ts:835`), and `onboarding.template.ts` / `password-reset.template.ts` (fields the account owner typed at sign-up).
- **Vendor-bound paths outside `buildEmailHtml`:** `email-templates-legacy.ts`'s `orderInquiryTemplate` puts a request-body `wineName` into mail to a request-body `vendorEmail` (`communications.controller.ts:620-630`). The census called it live, but **it is not reachable in production**: the route is `@UseGuards(NonProductionGuard)` (`communications.controller.ts:566`, which returns 404 when `NODE_ENV=production`, ADR 0019 D2). It is a dev/sim exposure only. `vendor-action.template.ts` (`aiDraftedMessage`, the vendor's own `latestMessage`) has **no production caller**.
- **Dead code:** `order-notification.template.ts` and `payment-due.template.ts` have no caller, nor do five functions in `email-templates-legacy.ts`. Delete them rather than escape them, with the legacy removal under ADR 0149.

## Consequences

- An HTML-looking draft now reaches the vendor as visible text. That is the intended trade.
- The plain-text output changes in two small ways: CRLF is normalised, and whitespace-only paragraphs are dropped instead of emitted as empty `<p>`.
- `vendor-mail-is-escaped.spec.ts` asserts at the wire (the `html` handed to `GmailService.sendEmail`). Each protected behaviour was mutated and went red; the record is in the PR.
- **Revisit when:** a product need for formatted vendor mail appears (answer it with slots, not HTML), or the templates rebuild lands (strike step 2 and flip the CLAIMS row).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Claude (Opus 5) | Created; vendor path built and mutation-tested; step 2 recorded open |
