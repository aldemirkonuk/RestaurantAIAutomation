## A failed menu import can leave its source object in storage with no version naming it — OPEN — 2026-11-07

Filed by `fix/menu-failed-read-leaves-no-orphan` (menu upload Phase 1A step 1d, gap M8 transaction half).

**What is true.** `MenusService.importMenu` now resolves the library before it keeps the source, and `persistIntoNewVersion` deletes the just-made `restaurant_menus` row when the line write throws (`apps/api-gateway/src/menus/menus.service.ts`). It does not remove the source object. `keepSource` uploads `<house>/menus/<sha256>.<ext>` before `createVersion`, so when `createVersion` or the line write fails, that object can remain with no row naming it. It is left on purpose: the path is content-addressed, so another version of the same bytes may name it, and a delete decided by "no row names it now" races a concurrent import of the same bytes that has uploaded but not yet inserted its row. A later upload of the same bytes reuses the object (`upsert: true`).

**What closes it.** A sweep that removes `<house>/menus/*` objects no `restaurant_menus.source_path` names and that are older than a set age, or keeping the source only after the version and lines are written.

## The version-and-lines write is compensated, not transactional — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** The version row and its `menu_items` are two PostgREST calls. On a line-write error the version is deleted; if that delete also fails, the error names the draft that remains (`InternalServerErrorException`, spec "if that removal also fails"). A process that dies between the two calls still leaves an empty draft, and nothing in the gateway removes it later. Rows the library resolver added to `master_wine_library` before a later failure also stay (unchanged from `origin/main`).

**What closes it.** One RPC (migration) that inserts the version and its lines in one transaction, as step 1d allowed. Not built here, to keep this PR free of a migration.

## Menu import re-reads the same bytes, and a long read outlasts the web client — OPEN — 2026-11-07

Filed with the entries above; neither is changed by this PR.

- The idempotency half of M8 (same bytes re-read and billed again; `source_sha256` never looked up): Phase 2b, MU-11.
- The 30 s web client timeout (`apps/web/src/services/api/client.ts`, `timeout: 30000`): step 1d-ii, behind MU-5 and a measurement of the gateway host's request ceiling. Only the copy that promised "10–20 seconds" changed here.
