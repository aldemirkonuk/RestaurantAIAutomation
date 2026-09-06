# 0123 — The OpenAPI export is a command, not a commit

- **Status:** Proposed — the founder's call of 2026-09-05, written up for the lock. Closes [OD-89](OPEN-DECISIONS.md).
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** openapi, swagger, api-gateway, generated artifact, gitignore, diff noise, boot side effect, OD-89
- **Links:** [`OD-89`](OPEN-DECISIONS.md), `[[0020-no-fabricated-answers]]`,
  `[[0025-citations-must-disagree-loudly]]` (the claims runner this row had flipped),
  `apps/api-gateway/src/openapi-export.ts`, `apps/api-gateway/src/openapi-export.spec.ts`,
  `apps/api-gateway/src/main.ts`, `apps/api-gateway/src/openapi.ts`, `.gitignore`

## Context

`apps/api-gateway/openapi.json` has been a **tracked file written by a side
effect**. `main.ts` wrote it on any `NODE_ENV !== "production"` startup, so
running the gateway locally — for any reason, on any branch — rewrote 7,900
lines of a committed file:

```
apps/api-gateway/src/main.ts:136-140   (pre-fix, at 3ab6302a)
  // Export OpenAPI spec to file (for CI/CD and external tools)
  if (process.env.NODE_ENV !== "production") {
    fs.writeFileSync("./openapi.json", JSON.stringify(document, null, 2));
```

The comment names a consumer that does not exist. **Measured on this tree**
(`/Users/aldemirkonuk/Projects/wt-p4`, HEAD `3ab6302a`, 2026-09-05):

| Question | Command | Answer |
|---|---|---|
| Does anything read the file? | `git grep -n "openapi\.json" -- . ':!.planning'` | **No.** The only hits are the two writers, and six in `services/agent-orchestrator/main.py` which are that service's own **HTTP route** `/openapi.json`, served from memory by FastAPI — a different thing wearing the same name. |
| Does CI, Docker or Railway read it? | `git grep -ln "openapi" -- .github docker '*Dockerfile*' '*railway*' '*nixpacks*'` | **No output.** Not one reference. |
| Is it dirty right now? | `git diff --numstat -- apps/api-gateway/openapi.json` | **11834 insertions, 7910 deletions** — left by another builder's local boot on the shared worktree, in a session about something else entirely. |

That last row is the whole argument in one number. Nobody chose to change the
spec; someone started the gateway.

**It had also flipped a guard.** `bash scripts/check_decision_claims.sh` on the
pre-fix tree:

```
== Decision claims: 226 checked, 225 holding

== STALE (1) — listed as open, but already true
   OD-89 — listed OPEN, but its claim now verifies: the committed openapi.json
           matches the routes the code actually serves (pos-hub sale-unit routes present)

FAIL — the register disagrees with the code about what is still broken.
```

OD-89 recorded, correctly, that the **committed** spec was stale (`grep -c
sale-unit` on it returned 0). The claim greps the **working copy**, and a
builder's boot had regenerated it — so the guard now reported the register as
out of date when nothing had been fixed. A boot side effect was, by that route,
editing the decision register.

Two related things measured while here, because both were assumed and neither
was true:

- **`scripts/check_gateway_boots.sh` does not rewrite the file.** `md5 -q
  apps/api-gateway/openapi.json` is `90835af81700f6e060056780e9c674b5` before
  and after a run: it resolves the dependency graph, it does not execute
  `bootstrap()`'s Swagger step.
- **`scripts/check_decision_claims.sh` does not rewrite it either.** It greps.
  The dirt on this tree came from a real gateway run, not from a guard.

## Options considered

1. **Keep committing it and make it true.** Gate the boot write, regenerate on a
   dedicated branch, and add a CI check that fails when the committed spec
   differs from the code. Costs: a CI job and a per-PR regeneration ritual, paid
   forever, to keep a file honest that **no reader has ever consulted** — and a
   large generated JSON in every diff, which is the reviewability tax CLAUDE.md
   §2 exists to prevent. This is the right answer if and only if something
   external is meant to consume the spec, and nothing does.
2. **Stop committing it.** Gitignore the file, keep the export as an explicit
   command, untrack the copy. Costs: an external consumer that appears later
   must run the command (or a CI job must publish the artifact); and the
   convenience of browsing the spec on GitHub is lost — `/api/docs` on a running
   gateway and `pnpm openapi:export` replace it.
