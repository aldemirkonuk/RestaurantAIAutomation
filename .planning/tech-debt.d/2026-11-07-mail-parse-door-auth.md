## The inbound-parse webhook still accepts `?secret=` by default — OPEN — 2026-11-07

Filed by `fix/inbound-parse-door-refuses-loudly` (mail proposal F16, G8; founder /goal 2026-11-07).

**What is true.** `POST /webhooks/inbound-email` now refuses loudly (401 bad secret, 503 unset secret or failed hand-off) and compares in constant time, but `?secret=` is still accepted unless `INBOUND_WEBHOOK_ALLOW_QUERY_SECRET=false` (`apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts`, `querySecretAllowed`). That default is deliberate: whether the deployed provider's webhook URL carries the secret as a query param is unverified (no production read in this lane), and the repo's own Sentry specs say it does (`apps/api-gateway/src/common/error-tracking/sentry-pii.spec.ts:323`, `:390`; `sentry-wire.spec.ts:80`). A query-string secret lands in access logs and proxies.

**What closes it.** Read the deployed provider's webhook URL; if it can send the `x-inbound-secret` header, switch it to the header, set `INBOUND_WEBHOOK_ALLOW_QUERY_SECRET=false` on the gateway, then flip the default (or delete the query path) in code.

## Mail intake L4 is only partly done — OPEN — 2026-11-07

Filed with the entry above. This branch is a carve-out of mail proposal L4: only the controller's door behaviour (L4 tests (a)-(d)).

**Still owed for L4 proper, after L2:** (e) the same Message-ID delivered twice stores one row (dedupe on `rfc_message_id` plus recipient in `rabbitmq-bridge.service.ts`, with its migration); (f) a reply to an SMTP-fallback send threads by In-Reply-To / References (`procurement.service.ts` storing the minted Message-ID on the outbound row); `GET communications/inbound-address`; the address in the health sheet (F16). None was touched here: `rabbitmq-bridge.service.ts` has open PR #681 and `procurement.service.ts` several.

**A 503 now reaches the provider where a 200 used to.** A broker or database outage during intake makes Postmark/SES/Mailgun retry the letter. Nothing downstream dedupes a retried letter by Message-ID yet (that is (e)), so a letter whose publish half-succeeded before the throw could arrive twice. Before this branch it was lost instead.
