---
type: adr
id: 0107
title: A declared model-context server is not a reachable one
status: proposed
updated: 2026-09-03
links: []
---

# 0107 — A declared model-context server is not a reachable one

- **Status:** Proposed — built behind `mudavym_design_profile`, founder review open
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — the p4 third-pass call: *"the four large builds — make them elegant and pretty looking"*, build D
- **Keywords:** MCP, model context protocol, Streamable HTTP, handshake, tools/list, probe, per-connection secret, AES-256-GCM, SSRF, commitment guardrail, last_used_at, /profile
- **Links:** [[0013-one-commitment-guardrail]], [[0020-no-fabricated-answers]], [[0016-ledgers-must-express-unknown]], [[0042-iznik-seal-single-chromatic]], `.planning/06-pages/profile.md`, `.planning/08-softwares/mudavym-mcp.md`, `supabase/migrations/20260903094500_user_mcp_connections.sql`, `supabase/migrations/20260903104500_user_mcp_connection_runtime.sql`

## Context

`/profile`'s Model context register was built on 2026-09-03 as a table
(`user_mcp_connections`) and three routes. Its own migration header said what it
was not:

> "A row is a DECLARED server: a name, an endpoint, and the scopes the house has
> granted it. It is NOT evidence that anything has ever called that server."
> — `supabase/migrations/20260903094500_user_mcp_connections.sql:20-23`

That honesty was filed as a gap the same day. `profile.md:539` (G9) reads:
*"nothing calls a model-context server … Closing it means an MCP client in the
gateway … and, before that, a decision on the handshake: which transports, whose
credential, what happens when a trusted server starts exposing a new tool."*

Three facts made the gap worth closing rather than restating:

1. **The register's whole value is the column it could not fill.**
   DESIGN-FOUNDATION §6 (`.planning/06-pages/DESIGN-FOUNDATION.md:304`) names the
   exponential idea for this page as *"one list of everything that acts on your
   behalf … each with its scope, its **last action** and a revoke"*, rated **now**.
   A register with a scope and a revoke and a permanent em dash under "last
   action" is two thirds of that idea.
2. **`last_used_at` was already nullable, deliberately, for exactly this.** The
   migration refused to default it to `created_at` precisely so a real caller
   could one day stamp it (`:70-71`). Nothing had to be undone.
3. **The credential question had a decided shape waiting.** The same header said
   a token column would come "with its own migration and its own encryption, the
   way `integration_oauth_connections` did" (`:33-37`) — and
   `common/crypto/token-crypto.service.ts:70-105` is that encryption, already in
   the tree, already proven on Google/Microsoft refresh tokens.

What was **not** decided, and is still not, is whether a model-context client may
**invoke** a tool. ADR 0013 governs commitment language and auto-send for vendor
conversation; it has never been extended to a third party calling a tool that
places an order or sends an email. That is the fork this ADR deliberately leaves
open, and it is the reason the build stops where it does.

## Options considered

**A. Leave the em dash; close G9 when the whole MCP client exists.**
The register keeps saying "nothing dispatches yet". Correct, and it was correct
for one day. Rejected because it makes the honest sentence permanent for a reason
that is no longer true — the transport is a published specification, not an
undecided fork. The *invocation* question is the undecided fork, and conflating
"we have not decided whether to call tools" with "we cannot tell whether this
server exists" hides a decision behind a capability gap.

**B. Adopt the official `@modelcontextprotocol/sdk` client.**
Fewest lines, and it tracks the spec. Rejected for three measured reasons: it
pulls a dependency whose transport layer we would still have to constrain (the
SDK will follow redirects and has no notion of a refused address range, which is
half of what §Decision below is *for*); it is built for a long-lived session with
reconnection and server-initiated messages, none of which a one-shot probe wants;
and a probe is ~200 lines of `fetch` against a specification we can cite line for
line. If a *persistent* client ever lands — the thing that would actually call
tools — the SDK is the right answer for it, and this service is not in its way.

**C. Probe on a schedule, so the register is always current.**
Rejected for now, on the shape of the product rather than the difficulty: a cron
that calls every declared server turns a page-level "check this" into standing
outbound traffic from our infrastructure to addresses tenants typed in, which is
a different security posture and needs the per-tenant scheduler's quiet-hours and
back-off treatment (ADR 0022). Filed as G14. The manual probe is the honest
smaller thing, and it is the one a person asks for at the moment they care.

**D. One timestamp — refresh `last_used_at` on every probe.**
The obvious simplification, and it is the fault this repo has a memory file
about. A failed probe would refresh "last call", so a server dead for a month
would read as busy, and the column's own comment ("when this server last
*answered*") would become false. Rejected: two columns, `last_probe_at` and
`last_used_at`, each with one meaning.

