# Open-decision register audit — 2026-08-26

> **Read-only audit.** Nothing here was fixed; corrections are written out so a
> reviewer can apply them. No file outside this one was changed.
>
> **Retire-to-write (CLAUDE.md §4):** this document retires *itself*. It is a
> point-in-time verification, not a standing reference — delete it once its
> corrections have been applied to `OPEN-DECISIONS.md`.
>
> **Owed, and not done here:** CLAUDE.md §4 requires an index entry for a new
> long-form doc. This audit was scoped to write exactly one file and edit nothing
> else, so `.planning/00-index/` was left untouched. Whoever applies these
> corrections should add the entry, or delete this file and skip it.

## Method and base

- Worktree base commit **`e17bde5f`**. **`origin/main` moved to `493fe3fa` during
  this audit** ("docs(decisions): retire 7 stale Open rows…", #80), which removed
  exactly the seven duplicate rows this audit had independently flagged
  (OD-61, 62, 63, 82, 83, 84, 85). Those seven are recorded in §4 for the record;
  **no action is needed on them.** Everything else was verified against `e17bde5f`,
  which is byte-identical to `493fe3fa` outside `OPEN-DECISIONS.md`
  (`git diff --stat e17bde5f 493fe3fa` → 1 file, 1 insertion, 8 deletions).
- Production checked through the PostgREST API with the service-role key from
  repo-root `.env`. No secret value appears in this document.
- `scripts/check_decision_claims.sh` was run: **64 claims checked, 64 holding.**
  The guard passing is not evidence an entry is right — three entries below are
  wrong in ways no claim in `CLAIMS.jsonl` covers.
- **Deliberately skipped (CLAUDE.md §0.5):** the Python test suite was not run.
  Another session is editing `services/agent-orchestrator/` concurrently and the
  instruction for this audit was not to touch that tree; OD-88 is therefore
  verified by source citation, not by an observed skip. `pnpm install` was not run
  in this worktree either, which is what blocks the exact count under OD-33.

---

## 1. Summary

| ID | Verdict | One-line finding |
|---|---|---|
| OD-01 | HOLDS | Fork open. 28 top-level `.planning/*.md` confirmed; the legacy counts drifted (`md/` **115** files not 120, `md_files/` **3** not 47). |
| OD-03 | HOLDS | No ADR selects an orchestration base; OD-52 still reframes it. |
| OD-04 | **WRONG** | Every literal count in the census is stale, and "three retired names are failing in production today" is no longer true — OD-57's sweep landed. |
| OD-05 | HOLDS | No ADR names the audience. |
| OD-06 | HOLDS | No ADR; no bake-off artifact in the repo. |
| OD-07 | HOLDS | No ADR. |
| OD-18 | HOLDS | Still founder-deferred. |
| OD-19 | **WRONG** | "94 of 137 unguarded" describes a codebase that no longer exists: **458** route decorators, **419** on class-guarded controllers, **39** on five controllers without one — mostly deliberate. |
| OD-23 | HOLDS (citation wrong) | The quote is at `PROJECT.md:66`, not `:135`. Claim intact. |
| OD-25 | HOLDS | Both owners still stand: `foundation/README.md:272` (Research & Math) vs `foundation/teams/technology.md:495-498` (Skill Lifecycle). |
| OD-26 | HOLDS (numbers moved) | Asymmetry **widened**: 23 files name a split trigger vs 6 a merge/retirement trigger under `.planning/01-org/`. |
| OD-29 | HOLDS | `teams/technology.md` §3.3 still carries the routing mandate *and* "NF-A `cost_per_task` by task type" as its primary metric. |
| OD-31 | **WRONG** (half STALE) | All four headcounts changed, the `agent_registry.py:337` citation is wrong, and the silent-`{}` spec defect is **fixed**. |
| OD-33 | HOLDS | Both citations exact (`insight-catalog.ts:547`, `insight-catalog.spec.ts:10`). Exact candidate count unverifiable here — see §5. |
| OD-37 | **STALE** | Both remediations already landed: the `:156-157` docstring is gone and the memory carries the 2026-08-24 correction. |
| OD-39 | **STALE** | Toast now fails closed on a missing signature (`toast/toast.service.ts:217-233`). |
| OD-40 | **STALE** | `pos-hub.controller.ts:45` carries a class-level `@UseGuards(JwtAuthGuard)`. |
| OD-43 | HOLDS | Same measurement as OD-26 — and OD-43 is a duplicate of OD-26 in substance. |
| OD-46 | HOLDS (numbers wrong) | **485** loops, not 482; **5** active+running, not 4; gated is 4, not 2. |
| OD-49 | **STALE** | `schema-parity` runs **green on `main`**; the workflow prefers the `SUPABASE_POOLER_URL` secret that already exists. The founder action is obsolete. |
| OD-51 | UNVERIFIABLE | Fork is open (no ADR), but "0 of 17 Pro tiers complete" needs a per-scenario §10 audit — see §5. |
| OD-52 | HOLDS | `core/base_agent.py` has exactly one `completion` hit, at `:400`, in a shutdown log. Zero LLM imports. |
| OD-53 | UNVERIFIABLE | Claims about third-party APIs; nothing in the repo can settle them — see §5. |
| OD-56 | UNVERIFIABLE (half HOLDS) | 15 Dependabot PRs confirmed, `pnpm.overrides` still carries no security pin — but **Dependabot alerts are DISABLED on the repo**, so the "9 open CVEs" premise is no longer observable. |
| OD-57 (✅ row) | **STALE placement** | Marked resolved 2026-08-24 and still sitting in the **Open** table, along with its two struck-through originals. |
| OD-58 | HOLDS | Confirmed: `nf_readout.py:339` returns `EXIT_OK` unless `--require-volume`; only `events == 0` withholds a number (`:299-303`). |
| OD-60 | HOLDS | `.gitignore:71-73` exact; globs still cover only `* 2.py` / `* 2.md`. |
| OD-64 | **WRONG** (one fact) | `pos_checks` has **66 rows**, not 0. Everything else in the entry checks out. |
| OD-65 | HOLDS — and is a duplicate of OD-67 | `pos-hub.service.ts:570-587`; the code documents the defect in place. |
| OD-66 | HOLDS (citation wrong) | The `?? "bottle"` moved to `toast/toast.service.ts:520`; `:502` is now an unrelated insert. |
| OD-67 | HOLDS — and is a duplicate of OD-65 | Same lines, same defect, two IDs. |
| OD-68 | HOLDS | `provider_important_dates` → **HTTP 404** from production. |
| OD-76 | HOLDS (citation wrong, defect sharper) | The fabricated vector is at `:1265-1270` — the **live** failure path. `:1238` is a blank line ending the legitimate mock branch. |
| OD-77 | HOLDS — and understates it | Confirmed personal-account posture; **plus an untracked service-account key at the repo root that no `.gitignore` rule covers.** |
| OD-78 | **WRONG** | Production returns **401** to an unsigned Gmail push, and all three vars are set in `.env`. Enforcement is ON, not staged open. |
| OD-80 | **WRONG** (the blocker is gone) | The calendar retirement **has landed on `main`** — `pages/Calendar.tsx` and `EntityAutocomplete.tsx` no longer exist, so nothing blocks the cleanup. |
| OD-88 | HOLDS (citation off by one) | Autouse session fixture is at `conftest_prod.py:218`, `prod_supabase` skips at `:199-203`, `prod_e2e` marker exists at `pytest.ini:12`. |
| OD-89 | HOLDS | Verified exactly: two `writeFileSync`, boot-time write at `main.ts:154-156`, and `grep -c sale-unit openapi.json` → **0** against three live routes. |
| OD-91 | **WRONG** | A `staff` role **does** exist; "6 of 10 restaurants have only `owner`" is wrong — **6 of 10 have no users at all**; and all 10 are active (3 were soft-deleted at 10:00Z and **restored at 10:26Z** on the founder's instruction). |
| OD-92 | HOLDS | 10 `@Cron`s, **8** pinned to `America/New_York`; `restaurants.timezone` holds exactly the 3 claimed values. |
| OD-81 *(in Resolved)* | **WRONG** | "`scheduled_reports` has zero readers" — it has **three** call sites, and the table **does not exist in production**. Row is also malformed. |
| OD-61/62/63/82/83/84/85 | STALE — **already fixed** | Duplicate Open rows; removed by `493fe3fa` mid-audit. No action. |

**Counts:** HOLDS 25 · WRONG 8 · STALE 5 (plus the 7 auto-retired) · UNVERIFIABLE 3.

---

## 2. WRONG — evidence and corrected text

### OD-78 — Gmail push enforcement is ON, not staged open

**The entry claims** the pair is unset "in `.env`, `.env.local`, `.env.sim` and on
Railway (verified 2026-08-25), so the endpoint accepts unverified pushes and logs
an error per request".

**Evidence.**

```
$ curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://wineopsapi-gateway-production.up.railway.app/api/v1/communications/webhooks/gmail \
    -H 'Content-Type: application/json' -d '{"message":{"data":"","messageId":"audit-probe"},"subscription":"audit-probe"}'
401
```

Repo-root `.env` carries all three keys with non-empty values
(`GMAIL_PUBSUB_AUDIENCE` 89 chars, `GMAIL_PUBSUB_SERVICE_ACCOUNT` 62 chars,
`GMAIL_PUBSUB_REQUIRE_AUTH=true`). Values withheld.

**One correction to the inference, not just the entry.** A 401 does **not** prove
the Pub/Sub pair is set. `gmail-push-auth.service.ts:75-83` returns `false` — a
401 — when the pair is *absent* and `GMAIL_PUBSUB_REQUIRE_AUTH=true`. Both branches
mean the door is shut; only one means verification is genuinely running. Which one
is live on Railway could **not** be determined: `railway status` with the
`RAILWAY_TOKEN` from `.env` returns *"Invalid RAILWAY_TOKEN"*, so the Railway side
of this entry (and of the "check `railway status` after every merge" memory) is
currently unverifiable from this repo.

**The entry's own guard misses this.** `CLAIMS.jsonl` line for OD-78 greps
`.env.example` — a file that has nothing to do with what production runs.

**Corrected text.**

> OD-78 · 🟢 **Gmail push enforcement is ON in production — verified 2026-08-26.**
> An unsigned `POST /api/v1/communications/webhooks/gmail` returns **401**.
> `.env` carries `GMAIL_PUBSUB_AUDIENCE`, `GMAIL_PUBSUB_SERVICE_ACCOUNT` and
> `GMAIL_PUBSUB_REQUIRE_AUTH=true`. **Still to confirm:** which branch produces the
> 401 — full OIDC verification (pair set) or the fail-closed flag with the pair
> absent (`gmail-push-auth.service.ts:75-83`). Both are safe; only the first is
> verification. The `RAILWAY_TOKEN` in `.env` is rejected by the CLI, so this needs
> a working Railway credential or one line of production log. The executable claim
> must stop testing `.env.example`, which cannot see production either way.

### OD-91 — the tenant/role facts it rests on are wrong, in both directions

**The entry claims** "No flag rows exist", "production has **no `staff` role at
all**", "**6 of 10 restaurants have only `owner`**", and (inherited from OD-87)
that all 10 are `is_active = true` with none soft-deleted — which, after a soft-delete and a restore on 2026-08-26, is **true again** as of 10:26Z.

**Evidence** (production, 2026-08-26):

- `users` → 10 rows: **6 `owner`, 3 `manager`, 1 `staff`.** A `staff` role exists.
- The one `staff` account is `sim-staff@wineops.internal`, `restaurant_id = NULL`
  (one of three `sim-*@wineops.internal` accounts created 2026-07-27, all unattached).
- Users group onto only **4** restaurant ids. So **6 of 10 restaurants have zero
  users**, 2 have `owner` only, 2 have `manager` + `owner`.
- `restaurants` → 10 rows, **all active, none soft-deleted**. *Gullit's Tavern*,
  *Yaren's Fine Dine* and the duplicate *Meyhouse Palo Alto* were soft-deleted at
  `2026-08-26T10:00:02Z` and **restored at 10:26Z** when the founder said to keep
  them. This audit was written against the window in between; the register entry's
  original claim stands. `is_active` still distinguishes nothing.
- `restaurant_feature_flags` → **1 row**, not zero: `self_evolution`
  (`enabled = false`) on the default restaurant, created 2026-03-04. There is no
  `scheduled_communications` row, which is what the entry actually depends on.

**Why this matters more, not less.** The recipient-resolver risk the entry names is
*worse* than described: six restaurants resolve zero recipients no matter which
roles a job asks for, because they have no members at all — adding `owner` to the
role list, the mitigation the entry floats, fixes nothing for those six.

**Corrected text.**

> OD-91 · 🟠 **FOUNDER'S CALL — do existing tenants get scheduled communications by
> default, or stay opted in explicitly?** Shipped gated: `ScheduledTenantsService`
> serves `DEFAULT_RESTAURANT_ID` ∪ restaurants flagged `scheduled_communications`.
> **No `scheduled_communications` flag row exists** (the table holds exactly one row,
> a `self_evolution` flag on the default restaurant), so behaviour is unchanged.
> **Production shape, re-measured 2026-08-26:** 10 restaurants, **all active** — a
> soft-delete of 3 was reverted the same hour, so `is_active` still separates
> nothing. **6 of the 10 have no user rows at all** and therefore resolve zero
> recipients regardless of the role list; 2 carry `owner` only and 2 carry
> `manager` + `owner`. A `staff` role **does** exist, but only on
> `sim-staff@wineops.internal`, which has `restaurant_id = NULL` — so no tenant has
> a staff member. Adding `owner` to the requested roles would change who gets mail
> at the existing tenant and would still leave the six memberless restaurants silent.

### OD-19 — the endpoint census describes a codebase two guard-sweeps ago

**The entry claims** "the **94** endpoints unguarded by omission (137 total − 32
webhook-module − 11 explicit `@Public()`)".

**Evidence** (census over `apps/api-gateway/src/**/*.controller.ts`, 47 files,
excluding specs; script preserved in the audit scratchpad):

- **458** route decorators total, **16** `@Public()`.
- **419** routes sit on controllers carrying a class-level `@UseGuards`.
- **39** routes sit on the five controllers without one:
  `auth` (28 routes, 7 `@Public`, 16 method-level guards),
  `integrations-oauth` (5 / 1 / 4), `events` (3 / 1 / 2),
  `common/orchestrator/inbound-email` (1 route, `@Public` webhook),
  `vendor-portal` (2 routes, both `@Public`).

**Also stale, in the document the entry cites.** `foundation/ENDPOINTS.md:19-21`
still records a 🔴 open finding that `toast/toast.controller.ts` has no class-level
`@UseGuards` and that "9 are genuinely unguarded tenant data". It does now:
`toast/toast.controller.ts:63` is `@UseGuards(JwtAuthGuard)` with only
`@Post("webhook")` marked `@Public()` (`:80-81`).

**Corrected text.**

> OD-19 · **Security classification — re-measured 2026-08-26.** The gateway now
> serves **458** route decorators across 47 controllers; **419** are on
> class-guarded controllers and **39** are not, spread over five files
> (`auth`, `integrations-oauth`, `events`, `inbound-email`, `vendor-portal`),
> where 16 `@Public()` markers and 22 method-level `@UseGuards` account for most of
> the remainder. The "94 unguarded by omission" figure and
> `foundation/ENDPOINTS.md`'s 🔴 Toast finding both predate the pos-hub, Toast and
> analytics guard fixes and should be struck. What is still worth a security pass is
> narrow: enumerate the residual routes on those five controllers and confirm each
> is public by intent.

### OD-31 — all four headcounts are wrong and half the defect is fixed

**The entry claims** "19 specs / 23 registered / 24 (`PROJECT.md:33`) / 26 on disk",
"3 unregistered `BaseAgent` subclasses with zero call sites", and "4 registered
agents resolving spec from a silent `{}` at `core/agent_registry.py:337`".

**Evidence.**

- `services/agent-orchestrator/agents/*.py` → **24** files; **23** declare a
  `BaseAgent` subclass.
- `core/orchestrator.py` class map → **23** agents (a 24th regex hit,
  `enable_opus_review`, is a config key, not an agent).
- `DEFAULT_AGENT_SPECS` → **23** entries; the symmetric difference against the class
  map is empty.
- Unregistered `BaseAgent` subclasses: **none**. The only unregistered agent file is
  `agents/recurring_order_agent.py:14`, whose `RecurringOrderAgent` is a **plain
  class**, not a `BaseAgent`, referenced only by its own factory (`:387`) and its own
  test.
- `PROJECT.md:33` is the milestone heading. The count lives at **`PROJECT.md:51`**
  ("~24 agents at mixed maturity").
- `core/agent_registry.py:337` is `"description": self.spec.description` inside a
  status dict. **The silent-`{}` defect is fixed**: `register_from_defaults`
  (`agent_registry.py:379-400`) now raises when a class has no spec or its spec omits
  `tier`, and says so in a comment naming the exact failure the entry describes.

**Corrected text.**

> OD-31 · **Agent headcount still has no single source, but the spread has narrowed
> and the registry defect is closed.** Re-measured 2026-08-26: **24** agent files,
> **23** `BaseAgent` subclasses, **23** registered in `core/orchestrator.py`'s class
> map, **23** `DEFAULT_AGENT_SPECS` entries (symmetric difference empty), against
> "~24" in `PROJECT.md:51`. The only unregistered agent file is
> `agents/recurring_order_agent.py`, whose `RecurringOrderAgent` is a plain class
> rather than a `BaseAgent` — reachable only from its own factory and test.
> **Closed, not open:** the silent-`{}` spec fallback is gone —
> `agent_registry.py:379-400` raises at boot on a missing spec or a spec without
> `tier`. What remains is the documentation question: one authoritative count, and a
> decision on `recurring_order_agent`.

### OD-04 — the model-literal census no longer describes the repo

**The entry claims** `gemini-2.5-flash` ×32, `gemini-2.0-flash` ×20,
`gemini-pro` ×17, `claude-haiku-4-5` ×18, `gpt-4-turbo-preview` ×3,
`gemini-3.6-flash` ×2, "~90 sites", and that "three retired names are failing in
production today".

**Evidence** (occurrences across `apps services packages scripts`, excluding
`node_modules`/`.git`/`.planning`/`md`/`md_files`):

| literal | entry | measured 2026-08-26 |
|---|---|---|
| `gemini-2.5-flash` | 32 | **59** |
| `gemini-2.0-flash` | 20 | **9** |
| `gemini-pro` | 17 | **3** |
| `claude-haiku-4-5` | 18 | **34** |
| `gpt-4-turbo-preview` | 3 | **2** |
| `gemini-3.6-flash` | 2 | **5** |
| *(not in the entry)* `gpt-4o` | — | 6 |
| *(not in the entry)* `claude-sonnet-4` | — | 9 |

All **three** remaining `gemini-pro` occurrences are inert:
`calendar_agent.py:214` and `sommelier_agent.py:44` are comments recording the
retirement, and `spend_logger.py:163` is a historical price row. The "failing in
production today" clause is no longer true — OD-57's sweep closed it.

**Corrected text.** Keep the fork (a job → model registry is still undecided and
still unbuilt); replace the census paragraph with the table above and delete the
"three retired names are failing in production today" sentence, which OD-57 resolved
on 2026-08-24.

### OD-64 — `pos_checks` is not empty

**The entry claims** "`pos_checks` has 0 rows, so whichever POS lands first defines
what the analytics layer has ever seen."

**Evidence.** `pos_checks` → **66 rows**, all
`source = 'generic_webhook'`, all on the default restaurant
(`550e8400-e29b-41d4-a716-446655440000`), `external_check_id` prefixed `P3PROOF-`,
`imported_at` 2026-08-24. So the table is populated — with proof fixtures through
the provider-neutral door, not with real POS traffic.

**Everything else in the entry verified.** `TOAST_WEBHOOK_SECRET` and
`TOAST_API_KEY` are absent from `.env`, `.env.local` and `.env.sim`;
`TOAST_CLIENT_ID` / `TOAST_CLIENT_SECRET` are present; all **10** restaurants
declare `pos_system = 'toast'`; exactly **one** carries `pos_credentials`
(*Meyhouse Palo Alto*, a `restaurant_guid`).

**Corrected text.** Replace "`pos_checks` has 0 rows" with:

> `pos_checks` holds **66 rows** — every one a `generic_webhook` `P3PROOF-*` fixture
> on the default restaurant, imported 2026-08-24. The analytics layer has therefore
> only ever seen the provider-neutral shape, which strengthens rather than weakens
> the provider-neutral option: it is the door that has actually carried traffic.

Also note the citation drift: `toast.service.ts` lives at
`apps/api-gateway/src/toast/`, not `pos-hub/`, and the fail-closed logic the entry
points at `:113` is now at `:117-119` (`enforceSignature`) and `:217-233`.

### OD-80 — the branch blocker is gone; the cleanup is unblocked on `main`

**The entry claims** it is "**Blocked on branch, not on a decision** … no part of
this can land `tsc`-green on any branch where `Calendar.tsx` still exists", verified
on `claude/heuristic-gould-b86f4d`.

**Evidence** on `origin/main`: `apps/web/src/pages/Calendar.tsx` and
`apps/web/src/components/shared/EntityAutocomplete.tsx` **do not exist**. The
retirement has landed.

Re-checked with the retirement in place:

- `apps/web/src/types/companyClass.ts` exports exactly **25** names; a whole-word
  grep for each across `apps/web/src`, `apps/mobile` and `packages` finds **zero**
  consumers outside the file itself and `types/index.ts`. The file (743 lines) is
  fully dead **now**, not conditionally.
- `types/index.ts` re-export blocks close at `:83` and `:102`, matching the entry's
  `:71-102` range.
- `data/customEventTypes.ts`: `isCustomEventType` `:68`, `getCustomEventTypeByName`
  `:76`, `EVENT_TYPE_COLORS` `:92` — **all three have zero consumers**;
  `isEventTypeNameAvailable` `:84` and the four exports `EventModal.tsx` imports
  survive. `CalendarPage.tsx:43` declares its own local `EVENT_TYPE_COLORS`, which
  must survive — confirmed a separate `const`, not an import.

**Corrected text.** Strike the "Blocked on branch" clause and replace with:

> **Unblocked as of 2026-08-26.** The retirement is on `main`; `Calendar.tsx` and
> `EntityAutocomplete.tsx` are gone, and `types/companyClass.ts` is now
> unconditionally dead (25 exports, 0 consumers outside `types/index.ts`). Apply the
> three deletes on a branch off `main`, verify with
> `cd apps/web && npx tsc --noEmit && npx vitest run`, then flip both CLAIMS entries
> to `resolved`.

### OD-81 *(sitting in the Resolved table)* — "zero readers" is wrong, and the row is malformed

**The entry claims** "`scheduled_reports` (`reports.service.ts:147-179`) has **zero
readers**".

**Evidence.** `apps/api-gateway/src/reports/reports.service.ts` touches
`scheduled_reports` at **three** call sites — an `.insert()` at `:165`, a
`.select()` at `:185`, and a `.delete()` at `:208`. What it lacks is the **table**:

```
scheduled_reports: HTTP 404  Could not find the table 'public.scheduled_reports' in the schema cache
```

The migration that would create it is
`services/database/migrations_archive/008_providers_and_reports.sql`, outside the
live chain (§3). So three reachable gateway endpoints throw against production —
strictly worse than the dead code the entry describes.

**Two structural problems with the row itself.** It sits in the **Resolved** table
carrying four cells against a three-column header (`ID | Resolved as | Date`), so it
has no date and its "Resolved as" cell still contains the original *open* text.

**Corrected text** (as a Resolved row, three cells):

> OD-81 · ✅ **Resolved 2026-08-26 — and the entry's central claim was backwards.**
> `scheduled_reports` does not have zero readers: `reports.service.ts` inserts
> (`:165`), selects (`:185`) and deletes (`:208`) against it. It has no **table** —
> production returns 404, because
> `services/database/migrations_archive/008_providers_and_reports.sql` was never
> applied. Report scheduling is not dead code, it is three endpoints that 500.
> `generated_reports` does exist and holds **0** rows, so the "empty archive by
> construction" half stands. | 2026-08-26

---

## 3. Migrations outside `supabase/migrations/`, checked against production

This is the recurring root cause named in the audit brief. **136** `.sql` files live
outside the live chain — 105 in `supabase/migrations_archive/`, 16 in
`services/database/migrations_archive/`, 8 in `Supabase_SQL_Files/`, 5 under
`md/`+`md_files/`, 2 in `scripts/`. **92** of them declare at least one table.

Every `CREATE TABLE` / `CREATE VIEW` target was extracted and checked against the
production PostgREST schema (232 exposed relations), then each absent object was
re-probed directly for an HTTP status.

### 3a. Absent from production **and** referenced by live code — act on these

| Object | Declared in | Production | Live reader |
|---|---|---|---|
| `integration_oauth_connections` | `supabase/migrations_archive/20260730120000_integration_oauth_connections.sql` | **404** | `apps/api-gateway/src/integrations/integrations-oauth.service.ts:435,465,478,512,534,586` |
| `integration_oauth_states` | same file | **404** | `integrations-oauth.service.ts:146,323,651` |
| `scheduled_reports` | `services/database/migrations_archive/008_providers_and_reports.sql` | **404** | `apps/api-gateway/src/reports/reports.service.ts:165,185,208` |
| `push_subscriptions` | `supabase/migrations_archive/20260208024921_baseline_schema.sql` | **404** | `apps/api-gateway/src/communications/recipient-resolver.service.ts:275`; `services/agent-orchestrator/agents/notification_agent.py:1579` (in `_get_push_subscriptions`, `:1575`, called from `:543,624,710,781`) |
| `provider_ratings` | `…/008_providers_and_reports.sql` + baseline | **404** | `apps/api-gateway/src/providers/providers.service.ts:589` |
| `notification_logs` | baseline | **404** | `services/agent-orchestrator/agents/notification_agent.py:1602` |
| `pos_webhook_logs` | baseline | **404** | reporting agent + `tests/e2e/wave_d_toast_pipeline.py`; asserted by `tests/test_reporting_agent_bugs.py:235` |

`integration_oauth_connections` / `integration_oauth_states` are the sharpest of
these and appear **nowhere in the register**: nine call sites in a shipped gateway
service, against a migration dated 2026-07-30 that predates — and therefore was not
captured by — the 2026-08-05 `baseline_from_production` snapshot. This is the exact
shape of `restaurant_feature_flags` (OD-86) and `scheduled_reports` (OD-81), found a
third and fourth time.

`push_subscriptions` is the one with a live blast radius on a path that already
matters: `recipient-resolver.service.ts` is the service OD-87/OD-91 turn on.

### 3b. Absent from production, referenced only by TODOs, seeds or tests — record, don't build

| Object | Declared in | Only reference |
|---|---|---|
| `anomaly_patterns`, `shrinkage_alerts`, `staff_correlation_data` | `services/database/migrations_archive/009_p1_agent_tables.sql` + baseline | `agents/shrinkage_detective_agent.py:40-41` — `# TODO` comments |
| `auto_pilot_rules`, `auto_pilot_executions` | 009 + baseline | `agents/auto_pilot_agent.py:40,42` — `# TODO` |
| `compliance_deadlines`, `compliance_reports`, `excise_tax_records` | 009 + baseline | `agents/compliance_agent.py:40-41` — `# TODO` |
| `inventory_discrepancies`, `inventory_trust_scores`, `camera_movement_logs` | 009 + baseline | `agents/ghost_inventory_agent.py:41-43` — `# TODO` |
| `negotiation_tactics`, `provider_price_patterns` | 009 | `agents/negotiation_playbook_agent.py:41-42` — `# TODO` |
| `provider_important_dates` | baseline only | `scripts/seed_database.py:927-957`, guarded by `_table_exists` — **this is OD-68** |
| `bottle_specifications` | `supabase/migrations_archive/20260208030000_wine_specific_tables.sql` | `scripts/seed_database.py:733-762`, guarded by a probe |
| `restaurant_addresses` | `supabase/migrations_archive/20260507000002_restaurants_location_fields.sql` | **no references at all** |
| `pending_ai_approvals` (view) | `md/02-architecture/migrations/001_add_conversation_approval_fields.sql` | none |
| `v_restaurants_lookup` (view) | `scripts/fix_uuid_migration.sql` | none |

Note `negotiation_history` is a **column** on `procurement_orders`
(`packages/database/src/queries/orders.ts:142,153`), not the table of that name in
`009` — those are different objects that share a name.

### 3c. Checked and clean

The three cases named in project memory as prior offenders resolve as follows:
`restaurant_feature_flags` **exists** (8 columns in production — the 7-column EAV
shape plus the two columns migration `20260826120000` added; **not** the 22-column
table in `services/database/migrations_archive/011`, which remains unapplied and
should be deleted or marked superseded); `restaurant_inbound_addresses` **exists**;
`scheduled_reports` does **not** — §3a.

No other file outside `supabase/migrations/` declares a relation that is missing
from production. `Supabase_SQL_Files/` (8 files) and the `md/` copies declare only
objects that exist.

**One recommendation, since the pattern has now bitten five times:** the archive
scan in this audit is ~60 lines of Python and could run in CI as a guard —
"every `CREATE TABLE` outside `supabase/migrations/` either exists in production or
is listed in an explicit `KNOWN_UNAPPLIED` file". That converts the class of defect
into a build failure rather than a discovery. Recording it as a suggestion, not a
decision.

---

## 4. STALE — already fixed, still recorded as open

### OD-39 — Toast webhook signature verification fails closed

The entry describes `toast.service.ts:189` running the verifier only
`if (signature && timestamp)`. In `apps/api-gateway/src/toast/toast.service.ts`
today the `if (signature && timestamp)` at `:204` is followed by two explicit
rejection branches:

```
217  } else if (!this.webhookSecret && this.enforceSignature()) {
222    throw new HttpException("Toast webhook rejected: TOAST_WEBHOOK_SECRET is not configured", 401)
226  } else if (this.webhookSecret && this.enforceSignature()) {
229    throw new HttpException("Missing webhook signature", 401)
```

and `enforceSignature()` (`:117-119`) returns `true` unconditionally when
`NODE_ENV === "production"`. Move to Resolved.

### OD-40 — the human approval gate is authenticated

`pos-hub.controller.ts:45-46` is `@UseGuards(JwtAuthGuard)` / `@Controller("pos-hub")`,
with a comment at `:41-45` naming this exact fix. Approve/reject are at `:272` and
`:293` (not `:169,190`), and only `@Post("webhook")` at `:71` is `@Public()`.
Move to Resolved.

### OD-37 — both remediations already landed

The stale docstring is gone: `inbound-responder.service.ts:158-162` is now an
accurate "fire-and-forget from the RabbitMQ bridge" comment, and no "never
auto-send" claim survives anywhere in the file. The project memory
`autonomous-email-replies.md` already carries the 2026-08-24 correction as its
closing paragraph. The mechanism still reads as the entry describes it, at drifted
lines: `willAutoSend` is `:498` (not `:511`), the scheduling block `:498-500`,
and `isAutonomousSendEnabled` (`:963-978`) defaults **OFF** on a missing row.
Move to Resolved, and fix the two line numbers inside the memory while doing so.

### OD-49 — the schema-parity guard is running

`.github/workflows/schema-parity.yml:67,111,145` resolve
`secrets.SUPABASE_POOLER_URL || secrets.SUPABASE_POOLER_CONNECTION_STRING || …`,
so the secret named in the entry's founder action is no longer required.

```
$ gh run list --workflow=schema-parity.yml --limit 6
2026-08-26T10:10:19Z  main  success  docs(decisions): retire 7 stale Open rows…
2026-08-26T09:41:34Z  main  success  OD-81: reports have no producer…
```

The guard is on. Delete the founder action; the row is fully resolved.

### OD-57 — resolved but filed in the Open table

The ✅ row (swept 2026-08-24) and its two struck-through originals all sit under
`## Open`. Three rows, one resolved decision. Move all three to Resolved as a single
entry; §2's OD-04 correction depends on it.

### OD-61 / 62 / 63 / 82 / 83 / 84 / 85 — fixed during this audit

Each appeared in **both** the Open and Resolved tables. Commit `493fe3fa` (#80)
removed the seven Open rows while this audit was running. Independently confirmed
along the way that OD-61 really did land: production
`api_spend.cost_usd` carries the column comment
*"NULL means UNKNOWN … OD-61"*, so migration `20260825160000` **is applied** —
which corrects the OD-61 Resolved row's own closing words, "Migration written,
**NOT applied**".

---

## 5. Could not verify, and what it would take

- **OD-33 — the exact `INSIGHT_CANDIDATES.length`.** Both citations are exact and
  the contradiction is real: `insight-catalog.spec.ts:10` asserts only
  `toBeGreaterThanOrEqual(200)`, so 348, 375, 573 and 200 all pass.
  `INSIGHT_CANDIDATES` is built at import time by `buildCandidates()`
  (`insight-catalog.ts:547`), so it cannot be counted statically. **Needs:**
  `pnpm install` at the repo root, then evaluate
  `INSIGHT_CANDIDATES.length` (`npx tsx -e` or a one-line vitest). This worktree has
  no `node_modules` and installing it was out of scope for a read-only audit.
- **OD-51 — "0 of 17 Pro tiers complete, 8 fully unbuilt."** The fork is genuinely
  open (no ADR resolves it; `03-scenarios/TIER-MAP.md:74` records `pro | 0 | —`,
  consistent with OD-48). The completeness claim is a per-scenario judgement about
  each scenario's §10 Pro band. **Needs:** a scenario-by-scenario build audit
  against `03-scenarios/`, which is a work item, not a lookup.
- **OD-53 — the SEO pipeline's step 1.** Both halves are claims about third-party
  products (whether Perplexity exposes a search-history API; whether
  AnswerThePublic's Alpha API exists at 60 req/min). Nothing in this repo can settle
  either. **Needs:** a dated check against each vendor's current API docs, recorded
  with the date — the discipline ADR 0016 introduced for model rates.
- **OD-56 — the 9 open CVEs.** Two halves verified, one unverifiable.
  *Verified:* exactly **15** Dependabot PRs are open and the list matches the entry
  item for item, including **#16** (`@storybook/addon-viewport` 8.6.14 → 9.0.8), the
  one flagged as re-breaking Storybook; and root `package.json:66-70` still carries
  only `typescript` / `@types/react` / `@types/react-dom` in `pnpm.overrides`, so the
  Node transitive fix has **not** been applied. *Unverifiable:*
  `GET /repos/…/dependabot/alerts` returns **403 "Dependabot alerts are disabled for
  this repository"**, so the "9 open CVE alerts" premise can no longer be observed at
  all. Lockfile versions were read (undici 6.23.0 / 7.25.0, nanoid 3.3.11,
  image-size 1.2.1, brace-expansion 1.1.12 / 2.0.2, socket.io-parser 4.2.5,
  postcss 8.4.49 / 8.5.6, react-router 6.30.3) but **deliberately not graded against
  advisories from memory** — CLAUDE.md §5b's rule is that a version is only patched
  against the CVE you actually looked up. **Needs:** re-enable Dependabot alerts, or
  run `pnpm audit` / `osv-scanner` against the lockfile and date the result.
- **OD-78's Railway half.** See §2 — `RAILWAY_TOKEN` in `.env` is rejected
  (*"Invalid RAILWAY_TOKEN"*), so no Railway variable state was confirmed for this
  or any other entry. This also disables the "check `railway status` after every
  merge" step recorded in project memory.
- **OD-88's runtime proof.** The source is unambiguous —
  `conftest_prod.py:191-204` (`prod_supabase` calls `pytest.skip` without
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), `:218` (`scope="session",
  autouse=True` depending on it), `pytest.ini:12` (an unused `prod_e2e` marker).
  **Not** proven by an observed skip, because the suite was not run — another
  session holds `services/agent-orchestrator/`. **Needs:** one
  `pytest tests/e2e/test_studio_pipeline.py --collect-only` with the two variables
  unset, when that tree is free.
- **OD-26 / OD-43's original counts.** The 11-vs-3 and 15-vs-3 figures cannot be
  reproduced because the entries do not record the query that produced them. A plain
  phrase grep under `.planning/01-org/` gives **23** files naming a split trigger and
  **6** naming a merge or retirement trigger — the asymmetry holds and has widened,
  but the numbers are not comparable to the entries'. **Needs:** the entries to carry
  their own grep, per CLAUDE.md §5b.

---

## 6. Found while auditing — not in the register

1. **An unignored service-account key sits at the repo root.**
   `wineops-vertex-ai-f47258ef6209.json` (2,385 bytes) is untracked (`??` in
   `git status`) and matched by **no** `.gitignore` rule — the only `*.json` rules
   are three `.planning/.obsidian/` paths (`.gitignore:104-107`). One `git add -A`
   commits a Google Cloud private key to a GitHub repo, and project memory records
   that several sessions share this checkout. The file was **not opened**. This
   belongs with **OD-77**: it is the same personal `wineops-vertex-ai` project, and
   it is the sharpest cost of the current arrangement.
2. **`OD-90` is a dangling reference.** OD-87's Resolved row ends "Timezone left open
   as **OD-90**", but OD-90 in the Resolved table is the SSRF / log-injection work
   and the timezone entry is filed as **OD-92**. CLAUDE.md §5b's "never reuse an OD
   number" caught the collision; the prose pointing at it was not updated.
3. **`OD-93` is cited by an open PR and does not exist in the register.**
   PR **#79**, "fix(security): sweep the 54 log-injection sites, and guard the way
   the fix can break (OD-93)", is open against `main`; `OPEN-DECISIONS.md` has no
   OD-93 row. Either the row was never filed or it lives only on that branch.
4. **OD-65 and OD-67 are the same decision under two IDs.** Both describe a
   partial-volume void returning `qty` whole bottles, both cite B19, both resolve to
   `pos-hub.service.ts:570-587` — where the code itself says *"B19 (unchanged, and
   wrong — see ADR 0011 Consequences)"*. The Toast door has the **same** defect
   independently at `toast/toast.service.ts:530-544`, which neither entry mentions:
   a glass void there books `apply_stock_movement` with `p_delta: qty` against
   `p_stock_state: "live"`. Whoever supersedes B19 must fix two call sites.
   OD-26 and OD-43 are a second such pair (the ratchet, measured twice).
5. **`processCustomReminders`' target table exists and is empty.** `custom_reminders`
   → 200 with **0** rows, consistent with OD-87's "nothing was misdelivered".
6. **The `enable_ai_negotiation` default is live and ON.** The single
   `restaurant_feature_flags` row carries `enable_ai_negotiation: true` and
   `enable_ai_autonomous_send: false` — so OD-86's fix works, and OD-37's guardrail
   is genuinely OFF in production for the one restaurant that has a row. The other
   nine have no row at all, and `isAutonomousSendEnabled` returns `false` on a
   missing row, so
   auto-send is off everywhere (`inbound-responder.service.ts:963-978`).
7. **`generated_reports` exists with 20 columns and 0 rows** — the "empty archive by
   construction" claim in OD-81 is exactly right about that table, which makes the
   `scheduled_reports` error in the same entry easier to miss.