3. **Delete the export entirely.** Swagger UI is already served at `/api/docs`.
   Costs: throws away a genuinely useful command for client generation and
   diffing two revisions of the API, to save one script line.

## Decision

**Option 2, on the founder's call of 2026-09-05: "stop committing it —
gitignore, keep the export command."** The boot-time write stops either way; the
fork was only about whether the artifact stays in git.

**What ships:**

- `apps/api-gateway/src/openapi-export.ts` — `shouldExportOpenApi(env)` is true
  only for `EXPORT_OPENAPI` = `1`/`true` (unset, empty, `0`, `false` and
  anything else are all "do not touch the file": absence is never consent), and
  `maybeExportOpenApi(document, {write, log})` writes only then and **returns
  whether it wrote**, so no caller can announce a write it did not make (ADR
  0020).
- `main.ts` routes its export through that function. A plain boot writes nothing.
- `openapi.ts` — the dedicated export script — is gated on the **same** flag, so
  there is exactly one rule to know. Run without it, it writes nothing, says so,
  and exits non-zero rather than leaving the operator to guess.
- `package.json`: `openapi:export` now sets the flag —
  `EXPORT_OPENAPI=1 ts-node -r tsconfig-paths/register src/openapi.ts`.
- `.gitignore` gains `apps/api-gateway/openapi.json`.
- `apps/api-gateway/README.md` documents the command, because a capability that
  exists only in a `scripts` block is one nobody finds.

**The CLAIMS rows are rewritten, not deleted.** OD-89's second claim greps the
file itself; once the file is untracked and regenerable, that claim would read a
missing file as a failure, which is exactly the cannot-run-certifies-itself
shape ADR 0025 §5 bans. Both rows become `resolved` and are repointed at what is
now true: the boot path routes through `maybeExportOpenApi`, and the path is in
`.gitignore`. Both name files that exist, so a rename makes the guard shout
rather than pass.

**Proof.** `apps/api-gateway/src/openapi-export.spec.ts`, 14 cases, run with
`./node_modules/.bin/jest --runInBand --forceExit src/openapi-export.spec.ts`
from `apps/api-gateway` — **14 passed, 1 suite**. It does **not** boot Nest:
`bootstrap()` opens a real Supabase client against the production project, and
this repo forbids pointing a test there. So the boot behaviour is proven in two
halves — the decision function with a spy writer (the exact function both call
sites now use), and a source-shape predicate over `main.ts` — and the second
half is run over `git show 3ab6302a...:apps/api-gateway/src/main.ts` to prove it
fails on pre-fix code. That comparison FAILS, rather than passing or skipping, if
the sha is ever unreachable (72a815b7: a skip would certify the guard against nothing). Measured independently with the same predicate:

```
pre-fix (git show HEAD:): FAIL -- BOOT WRITES THE SPEC
current tree: OK
```

## Consequences

- **Easier.** Running the gateway stops editing the repository. The class of
  accident OD-89 was filed for — 500 lines of unrelated pos-hub drift swept into
  a studio-invite diff — cannot happen from a boot again. `check_decision_claims.sh`
  stops depending on whether someone happened to start the gateway.
- **Harder.** Anyone who wants the spec must run the command or open `/api/docs`;
  it is no longer browsable on GitHub. If an external consumer ever appears, this
  decision is the thing to revisit, and CI publishing the artifact is the cheaper
  answer than committing it again.
- **Given up.** A committed spec is a free API changelog — `git log -p
  openapi.json` would have shown when a route appeared. That history stops here.
  It was never true history anyway: the file was regenerated by accident, by
  whoever booted last, not by whoever changed the API.
- **One step is not mine to take.** `.gitignore` does **not** untrack a file
  already in the index. Until `git rm --cached apps/api-gateway/openapi.json`
  runs, the file is still tracked and still shows as modified. The parent session
  runs it with the commit; this branch cannot make git state changes.
- **Revisit when:** (a) a client generator, an SDK build, or an external partner
  needs the spec from the repo — publish it from CI, do not commit it; (b) the
  `/api/docs` route is ever disabled in an environment where someone needs to
  read the spec.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | — | Created on the founder's call. Gate, spec (14 cases), gitignore, script, README and the two rewritten CLAIMS rows measured on `wt-p4` at HEAD `3ab6302a`; the `git rm --cached` handed to the parent. |