**E. Store the credential in plaintext until a key exists; encrypt later.**
Rejected outright. A credential written in the clear cannot be un-written by a
later migration, and the row would be indistinguishable from one written after
the key arrived.

**F. Reuse `INTEGRATION_TOKEN_ENCRYPTION_KEY`.**
Tempting — it is deployed, and the envelope format is identical. Rejected: that
key unlocks Google Drive and Microsoft Graph refresh tokens, and a key that
unlocks two unrelated blast radii is one rotation away from being unrotatable.
`MCP_CONNECTION_SECRET_KEY` is its own variable **with no fallback**, so a
deployment that has not enabled this feature has not enabled it.

**G. Expose `tools/call` behind a confirmation dialog.**
The thing a demo would show. Rejected as the central decision of this ADR: see
below.

## Decision

**1. A probe is a first-class act, and it is the only one.**
`POST /mcp-connections/:id/probe` performs the Model Context Protocol lifecycle
over the Streamable HTTP transport (spec revision `2025-06-18`): `initialize` →
`notifications/initialized` → `tools/list`. It handles both response shapes the
spec makes mandatory (`application/json` and `text/event-stream`), echoes the
server's `Mcp-Session-Id` on every subsequent request, and sends
`MCP-Protocol-Version` carrying **the version the server negotiated to**, not the
one we asked for. `tools/list` is skipped entirely when the InitializeResult
declares no `tools` capability, because the spec permits only negotiated
capabilities — and "it never offered a tool list" is a different sentence from
"it offered an empty one". Implementation:
`apps/api-gateway/src/mcp-runtime/mcp-runtime.service.ts`.

**2. There is no invocation path, and its absence is the decision.**
No `tools/call`, no route of any shape that reaches one, no column to record one.
Calling a tool can send an email to a vendor, place an order, or otherwise bind
the restaurant — the subject of ADR 0013's commitment guardrail, which has never
been extended to model-context dispatch. The row says so **in the gateway's own
words**: `GET /mcp-connections/runtime` returns
`invocation: {enabled: false, reason: "…the commitment guardrail (ADR 0013)…"}`
and the page prints that string rather than prose of its own. A structural test
asserts the service has no `call`/`callTool`/`invoke` method
(`mcp-runtime.service.spec.ts`), so the absence is a property of the module and
not a habit of its callers.

**3. Two timestamps, because a call and an answer are two facts.**
`last_probe_at` is stamped on every probe. `last_used_at` is stamped **only** on a
handshake that completed, preserving the meaning
`20260903094500_user_mcp_connections.sql:70-71` gave it. A failed probe leaves the
previous answer where it was, so the row keeps saying *"it last worked on the
3rd"* instead of quietly refreshing to now.

**4. Five outcomes, never one.** `probe_status` is
`ok | unreachable | refused | protocol_error | unconfigured`, **nullable, with no
default and no `unknown` member**: NULL means never probed and renders as an em
dash. A dead host, a 500, a redirect, a body over the cap and a credential we
cannot decrypt have four different fixes, so they get four different sentences —
`probe_detail` carries the server's own words where the server supplied any.

**5. The credential is encrypted, refused, or absent — never plaintext.**
`secret_encrypted` holds an AES-256-GCM `v1.iv.tag.ciphertext` envelope under
`MCP_CONNECTION_SECRET_KEY` (`mcp-runtime/mcp-secret.service.ts`). With no key the
gateway **refuses the whole write** with a 503 naming the variable, so a NULL
never means "stored, unencrypted", and no row is created without the credential
the operator believed they supplied. A key that is not exactly 32 bytes is
**refused rather than stretched** — unlike its neighbour, which SHA-256s a
passphrase — because stretching makes a typo'd key work and then makes the
corrected key unable to read what it wrote.

**6. The secret is not fetched, not merely filtered.**
`McpConnectionsService.ROW_COLUMNS` names every column a row shows and does not
include `secret_encrypted`; the only select that names it is inside `probe()`.
A response cannot carry the ciphertext because the value is never read. The row
reports `hasSecret`/`secretSetAt`, derived from a **date**. Revoking destroys the
credential rather than orphaning it.

