---
type: format
title: ENDPOINTS.md — generator, data files and trace schema
status: live
updated: 2026-09-30
---

# How `ENDPOINTS.md` is built

[`../ENDPOINTS.md`](../ENDPOINTS.md) is **generated**. It is two layers merged
by one renderer; never hand-edit it, regenerate it.

| Layer | File | Written by | Says |
|---|---|---|---|
| mechanical | `routes.json` | `node scripts/endpoints/extract_routes.mjs` | every route the controllers declare: method, path, `file:line`, class, handler, guards, flags, `@Roles`, inputs, mount status |
| traced | `trace.json` | a person or agent reading the code | what each route does: service, role check, house scope, tables, RPCs, external calls, writes |

Those two committed files are the renderer's only inputs, so a render is a
function of the tree. A trace phase also uses two work-allocation files that
are **not committed** (ADR 0245) — `prepare_tracing.py` regenerates them:
`shards.json` (ten shards of ~82 routes; a controller file is never split) and
`census-seed.json` (the 2026-09-29 PATCH/PUT/DELETE census verdicts as hints,
with `file:line`s at the census commit `71ae5449b` — hints, never verdicts).

```sh
node scripts/endpoints/extract_routes.mjs           # routes.json from the controllers
python3 scripts/endpoints/render_endpoints.py       # ENDPOINTS.md from routes.json + trace.json
python3 scripts/endpoints/render_endpoints.py --validate   # check trace.json only
python3 scripts/endpoints/prepare_tracing.py --out-dir <scratch>   # trace phase only: shards.json + census-seed.json
python3 scripts/endpoints/render_endpoints.py --merge <scratch>/s*.json   # fold shard fragments into trace.json
```

Checks (exit 0 ok, 1 finding, 2 cannot check):

```sh
node scripts/endpoints/extract_routes.mjs --check                  # routes.json matches the code
python3 scripts/endpoints/render_endpoints.py --check              # ENDPOINTS.md matches a fresh render AND every route is traced
python3 scripts/endpoints/render_endpoints.py --check --allow-untraced   # local only, mid-trace
```

**Shape strict, lines soft** (founder ruling 2026-09-29). Both checks mask every
`file:line` number (and the extraction commit) before comparing: an added or
removed route, or a changed method, path, guard, flag, access class, role,
mount or input fails; a line that merely moved does not. Running the two
generators refreshes the numbers. Both run in CI (`gateway-boot` job).

**Every route is traced** (founder ruling 2026-09-30, "Require trace"). CI runs
`render_endpoints.py --check` without `--allow-untraced`, so a PR that adds a
route, or renames one (its id changes), adds or moves that route's
`trace.json` entry in the same PR. `--allow-untraced` exists only for a local
render in the middle of a trace phase.

## Citing a route

Cite **the anchor, never a line number**: `ENDPOINTS.md#post-auth-me-leave-restaurant`.
Every row carries `<a id="<route id>"></a>`; find it with
`grep -n 'id="post-auth-me-leave-restaurant"' .planning/foundation/ENDPOINTS.md`.

The id is `METHOD + path` without the global prefix, lower-cased, `:param` →
`param`, `*` → `wildcard`, every other run of non-alphanumerics → `-`
(`POST /auth/me/leave-restaurant` → `post-auth-me-leave-restaurant`). It changes
only when the route's method or path changes. Two routes with one id make the
extractor exit 1 — a citation must never be ambiguous.

Anchors that are not routes, for citing a whole section: `verification`,
`global-guards`, `trace-progress`, `needs-attention`, `legend`, `modules`;
`module-<dir>` per feature directory (`module-procurement`); and
`controller-<name>` per controller class, from the class name without
`Controller`, kebab-cased (`HouseMailArchiveController` →
`controller-house-mail-archive`). `render_endpoints.anchors()` is the list.

## `routes.json`

