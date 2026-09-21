# 0185 — mudavym.com sends its security headers

- **Status:** Locked 2026-09-21 — the founder chose *"Add both, as planned"* in session: the low-risk header set now, a Content-Security-Policy in report-only mode after the public pages land, then enforced.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder)
- **Keywords:** security headers, vercel.json, nosniff, X-Frame-Options, HSTS, includeSubDomains, preload, Referrer-Policy, Permissions-Policy, COOP, CSP, report-only, token routes, source maps
- **Links:** [[0158-machines-read-mudavym-from-what-the-host-serves]] (owns the token-route headers and the crawl surface in the same file), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]], [[0110-a-card-on-file-is-the-providers-record-not-ours]] (names a CSP as a revisit trigger)

## Context

Measured 2026-09-17 with `curl -sI https://mudavym.com/`: the site sent no
`X-Content-Type-Options`, no `X-Frame-Options` or `frame-ancestors`, no
`Referrer-Policy`, no `Permissions-Policy`, no `Cross-Origin-Opener-Policy`, and only
Vercel's default HSTS (`max-age=63072000`, no `includeSubDomains`). Access tokens live in
`localStorage`, so any injected script is token theft; nothing stopped another site from
framing the app either. The production project's Root Directory is `apps/web`, so
`apps/web/vercel.json` is the file mudavym.com reads - the repo-root `vercel.json` only
configures the duplicate api-gateway project (measured by the SEO/GEO session through the
Vercel API, ADR 0158).

The research behind the values (every origin the app contacts, a live report-only CSP
probe on nine public routes, and the forks) is the hardening plan written 2026-09-17
(`backend-1/hardening-plan.md` in the finish session's scratchpad, summarised here where it
decides something).

## Options considered

1. **The low-risk set now, CSP report-only after the public pages land, then enforce.**
   Nothing in the low-risk set can break a page that works today; a CSP can, so it earns a
   report-only week of evidence first.
2. **Everything at once, CSP enforced.** Fastest to "done", but Google Maps needs
   `'unsafe-eval'` by its vendor's own guide and nobody has measured whether it fires; an
   enforced guess could break sign-in, Maps or the scanner for real houses.
3. **Wait until every page is finished.** Leaves clickjacking and MIME sniffing open for the
   whole cutover for no gain; the set does not depend on page design.

## Decision

Option 1. In `apps/web/vercel.json`, every path on every host carries:

| Header | Value | Why this value |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | no MIME sniffing of uploads or API text |
| `X-Frame-Options` | `DENY` | nothing frames mudavym.com (the only iframe is the app framing a signed document, the other way round) |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | no subdomain resolves today, so nothing breaks; **no `preload`** - effectively irreversible and binds every future subdomain |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Google sign-in's popup fallback and the print windows still work; no COEP (it would break GSI, Maps, Stripe frames and third-party images) |
| `Permissions-Policy` | camera and microphone for Mudavym itself; geolocation, USB, serial, HID, Bluetooth, MIDI, motion sensors, display capture and topics off | the scanner and the spoken count need camera and microphone; nothing uses the rest. `payment` and `identity-credentials-get` are deliberately unlisted (Stripe's wallet buttons, Google's FedCM) |

`Referrer-Policy: strict-origin-when-cross-origin` goes on every path EXCEPT the token
routes (`/reset-password`, `/verify-email`, `/invite/`, `/studio/invite/`), through a
negative-lookahead source, because those routes already carry `no-referrer` under ADR 0158
and the host merges matching rules without documenting which value wins. The test
`apps/web/src/lib/security-headers.test.ts` evaluates the real file for sample paths and
fails if any header is missing, if a token route gets a second referrer value, if two
matching rules disagree on a header, or if HSTS gains `preload`.

**Content-Security-Policy, next:** report-only once the public pages land (so the week of
reports describes the pages that will ship), with its reports going to the Sentry security
endpoint only after `/reset-password` and `/verify-email` strip `?token=` from the address
bar (a report's `document-uri` carries the query). Enforced after a clean week. Maps'
`'unsafe-eval'` is decided on that week's evidence: isolate the map, or replace the
autocomplete server-side, before granting eval app-wide.

## Consequences

- Clickjacking, MIME sniffing and downgrade-to-HTTP are closed today; the browser features
  nothing uses are off.
- A future `api.` or `mail.` subdomain must be HTTPS-only from its first day
  (`includeSubDomains`).
- Anyone adding a header rule to `apps/web/vercel.json` meets the test's merge rule: one
  value per header per path.
- The Railway gateway still sends `x-powered-by: Express` and no security headers of its
  own; that is a separate change (plan step H5), not in this record.
- **Revisit when:** the CSP report-only week ends (enforce it and bracket this record);
  a subdomain is added; a feature needs a browser permission listed as off; Stripe's key is
  set in production (ADR 0110's CSP trigger).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Aldemir (founder), in session | Locked — "Add both, as planned" |
