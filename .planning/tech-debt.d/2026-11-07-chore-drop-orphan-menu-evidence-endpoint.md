## MenusService.previewArrivalMenu has no production caller after the menu-evidence route left — OPEN — 2026-11-07

Filed by `chore/drop-orphan-menu-evidence-endpoint` (menu proposal step 1i, gap M17 gateway half).

**What is true.** `POST /arrival/menu-evidence`, `ArrivalService.menuEvidence` and `MenuEvidenceDto` are deleted; on origin/main `c93d6115c` no file in `apps/web`, `apps/mobile` or `services` named the route (claim `ARRIVAL-MENU-EVIDENCE-ROUTE-GONE`, `../decisions/claims.d/chore-drop-orphan-menu-evidence-endpoint.jsonl:1`). That route was the only production caller of `MenusService.previewArrivalMenu` (`apps/api-gateway/src/menus/menus.service.ts`), so it is now reached only by its own case in `arrival.service.spec.ts`. It is kept because menu proposal steps 1a and 1c name it, and its 0-item and 500-item refusals are what the menu audit proposes reusing for `importMenu`.

**Also left as is.** The `"menu"` member of `Provenance` (`apps/api-gateway/src/arrival/arrival-contract.ts:14`) is no longer written by any route (`ProposeBatchDto` accepts only spoken, inferred and invoice); a batch written before this change can carry it, so the type keeps it. `IsObject` in `arrival.dto.ts` was already unused before this branch (eslint warning).

**What closes it.** Step 1a or 1c lands and either gives `previewArrivalMenu` a caller or deletes it with its spec case.