One route per line, sorted by path then method. Always present: `id`, `method`,
`path`, `at` (the verb decorator's `file:line`), `class`, `handler`,
`controller_at` (the `@Controller` line), `mount` (`mounted` · `conditional` ·
`unmounted`), `access` (`jwt` · `credential` · `public` · `none`). Present only
when non-empty: `mount_condition`, `credentials`, `access_note`, `env_gate`,
`guards` / `flags` (`Name@class|method`), `roles` (`{roles, level, enforced}` —
`enforced` false means `@Roles` with no `RolesGuard`), `rate_limit`,
`http_code`, `params`, `query`, `query_dto` / `body` (`{type, file}`),
`body_fields`, `other_inputs` (`CurrentUser`, `Req`, `Headers(x)`, …),
`decorators_other`, `host`, `version`.

`access` is computed, not read from a comment: a guard that ignores `@Public()`
(service key, MCP house key, relay door) makes it `credential`; else `@Public()`
makes it `public`; else `JwtAuthGuard` makes it `jwt`; else `none` (UNGUARDED).
Every guard name must be classified in `GUARD_KINDS` in the extractor — an
unclassified guard is exit 2, not a guess. Global guards (`APP_GUARD` in any
module, `useGlobalGuards` in `main.ts`) are recorded once in the header.

## Trace file — `trace.json`

One file, one entry per route id. It is kept in **canonical form** — every
object's keys sorted, indent 1, UTF-8, trailing newline — and `--validate`
refuses any other byte form, so two edits never differ by key order.
`render_endpoints.py --merge` writes that form: with shard fragments as
arguments it folds them in by route id (a route already traced *differently*,
or fragments read at different commits, is refused, never overwritten); with
none it only rewrites the file canonically after a hand edit.

The shape (shown with keys in reading order; the file itself sorts them):

```json
{
  "schema": 1,
  "traced_at_commit": "5a20d774b",
  "routes": {
    "post-auth-me-leave-restaurant": {
      "service": "apps/api-gateway/src/auth/auth.service.ts:4441 AuthService.leaveRestaurant",
      "role_check": { "kind": "none", "evidence": null },
      "house_scope": {
        "verdict": "user-scoped",
        "evidence": ["apps/api-gateway/src/auth/auth.service.ts:4450"],
        "note": "removes the caller's own membership row"
      },
      "tables": ["user_restaurant_access"],
      "rpcs": [],
      "external": [],
      "writes": true,
      "notes": ""
    }
  }
}
```

Shape only: the `service` line is real at `5a20d774b`; the verdict, evidence and
tables are placeholders, not a trace of this route.

Every `file:line` is **at `traced_at_commit`** — record the commit you read.
The file has one `traced_at_commit`, so re-trace an entry at that commit, or
re-read the whole file at a new one; `--merge` refuses fragments read at
another commit.

| Key | Required | Meaning |
|---|---|---|
| `service` | yes | `path:line Class.method` of the service method the handler hands the work to; `inline` when the handler does the work itself |
| `role_check.kind` | yes | `none` — any authenticated member may call · `owner-manager` — owner or manager only (`@Roles` + `RolesGuard`, or a service-level assert) · `role-list` — another explicit list, given in `roles` · `custom` — any other authority rule (platform operator, authority grant, membership lookup) |
| `role_check.evidence` | yes unless `none` | `path:line` of the check |
| `house_scope.verdict` | yes | see below |
| `house_scope.evidence` | yes | list of `path:line`; non-empty for `scoped`, `user-scoped`, `unscoped`, `global-by-design` |
| `house_scope.note` | for `uncertain` | what is uncertain, or anything a reader needs |
| `tables` | yes | tables read or written (`[]` if none) |
| `rpcs` | yes | SQL functions called via `.rpc()` |
| `external` | yes | hops outside the gateway: `orchestrator`, `gmail`, `stripe`, `expo-push`, `anthropic`, … |
| `writes` | yes | `true` when the route can change state anywhere — a row, a stored file, or an outside effect such as sending mail |
| `notes` | no | anything else worth a reader's attention |

House-scope verdicts:

| Verdict | Means |
|---|---|
| `scoped` | every house-owned row it touches is filtered by the caller's house (the token's house, or a house id `JwtAuthGuard` → `assertTenantMatch` matched — a path id always, a query or body id only when the value is a string: arrays and other non-strings are skipped, `assert-tenant-match.ts:61-62`, so a query/body house counts only behind a DTO `@IsString`/`@IsUUID` under the global `ValidationPipe`), or a house-filtered read proves ownership before a write keyed to that row |
| `user-scoped` | the rows are the caller's own, filtered by the token's user id |
| `public` | deliberately reachable without a user credential, and safe for that: the evidence is what stands in for it (signature check, bearer token in the path, a catalogue meant to be public) |
| `global-by-design` | reads or writes platform rows that belong to no house, and is meant to (operator tooling, reference registers) |
| `unscoped` | touches house-owned rows by id alone, without the house filter — a **finding** |
| `n/a-read-only-global` | read-only over data that belongs to no house (health, static reference lists) |
| `uncertain` | could not be settled from the code; `note` says why |

A tracer seeded from `census-seed.json` still cites what it read at
`traced_at_commit`, never the census's lines.

The renderer rejects (exit 1) an entry with an unknown key, a verdict or kind
outside these lists, a malformed `path:line`, a route id that is not in
`routes.json` — so a renamed route cannot keep a stale trace — or a
`trace.json` that is not in canonical form.
