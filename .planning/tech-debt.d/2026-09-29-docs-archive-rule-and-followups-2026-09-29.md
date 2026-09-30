## The archive rule said "never" after a founder exception made it "only by exception" — CLOSED on `docs/archive-rule-and-followups-2026-09-29` — 2026-09-29

PR #494 kept the deleted legacy web pages in one compressed file (`.planning/07-reference/legacy-web-archive-2026-09-29.tar.gz`) on the founder's call, recorded in ADR 0032 §Scoped exception. `CLAUDE.md` §4 ("nothing is ever copied or moved into an in-tree archive folder") and ADR 0032's row in `.planning/decisions/README.md` ("never an in-tree copy") still said never; both are gate-owned, so #494 could not edit them. The founder, asked whether to update both, answered in chat on 2026-09-29, verbatim: *"Update both (Recommended)"*. Both now say an in-tree archive is allowed only by a founder exception recorded in an ADR, and point at ADR 0032 §Scoped exception. `CLAUDE.md` keeps its line count, so no `CLAUDE.md:N` citation moves. Claim `ARCHIVE-RULE-NAMES-THE-FOUNDER-EXCEPTION` (`claims.d/docs-archive-rule-and-followups-2026-09-29.jsonl`).

## `mudavym_design_arrival` is a Settings switch that does nothing — OPEN — 2026-09-29

After #494, `/get-started` renders `GetStarted` with no PageGate (`apps/web/src/App.tsx`, the comment at `:214`), so nothing reads the flag to choose a page. It is still an ACTIVE registry key (`apps/api-gateway/src/settings/feature-flag-registry.ts:83`), and `arrival` is not in `LIVE_PAGES`, so Settings (`apps/web/src/pages/settings/next/FeaturesSection.tsx`) still offers a working toggle whose copy says it "Renders the Mudavym design of this page for everyone at this restaurant". Flipping it changes nothing. ADR 0020 says a flag naming no capability is deleted, not relabelled. The cutover manifest recorded this as a later gateway PR (`.planning/07-reference/deploy/CUTOVER-MANIFEST-2026-09-28.md`, the `arrival_book` sub-fork); the #494 audit made filing it a condition. Fix: retire the key in the registry (INACTIVE, no column drop — ADR 0149 never drops `mudavym_design_*` columns) and remove the row from Settings. Claim `ARRIVAL-FLAG-RETIRED` (status `open`: it must fail while the key is ACTIVE).

## `safe-action-path.ts` points its follow-up at the frozen register — OPEN — 2026-09-29

`apps/api-gateway/src/notifications/safe-action-path.ts:24-25` says the web-sink follow-up is "listed as a follow-up in v3.0-TECH-DEBT.md". It is not there (that file is frozen since ADR 0240); it is in `.planning/tech-debt.d/2026-09-28-fix-websocket-role-gate.md`. Found by the #497 audit. Fix: repoint the comment.

## OD-133's resolved row cites the wrong charter line — OPEN — 2026-09-29

OD-133 (OPEN-DECISIONS.md:107) says it "does not classify TypeSafe in `compliance-privacy-charter.md:202`'s subprocessor register (still 0/50 there)". Line 202 of `.planning/01-org/corporate/compliance-privacy/compliance-privacy-charter.md` says there is "no subprocessor register"; the 0 / 50 metric (`compliance.subprocessor_classification`) is at `:124`, and the charter's own bracket (from `:204`) says a register now exists in `.planning/foundation/EXTERNAL_CONNECTIONS.md`. The row's meaning holds (it classifies nothing); the citation is wrong. Found by the #504 audit. Fix: cite `:124`, in place, as a bracket.

## The compliance charter still says TypeSafe's DPA is "already done" — OPEN — 2026-09-29

`.planning/01-org/corporate/compliance-privacy/compliance-privacy-charter.md:214` reads "(TypeSafe's DPA is the founder's "already done", 2026-09-25)". OD-133, resolved by #504 on the founder's item 84 ("Accept their retention", "Not a DPA"), now says no signed DPA is on record, so the two records disagree. Found by the #504 audit. Fix: a dated bracket in the charter pointing at OD-133.

## A zone-setup assignment comes back after promote-then-demote — OPEN — 2026-09-29

`user_restaurant_access.zone_setup_access` (ADR 0238, #518) is not cleared by a role change: `MembersService.updateMemberRole` (`apps/api-gateway/src/restaurants/members.service.ts:186`) leaves the column as it was, so a staff member who was assigned, promoted to manager, then demoted back to staff has the right again with no one re-granting it. Owners and managers can see it (the setup-access read lists the assigned), and ADR 0238's Consequences discloses it. Raised by both #518 reviewers. Fix: clear the column on any role change in the same write, audited, or read the grant only with `role = 'staff'` at grant time and re-check on demotion.
