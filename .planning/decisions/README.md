# Decision Log — Mudavym

> Every decision gets a record. A decision not written here (or in a doc this
> index points to) **has not been made** — that is non-negotiable #1 in
> [`CLAUDE.md`](../../CLAUDE.md).

## How this works

- One decision = one file: `NNNN-short-slug.md`, from [`TEMPLATE.md`](TEMPLATE.md).
- Statuses: **Locked** (binding) → may later become **Superseded** (points to its
  replacement). Nothing here is ever silently deleted.
- Undecided forks live in [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) — the queue of
  questions waiting for the founder. Sessions add to it; only a founder call moves
  an item out of it and into an ADR.
- Decisions locked **before** this log existed remain canonical where they were
  written. This index links to them; we do not copy them (one source of truth per
  decision).

## Locked — recorded in this log

| # | Decision | Date |
|---|---|---|
| [0001](0001-mudavym-single-entity.md) | Mudavym is one entity; modules are internal softwares | 2026-08-24 |
| [0002](0002-documentation-first-operating-mode.md) | Documentation-first operating mode + ADR discipline | 2026-08-24 |
| [0003](0003-session-output-discipline.md) | Low per-session output footprint, branch-per-operation | 2026-08-24 |
| [0004](0004-obsidian-as-backlink-layer.md) | Obsidian adopted as the doc backlink layer | 2026-08-24 |
| [0005](0005-v3-to-v0-version-reset.md) | v3 internal build → deliberate v0 production reset | 2026-08-24 |
| [0006](0006-neural-footprint-architecture.md) | Neural Footprint — split narrow production store from wide append-only research log; NF-C gated | 2026-08-24 |
| [0008](0008-nf-column-contract.md) | NF column contract — full ADR 0006 shape now (Path C); Claude's Path A recommendation overruled | 2026-08-24 |
| [0007](0007-org-structure.md) | Org — 7 divisions, 19 departments, 3 findings-only advisory functions, 7-artifact unit anatomy | 2026-08-24 |
| [0009](0009-loop-vocabulary-contract.md) | Loop vocabulary read from ORG_STRUCTURE §5.1's own table and enforced as a hard CI gate; `active`/`running` must cite evidence — live loops 6 → 5 | 2026-08-24 |
| [0011](0011-pos-sale-volume-contract.md) | POS sale volume — `sale_volume_ml` is the truth, `sale_unit` becomes an open reporting label, and an unresolvable line queues instead of defaulting to a bottle. Kills a silent 5x over-depletion on all 92 production mappings; accepts visible under-depletion in exchange | 2026-08-25 |
| [0010](0010-gemini-model-retirement.md) | `gemini-3.5-flash-lite` replaces retired `gemini-2.0-flash`/`gemini-pro`; runway beat price. Spend table was wrong (2.5-flash under 8.3x), lite billed as flash, thinking tokens uncounted — all three corrected | 2026-08-24 |
| [0016](0016-ledgers-must-express-unknown.md) | Ledgers express "unknown" — `api_spend.cost_usd` nullable and `DEFAULT 0.0` dropped, one `unpriced` determination driving both ledgers; every rate row carries a required dated source, so an undated price is a `TypeError` at import; calendar regex fallback reads the email, not the prompt. `gpt-4-turbo` verified correct | 2026-08-25 |
| [0015](0015-pos-referential-integrity.md) | POS referential integrity — `inventory_id` FK added, 92 orphaned mappings from a deleted tenant removed; ledger writes idempotent | 2026-08-25 |
| [0017](0017-doneability-verdicts-are-sidecar-claims.md) | Doneability verdicts are sidecar claims (`nf_verdict`, one row per event+basis), never edits to the event; first grader `reconciliation_v1` on invoices only; coverage view ships with the verdict | 2026-08-25 |
| [0018](0018-p2-plan-of-record.md) | P2 plan of record — milestone `P2 — Web complete + deploy`; spine reset; Surface page graph; existing-first then founder-approved proposal | 2026-08-25 |
| [0020](0020-no-fabricated-answers.md) | **A surface with no data says so; it never invents one** — fabricated analysis deleted rather than labelled, actions that cannot complete refuse out loud, an error never renders as emptiness, a mislabelled number is a fabrication. Generalised from 7 broken / 8 hollow pages | 2026-08-26 |
| [0024](0024-identity-first-signin.md) | **Sign-in reveals the methods an identity actually has** — email first, then the methods resolved from `password_hash` + `user_oauth_accounts`; one provider registry; `validateUser` stops guessing "Google" (wrong for 4 of 4 password-less production accounts); enumeration made deliberate and rate-limited, with `requestPasswordReset` explicitly untouched. Applies ADR 0020 to auth | 2026-08-26 |
| [0025](0025-citations-must-disagree-loudly.md) | **A citation must carry two anchors that can be diffed — an id *and* a line — and CI fails when they disagree.** Re-derived at lock time: **78** register citations, **0 of 38** id-paired ones agreeing, 36 carrying no id at all. Line anchors are 100% wrong but detectable; ids renumber and keep resolving, which is what hid OD-83. `scripts/check_citation_pairing.py` enforces both arms in the `decision-claims` job — the checker the ADR called "already written" existed only in a transcript. **74 citations repointed**, 3 handed off ([HANDOFF-adr-0025](../04-specs/HANDOFF-adr-0025.md)). Also ships "a claim that cannot run is a FAILURE": three of four cannot-run states were certifying themselves, including one on a security claim; cost on arrival **0 of 94**. §7 executed — **469 archive twins deleted**, re-derived not trusted. **All three questions answered by the founder 2026-08-26** | 2026-08-26 |

