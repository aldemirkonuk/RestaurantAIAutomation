# Citation rewrite ledger — every `v3.0-TECH-DEBT` reference outside the register

Source: `git grep -n 'v3\.0-TECH-DEBT' -- . ':!.planning/v3.0-TECH-DEBT.md'` in `/Users/aldemirkonuk/Projects/wt-retire-debt` @ `9c6bdc0be` (main + ADR 0166 only — does NOT include the ADR-0159 lane, `PROGRESS.md`, or the two `check_*` guard scripts that exist only on other unmerged lanes; re-run this grep fresh at execution time). **354 entries** (353 from the fresh grep + 1 out-of-band note for ADR 0159, which the critic's prior pass found on a different checkout).

**[R5 UPDATE, 2026-09-21]** All 143 `GENERIC-DOSSIER-UNVERIFIED` references (must_fix 3 of round 5) are
now resolved — see that section below, plus `plan.json`'s `fixed_2026_09_21_r5` block for the rollup.
Every one of the 354 references named at the top of this file now has its own disposition somewhere
in this ledger: a mapped item's home, a drop/closed tag, a tombstone, or (for `CLAUDE.md`/`decisions/README.md`
gate-owned rows and two live page-contract instructions) exact before/after text in "Special / cross-cutting
rows" below.


## EXPLICIT (55)

Item id/key literally spelled out in the citing text. High confidence.

- `.planning/00-index/cards.json:114` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/00-index/cards.json:3706` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-agenda-board.md:117` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md:65` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-agent-stack.md:117` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-charter.md:79` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-charter.md:198` -> **44.10 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-loops.md:122` -> **44.10 [roadmap -> .planning/ROADMAP.md]; 44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/analytics-engine/analytics-engine-agenda-full.md:92` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:46` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:121` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-charter.md:45` -> **44.10 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-charter.md:170` -> **44.10 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-loops.md:67` -> **44.10 [roadmap -> .planning/ROADMAP.md]; 44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-premortem.md:26` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agenda-full.md:70` -> **44.10 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agent-stack.md:70` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-charter.md:127` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-loops.md:87` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-schedule.md:35` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/06-pages/providers.md:402` -> **44.15 [adr-text -> .planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md]**
- `.planning/06-pages/simpos-terminal.md:64` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/06-pages/simpos-terminal.md:108` -> **44.13 [roadmap -> .planning/ROADMAP.md]**
- `.planning/archive/STATE-pre-P2-20260825.md:29` -> **44.11 [roadmap -> .planning/ROADMAP.md]; 44.1a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.2a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/decisions/0097-the-gateway-says-which-build-it-is.md:267` -> **44.2d [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `.planning/decisions/0125-an-order-changes-state-through-a-sealed-transition.md:568` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire" item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `.planning/decisions/0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person.md:130` -> **44.1g [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:7` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:24` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:213` -> **44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:363` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:419` -> **44.1r [claims-row -> .planning/decisions/CLAIMS.jsonl]; 44.1t [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/decisions/CLAIMS.jsonl:263` -> **44.2d [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `.planning/decisions/CLAIMS.jsonl:350` -> **44.1g [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `.planning/decisions/CLAIMS.jsonl:351` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `.planning/decisions/CLAIMS.jsonl:353` -> **44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/decisions/CLAIMS.jsonl:354` -> **44.1p [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/CLAIMS.jsonl:356` -> **44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]; 44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/CLAIMS.jsonl:357` -> **44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]; 44.1p [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/CLAIMS.jsonl:358` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/CLAIMS.jsonl:359` -> **44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/foundation/teams/intelligence.md:123` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/foundation/teams/intelligence.md:245` -> **44.6 [roadmap -> .planning/ROADMAP.md]**
- `.planning/foundation/teams/intelligence.md:456` -> **44.10 [roadmap -> .planning/ROADMAP.md]**
- `apps/api-gateway/src/auth/auth.service.ts:1120` -> **44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `apps/api-gateway/src/auth/house-role.ts:20` -> **44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `apps/api-gateway/src/procurement/dto/procurement.dto.ts:1077` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire" item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `apps/api-gateway/src/procurement/order-recurrence.service.spec.ts:19` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire", item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `apps/api-gateway/src/procurement/order-recurrence.ts:12` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire", item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `apps/api-gateway/src/team/team.service.ts:548` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/web/src/pages/orders/next/Recurrence.test.tsx:18` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire" item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `apps/web/src/pages/orders/next/recurrence.ts:11` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire", item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `apps/web/src/services/api/types.ts:367` -> **__ORDERS_WIRE_ITEM2__** — quotes '"The orders wire" item 2' by name (verifier NOT-READY finding (d), 2026-09-19)
- `supabase/migrations/20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql:5` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]**
- `supabase/migrations_archive/20260731164610_capture_ghost_tables.sql:6` -> **44.3a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**

## MANUAL (47)

Hand-verified against the actual current file content (not line arithmetic alone). High confidence; see note per row.

