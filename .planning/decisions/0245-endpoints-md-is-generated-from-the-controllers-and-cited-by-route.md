# 0245 — ENDPOINTS.md is generated from the controllers and a per-route trace, checked by shape, and cited by route

- **Status:** Locked 2026-09-30 (founder). Six rulings: four on 2026-09-29, two on 2026-09-30 (§Rulings). No fork is open. Supersedes nothing. Retires the ENDPOINTS writer in `scripts/render_system_atlas.py` (removed in PR 1). PR 2 then retires the standalone census `.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md` by merging it into ENDPOINTS.md (ruling 4). The new format doc `.planning/foundation/endpoints/README.md` is part of the generated artifact, not a separate document.
- **Date:** 2026-09-30
- **Decider:** Aldemir (founder). His picks, verbatim as the orchestrating session relayed them. On 2026-09-29: **"Full row (Recommended)"**, **"Re-anchor by route (Recommended)"**, **"Shape strict, lines soft (Recommended)"** and **"Merge the census in (Recommended)"**. On 2026-09-30: **"Build PR + waived re-cite PR (Recommended)"** and **"Require trace (Recommended)"**. The wording of the questions was not recorded in this lane. Each ruling is restated below from what was built under it.
- **Keywords:** ENDPOINTS.md, routes.json, trace.json, extract_routes.mjs, render_endpoints.py, anchor, line citation, shape check, house scope, assertTenantMatch, census, PR split, file cap waiver
- **Links:** [[0033-design-map-zoomable-atlas]] (generated docs are regenerated, never hand-edited); [[0025-citations-must-disagree-loudly]] (a citation that silently points elsewhere is the defect); [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (the house rule the trace measures); [[0240-register-entries-are-fragments]] (where the findings and claims go); [[0090-pr-audit-gate-autonomous-merge]]. The fix lanes that act on the findings: ADR 0243 (`fix/tenant-guard-and-cross-house-runs`) and ADR 0244 (`fix/order-approval-and-alert-relays`), both in flight at this writing. Findings: `tech-debt.d/2026-09-30-docs-endpoints-regenerate.md`. Claims: `claims.d/docs-endpoints-regenerate.jsonl`.

## Context

`.planning/foundation/ENDPOINTS.md` was written on 2026-08-24 by `scripts/render_system_atlas.py` from a scratch `atlas.json`. The generator could not run in CI, because it read a scratch path and a hard-coded root. Measured on 2026-09-29 at `d80e41e69`, the file held 445 rows for 817 routes, so 374 routes were missing. It had no house-scope column. Its headline "toast … 9 UNGUARDED" was false (`toast.controller.ts` has a class-level `JwtAuthGuard`). The same day's census, `07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md`, graded house scope for the 130 PATCH/PUT/DELETE routes and left the 320 POST and 367 GET routes ungraded. There were 126 `ENDPOINTS.md:<line>` citations across 58 files. Any regeneration would have made each of them point at an unrelated row without any error.

## Rulings

1. **Full row** (2026-09-29). Every route gets one row with an explicit `<a id="<route id>">`: auth mark, guards and flags, role, house scope (verdict, evidence and note), service, data touched, inputs, handler `file:line`, and notes. The file is not a method-and-path list.
2. **Re-anchor by route** (2026-09-29). Every line citation becomes `ENDPOINTS.md#<route id>`, or a section, module or controller anchor. Each one is read against the layout it was written for (121 against `bb14906fc`, 5 against `c0a9196b8`), never mapped by line number alone. A guard then fails any line citation, and any anchor that names no route or section. This lands in PR 2.
3. **Shape strict, lines soft** (2026-09-29). `extract_routes.mjs --check` and `render_endpoints.py --check` mask every `file:line` number and the extraction commit before comparing. An added or removed route fails. So does a changed method, path, guard, flag, access class, role, mount or input. A line that merely moved does not.
4. **Merge the census in** (2026-09-29). The census's grades fold into ENDPOINTS.md's house-scope column and the standalone census retires. This lands in PR 2.
5. **Build PR + waived re-cite PR** (2026-09-30). PR 1 is the build: generator, data, render, this ADR, findings, claims, and one CI step. It stays within the 15-file cap, with no waiver. PR 2 takes a one-PR waiver of the cap. It carries the 58 re-anchored citing files, about 38 prose corrections, the anchor guard with its CI step, and the census merge.
6. **Require trace** (2026-09-30), answering the fork this record first left open. CI runs `render_endpoints.py --check` without `--allow-untraced`, so every route must carry a `trace.json` entry. A PR that adds a route, or renames one, adds or moves its entry: service, role check, house scope with evidence, tables, RPCs, external hops, writes. The rejected path was keeping `--allow-untraced`, under which a new route would pass CI rendering `untraced` and nobody would be asked whether it is house-scoped.

## Method (what the trace data rests on)

- **Extraction.** `scripts/endpoints/extract_routes.mjs` reads every `*.controller.ts` with the TypeScript compiler's parser and walks the module graph from `AppModule`. It exits 2 on any shape it does not understand. Every guard must be classified in `GUARD_KINDS`, so it never guesses. At `5a20d774b` it found 817 routes in 94 controller classes across 91 files: 791 mounted, 18 conditional (`SimposController`) and 8 unmounted (`ContactsController`). By access: 764 JWT, 14 other credential, 39 public and 0 unguarded.
- **Tracing.** `prepare_tracing.py` split the routes into 10 shards of 81–82. A controller file was never split across shards. It also seeded the 130 census routes as hints, never as verdicts. Ten Opus tracers each read one shard at `5a20d774b`. For every route they recorded the service, `role_check`, the house-scope verdict with `path:line` evidence, the tables, RPCs and external hops, and whether the route writes.
- **Adversarial verification.** Five Sonnet verifiers took two shards each. Each re-traced every `unscoped` or `uncertain` route (49 in total) and hunted misses in a seeded sample of 15 routes per shard. The sample pool was `scoped`/`user-scoped` routes that write or take an id param, 150 routes in all. They also spot-checked evidence lines and role checks. Seeds: s01–s02 `random.seed(12)`; s03–s04 `Random(20260929)` (role sample `20260930`); s05–s06 `Random(20260929)`; s07–s08 `Random(20260929)` (role `20260930`, evidence `20261001`); s09–s10 `random.seed(20260929)`.
- **Results.** None of the 49 was refuted. Three severities were restated: org chains read too high; the daily-summary relay and the submissions list were understated. Misses found:
  - `assertTenantMatch` compares only string house names, gateway-wide (`assert-tenant-match.ts:61-62`).
  - The low-stock alert relay.
  - A POS stock idempotency key that carries no house.
  - Ledger poisoning through `deliveryHasBookedOrder`.
  - The extraction route persists foreign provider data.
  - The scrape dedupe works as a cross-house oracle.
  - MCP `prices.compare`.
- **Corrections.** The verifiers listed 46 corrections. 45 were applied after re-reading each cited line; several were narrowed to what the code shows. One was refused: `UpdateCalendarEventDto` carries no `providerId`/`orderId`, and the cited lines belong to a response DTO.
- **Guard-bypass sweep.** A sweep of all 817 routes followed. For every raw `@Query`, DTO field and untyped body that can name a house, it asked whether a validator refuses a non-string. It found 9 routes where the guard's query/body comparison was the only house binding. One became newly `unscoped`; the other 8 were already `unscoped` for other causes. The 17 DTO-validated inputs (`@IsString`/`@IsUUID` under the global `ValidationPipe`) are safe.
- **Counts.** Before corrections: scoped 578 · user-scoped 70 · n/a-read-only-global 45 · global-by-design 39 · public 36 · unscoped 47 · uncertain 2. After: 574 · 70 · 45 · 39 · 36 · **51** · 2. The verifiers' write-ups are scratch; their conclusions live in `trace.json` and in this record.

## Options considered

1. **Regex extraction.** This is what produced the atlas behind the old file, and the census's scratch parser. Decorators span lines, `@Controller` takes a string, an array, an object or nothing, a module can mount another behind a conditional spread, and a comment that quotes `@Post(...)` is not a route. **Rejected:** the old file's headline was false within a month, and a regex guesses where the AST refuses (exit 2).
2. **Line-exact CI.** **Rejected by ruling 3.** Any edit above a route in a controller would fail CI, and every unrelated PR would carry a regeneration commit.
3. **Leave the 126 line citations.** **Rejected by ruling 2.** After regeneration they resolve to unrelated rows with no error. That is the failure ADR 0025 exists to make loud.
4. **One waived PR for everything.** About 75 files in one head. **Rejected by ruling 5.** A generator and 58 prose files are two kinds of review, and one audited head would have to hold both.
5. **Every PR within 15 files.** **Rejected by ruling 5.** The 58 citing files would need at least four PRs. The anchor guard could only switch on after the last of them, so the citations would stay unguarded for the whole train.
6. **Commit the shard plan and the census seed** (`shards.json`, `census-seed.json`). **Rejected in this PR.** They are work allocation for one trace phase, not data. The renderer now reads only the two committed inputs, `routes.json` and `trace.json`, and `prepare_tracing.py --out-dir` regenerates the other two when a new trace phase needs them.

## Decision

`ENDPOINTS.md` is generated, never edited by hand. It comes from `routes.json`, which `extract_routes.mjs` writes from the controllers by AST, and from `trace.json`, one canonical file with one entry per route id, keys sorted, written by reading the code. `render_endpoints.py --merge` folds shard fragments into that file by route id. It refuses a route traced differently in two places, and fragments read at different commits. CI's `gateway-boot` job runs both `--check`s under "shape strict, lines soft", and with no route allowed untraced. Citations name anchors, never lines; that guard ships in PR 2.

## Consequences

- **Easier.** A route's auth, role and house scope are one `grep -n 'id="<route id>"'` away. A controller change that alters shape fails CI until both generators are re-run in the same PR.
- **The window between the two PRs.** From PR 1's merge to PR 2's, the 126 `ENDPOINTS.md:<line>` citations point at the new file's lines, which are the wrong rows. PR 2 is prepared as a patch that applies cleanly to `5a20d774b` and is meant to follow PR 1 immediately.
- **Traces drift with fixes.** Each fix lane that changes a traced route must re-trace that route's entry in `trace.json`. That covers ADR 0243 (tenant guard, `clocks/run`, `execute-check`) and ADR 0244 (order PATCH, alert relays). Whichever of PR 1 and a fix lane merges second re-runs the extractor and the renderer.
- **Harder.** A PR that adds or renames a route must add or move its `trace.json` entry (ruling 6). That means reading the route through to its writes before merge, about a minute per route. CI refuses the PR otherwise.
- **Revisit if** `extract_routes.mjs` exits 2 on a new decorator shape more than once a month (the AST has fallen behind the codebase), or `trace.json` entries are found stale against their `traced_at_commit` (the file then needs a re-read at one new commit).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `docs/endpoints-regenerate` (PR 1 of 2) |
| 2026-09-30 | Aldemir (founder) | F1 answered, "Require trace (Recommended)"; ruling 6 added, fork section removed, ruling dates recorded |
