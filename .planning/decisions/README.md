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

## Open

See [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) — that file is canonical and this line
is a pointer, not a count. It has grown well past its original 8 items; four are
marked 🔴 and several were raised by review agents against Claude's own work.

Evidence annexes attached to open items (each merges into the ADR that resolves its
item, then is deleted):

| Annex | For |
|---|---|
| [`OD-72-rls-census.md`](OD-72-rls-census.md) | OD-72 (142 naked-RLS tables) · OD-73 (12 RLS-off tables with full `anon` DML) |
