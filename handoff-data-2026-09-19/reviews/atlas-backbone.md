# Mudavym System Atlas — Part 2: BACKBONE

Reviewed worktree: `/Users/aldemirkonuk/Projects/wt-review`, detached at
`train/finish-2` = `804a1bdb5` (`main` `cb756083e` + PR #391's train). Reviewed
2026-09-18/19, read-only. All numbers below were produced by a command run in
this session; each section says which.

Companion doc: Part 1 (design/UX atlas) — not covered here.

---

## 0. Method

- Copied `scripts/generate_system_atlas.py` and `scripts/generate_design_atlas.py`
  unmodified (diffed byte-identical against the source repo) into the scratch
  dir, repointed `ROOT`/`OUT_DIR` at the worktree, ran them. Outputs:
  `atlas-b/atlas.json`, `atlas-b/out/atlas-graph.json`.
- Reused three existing repo guards rather than re-deriving their checks:
  `scripts/check_queried_tables_exist.py`, `scripts/check_route_exposure.py`,
  and read (not re-derived) `.planning/v3.0-TECH-DEBT.md`'s hollow-features
  register (§44.2) via grep+offset, never read whole.
- `apps/api-gateway` jest+coverage and `tsc` run once each through
  `p4-scratch/heavy.sh`.
- Production reads: Supabase MCP, SELECT-only, project `exzueerziesmczwlhomd`,
  used only to settle "is X actually happening" questions no static grep can
  answer (agent liveness, external-connection configuration counts).

---

## 1. Counts vs. the 2026-09-16 baseline

Regenerating the same generator against three points gives a clean read on
how much the counts have moved and why:

| | 2026-09-16 (committed) | current `main`/`feat/p1-readout` (working tree) | `wt-review` (PR #391 train) |
|---|---|---|---|
| endpoints | 468 | 507 | **689** |
| pages | 47 | 48 | 49 |
| features | 186 | 233 | **581** |
| services (gateway modules) | 39 | 40 | 53 |
| agents (Python) | 25 | 25 | 25 |
| tables | 163 | 177 | **239** |
| model tasks | 40 | 40 | 41 |

Command: `python3 generate_design_atlas.py` with `ROOT` pointed at each tree in
turn (`atlas-b/gda_main_check.py` for the middle column, `atlas-b/generate_design_atlas.py`
for the right column); left column is the file already committed at
`.planning/00-index/atlas-graph.json` in `wt-review`.

**Reading this:** the generator/overlay files are byte-identical across trees
(`diff` confirms), so none of this movement is a change in how counting works
— it is real. Two separate things are true at once:

1. **The committed atlas is stale by three weeks of ordinary work**, not just
   by this one PR train: `main` alone (no PR #391) already moved 468→507
   endpoints and 186→233 features. There is no regeneration cadence tied to
   merges — nothing fails CI when the committed graph drifts this far from
   the tree it describes. Findings F1.
2. **PR #391's train is the larger jump**: +182 endpoints, +348 features,
   +13 services, +62 tables beyond current `main`. Features count is driven
   by `.planning/06-pages` §1a lists (57 page docs in `wt-review` vs 56 on
   `main` — almost the same doc count, so the 3x feature growth is far more
   bullet points being written into existing docs' Features sections, not new
   pages). Agents count is flat at 25 across all three — no new Python agent
   shipped in this train.

---

## 2. Gateway endpoints: guarded, public, or a gap

Command: `python3 scripts/check_route_exposure.py` (existing guard, ADR 0096) —
**681 routes / 76 controllers: 635 auth-guarded, 46 declared public, 0
guard-not-recognised, 0 UNDECLARED. PASS.**

This is the number to trust over the atlas generator's own auth column: the
generator's regex only recognizes `JwtAuthGuard` (giving 678 "authed" / 11
"unauthed" in `atlas.json`), so it undercounts every route protected a
different way. Spot-checked the delta: `POST/GET /mcp` reads as "unauthed" by
the generator but carries `@UseGuards(McpCredentialAuthGuard)`; the two
WhatsApp webhook routes and `/webhooks/inbound-email` read as "unauthed" but
each verifies a signature/shared secret in the handler body (Meta
`X-Hub-Signature-256` via `verifyMetaSignature`; `x-inbound-secret` header,
refuses if unconfigured). None of the 11 the generator flags is an actual
hole — `check_route_exposure.py`'s 46-strong "public" list is the accurate
one and it is 0 `guard-not-recognised`, so nothing is silently unguarded.
**Tenant/house-membership scoping is centralized, not per-controller**:
`TenantGuard` (an `APP_GUARD`) is a documented no-op backstop (ADR 0096 — Nest
runs global guards before `JwtAuthGuard`, so `request.user` isn't set yet);
the actual tenant match (`assertTenantMatch`) runs inside `JwtAuthGuard`
itself, applied on 80 `@UseGuards(JwtAuthGuard)` sites. One chokepoint, well
commented, matches "1 real tenant" production shape. No `RolesGuard`/`@Roles`
gap found in the 13 files that use it — not exhaustively audited endpoint by
endpoint.

**Finding F2 (dead code, confirmed):** `apps/api-gateway/src/contacts/`
(`contacts.controller.ts` 137 ln + `contacts.service.ts` 324 ln, 6 routes
including `GET/POST /contacts`, `GET/POST /contacts/:id/addresses`) —
`ContactsModule` is defined but **never imported into `app.module.ts` or any
other module** (`grep -rl ContactsModule apps/api-gateway/src` returns only
its own file). It has been unreachable since the commit that introduced the
whole gateway (`91b75dd1e`, checked via `git log`), survived the OD-20
unauthenticated-controller sweep only because it isn't reachable at all, and
carries 0% test coverage (jest run, §5).

**Finding F3 (dead file):** `services/api-gateway/routes/advanced_features.ts`
(423 ln) — a pre-NestJS-rewrite relic in `services/`, not `apps/`. Zero
references anywhere in the repo (`grep -rl` for the path or an import of it:
nothing). Not part of any running process.

---

## 3. Endpoints: called by a client, or dead

Static grep is the honest tool here, not the atlas's own endpoint edges: the
design atlas's derived call-graph only connects **100 of 681** endpoints to a
caller (`atlas-b/out/atlas-graph.json`, edges where `to` starts with `ep:`) —
that 581-"orphaned" figure is an artifact of the atlas's edge derivation being
curated/partial for endpoints, not a real dead-code count.

Command: `atlas-b/caller_check.py` — for each of the 689 endpoints, strip
`:param` segments and search `apps/web/src`, `apps/mobile`, `services/**/*.py`
for the static path segments. **659/689 have some static reference; 30 do
not.** Cross-checked a sample of the 30 with a repo-wide grep excluding the
endpoint's own controller/service/dto/module files (so a spec file doesn't
count as a caller): 27 have **zero** references anywhere outside their own
implementation; 3 had exactly one non-implementation hit, and each of those
turned out to be a false positive (the endpoint's own `.spec.ts`, or an
unrelated string match) — so the real count of client-orphaned, authenticated
endpoints is **~28**, minus 2 that are correctly public/external-only
(`/vendor-portal/:slug/jsonld`, `/webhooks/inbound-email`) and not meant to be
client-called.

Full 30-row list (method, path, module, auth): `atlas-b/no_caller_report.txt`.
Notable ones, verified individually:

- **`POST /providers/:id/retroactive-order`** — has a regression-test file
  (`retroactive-order.spec.ts`) describing a real, previously-live production
  defect (multiple NOT-NULL/column-name mismatches, fixed and verified against
  production 2026-09-01), and a second unrouted copy of the same method
  in `provider-intelligence.service.ts` was found and deleted during that fix.
  The endpoint is now correct — and still has **no caller**. `Notifications.tsx`
  has copy telling a manager to "create a retroactive order" but that string
  is descriptive text, not a button wired to this endpoint (`grep -n
  retroactive apps/web/src/pages/Notifications.tsx` — one hit, in a switch
  statement's message string, no `fetch`/`navigate` nearby). **F4: fixed
  backend, no front-end action reaches it.**
- **`GET hot-tables`, `vendor-scorecard`, `insight-prefs` (analytics)**,
  **`identity-curation/*` (3 routes)**, **`mcp-server-keys` (3 routes)**,
  **`price-index/uploads` (5 routes)** — genuinely zero references anywhere
  in `apps/web`, `apps/mobile`, or `services/`. These read as built-but-
  never-wired-to-a-page features, not obviously agent-only (agent-orchestrator
  calls the gateway over HTTP in some flows and directly to Supabase in
  others — the direct-Supabase agent calls wouldn't show up as a caller of a
  gateway route at all, which is a real blind spot in this method, stated
  plainly: **not checked** whether any of these 28 are called from an agent's
  direct HTTP client rather than a page).

---

## 4. Tables: does the code query what migrations declare

Reused, not re-derived: `python3 scripts/check_queried_tables_exist.py`
(no `--against-production`, no `--base`) — **PASS**. 2060 call sites (1579
gateway, 456 agent-orchestrator, 14 self-evolution, 11 web, 0 mobile) resolve
to 243 distinct relations + 21 RPC functions; `supabase/migrations` declares
311 relations + 102 functions across 191 files. 6 relations are queried but
undeclared, and all 6 are the guard's own tracked, `prod:no`-confirmed debt
list (`notification_logs`, `pos_webhook_logs`, `provider_important_dates`,
`provider_ratings`, `push_subscriptions`, `scheduled_reports`) — nothing new.
26 call sites are not statically resolvable (24 in
`services/agent-orchestrator/core/database.py`, 2 in
`analytics/dev-truth.service.ts`) — the guard's own stated ceiling, not a
new gap. **This area is in good shape**: the table-backing question this
review was asked to measure already has a maintained, passing, non-vacuous
guard; I am citing its output rather than re-running the equivalent checks by
hand.

Not verified by this review: whether production actually **has** all 243
relations (`--against-production` arm) — that's `schema_parity.yml`'s job per
the guard's own text, and I did not re-run a schema-parity comparison against
live Supabase (would need write-free introspection of `information_schema`
across all 243 names; skipped for time — flagged as **not checked**, not
assumed passing).

---

## 5. Gateway jest + tsc

Command: `heavy.sh npx jest --coverage --runInBand --forceExit`
(`apps/api-gateway`), full log `atlas-b/jest-coverage.log`.

```
Test Suites: 2 skipped, 432 passed, 432 of 434 total
Tests:       14 skipped, 6677 passed, 6691 total
Time:        82.9s
All files:   72.1% stmts | 57.06% branch | 69.67% funcs | 73.1% lines
```

Zero failing tests. Coverage by folder (full table:
`atlas-b/coverage-by-folder.txt`, 137 rows) — flagging the folders under ~40%
statements, since these are where an untested regression is most likely to
already be live:

| folder | stmts % | branch % | note |
|---|---|---|---|
| `src/contacts` | 0 | 0 | F2 — unreachable, so untestable-by-HTTP; dead code, not a test gap |
| `src/communications/tests` | 0 | 0 | test-fixture dir, not app code |
| `src/websocket` | 18.95 | 27.14 | |
| `src/storage-locations` | 20.64 | 10.79 | |
| `src/conversations` | 23.54 | 8.67 | matches §3's two orphaned `by-order`/`by-provider` routes |
| `src/menus/parsers` | 22.81 | 21.73 | |
| `src/mobile` | 30.87 | 21.42 | gateway's mobile-BFF module |
| `src/common/idempotency` | 34.21 | 18.51 | correctness-load-bearing name, low branch coverage |
| `src/common/cache` | 35.08 | 16 | |
| `src/database` | 37.25 | 27.77 | |
| `src/providers` | 37.90 | 36.03 | |
| `src/restaurant-templates` | 39.43 | 44.44 | |
| `src/push` | 40.84 | 17.14 | |
| `src/common/orchestrator` | 44.72 | 34.49 | the gateway's bridge to the agent-orchestrator — see §6, matches the production-dark finding |
| `src/communications` (aggregate) | 45.77 | 35.23 | subfolders vary widely, `email-templates` at 42.14/12.2 |
| `src/notifications` (aggregate) | 46.29 | 38.57 | |

Separately: **91 of 158 `*.service.ts` files have no dedicated `.spec.ts`**
(`find`-based count, `atlas-b` session log). This overstates the real gap —
e.g. `analytics.service.ts` has no spec file of its own but shows 79%
coverage above, meaning it's exercised through its controller's or an
integration test — so treat the 91 as "not independently unit-tested," not
"untested."

`tsc` — both configs run through `heavy.sh`, **0 errors**:
`tsc --noEmit -p tsconfig.json` and the project's own
`npm run typecheck` (`-p tsconfig.spec.json`, includes test files).
Full logs `atlas-b/tsc.log` (empty = clean) and `atlas-b/tsc2.log`.

---

## 6. Python agents: do they run, are they deployed

25 files under `services/agent-orchestrator/agents/` (matches the atlas's
`agents: 25`, flat across all three trees in §1). Deployment config exists:
`services/agent-orchestrator/Dockerfile` + `railway.toml`
(`healthcheckPath = "/health"`, Railway auto-detects the Dockerfile) — **not**
independently confirmed against the Railway dashboard/API in this session (no
Railway credential in this environment); config presence is not the same as
"currently running," stated plainly.

What production data **can** show, and does (Supabase MCP, SELECT-only,
`exzueerziesmczwlhomd`, run 2026-09-18):

```
api_spend               latest = 2026-08-24 15:34   | last_24h=0 | last_7d=0
procurement_conversations latest = 2026-08-16 11:15 | last_24h=0 | last_7d=0
procurement_orders      latest = 2026-08-16 11:15   | last_7d=0
-- control (proves the DB itself, and the app, are live today) --
notifications            latest = 2026-09-18 16:00  | last_7d=76
```

**Finding F5 (high):** every LLM call any agent or the gateway makes is
supposed to write a row to `api_spend` (it's the shared spend ledger every
model client in the repo is meant to hit — see `.planning/07-reference`'s
model-pricing docs and the `check_analytics_cost_honesty.py` guard's own
premise). Its last row is **25 days old** as of this review, with 0 rows in
the last 7 days, while `notifications` (unrelated to agents, proves the
system is in use today) has 76 rows in the same window. `procurement_orders`
and `procurement_conversations` — the tables the procurement agent family
writes to on every provider interaction — stopped 33 days ago. This is
consistent with either (a) the agent-orchestrator process not actually
running against this tenant, or (b) it running but every write path into
these three tables silently failing (the tech-debt register already
documents a pattern of exactly this shape — swallowed writes, §44.1). I did
not have a way to distinguish (a) from (b) from read-only Supabase access
alone — that needs a Railway process check or an orchestrator log tail,
neither available here. **Stated as what it is: a dark pipeline, cause
unconfirmed, not "the agents don't work."**

`.planning/v3.0-TECH-DEBT.md` §44.2a (grepped + offset-read, not read whole)
already documents 5 of the 25 agents as deliberate stubs
(`ghost_inventory_agent`, `auto_pilot_agent`, `negotiation_playbook_agent`,
`shrinkage_detective_agent`, `compliance_agent` — 35-37 lines each, gated
behind `AGENT_<NAME>_ENABLED` defaulting false, and the orchestrator refuses
to start a stub even if the flag is flipped) — this is **already fixed and
tested** (20 tests in `test_agent_registry_gating.py` per that doc) and not
re-verified line-by-line in this pass; citing the existing record rather than
re-deriving it.

**`services/self-evolution`** (561-line FastAPI app, port 8090, its own
docstring: "LEARNING ENGINE: disabled by default") has **no Dockerfile and no
railway config anywhere under `services/self-evolution/`** — unlike
agent-orchestrator, there is no deployment mechanism for it in this repo at
all. Not referenced by any other service as a live HTTP dependency (the few
repo-wide hits for "self-evolution"/"SELF_EVOLUTION" are unrelated feature-
flag and feedback-hook code, not calls to this service). Read as: **source
exists, was never wired to run anywhere.**

---

## 7. External connections: live, dark, or dead

The atlas generator's own SDK detector (`atlas.json`'s `sdks` map) only
pattern-matches `import <package>` for a fixed list — it shows Twilio and
Stripe as **absent** because both integrations here are hand-written HTTP
clients, not the `twilio`/`stripe` npm packages. Corrected by direct grep +
one production count per connection (Supabase MCP, SELECT-only):

| Connection | Code | Production evidence | Status |
|---|---|---|---|
| **Gmail/Google** | `googleapis` SDK, 88 files reference Gmail in `apps/api-gateway/src` | `user_oauth_accounts`: 1 row; `restaurant_inbound_addresses`: 1 row | **Live** — matches memory note "Google Sign-In OAuth client verified" |
| **Twilio (SMS/WhatsApp)** | Hand-written form-encoded adapter (`text-transport/providers/twilio.adapter.ts`), sourced from Twilio's own docs MCP per its header comment, per-house credential model (ADR 0121: bring-your-own or Mudavym-registers) | `house_text_senders`: 0 rows; `house_text_sender_credentials`: 0 rows | **Dark** — built and well-documented (handles Twilio's async pricing, 13-value status enum, alphanumeric-sender STOP-keyword gap), never configured for the one real tenant |
| **Meta/WhatsApp webhook** | `whatsapp-webhook.controller.ts`, verifies `X-Hub-Signature-256` and the handshake token, correctly `@Public()` | 0 senders configured (same table as above — WhatsApp via Twilio is the only sender path found) | **Dark** — endpoint is correctly built/secured but has nothing to receive against |
| **Stripe** | `payment-methods` module (controller/service/dto), referenced in `app.module.ts`, `seal-challenge.service.ts` | `payment_methods`: 0 rows | **Dark** |
| **Generic OAuth (Drive/Excel etc.)** | `integration_oauth_connections`/`_states` tables exist | 0 rows | **Dark** — matches `check_queried_tables_exist.py`'s own noted history of this integration family |
| **Railway** | `agent-orchestrator/railway.toml` + `Dockerfile` | Not independently checked (no Railway API access this session) | **Config present, runtime not confirmed** — see F5 |
| **Vercel** | Referenced only in memory notes ("web is Vercel"), no Vercel MCP access in this session | `notifications` table shows live app usage today | **Not checked directly** — inferred live from app-usage evidence, not from Vercel itself |

---

## 8. Scorecard

| Area | Score | Why |
|---|---|---|
| Endpoint auth/exposure governance | 8/10 | `check_route_exposure.py` (ADR 0096) is a real, passing, non-vacuous ratchet; every one of the 11 "unauthed" flags from the naive detector checked out as intentionally protected a different way. Docked for the atlas generator itself under-detecting guards, which would mislead anyone who trusted its raw numbers. |
| Tenant/house isolation | 8/10 | Single well-commented chokepoint (`assertTenantMatch` inside `JwtAuthGuard`), ADR 0096 explains a real ordering bug that was found and fixed; not exhaustively re-audited endpoint-by-endpoint this pass. |
| Table/migration backing | 8/10 | Existing guard passes with only known, tracked debt (6 relations); production-side confirmation (`--against-production`) not re-run this pass. |
| Client-endpoint reachability | 5/10 | ~28 authenticated endpoints (of 689) have no static caller anywhere in web/mobile/services, including one with a fixed backend defect and a UI string that implies it exists but never calls it (F4). Not all-bad — most (659/689) do resolve — but 28 orphaned, non-trivial routes (identity-curation, price-index review flow, mcp-server-keys) is a real gap. |
| Dead code | 6/10 | Two confirmed, unambiguous dead modules (`contacts/`, F2; `services/api-gateway/routes/advanced_features.ts`, F3) sitting in the tree with 0% coverage and 0 references — cheap to remove, currently just noise. |
| Test coverage (gateway) | 7/10 | 72.1%/57.1% stmts/branch, 0 failing tests, clean `tsc` on both configs. Real, not vacuous — but 15 folders under 40% statements, several in correctness-sensitive areas (`idempotency`, `orchestrator` bridge). |
| Hollow features | 7/10 | The 7-item register in `v3.0-TECH-DEBT.md` §44.2 is current, cites live verification, and 6 of 7 are marked resolved/fixed with tests — this is a well-run process, not a pile-up. Not re-verified line by line this pass; cited, not re-derived. |
| Python agents — deployed & live | 4/10 | Deployment config exists (Dockerfile+railway.toml), but the two production tables the agent-orchestrator's procurement/spend paths write to have been silently stale for 25–33 days while the rest of the app is actively used today. Cause not confirmed (dark vs. broken) — that uncertainty itself is a finding, not a hedge. |
| External connections | 5/10 | One real, live, well-evidenced connection (Gmail) against four built-but-unconfigured ones (Twilio, WhatsApp senders, Stripe, generic OAuth) and one service with no deployment path at all (`self-evolution`). The code for the dark ones is well-built (the Twilio adapter especially), so this is a go-live/config gap, not a code-quality gap. |
| Atlas/graph currency | 3/10 | Committed `atlas-graph.json` is stale against `main` alone (three weeks: +39 endpoints, +47 features) before even counting PR #391's train (+182 endpoints, +348 features). No CI check ties the committed graph to the tree it claims to describe — F1. |

---

## 9. Findings for the founder's checklist

| id | area | severity | plain | recommendation | size |
|---|---|---|---|---|---|
| F1 | Atlas currency | medium | The build-map file (`atlas-graph.json`) hasn't been regenerated in three weeks and is already off by a large margin — nothing catches this automatically. | fix (add a CI check or a regen-on-merge step) | S |
| F2 | Dead code | low | A whole "contacts" feature (controller + service, 6 endpoints) has never been switched on since the day it was written — it's unreachable, so it can only be costing you confusion, not bugs. | remove (or wire it up, if it was meant to ship) | S |
| F3 | Dead code | low | A leftover file from before the current backend was built sits unused in the tree. | remove | S |
| F4 | Hollow-ish feature | medium | "Create a retroactive order" is described to managers in a notification message, but tapping through it doesn't actually reach the (now-fixed) endpoint that would create one. | decide (finish wiring it, or remove the copy that promises it) | M |
| F5 | Agent liveness | critical | The automated procurement/spend-tracking side of the system has been silently quiet for 3-5 weeks even though the rest of the app is being used today — and it isn't yet clear whether that's because it's turned off or because it's broken. | decide (needs a live check first — Railway status + a manual test order — before anyone can say "fix" or "remove") | M |
| F6 | External connections | high | Texting/WhatsApp and card payments are both fully built in code but have never been turned on for the real restaurant using the product — zero senders, zero payment methods on file. | decide (founder call: turn these on now, or they stay parked) | S (turn on) / already built |
| F7 | Orphaned endpoints | medium | About 28 backend actions (out of 689) have no button or screen anywhere that calls them — built, some possibly agent-only, most look simply unfinished. | decide (per-route: wire up, or remove) — full list in `atlas-b/no_caller_report.txt` | M |
| F8 | Test coverage | low | A handful of folders (session handling for repeat orders, background jobs, the bridge to the AI agents) are under 40% tested, which is where a next regression is most likely to hide. | fix (raise coverage on `common/orchestrator`, `common/idempotency`, `conversations` first — they're correctness-sensitive, not cosmetic) | M |
| F9 | Unlaunched service | low | A 561-line "self-improving AI" service exists in the code but was never given a way to actually run anywhere. | decide (finish deploying it, or delete it — right now it's neither) | S |

---

## 10. What this review did not check (stated plainly)

- Production schema parity for all 243 queried relations (`--against-production`
  arm of `check_queried_tables_exist.py`) — relied on the guard's declared-vs-code
  pass only.
- Railway/Vercel deployment status directly (no API access in this session) —
  agent liveness (F5) and Vercel currency were inferred from Supabase data,
  not from the platforms themselves.
- Whether any of the 28 orphaned endpoints (§3, F7) are called by an agent's
  direct HTTP client rather than a browser page — the grep method can't see
  that distinction, and agent-orchestrator often talks to Supabase directly
  rather than through the gateway, which this method also can't rule in or out.
- RolesGuard/`@Roles` correctness per-route (13 files use it) — presence
  confirmed, not audited for whether the right roles are required on the
  right routes.
- `.planning/v3.0-TECH-DEBT.md`'s other 43 subsections beyond §44.2 — only
  grepped for "hollow"/"stub"/"swallow" terms and read the matched sections
  by offset, per CLAUDE.md §2's rule against reading it whole.
- mobile app: 0 static-caller hits in `apps/mobile` contributed to the
  caller-check in §3, but the mobile app itself was not separately reviewed
  for build health, tests, or coverage.