## Proposed — implemented, awaiting a founder lock

> These carry `status: proposed`. The work has landed and the OPEN-DECISIONS rows are
> closed, but per the template a decision is locked by the founder, never by a session.

| # | Decision | Date |
|---|---|---|
| [0012](0012-reports-through-the-gateway.md) | Generated reports read through the gateway, not the browser — RLS-on-with-zero-policies confirmed in production (and on 141 other tables); the missing delete endpoint and three invented columns closed rather than half-ported | 2026-08-25 |
| [0013](0013-one-commitment-guardrail.md) | One UCC commitment guardrail: TypeScript canon, generated Python module, three independent drift guards. Real counts were 19 / 8 / **3** — a third list existed | 2026-08-25 |
| [0019](0019-p2-build-scope.md) | **P2 build scope — the founder-approval list**: live defects (2 broken routes), 15 dead-end verdicts, cold-entry audit, tenant-ownership gap; drafted from the Surface graph, awaiting lock | 2026-08-25 |
| [0021](0021-studio-invites-are-self-service.md) | **Studio invites are redeemed by the invitee, bound to the invited address** — the role gate made redemption impossible for everyone it was for; `target_email` was written and never read, so removing the gate alone would have opened a privilege-escalation path; and nothing served `/api/v1/studio/*` in either environment | 2026-08-26 |
| [0022](0022-scheduled-jobs-serve-opted-in-tenants.md) | Scheduled jobs iterate opted-in tenants and never borrow another tenant's recipients | 2026-08-26 |
| [0023](0023-email-verification-is-enforced.md) | Email verification is enforced, and enforced on the server | 2026-08-26 |
| [0026](0026-schema-has-one-home.md) | **Schema has one home, and CI compares it against the code** — five instances in a day of a migration archived, never applied, and queried anyway. `Fresh database equals remote` was green *because* both sides were wrong the same way, and `baseline_from_production` made that blindness total. Two guards add the third corner (what the code queries); 14 relations + 5 rpc functions + 8 sole-definitions recorded as shrink-only debt; blind spot measured at 24/1377 sites. **0025 skipped deliberately** — a concurrent worktree was already holding it | 2026-08-26 |
| [0027](0027-push-recipients-are-not-resolved-here.md) | **The recipient resolver's push branch is deleted, not repointed** (resolves OD-95, Proposed). The standing recommendation was to repoint at `notification_preferences.push_subscription`; that column's only writer upserts `onConflict: "user_id"` against a table whose only unique index is `(restaurant_id, user_id)`, so it returns **42P10** and can never hold a value — repointing would have swapped a loud 404 for a silent empty read. It was also unusable: **both push senders take user ids and enumerate devices themselves**. `"push"` leaves `NotificationChannel`, so asking is now a compile error. Applies ADR 0020. Found in passing: **no gateway spec file is type-checked by anything** (`tsconfig.json:24` + ts-jest `isolatedModules`) | 2026-08-26 |
| [0028](0028-phantom-relations-repoint-or-delete.md) | **A phantom relation is repointed or deleted, never created** (resolves OD-99, Proposed). Eleven class-C relations — six tables plus **five `.rpc()` functions the register never mentioned** — verified absent from *production* by curl, not from `supabase/migrations/`. None got a migration: `reports`→`generated_reports`, `inventory_stock`→`restaurant_inventory`, `managers`→`manager_report_profiles` were **repointed** (the real store existed all along); the rest were **deleted**, per ADR 0027. What let them survive was uniform: every read was wrapped in error handling that returned exactly what success returns — and in three RPC call sites the author's own fallback sat *inside the same `try`*, so it was unreachable code that made the site read as defensive. `_find_provider_by_email` had returned None for **every inbound email ever parsed**; `jsonb_array_append` was a **write**, so its failure was data loss, not a degraded read. Found in passing: **two tests that pinned defects rather than catching them**. Applies ADR 0020. Five forks filed as OD-100…104 | 2026-08-26 |
| [0029](0029-p3-plan-of-record.md) | **P3 plan of record: grade before you scale, and parallel only where nothing is assumed** (Locked). The founder asked whether the five ROADMAP P3 candidates could run in parallel; the answer is **no, and not for capacity reasons** — two of the five are blocked on decisions rather than effort, so "parallel" would mean an agent picking the guest product (OD-05/OD-07) and the routing basis (OD-04) by default. Shape: one gate (**P3.0 doneability coverage** — the gateway emits 7 task types and exactly 1 carries a real verdict, the rest stamping `call_level_v0` at `model-client.service.ts:387`), two lanes gated on nothing (mobile parity, kitchen expansion), two stages behind the gate (Ask AI, model registry), and **NF-B held**: 564 lines of applied migration, 3 tables, 2 CI guards, zero callers. Supersedes PLAN.md Push 4 and the ROADMAP P3-candidate menu | 2026-08-26 |
| [0014](0014-proposal-candidate-set-null.md) | **A proposal keeps its question when it loses its candidate** (Locked 2026-08-25, **restored 2026-08-27**). `pos_catalog_match_proposals.candidate_inventory_id` takes `SET NULL`, not the `CASCADE` its sibling took: a mapping is a *claim* ("this POS item depletes that stock row") and dies with its target, while a proposal is a *question* ("is this the right target?") that outlives its answer. Symmetry with ADR 0030 would have been cosmetic | 2026-08-25 |
| [0030](0030-pos-mapping-inventory-integrity.md) | **Delete orphaned POS mappings, and make the database refuse new ones** (Locked 2026-08-25, **restored 2026-08-27 — was ADR 0012 until a squash-merge dropped the file and that number was reused**). All 92 production `pos_item_mappings` rows carried a non-null `inventory_id` pointing at nothing; root-caused to `SYNTH_WRITE_SET` and proven reproducible 92/92. Deleted, then an FK so the database refuses the next one | 2026-08-25 |
| [0031](0031-migration-ledger-reconciliation.md) | **Reconcile the migration ledger in both directions, and check it that way** (Locked 2026-08-25, **restored 2026-08-27 — was ADR 0013**). Applying ADR 0030's migration surfaced ledger drift *both* ways (4 unregistered, 1 unrecorded); the check now runs in both directions rather than the one that happened to be noticed | 2026-08-25 |
| [0032](0032-vault-cleanup-cut-line.md) | **Delete closed build artifacts; a tombstone index replaces the archive tree** (Locked — resolves OD-01's cut line). Cut line C-modified, founder-picked question by question: `phases/` + `quick/` + the remaining `archive/` twins + 4 duplicate data blobs deleted (~525 files, vault 1,677→1,152), everything recoverable via the ADR's tombstone index. Kept on evidence: `sketches/` (20 live code citations), `claude_full_architectural.md` (founder), `FIX_ERROR_LOG.md` (its `.cursor` skill still runs). Standing rules: archive = delete + tombstone, never an in-tree copy; retirements score AUTO only when provably zero-loss, everything else is founder REVIEW | 2026-08-27 |
| [0033](0033-design-map-zoomable-atlas.md) | **The design map is a zoomable atlas over one generated graph** (Locked). Six looks sketched and scored on the founder's axes (whole-map, detail, growth); F chosen. `atlas-graph.json` is generated source of truth (every edge carries its derivation basis), `atlas-overlay.json` is additive-only — the generator exits 2 if the overlay tries to shadow the map — and `DESIGN-MAP.html` renders three altitudes. First build: 186 features · 464 endpoints · 1,142 edges, browser-verified | 2026-08-27 |
| [0034](0034-agent-stack-artifact.md) | **Every unit gets an agent stack — a 9th artifact, `<slug>-agent-stack.md`, docs-only** (**Locked 2026-08-27** — founder answered the four framing forks in-session, delegated the two approach picks with criteria, and locked the same day by re-stating them; no pick overruled). Requirements-only declarative agent cards, harness-agnostic while OD-03 is open (model choice stays with aio-model-routing; stock/money/outbound stays confirm-gated per FUTURES §8.1); §3.3-compliant T2 skill tables (real past instance or no row); four-layer git-native memory (skills · NF-A episodic · one-fact-per-file semantic with provenance · bounded working) with a PR-gated consolidation loop feeding skill-harvesting's queue; cross-unit interaction async-only. Template `_templates/agent-stack.md`, wave contract `foundation/GENERATION_BRIEF.md` §7 | 2026-08-27 |
| [0035](0035-wave2-seam-reconciliation.md) | **Wave-2 seam reconciliation — one owner per question, and the roster is 76** (Locked — founder picked all eight in-session). `nf-a-coverage-report` split by question (Applied AI owns coverage; observability's job renamed emission-liveness); substrate report produced by the team, consumed by the department; the fleet census has one computer (`fleet-census-agent`) and HR publishes only the declared-vs-computed variance; `nf_a.cost_per_task` — the most-covering unit produces, Finance fetches (OD-29's Finance edge settled, RM-1 half open; ledger-grain divergence filed); NF-B erasability loop assigned to privacy-engineering (NF-B stays HELD, mechanism fork open); POS-bridge throughput excludes the 66 `P3PROOF-*` rows; ai-surface-security narrowed to allowlist *audit*; `backtests` accepted as team 76 with a dated ORG_STRUCTURE correction | 2026-08-27 |
| [0040](0040-error-tracker-receives-no-identity.md) | **The error tracker receives no identity** (Proposed). The wave-3 finding named one runtime; verification found **three** — `apps/web`, `apps/api-gateway` and `services/agent-orchestrator` each forwarded `email` and `username` onto the Sentry user scope. Both existing `beforeSend` hooks were decorative (the web one was a literal `// Placeholder`), and the init that actually runs in production, `main.py`, had **none**. `sendDefaultPii` would not have helped and reads as though it would: Sentry's own docs say it covers SDK-attached data but *not* anything set via `setUser()`. Fix is two controls answering two failure modes — narrowed types so a regression fails to compile, plus a real scrubber for the paths types do not own — held by a blocking guard proven against the pre-fix tree (**15 findings, 3 runtimes**). Also: the interceptor sent `request.query` whole (now key names only), and `Privacy.tsx` documented five data flows while omitting error tracking entirely, which under ADR 0020 is a surface asserting something untrue about itself. Three items held for the founder: whether the UUID goes at all, purging the already-sent archive, and a DPA | 2026-08-28 |

## Locked — recorded elsewhere (pre-log)

| Decision | Where | Date |
|---|---|---|
| Brand: Mudavym (spelling confirmed) | [`PROJECT.md`](../PROJECT.md) Key Decisions | 2026-07-26 |
| Expansion sequence: wine → beverages → bakery → kitchen | [`FUTURES.md`](../FUTURES.md) §2 | 2026-07-26 |
| Wine = extraction quality bar for every category | [`FUTURES.md`](../FUTURES.md) §4 | 2026-07-26 |
| Bakery = first food vertical | [`FUTURES.md`](../FUTURES.md) §5 | 2026-07-26 |
| Live camera stack: RF-DETR → PaddleOCR → Gemini; no full OCR on live frames | [`PROJECT.md`](../PROJECT.md) / `SCANNING_PIPELINE_SETUP.md` | 2026-07-27 |
| Extend BaseAgent, not rebuild; wave sequencing; 7 core principles | [`PROJECT.md`](../PROJECT.md) Key Decisions | v2.0 |
| Blender / landing-page visuals: **hold** until structure + brand exist | Vision capture §13/§14.5 | 2026-08-24 |
| Agent-native UI: **do not build**; fix the security defects, ship the narrow deterministic slice | [`AGENT_NATIVE_UI_DECISION.md`](AGENT_NATIVE_UI_DECISION.md) (moved here from top level, ADR 0032) | 2026-07-27 |

## Open

See [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) — that file is canonical and this line
is a pointer, not a count. It has grown well past its original 8 items; four are
marked 🔴 and several were raised by review agents against Claude's own work.

Evidence annexes attached to open items (each merges into the ADR that resolves its
item, then is deleted):

| Annex | For |
|---|---|
| [`OD-72-rls-census.md`](OD-72-rls-census.md) | OD-72 (142 naked-RLS tables) · OD-73 (12 RLS-off tables with full `anon` DML) |