- `.github/workflows/e2e-prod.yml:16` -> **2251 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — quotes 2251's own title verbatim ('failure for not configured')
- `.github/workflows/e2e-prod.yml:96` -> **2251 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — 'What the founder must set' secrets table lives inside 2251's own content (the nightly E2E secrets precondition)
- `.planning/06-pages/calendar.md:777` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/calendar.md:1100` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/calendar.md:1147` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/calendar.md:1188` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/calendar.md:1296` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/settings.md:995` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/settings.md:1224` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/settings.md:1258` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/06-pages/settings.md:1382` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/07-reference/INDEX.md:22` -> **__GENERIC_STRUCTURAL__** — 'v2.0-MILESTONE-AUDIT.md ... feeds v3.0-TECH-DEBT.md' -- describes a relationship to the file itself, not one item
- `.planning/07-reference/INDEX.md:23` -> **44.15 [adr-text -> .planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md]** — explicit '44.13' cited in text is a MISCITE -- UX_PATHS_CATALOG/760-path burn-down is 44.15's own subject, not 44.13 (Autonomous Vendor Discovery); flagged, not silently kept
- `.planning/08-softwares/calendar.md:152` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/08-softwares/dashboard-home.md:141` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/PROJECT.md:47` -> **__PROJECT_MD_47__** — structural mention of the register's role, not a single item
- `.planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:124` -> **2433 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — resolved in finalize2 pass
- `.planning/decisions/0111-the-calendar-is-the-houses-day-book.md:469` -> **__ICAL_DRIFT__** — same iCal citation drift cluster
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:11` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:184` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:193` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:205` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:216` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:239` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:240` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md:241` -> **2335 [od-row -> .planning/decisions/OPEN-DECISIONS.md]** — resolved in finalize2 pass
- `.planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:114` -> **adr0141-null-restaurant-id-deferred [already-existing CLAIMS.jsonl row (verify it names the same fact)]** — names the same gap this key already tracks: `services/agent-orchestrator/core/database.py:1077`'s `update_stock` cannot name a restaurant, filed as the one thing ADR 0141 leaves open (verifier NOT-READY finding (a), 2026-09-19)
- `.planning/decisions/0141-a-stock-write-names-the-house-it-is-for.md:182` -> **adr0141-null-restaurant-id-deferred [already-existing CLAIMS.jsonl row (verify it names the same fact)]** — same gap restated in the ADR's own 'What this does NOT settle' section, same `database.py#update_stock` citation (verifier NOT-READY finding (a), 2026-09-19)
- `.planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md:115` -> **44.1i [already-existing CLAIMS.jsonl row (verify it names the same fact)]** — explicit id on the next source line (44.1i); grep is line-scoped and missed the wrap, same pattern as `team.service.ts:453` below (verifier NOT-READY finding (b), 2026-09-19)
- `.planning/decisions/OPEN-DECISIONS.md`, preamble (the "ID collision, reconciled 2026-08-24" blockquote near the top of the file, not a `| OD-nn |` row) -> **__GENERIC_HISTORICAL__** — closed historical narrative about a past OD renumbering; leave untouched like other frozen historical records. **[R6, 2026-09-21]** — was anchored by line number (line 14) until `check_citation_pairing.py` correctly reported it UNANCHORED: the preamble has no register row to pair a line number against, so a bare line pointer was never a valid anchor form here. Re-anchored by section content instead, which does not rot the way a line number does; meaning is unchanged.
- `CLAUDE.md:124` -> **__CLAUDE_MD_124__** — gate-owned; exact replacement text given in report, not applied here
- `CLAUDE.md:130` -> **__CLAUDE_MD_130__** — gate-owned; exact replacement text given in report, not applied here
- `apps/api-gateway/src/calendar/calendar.controller.ts:744` -> **__ICAL_DRIFT__** — cites :243-245 but that range is now 44.1g content (POST /auth/register); the actual iCal text ('Phase 30 iCal ... no client has ever confirmed the feed subscribes') is at register:1103-1105, inside 44.4's range, with NO dedicated key of its own
- `apps/api-gateway/src/procurement/documents/document-intake.service.ts:1002` -> **3144 [claims-row -> .planning/decisions/CLAIMS.jsonl]** — content ('temporary shape ... schema-lag retry, delete once migration is everywhere') matches register:3144 verbatim
- `apps/api-gateway/src/procurement/quantity-received-unit.ts:67` -> **2159 [claims-row -> .planning/decisions/CLAIMS.jsonl]** — resolved in finalize2 pass
- `apps/api-gateway/src/team/team.service.ts:453` -> **44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]** — explicit id on the next source line (44.1n); grep is line-scoped and missed the wrap
- `apps/api-gateway/src/wines/a-generic-name-stays-the-venues-own-wine.spec.ts:273` -> **library-identity-item2-shared-path-error [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — country-fallback hash mismatch on the 'shared path' -- exact match to this key's own name
- `apps/web/src/lib/doorOutbox.ts:71` -> **offline-storage-swallow [claims-row -> .planning/decisions/CLAIMS.jsonl]** — quotes this item's own section title verbatim ('The offline queue reports a write it swallowed as a write that succeeded') and names the same two functions (`localStoragePut`, `idbGetAll`) its CLAIMS verify checks (verifier NOT-READY finding (c), 2026-09-19)
- `apps/web/src/pages/cellar/next/cellar-format.ts:10` -> **inventory-add-remove-item7 [claims-row -> .planning/decisions/CLAIMS.jsonl]** — STALE CITATION: cites :543-549 but that range is now 44.1n content (team.service.ts owner-removal); the real 'retailPriceAvg null on 442 rows' text is at register:1304-1306, within the CLOSED 'Inventory add/remove build list' section, item 7. Second drift on this exact file (its own comment already notes a prior :432-440 miscite).
- `apps/web/src/pages/receiving/next/RcOutboxRail.tsx:10` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]** — 'motion canvas inv-09' defect 2 = the dropped-door-receipt finding, register key 1994
- `apps/web/src/pages/settings/next/CalendarSection.tsx:5` -> **__ICAL_DRIFT__** — same drift as calendar.controller.ts:744
- `apps/web/src/services/api/inventory.lowstock.test.ts:7` -> **2499.D1-12 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — '2026-09-03 intelligence lens, defect 1' = Sim Meyhouse lens Defect 1 (dashboard low-stock camelCase/snake_case), bundled under 2499.D1-12
- `apps/web/src/services/api/inventory.ts:29` -> **2499.D1-12 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — same as inventory.lowstock.test.ts:7
- `scripts/check_web_reads_gateway_dto_keys.py:62` -> **orders-wire-guard-blindspot-test-fixture-cast [guard -> scripts/check_web_reads_gateway_dto_keys.py]** — this exact line is inside the docstring section this item is already adding a 4th bullet to (home_file match); the old 'recorded in .planning/v3.0-TECH-DEBT.md instead' phrase must be dropped when that bullet lands
- `supabase/migrations/20260906023000_the_library_may_say_it_does_not_know.sql:77` -> **library-identity-item1-repair [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — 'the library may say it does not know' producer/country repair -- exact match
- `supabase/migrations/20260906233000_stock_at_the_door_cost_at_verified.sql:5` -> **vendor-lens-slice3stop3-finding2-cost-state [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — '2026-09-06 finding 2, V2' = inventory_lots.cost_state DEFAULT 'final' no writer
- `supabase/migrations/20260912163000_a_stock_write_names_its_house.sql:55` -> **adr0141-null-restaurant-id-deferred [already-existing CLAIMS.jsonl row (verify it names the same fact)]** — 'NULL p_restaurant_id ... second migration' = the ADR-0141 residual, already tracked by an existing CLAIMS row per the migration's own text

## CONCEPT (27)

Matched by a named concept/phrase (SimPOS, hollow features, one-tap-actions, etc.) rather than a line number, because line numbers in this class drift. High confidence for the concept, item-level precision only where the concept maps to one item.

- `.planning/01-org/intelligence/analytics-bi/analytics-bi-charter.md:211` -> **__44.2_CLASS__**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agenda-full.md:154` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agent-stack.md:67` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-charter.md:131` -> **44.1a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-charter.md:150` -> **__44.2_CLASS__**
- `.planning/01-org/research-math/research-math-agenda-board.md:141` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/research-math-agenda-full.md:381` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/research-math-schedule.md:48` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agenda-full.md:30` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-premortem.md:53` -> **44.11 [roadmap -> .planning/ROADMAP.md]**
- `.planning/06-pages/dashboard.md:376` -> **44.6b [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/06-pages/orders.md:1039` -> **__ICAL_DRIFT__**
- `.planning/06-pages/profile.md:1277` -> **44.15 [adr-text -> .planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md]**
- `.planning/06-pages/profile.md:1524` -> **44.6b [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/06-pages/receipts.md:275` -> **__ICAL_DRIFT__**
- `.planning/06-pages/reports.md:741` -> **44.5 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/06-pages/reports.md:896` -> **44.5 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/06-pages/reports.md:1143` -> **44.5 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/06-pages/simpos-order-log.md:83` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/06-pages/simpos-order-log.md:113` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/06-pages/simpos-terminal.md:206` -> **__ICAL_DRIFT__**
- `.planning/06-pages/simpos-terminal.md:239` -> **44.13 [roadmap -> .planning/ROADMAP.md]**
- `.planning/07-reference/pr-audits/354-987fff01.md:11` -> **__ICAL_DRIFT__**
- `.planning/08-softwares/simpos.md:183` -> **44.7 [roadmap -> .planning/ROADMAP.md]**
- `.planning/decisions/0019-p2-build-scope.md:7` -> **44.15 [adr-text -> .planning/decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md]**
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:703` -> **__ICAL_DRIFT__**
- `.planning/foundation/teams/intelligence.md:110` -> **__44.2_CLASS__**

## LINE-MAPPED (11)

Matched by nearest-preceding register header whose line number equals its item key (the 1600+ zone's 'one header = one key' convention). Medium confidence — not immune to the same drift found elsewhere.

- `.planning/06-pages/receipts.md:46` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/07-reference/pr-audits/354-424312e5.md:17` -> **1653 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `.planning/07-reference/pr-audits/354-b0f0a514.md:35` -> **1682 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/07-reference/pr-audits/354-b0f0a514.md:44` -> **1682 [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:345` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `apps/api-gateway/src/procurement/canonical/from-parsed-document.spec.ts:132` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `apps/api-gateway/src/procurement/canonical/from-parsed-document.ts:796` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `apps/api-gateway/src/procurement/documents/document-intake.service.ts:282` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `apps/api-gateway/src/procurement/documents/door-count.spec.ts:207` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `apps/web/src/components/documents/__tests__/canonical-sections.test.tsx:919` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**
- `supabase/tests/20260906233000_stock_at_the_door_cost_at_verified_test.sql:2` -> **1994 [claims-row -> .planning/decisions/CLAIMS.jsonl]**

## ALREADY-COVERED (23)

Already listed in an existing item's citations_to_rewrite before this pass (2026-09-19 sweep). No action needed here.

- `.planning/03-scenarios/S04-pos-order-flows-to-inventory.md:156` -> ****
- `.planning/03-scenarios/S04-pos-order-flows-to-inventory.md:205` -> ****
- `.planning/06-pages/notifications.md:1191` -> **44.1d [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `.planning/06-pages/providers.md:191` -> ****
- `.planning/06-pages/providers.md:399` -> ****
- `.planning/06-pages/recommendations-catalog.md:103` -> ****
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:615` -> ****
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:694` -> ****
- `.planning/decisions/0119-an-agreed-price-states-its-unit.md:43` -> ****
- `.planning/decisions/0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove.md:7` -> ****
- `.planning/foundation/teams/intelligence.md:241` -> **44.1a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/auth.controller.ts:112` -> **44.1g [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/auth.controller.ts:114` -> **44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/auth.service.ts:683` -> **44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/auth.service.ts:1109` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/auth.service.ts:2591` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/house-role.ts:12` -> **44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/role-grant.ts:13` -> **44.1h [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/auth/strategies/jwt.strategy.ts:58` -> **44.1q [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/restaurants/members.service.spec.ts:553` -> **44.1p [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/restaurants/members.service.ts:168` -> **44.1p [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/restaurants/members.service.ts:404` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]**
- `apps/api-gateway/src/restaurants/removal-only-that-house.spec.ts:17` -> **44.1j [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]; 44.1n [claims-row -> .planning/decisions/CLAIMS.jsonl]**

## NOT-APPLICABLE (11)

ADR 0166's own executing tool/tests naming their own target filename by design. Not a citation to rewrite.

- `scripts/retire_tech_debt.py:5` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/retire_tech_debt.py:49` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/retire_tech_debt.py:60` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/retire_tech_debt.py:92` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:75` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:76` -> **44.1a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:77` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:78` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:79` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:80` -> **44.1a [REMOVED -- drop the citation (or say '(closed/removed, ADR 0166)' if the sentence needs it)]** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite
- `scripts/test_retire_tech_debt.py:399` -> **** — ADR 0166's own executing tool/tests naming its own target filename -- expected, not a citation to rewrite

## MANUAL-UNVERIFIABLE-SOURCE-MISSING (1)

Named by the prior critic pass on a different checkout; the file does not exist in the instructed grep source (wt-retire-debt). Re-verify at execution time.

- NOT IN wt-retire-debt @ 9c6bdc0be (file lives only on an unmerged ADR-0159 lane branch) -> **postgis-definer-functions-informal, arm-b-grant-option-credit-bug** — Could not verify directly: instructed grep source (wt-retire-debt) lacks this file. Re-verify at execution time once the ADR-0159 lane is merged.

## GENERIC-DOSSIER-UNVERIFIED (0 remaining -- all 143 resolved, R5 pass 2026-09-21)

A 06-pages/08-softwares/pr-audits/decisions/foundation/code dossier citing a bare register line number with no named concept. ADR 0166 validated this CLASS's file-count, not each line's current accuracy -- exactly the gap this round closed. Every one of the 143 references below was read directly at its real, current line (not the line-arithmetic this class's own preamble warns against) and given one of three dispositions per round 5's must_fix 3: a mapped item's home, a drop/closed disposition, or the tombstone. See `plan.json`'s `fixed_2026_09_21_r5.must_fix_3_citation_ledger` for the rollup and the three drift clusters this pass folded in (UX-catalog L151/L173/L187, the 442-null-rows/'plumbing complete' cluster, and the Phase-33/401-not-404 cluster inside 44.4).

<details><summary>Full reference list (143), each annotated with its R5 disposition</summary>


- `.planning/06-pages/PAGE-CONTRACT.md:30` -> **SPECIAL, must_fix 4** (gate-owned or live-instruction rewrite -- exact text in 'Special / cross-cutting rows' below)
- `.planning/06-pages/PAGES-MAP.md:134` -> **TOMBSTONE** -- generic mention of register carry-overs
- `.planning/06-pages/RETIRED.md:114` -> **TOMBSTONE** -- intro line to a self-contained quote block; content preserved in RETIRED.md itself
- `.planning/06-pages/RETIRED.md:120` -> **44.1e-collision-meta** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/RETIRED.md:123` -> **TOMBSTONE** -- drift: cites :395 for a 'wrong page name' correction; :395 today holds unrelated 44.1i content, and the original text was not relocated within this pass
- `.planning/06-pages/dashboard.md:354` -> **orders-wire-item1-vendor-name** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/dashboard.md:377` -> **44.1a** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/dashboard.md:437` -> **TOMBSTONE** -- no dedicated checklist item found for the getSalesChartData/Math.random dashboard defect distinct from 2666.A1-4
- `.planning/06-pages/dashboard.md:439` -> **HELD, off-page-5** (names one of the 5 checklist items never marked by the founder -- see plan.json's off_page_five block; not placed until that founder question is answered)
- `.planning/06-pages/dashboard.md:517` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/06-pages/dashboard.md:519` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/documents-reports.md:366` -> **44.1j** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/inventory.md:216` -> **TOMBSTONE** -- drift: cites :357 for 'INVENTORY_SOTA_PLAN phases 2-3'; that content is now at register:1226 (a plans-reconciliation table row, not one of the 230 marked items)
- `.planning/06-pages/inventory.md:220` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/inventory.md:227` -> **TOMBSTONE** -- historical POS-lens run summary with inline strikethrough of already-closed defects
- `.planning/06-pages/inventory.md:237` -> **TOMBSTONE** -- generic 'filed in v3.0-TECH-DEBT.md' with no line number, for item 26
- `.planning/06-pages/inventory.md:253` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/inventory.md:258` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/06-pages/inventory.md:335` -> **TOMBSTONE** -- same INVENTORY_SOTA_PLAN drift as inventory.md:216
- `.planning/06-pages/invite-landing.md:71` -> **44.4** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/logs.md:219` -> **TOMBSTONE** -- historical intelligence-lens run summary, no specific line cited
- `.planning/06-pages/logs.md:328` -> **TOMBSTONE** -- historical intelligence-lens run summary, no specific line cited
- `.planning/06-pages/no-access.md:63` -> **44.4** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/no-access.md:111` -> **44.4** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/notifications.md:980` -> **TOMBSTONE** -- drift: cites :389-390 (44.1i's roleInHouse addition) for an unrelated 'rendering shipped, persistence did not' claim; not relocated
- `.planning/06-pages/notifications.md:985` -> **TOMBSTONE** -- generic backward-reference to 'old gaps' over a wide range (:95-131)
- `.planning/06-pages/notifications.md:1116` -> **TOMBSTONE** -- historical POS-lens run summary with inline strikethrough of already-closed defects
- `.planning/06-pages/notifications.md:1118` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/notifications.md:1163` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/06-pages/notifications.md:1165` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/orders.md:100` -> **orders-wire-item1-vendor-name** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/orders.md:102` -> **orders-wire-item2-recurrence** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/orders.md:369` -> **orders-wire-item1-vendor-name + orders-wire-item3-quantity-received** (see those items' citations_to_rewrite in plan.json)
- `.planning/06-pages/orders.md:526` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/orders.md:682` -> **__44.2_CLASS__** (joins the existing bare-section-mention cluster above)
- `.planning/06-pages/orders.md:803` -> **orders-wire-item4-createorderrequest-mismatch** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/orders.md:1043` -> **orders-wire-item1-vendor-name + orders-wire-item3-quantity-received** (see those items' citations_to_rewrite in plan.json)
- `.planning/06-pages/privacy.md:81` -> **TOMBSTONE** -- explicitly says 'Not in v3.0-TECH-DEBT.md' -- a negative reference, moot once the file is gone
- `.planning/06-pages/privacy.md:137` -> **SPECIAL, must_fix 4** (gate-owned or live-instruction rewrite -- exact text in 'Special / cross-cutting rows' below)
- `.planning/06-pages/promotions.md:82` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/promotions.md:184` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/providers.md:547` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/receipts.md:243` -> **TOMBSTONE** -- drift: cites :447 for 'match suggestions have no UI, deferred by design'; the real content is the register's own '## Deferred by design' table (~line 1316), which already names YC_WEDGE_PLAN.md as its destination -- no register-item action needed
- `.planning/06-pages/receipts.md:246` -> **TOMBSTONE** -- drift: cites :446 for 'Recovery metrics not built'; same '## Deferred by design' table (~line 1315, 'Cost-drift-caught... metrics', destination YC_WEDGE_PLAN.md already stated)
- `.planning/06-pages/receipts.md:272` -> **TOMBSTONE** -- generic 'Filed in v3.0-TECH-DEBT.md' with no line number, for the door-count-not-read topic
- `.planning/06-pages/receipts.md:331` -> **TOMBSTONE** -- same :447 'Deferred by design' drift as receipts.md:243
- `.planning/06-pages/receipts.md:332` -> **TOMBSTONE** -- same :446 'Deferred by design' drift as receipts.md:246
- `.planning/06-pages/receipts.md:588` -> **TOMBSTONE** -- same :447 'Deferred by design' drift as receipts.md:243
- `.planning/06-pages/receipts.md:590` -> **TOMBSTONE** -- same :446 'Deferred by design' drift as receipts.md:246
- `.planning/06-pages/receiving-door.md:143` -> **orders-wire-item1-vendor-name** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/receiving-door.md:154` -> **TOMBSTONE** -- strikethrough historical note, self-correcting in place
- `.planning/06-pages/recommendations-catalog.md:119` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/recommendations.md:944` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/recommendations.md:1076` -> **TOMBSTONE** -- historical intelligence-lens run summary ('none found'), self-contained
- `.planning/06-pages/recommendations.md:1110` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/recommendations.md:1235` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/reports.md:898` -> **TOMBSTONE** -- drift: cites :322-324 (44.1h's YAREN-manager bracket) for a '(was Phase 41)' phase-tracking note; not relocated
- `.planning/06-pages/reports.md:998` -> **2666.A1-4** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/reports.md:1000` -> **TOMBSTONE** -- the 'Purchased Wines badge... 30 orders over 0 procurement_orders' defect has no dedicated checklist item distinct from 2666.A1-4/dashboard-top-wines-wrong-table; flagged, not invented
- `.planning/06-pages/reports.md:1051` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/06-pages/reports.md:1053` -> **TOMBSTONE** -- historical intelligence-lens run summary, self-contained
- `.planning/06-pages/reports.md:1157` -> **TOMBSTONE** -- same :322-324 drift as reports.md:898
- `.planning/06-pages/simpos-terminal.md:114` -> **TOMBSTONE** -- historical POS-lens run summary ('all six fixed #310'), self-contained
- `.planning/06-pages/simpos-terminal.md:152` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/06-pages/simpos-terminal.md:236` -> **44.1h + 44.1j** (see those items' citations_to_rewrite in plan.json)
- `.planning/06-pages/sommelier.md:91` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/sommelier.md:98` -> **TOMBSTONE** -- historical intelligence-lens run summary (#317 closed), self-contained
- `.planning/06-pages/sommelier.md:131` -> **TOMBSTONE** -- historical intelligence-lens run summary ('still hollow'), self-contained
- `.planning/06-pages/studio-certify.md:77` -> **HELD, off-page-5** (names one of the 5 checklist items never marked by the founder -- see plan.json's off_page_five block; not placed until that founder question is answered)
- `.planning/06-pages/studio-certify.md:199` -> **HELD, off-page-5** (names one of the 5 checklist items never marked by the founder -- see plan.json's off_page_five block; not placed until that founder question is answered)
- `.planning/06-pages/studio.md:90` -> **TOMBSTONE** -- negative/moot reference -- the page's OWN text says the item is 'not in v3.0-TECH-DEBT.md'
- `.planning/06-pages/team.md:412` -> **TOMBSTONE** -- negative reference -- confirms absence of any register entry for /team
- `.planning/06-pages/team.md:563` -> **TOMBSTONE** -- negative reference -- same as team.md:412
- `.planning/06-pages/team.md:564` -> **TOMBSTONE** -- negative reference -- same as team.md:412
- `.planning/06-pages/wines.md:1200` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/wines.md:1213` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/wines.md:1215` -> **TOMBSTONE** -- drift: cites :47-49 which today is just the bare section header '## Three findings...'; original content not relocated within this pass
- `.planning/06-pages/wines.md:1218` -> **44.15** (see that item's citations_to_rewrite in plan.json)
- `.planning/06-pages/wines.md:1535` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/07-reference/pr-audits/354-987fff01.md:46` -> **TOMBSTONE** -- generic structural mention of citation-table pointing
- `.planning/07-reference/pr-audits/354-987fff01.md:47` -> **TOMBSTONE** -- generic structural mention, same paragraph as :46
- `.planning/07-reference/pr-audits/354-b0f0a514.md:54` -> **TOMBSTONE** -- generic historical mention ('misattribution survivors fixed')
- `.planning/08-softwares/inventory-command.md:155` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/08-softwares/inventory-command.md:172` -> **TOMBSTONE** -- same INVENTORY_SOTA_PLAN drift as inventory.md:216
- `.planning/08-softwares/pos-bridge.md:235` -> **TOMBSTONE** -- historical POS-lens run summary, self-contained
- `.planning/08-softwares/pos-bridge.md:261` -> **TOMBSTONE** -- generic dated reference ('four defects... in 2026-09-03') to the already-separately-tracked 2433.x cluster
- `.planning/08-softwares/receipts-invoice-match.md:50` -> **TOMBSTONE** -- same :447 'Deferred by design' drift as receipts.md:243
- `.planning/08-softwares/receipts-invoice-match.md:149` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `.planning/08-softwares/receipts-invoice-match.md:308` -> **TOMBSTONE** -- same :446 'Deferred by design' drift as receipts.md:246
- `.planning/08-softwares/receipts-invoice-match.md:331` -> **TOMBSTONE** -- historical ADR-0103 'rule A' review-trail narrative (2026-09-06 finding 1), dated changelog prose
- `.planning/08-softwares/wine-library-sommelier.md:105` -> **inventory-add-remove-item7** (see that item's citations_to_rewrite in plan.json)
- `.planning/decisions/0005-v3-to-v0-version-reset.md:16` -> **TOMBSTONE** -- generic Links line
- `.planning/decisions/0005-v3-to-v0-version-reset.md:21` -> **TOMBSTONE** -- generic mention of v3-era work tracking
- `.planning/decisions/0005-v3-to-v0-version-reset.md:36` -> **TOMBSTONE** -- generic mention of internal milestone numbering
- `.planning/decisions/0010-gemini-model-retirement.md:7` -> **TOMBSTONE** -- generic Links line
- `.planning/decisions/0018-p2-plan-of-record.md:66` -> **TOMBSTONE** -- generic mention of the register as 'organizing frame'
- `.planning/decisions/0019-p2-build-scope.md:24` -> **HELD, off-page-5** (names one of the 5 checklist items never marked by the founder -- see plan.json's off_page_five block; not placed until that founder question is answered)
- `.planning/decisions/0032-vault-cleanup-cut-line.md:34` -> **TOMBSTONE** -- generic mention alongside REQUIREMENTS.md
- `.planning/decisions/0032-vault-cleanup-cut-line.md:74` -> **TOMBSTONE** -- generic mention in a vault-cleanup table row
- `.planning/decisions/0032-vault-cleanup-cut-line.md:121` -> **TOMBSTONE** -- generic mention, citation-count context
- `.planning/decisions/0044-mudavym-implementation-kickoff.md:138` -> **TOMBSTONE** -- generic 'two P2-found defects' mention, no specific ids
- `.planning/decisions/0045-rivet-m-and-full-go.md:153` -> **TOMBSTONE** -- generic 'four systemic items filed' mention, no specific ids
- `.planning/decisions/0064-a-fitted-value-is-a-prediction-not-a-memory.md:7` -> **TOMBSTONE** -- generic wiki-style Links line
- `.planning/decisions/0064-a-fitted-value-is-a-prediction-not-a-memory.md:34` -> **TOMBSTONE** -- drift: cites :928 (today the 44.2c CI-mismatch table) for a Holt-Winters 'post-update trend' forecasting fact; not relocated
- `.planning/decisions/0064-a-fitted-value-is-a-prediction-not-a-memory.md:132` -> **TOMBSTONE** -- generic 'already done this since 2026-08-31' mention
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:198` -> **TOMBSTONE** -- historical review-trail narrative, dated changelog prose
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:279` -> **TOMBSTONE** -- historical review-trail narrative ('2026-09-06 finding 1'), dated changelog prose
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:325` -> **TOMBSTONE** -- historical review-trail narrative ('Follow-up owed... 2026-09-06'), dated changelog prose
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:335` -> **TOMBSTONE** -- historical review-trail table row, self-contained
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:338` -> **TOMBSTONE** -- historical review-trail table row ('rule A did not survive it'), self-contained
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:339` -> **TOMBSTONE** -- historical review-trail table row, self-contained
- `.planning/decisions/0103-a-delivery-is-agreed-before-it-is-verified.md:350` -> **TOMBSTONE** -- historical review-trail table row, self-contained
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:696` -> **TOMBSTONE** -- historical review-trail table row (second render), self-contained
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:698` -> **TOMBSTONE** -- historical review-trail table row (slice 3 stop 1), self-contained
- `.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:705` -> **TOMBSTONE** -- historical review-trail table row (slice 4 re-drive), self-contained
- `.planning/decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md:141` -> **TOMBSTONE** -- ALREADY-COVERED: within the :139-141 range already attached to 2433/2433.1/2433.2's citations_to_rewrite
- `.planning/decisions/0129-below-par-is-strictly-below-par.md:16` -> **TOMBSTONE** -- generic Links line ('POS lens, defect 7'), no line number; the underlying below-par fix is historical/closed (PR #312)
- `.planning/decisions/0139-an-oauth-sign-in-binds-to-a-linked-account.md:226` -> **TOMBSTONE** -- historical mention ('under the PR #179 closure')
- `.planning/decisions/0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove.md:63` -> **offline-storage-swallow** (see that item's citations_to_rewrite in plan.json)
- `.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md:9` -> **NOT-APPLICABLE** (ADR 0166 naming its own retirement target by design, same as the existing NOT-APPLICABLE tier)
- `.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md:18` -> **NOT-APPLICABLE** (ADR 0166 naming its own retirement target by design, same as the existing NOT-APPLICABLE tier)
- `.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md:60` -> **NOT-APPLICABLE** (ADR 0166 naming its own retirement target by design, same as the existing NOT-APPLICABLE tier)
- `.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md:64` -> **NOT-APPLICABLE** (ADR 0166 naming its own retirement target by design, same as the existing NOT-APPLICABLE tier)
- `.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md:206` -> **NOT-APPLICABLE** (ADR 0166 naming its own retirement target by design, same as the existing NOT-APPLICABLE tier)
- `.planning/decisions/OPEN-DECISIONS.md:49` -> **TOMBSTONE** -- OD-60 row: 'Detail in v3.0-TECH-DEBT.md' is a generic supplementary-detail pointer
- `.planning/decisions/OPEN-DECISIONS.md:83` -> **TOMBSTONE** -- OD-01 row: already-resolved historical record; mentions the register only while listing the top-level spine
- `.planning/decisions/README.md:89` -> **SPECIAL, must_fix 4** (gate-owned or live-instruction rewrite -- exact text in 'Special / cross-cutting rows' below)
- `.planning/decisions/README.md:152` -> **SPECIAL, must_fix 4** (gate-owned or live-instruction rewrite -- exact text in 'Special / cross-cutting rows' below)
- `.planning/decisions/README.md:154` -> **SPECIAL, must_fix 4** (gate-owned or live-instruction rewrite -- exact text in 'Special / cross-cutting rows' below)
- `.planning/foundation/README.md:273` -> **TOMBSTONE** -- process-cadence table row ('Weekly | Tech-debt triage...'), becomes moot
- `.planning/foundation/teams/corporate.md:182` -> **TOMBSTONE** -- generic mention alongside ORG_STRUCTURE
- `apps/api-gateway/src/auth/dev-bypass-verified.spec.ts:40` -> **2381** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/auth/dev-bypass.util.ts:45` -> **2381** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/canonical/canonical-document.service.spec.ts:415` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/canonical/canonical-invariants.spec.ts:467` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/canonical/delivery-mock.ts:15` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/canonical/delivery-stock.service.ts:17` -> **TOMBSTONE** -- historical ADR-0103 'rule A' review-trail narrative (2026-09-06, ADR 0103 A2), dated comment
- `apps/api-gateway/src/procurement/canonical/from-parsed-document.spec.ts:341` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/documents/document-extractor.spec.ts:559` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/documents/document-intake.service.spec.ts:155` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)
- `apps/api-gateway/src/procurement/order-recurrence.service.ts:22` -> **orders-wire-item3b-recurring-auto-approve-no-seal** (extends that item's existing order-recurrence.service.ts:17-21 citation to :17-22, same comment block)
- `apps/api-gateway/src/procurement/receiving.service.ts:538` -> **TOMBSTONE** -- generic 'for the founder rather than guessed at' comment, no line number or specific claim named
- `apps/web/src/components/documents/__tests__/canonical-sections.test.tsx:499` -> **canonical-first-render-9-findings** (see that item's citations_to_rewrite in plan.json)

</details>




## GENERIC-ORG-CORPUS (36)

A 01-org/04-specs/00-index/sketches structural or census mention of the register's existence/role, not a technical pointer into specific content. Default rewrite: remove the filename from the enumeration, or replace with a pointer to ADR 0166 (the retirement record), as a single mechanical repo-wide sweep — this is the class ADR 0166's own 'problems_left' note recommended running as a dedicated pass at deletion time; it is enumerated here in full so nothing is silently skipped, not because each line needs bespoke prose.

<details><summary>Full reference list (36)</summary>


- `.planning/01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-board.md:133`
- `.planning/01-org/corporate/knowledge-documentation/memory/2026-08-28-vault-census.md:11`
- `.planning/01-org/corporate/knowledge-documentation/teams/graph-retrieval/graph-retrieval-agenda-board.md:71`
- `.planning/01-org/corporate/knowledge-documentation/teams/graph-retrieval/graph-retrieval-charter.md:75`
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-directive.md:104`
- `.planning/01-org/intelligence/analytics-bi/analytics-bi-premortem.md:22`
- `.planning/01-org/intelligence/analytics-bi/teams/analytics-engine/analytics-engine-charter.md:196`
- `.planning/01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-charter.md:66`
- `.planning/01-org/intelligence/security/security-charter.md:292`
- `.planning/01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-agent-stack.md:129`
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-agenda-full.md:102`
- `.planning/01-org/research-math/teams/evaluation-doneability/evaluation-doneability-charter.md:32`
- `.planning/03-scenarios/DELIVERY-AUDIT.md:6`
- `.planning/03-scenarios/S02-vendor-delivery-arrives.md:78`
- `.planning/03-scenarios/S03-vendor-delivery-short-wrong-or-damaged.md:143`
- `.planning/04-specs/ECOSYSTEM-E0-MEASUREMENTS.md:260`
- `.planning/04-specs/ECOSYSTEM-PLAN.md:85`
- `.planning/04-specs/HANDOFF-page-retirement.md:104`
- `.planning/04-specs/P1-PYTHON-EMITTER.md:134`
- `.planning/04-specs/P1-PYTHON-EMITTER.md:328`
- `.planning/04-specs/POS-BRIDGE-AUDIT.md:13`
- `.planning/04-specs/POS-BRIDGE-AUDIT.md:65`
- `.planning/04-specs/POS-BRIDGE-AUDIT.md:440`
- `.planning/archive/ROADMAP-pre-P2-20260825.md:484`
- `.planning/archive/ROADMAP-pre-P2-20260825.md:702`
- `.planning/sketches/087-mudavym-motion-canvas/index.html:5198`
- `.planning/sketches/087-mudavym-motion-canvas/index.html:12102`
- `.planning/sketches/087-mudavym-motion-canvas/index.html:12104`
- `.planning/sketches/087-mudavym-motion-canvas/parts/prc.html:837`
- `.planning/sketches/087-mudavym-motion-canvas/parts/sig-c.html:349`
- `.planning/sketches/087-mudavym-motion-canvas/parts/sig-c.html:351`
- `.planning/sketches/087-mudavym-motion-canvas/shortlist.html:5173`
- `.planning/sketches/087-mudavym-motion-canvas/shortlist.html:12077`
- `.planning/sketches/087-mudavym-motion-canvas/shortlist.html:12079`
- `.planning/testing/SYNTHETIC-TENANT.md:222`
- `datasets/library/REPAIR-2026-09-05.md:208`

</details>



## Special / cross-cutting rows named explicitly by the critic


- **CLAUDE.md:124** — `as the live spine — the only top-level docs besides \`v3.0-TECH-DEBT.md\` and`
  Rewrite: drop `` `v3.0-TECH-DEBT.md` and `` so the sentence reads "...as the live spine —
  the only top-level docs besides `config.json`." (gate-owned; not edited here, this is the
  exact text for whoever executes it.)
- **CLAUDE.md:130** — `` - `v3.0-TECH-DEBT.md` is the live defect register. Check it before claiming
  something is broken or fixed.``
  Rewrite: replace the whole bullet with: "- The defect register retired (ADR 0166, 2026-09-19).
  Checkable defects live as open `CLAIMS.jsonl` rows; the founder's still-open forks live in
  `OPEN-DECISIONS.md`; everything else folded into its owning ADR." Net zero lines (one bullet
  replaces one bullet), matching the critic's own "CLAUDE.md gains no lines" constraint.
- **[ADDED 2026-09-21, R5 must_fix 4] decisions/README.md:89** — the ADR 0064 row ends "...
  the sibling the opening brief called correct, because it read pre-update *level* but
  **post-update trend**; `` `v3.0-TECH-DEBT.md:928` `` had this right and the brief did not."
  This is itself a DRIFTED citation (register:928 today is the unrelated 44.2c CI-run-mismatch
  table, not anything about forecasting — confirmed by direct read; the original content was not
  relocated within this pass). Rewrite: drop the file pointer and keep the historical claim in
  prose: "...the sibling the opening brief called correct, because it read pre-update *level* but
  **post-update trend**; an earlier tech-debt note had this right and the brief did not." (gate-owned;
  not edited here, this is the exact text for whoever executes it.)
- **[ADDED 2026-09-21, R5 must_fix 4] decisions/README.md:152** — the ADR 0139 row ends "...Closes
  the live `` `v3.0-TECH-DEBT.md` `` item on sign-in-without-a-link — by refusing, not by writing
  the row." Rewrite: "...Closes the live sign-in-without-a-link defect — by refusing, not by writing
  the row." (drop the backtick file reference; the sentence names its own fact, so nothing else
  needs to move.) (gate-owned; not edited here, this is the exact text for whoever executes it.)
- **[ADDED 2026-09-21, R5 must_fix 4] decisions/README.md:154** — the ADR 0141 row ends "...**Left
  open and filed in `` `v3.0-TECH-DEBT.md` `` :** NULL is still admitted, and the second migration
  that makes it refuse is blocked on `` `services/agent-orchestrator/core/database.py:1077` ``
  [citation corrected 2026-09-12 from `:996`], which takes only an inventory id and cannot name a
  house." This is the exact fact `adr0141-null-restaurant-id-deferred` (existing CLAIMS.jsonl row)
  already tracks (confirmed: same `database.py:1077`/`update_stock` citation, same gap). Rewrite:
  "...**Left open (tracked as `adr0141-null-restaurant-id-deferred` in `CLAIMS.jsonl`):** NULL is
  still admitted, and the second migration that makes it refuse is blocked on
  `` `services/agent-orchestrator/core/database.py:1077` `` [citation corrected 2026-09-12 from
  `:996`], which takes only an inventory id and cannot name a house." (gate-owned; not edited here,
  this is the exact text for whoever executes it.)
- **[ADDED 2026-09-21, R5 must_fix 4] 06-pages/PAGE-CONTRACT.md:30** — the page-dossier template's
  own §9 row: `| 9 | **Gaps** | Dead sections, unreachable states, known defects — link
  `` `v3.0-TECH-DEBT.md` `` items rather than restating |`. This is a LIVE INSTRUCTION every future
  page dossier follows, not a one-off citation — left alone, every page written after the register
  is deleted would keep being told to link a file that does not exist. Rewrite: `| 9 | **Gaps** |
  Dead sections, unreachable states, known defects — link the defect's `` `CLAIMS.jsonl` `` row,
  `` `OPEN-DECISIONS.md` `` entry, or owning ADR rather than restating |`. Not gate-owned (a regular
  page-contract dossier, not CLAUDE.md/decisions/README.md) but left unedited here per this round's
  "do not execute the retirement" instruction — this is the exact text for whoever executes it.
- **[ADDED 2026-09-21, R5 must_fix 4] 06-pages/privacy.md:137** — a pending page-dossier action
  item: "3. Register the coupling in `` `v3.0-TECH-DEBT.md` `` — §9 notes it is absent from the
  register, which is why it is invisible to anyone not reading this page." Rewrite: "3. Register
  the coupling as an open `` `CLAIMS.jsonl` ``/`` `OPEN-DECISIONS.md` `` row (the defect register
  retired, ADR 0166) — §9 notes it is absent from tracking, which is why it is invisible to anyone
  not reading this page." Not gate-owned, left unedited here for the same reason as PAGE-CONTRACT.md
  above — exact text supplied for whoever executes it.
- **PROJECT.md:47** — "its unfinished work is the live defect register [v3.0-TECH-DEBT.md](v3.0-TECH-DEBT.md),
  which feeds P2.3's proposal" — structural, not item-specific. Rewrite: "its unfinished work is
  tracked as open `CLAIMS.jsonl` rows, `OPEN-DECISIONS.md` forks and owning ADRs (register retired,
  [ADR 0166](decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md))".
- **07-reference/INDEX.md:22** — "v2.0-MILESTONE-AUDIT.md ... feeds `v3.0-TECH-DEBT.md`" — describes
  a now-dead relationship between two docs, one of which (v2.0-MILESTONE-AUDIT.md) is a frozen
  historical record left untouched (same convention as the archive files ADR 0166 itself leaves
  alone). Rewrite: "feeds the (retired 2026-09-19, ADR 0166) defect register" — keep the historical
  claim honest without a dead link.
- **07-reference/INDEX.md:23** — cites "v3.0-TECH-DEBT 44.13" for the UX_PATHS_CATALOG row, but
  44.13 is Autonomous Vendor Discovery — the UX catalog / 760-path burn-down is **44.15**'s subject.
  This is a pre-existing miscite in the current file, independent of the retirement. Rewrite:
  correct "44.13" to "44.15" AND point at wherever 44.15 lands (ROADMAP/FUTURES per its MOVE mark).
- **`.planning/decisions/OPEN-DECISIONS.md`, preamble** (the "ID collision, reconciled
  2026-08-24" blockquote near the top of the file; not a `| OD-nn |` row) — a frozen
  historical note about a past renumbering of decisions 57 through 63. Leave as-is; it is a
  closed historical record of an event, not a live pointer (same convention CLAUDE.md
  already applies to archive/*.md and v2.0-MILESTONE-AUDIT.md).
  **[REWORDED 2026-09-21, R5; SUPERSEDED 2026-09-21, R6]** — R5 rephrased "OD-57..63" to
  dodge the `OD-\d+` half of the pairing check but kept a bare line-number locator (line
  14), which `check_citation_pairing.py` still treats as a citation needing a paired id and
  correctly reported UNANCHORED (round 5's own last call reproduced the regression at this
  file, this line, exit 1). No line number can ever pair here — the preamble is not a
  register row. R6 drops the line-number form and anchors by section content instead.
  Meaning is unchanged; this is still not a content fix to the register itself.
- **4 migration comments that cannot be edited** (all resolved above with a specific item):
  `20260906023000_the_library_may_say_it_does_not_know.sql:77` -> library-identity-item1-repair (REMOVE/closed);
  `20260906233000_stock_at_the_door_cost_at_verified.sql:5` -> vendor-lens-slice3stop3-finding2-cost-state;
  `20260912163000_a_stock_write_names_its_house.sql:55` -> adr0141-null-restaurant-id-deferred (already has
  a durable home via an existing ADR-0141 CLAIMS row, independent of the register);
  `20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql:5` -> 44.1h/44.1i (ALREADY-COVERED,
  explicit). All four stay resolvable purely through ADR 0166's tombstone (which item's new home a reader
  should go find), exactly as CLAUDE.md §4 / ADR 0032 specify for content that cannot itself be edited.


## __ICAL_DRIFT__ — a proven citation-drift cluster (19 references, resolved as one)


All 19 cite `v3.0-TECH-DEBT.md:243-245` or `:346-348` for "no external calendar client has ever
confirmed the iCal feed subscribes." Both ranges currently fall inside **44.1g**'s content
(`POST /auth/register` role-scoping), not calendar code — confirmed by reading both spans directly.
The actual text ("Phase 30 iCal — code scored 10/10 but no external calendar client has ever
confirmed the feed subscribes") lives at **register:1103-1105 today**, inside **44.4**'s range,
as an uncredited sub-bullet with no key of its own (same shape as the 44.2/44.3 section-level
citations). None of the 19 files' citations are safe to line-copy forward.
Rewrite for all 19: replace the dead `v3.0-TECH-DEBT.md:243-245`/`:346-348` citation with a plain-text
restatement of the claim (already known and quoted above) plus, if 44.4 is not simply dropped as
"old bookkeeping" (its current REMOVE mark — see the report's founder-question flag on this),
a pointer to wherever 44.4 lands. Affected: calendar.md x5, settings.md x4, calendar.controller.ts:744,
CalendarSection.tsx:5, 08-softwares/calendar.md:152, 08-softwares/dashboard-home.md:141,
decisions/0111-the-calendar-is-the-houses-day-book.md:469.


## __44.2_CLASS__ — bare section-level mentions (4 references, was 3)


References to "the defect class `v3.0-TECH-DEBT.md:127` names (hollow features that report success)"
cite the SECTION concept, not any one of its five sub-items (44.2a/b/c/d/z, each already individually
placed). No single item owns "44.2" as a whole. Rewrite: replace with the concept in plain words
(already quoted verbatim in each citing sentence, so no information is lost) with no file pointer,
since the concept's constituent defects are now tracked individually and a single umbrella citation
would be misleading about which one(s) are still open.

**[ADDED 2026-09-21, R5 must_fix 3]** A 4th reference, `.planning/06-pages/orders.md:682`
("a 'not ready yet' catch is exactly the pattern `v3.0-TECH-DEBT.md` §44.2 names"), was found
in the GENERIC-DOSSIER-UNVERIFIED sweep and confirmed to name the same bare section concept —
joins this cluster rather than getting its own row.


## __ORDERS_WIRE_ITEM2__ — a second classifier miss, resolved as one (8 references, was 7)

**[CORRECTED 2026-09-21, R5 must_fix 3]** The "7 references" figure below was incomplete: an 8th
citation, `.planning/06-pages/orders.md:102` ("An order can be made to repeat... closes
`v3.0-TECH-DEBT` 'The orders wire' item 2"), was found in the GENERIC-DOSSIER-UNVERIFIED sweep —
it quotes the identical section/item-2 name the other 7 do, and was missed by the original
citelib pass because it sits right next to (and reads similarly to) `orders.md:100`'s item-1
citation. Confirmed by direct read: describes the identical closed defect (the Recurring
station could never fill; CLOSED 2026-09-05). Same rewrite as the other 7.

Added 2026-09-19, second pass, after an independent verifier named this exact 7-file cluster by hand.
All 7 (now 8, see the correction above) quote `.planning/v3.0-TECH-DEBT.md "The orders wire" item 2` by name and section title —
an EXPLICIT match the first classifier pass missed because this register uses "item 2 of a named
section" rather than the "44.x" pattern its regex looked for (the same class of miss as
`team.service.ts:453` -> 44.1n above, just not caught for this cluster the first time).

Content confirmed by direct read of all 7 citing lines on `wt-retire-debt@9c6bdc0be`: every one
describes the identical fixed defect — `useOrdersNextData.toRow` set `recurring = false`
unconditionally, so the rebuilt page's Recurring station could never fill — which is exactly
`orders-wire-item2-recurrence`'s own content (CLOSED 2026-09-05, the recurrence migration landed).
None of the 7 mentions the separate, still-open legacy-page half
(`orders-wire-item2b-legacy-not-migrated`, about `Orders.tsx`/`mapApiOrderToUi`), so the two were
checked individually and not conflated.

Rewrite for all 7: **orders-wire-item2-recurrence [REMOVED -- drop the citation (or say
'(closed/removed, ADR 0166)' if the sentence needs it)]**.
Affected: `.planning/decisions/0125-an-order-changes-state-through-a-sealed-transition.md:568`,
`apps/api-gateway/src/procurement/dto/procurement.dto.ts:1077`,
`apps/api-gateway/src/procurement/order-recurrence.service.spec.ts:19`,
`apps/api-gateway/src/procurement/order-recurrence.ts:12`,
`apps/web/src/pages/orders/next/Recurrence.test.tsx:18`,
`apps/web/src/pages/orders/next/recurrence.ts:11`,
`apps/web/src/services/api/types.ts:367`,
and (added 2026-09-21, R5) `.planning/06-pages/orders.md:102`.

**Not part of this cluster:** `apps/api-gateway/src/procurement/order-recurrence.service.ts:22` sits
in the same file family and was checked for the same reason, but it names a different, still-open
defect instead — an `auto_approve` schedule (`recurring-orders.service.ts:888`) that spends money
through `approveOrder` with no seal and no threshold check. Left in GENERIC-DOSSIER-UNVERIFIED at
the time; swept in by proximity it would have been a wrong, undisclosed merge.

**[RESOLVED 2026-09-21, R5 must_fix 3]** Confirmed: `order-recurrence.service.ts:22` is line 22 of
the SAME header comment `orders-wire-item3b-recurring-auto-approve-no-seal` already cites at lines
17-21 (same file, same block, same `auto_approve`/no-seal claim) — it is that item's own citation,
one line further than what was captured. Its `citations_to_rewrite` entry is extended from
`order-recurrence.service.ts:17-21` to `:17-22` rather than added as a new row. No longer left
untouched.
