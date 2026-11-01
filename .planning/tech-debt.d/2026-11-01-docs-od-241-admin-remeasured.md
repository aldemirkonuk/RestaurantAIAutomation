## A minted MCP key outlives its minter's role — OPEN — 2026-11-01

Filed by `docs/od-241-admin-remeasured`, from PR #711's CI gate at `1adb8b2ad` (comment 6552114395, security note 2b), which asked for it now rather than with the MCP slice.

**What is true.** Minting a key needs a manager or an owner (`apps/api-gateway/src/mcp-server/mcp-keys.controller.ts:95`). Using one reads `id, restaurant_id, label, scopes, token_hash, revoked_at` (`mcp-credentials.service.ts:232`): not the minter, not a role. `created_by` is `ON DELETE SET NULL`, and nothing revokes a key when its minter is demoted or leaves. So a key keeps every scope it was granted until someone revokes it on /connections. ADR 0298 decision 9 passes the sales gate open for MCP tools because only an owner or a manager mints, so once a reader slice hands MCP the till's figures, such a key reads them too.

**What closes it.** One of three things:
- using a key re-reads its minter's role in the house and refuses one below manager; or
- a demotion or removal revokes the keys that person minted; or
- a recorded ruling that a key belongs to the house, not to its minter.

## ADR 0298 decision 9 says a route reads the role "from the token" — OPEN — 2026-11-01

Filed with the entry above, from the same gate (security note 2c).

**What is true.** Decision 9 (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md:70`) says a route reads the role from the token, and that `admin` reaches the till through a route only. On `main`, a route's role is re-read on every request from the person's access row in the house the token names (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:60-68`, `auth.service.ts:1050-1056`); the token names only the house. So a demoted owner or manager loses the gate on their next request, not when the 15-minute token expires (`auth.module.ts:32`). And no route receives `admin` (OD-241, claim `OD-241-NO-ROUTE-RECEIVES-ADMIN`).

**What closes it.** The next PR that edits ADR 0298 rewrites both sentences to match.

## ADR 0298 decisions 6 and 7 have no claim row — OPEN — 2026-11-01

Filed with the entries above, from the same gate (compliance note 2).

**What is true.** The two rows of `../decisions/claims.d/docs-adr-0298-cost-of-goods-is-what-sold.jsonl` guard decisions 8 and 9. Decision 6 (`deliveredPurchases` and `shelfValueAtMenuPrice` under their own names) and decision 7 (seven registry entries set to `computed: false`) have none, so nothing fails if they never land or are undone.

**What closes it.** The slice that lands each of them adds a `resolved` row for it, or its PR body says why no check can be written.