**7. The gateway will not fetch a private address.**
The probe makes the *server* fetch a URL a *user* typed, so the endpoint is
resolved and every resulting address vetted before the call:
loopback, link-local (`169.254.0.0/16`, where cloud instance metadata lives),
RFC1918, CGNAT, unique-local and IPv4-mapped forms are refused, naming what was
refused and why. `MCP_ALLOW_PRIVATE_ENDPOINTS=true` unlocks them for a developer
running a server on `localhost`. Redirects are **not followed** (`redirect:
"manual"`), so a bearer credential cannot be carried to a host the check never
saw.

**8. Bounded: one deadline, one byte ceiling, one tool cap.**
`MCP_PROBE_TIMEOUT_MS` (8s) covers the whole three-request lifecycle rather than
each request. `MCP_PROBE_MAX_BYTES` (256 KiB) is enforced by reading the body
chunk-by-chunk and cancelling the stream — `response.text()` would buffer whatever
was sent. `MCP_PROBE_MAX_TOOLS` (100) caps what is stored, and `probe_tool_count`
records what the server **said**, so a truncation cannot read as the catalogue.

**9. `inputSchema` is dropped.** It is the largest field a tool carries and it is
useful only to a caller that can invoke. Storing an argument spec for a call that
cannot be made is keeping a key to a door that does not exist.

**10. The Mudavym MCP *server* stays documents-only.** This build is the client
half — servers *we* may call. `08-softwares/mudavym-mcp.md` remains `planned`,
and its §6 relation paragraph is amended to say that a probed row is now evidence
about a THIRD-PARTY server and still no evidence that the Mudavym server exists.

## Consequences

**Good**

- G9 closes. `last_used_at` can hold a real timestamp for the first time, and the
  register's "last action" column — DESIGN-FOUNDATION §6's **now** idea — is a
  reading.
- The page can state a *server* rule about invocation instead of a page promise,
  which is the same repair `getLocation`'s role gate made for the permission copy.
- The runtime module has no database dependency, so its specs drive a real
  `node:http` server rather than a mocked `fetch`: the `Accept` header, the
  session echo, the SSE parse and the byte ceiling are wire facts, tested as such.
- The SSRF vetting is reusable by any later outbound-fetch feature; it is the
  first one in this gateway.

**Costs and risks, stated**

- **DNS rebinding is not closed.** The guard resolves the name, then `fetch`
  resolves it again, and a hostile resolver can answer differently the second
  time. Closing it needs the socket pinned to the address that passed. Filed as
  **G13**; what *is* closed is the reachable class — someone typing a metadata or
  RFC1918 URL into the form.
- **A probe is manual.** The register is current as of the last check and says so
  with a date; nothing keeps it fresh. Filed as **G14** (option C).
- **Two more environment variables** (`MCP_CONNECTION_SECRET_KEY`,
  `MCP_ALLOW_PRIVATE_ENDPOINTS`) and three optional limits. With none of them set
  — today's state on every deployment — the register lists, adds, revokes and
  probes public servers, and the credential field is disabled carrying the
  variable's name. Verified live: `GET /mcp-connections/runtime` → 200 with
  `secretStorage.configured: false`.
- **The migration has not been applied anywhere.** `20260903104500` is a new file;
  migrations apply on merge. Until then the register renders its honest error
  state against a database that has not taken it — which is what the error branch
  is for, and is what the curl transcript in `profile.md` §1b shows.
- **This ADR does not decide invocation.** It records that invocation is refused
  and why. When the founder wants tools called, the fork is: does ADR 0013's
  guardrail extend to a third-party tool call, and what is the human step? The
  table takes no new column for it either way.

## Review trail

- 2026-09-03 — filed with the build. Number **0107**, and the way it was reached is
  worth recording because it is the failure mode
  `memory/adr-number-comes-from-the-guard.md` describes. `next_free()` reported
  **0106** across 622 refs; a sweep of all 40 `git worktree` checkouts, unpushed
  ones included, found 0100–0105 claimed and nothing above; this file was written
  as 0106 — and the *immediate* re-run found
  `0106-a-reminder-is-the-houses-job-not-the-browsers.md` beside it, filed seconds
  earlier by a concurrent build in the same worktree. So the sweep was correct and
  still not sufficient: with four builders in one checkout, the only safe check is
  the one run **after** the file is written. Renamed to 0107, which `next_free()`
  and a fresh sweep both confirm is free. Two further notes for the parent:
  **0102 is claimed twice** — by
  `0102-a-card-on-file-is-the-providers-record-not-ours.md` on this branch and by
  `0102-every-dependabot-pr-resolved-by-measurement.md` in an unpushed peer
  worktree — and two more builds on this branch may still be filing, so renumber
  deterministically at commit rather than trusting any number written here.
- Not yet reviewed by the founder. `OPEN-DECISIONS.md` deliberately untouched.
