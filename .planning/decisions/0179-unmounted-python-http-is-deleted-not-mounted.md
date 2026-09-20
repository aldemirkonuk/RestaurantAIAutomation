# 0179 — Unmounted Python HTTP is deleted, not mounted

- **Status:** Locked (founder, 2026-09-20, delegated: "analyze carefully, you decide"). The HTTP surface is not yet deleted. Nothing in this record is built.
- **Date:** 2026-09-20
- **Decider:** Aldemir (founder) asked the lane to decide after research. This is that decision.
- **Keywords:** FastAPI, APIRouter, unmounted, admin_routes, collection_routes, templates_routes, scan_routes, router_preview, self-evolution, SSRF, ratchet, verify_admin_key
- **Links:** [[0178-phase-0-then-phase-1-no-parallel-pitch]] (this is a Phase 0 item). Brief: [`../07-reference/ENDPOINT-UNIVERSE-PLAN.md`](../07-reference/ENDPOINT-UNIVERSE-PLAN.md). CLAIMS `ADR-0179-UNMOUNTED-PYTHON-GONE` (open until deleted), `ADR-0179-SCAN-PREVIEW-STAYS-AUTHED` (resolved). Census at `origin/main` `79dfea023`.

## Context

S8 counted 49 unmounted Python handlers with no auth: "the day someone mounts them they are public." Checked at `79dfea023`:

`services/agent-orchestrator/main.py:151-194` mounts eleven routers. It does **not** mount `admin_routes`, `collection_routes`, `templates_routes`, or `scan_routes.router`. It **does** mount `scan_routes.router_preview` (`main.py:55,154`).

| File | Handlers | `Depends` | If mounted |
|---|---|---|---|
| `api/admin_routes.py` | 8 | none | Wine-tier promote/demote, alias, edit, submission approve/reject |
| `api/collection_routes.py` | 7 | none | `POST /web` takes a caller URL and scrapes it (SSRF); also Google/Yelp/Vivino/OpenTable pulls |
| `api/templates_routes.py` | 9 | none | CRUD + render of `{variable}` bodies. Imports `core.database.get_db_connection`, which does not exist (`KNOWN_UNRESOLVED` in `tests/test_first_party_imports.py`) |
| `api/scan_routes.py` `router` | 24 + 1 WS | none | Scan, crawl, quality queue, learning cycle, training export |
| `api/scan_routes.py` `router_preview` | 1 (`POST /detect`) | `verify_admin_key` at `scan_routes.py:1359` | **Live.** Keep. |
| `services/self-evolution/main.py` | 11 | none | Separate app, port 8090, **not in `docker-compose.yml`**, `restaurant_id` from the caller |

No first-party importer of the four unmounted modules (grep of the orchestrator tree at that commit). `wineDetection.ts` is gone from this tree.

## Options considered

1. **Mount them behind `verify_admin_key`.** Makes the 49 reachable. **Rejected:** (a) `templates_routes` does not import, so this is a rewrite. (b) Auth does not make `POST /web` safe — it is an arbitrary-URL fetch. (c) Wine-tier and submission approve are house-data writes; they belong on the gateway with a seal, not on an internal FastAPI with an admin key. (d) "Mount + auth" is how a well-meaning patch puts 8 unauthenticated writes on the internet the week the `Depends` is forgotten.
2. **Leave them on disk, unmounted.** Today's exposure is zero. **Rejected:** the next `include_router(admin_router)` is a one-line incident. A ratchet is cheaper than hoping.
3. **Delete the HTTP surface, keep tables, keep the mounted preview, add a CI ratchet.** Chosen.
4. **Delete `router_preview` too.** **Rejected:** it is mounted and authed. A product still calls detect.

## Decision

**Delete the unmounted HTTP surface. Keep tables. Keep `router_preview`. Add a ratchet.**

- Delete `api/admin_routes.py`, `api/collection_routes.py`, `api/templates_routes.py`, and the unmounted `router` object in `api/scan_routes.py` (including its websocket). Keep `router_preview` and `Depends(verify_admin_key)` on `POST /detect`.
- Delete the self-evolution **HTTP app**. Keep any tables it wrote.
- Tombstone the deleted files in this ADR's review trail (recovery commit = the deleting PR).
- CI ratchet, in the same deleting PR: every `APIRouter` under `services/agent-orchestrator/api/` is in `main.py`'s include list **and** every write handler has a `Depends` auth, or the build fails.
- A later product that needs scan, admin wine review, or image collection is a **new authenticated gateway route**, not a resurrection of these files.

## Consequences

- **Easier.** The 49-handler footgun is gone. Preview detect stays the only live scan door.
- **Harder.** Anyone wanting wine-tier review or a crawler rebuilds it on the gateway, under 0112 if it writes house data.
- **Revisit when** a named product needs scan or wine review, as a new ADR, not a revert of the delete.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | Aldemir (founder) | Delegated the choice after research |
| 2026-09-20 | Cursor Grok 4.6 | Delete unmounted HTTP, keep preview + tables, ratchet. Counted at `79dfea023` |
