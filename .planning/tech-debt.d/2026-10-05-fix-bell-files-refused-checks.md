## Two more notes that send the reader to /connections landed under "Other" on the bell page — CLOSED on `fix/bell-files-refused-checks` — 2026-10-05

Found while giving `pos_import_refused` a register on `fix/bell-files-refused-checks` (ADR 0281's F7, founder: "Own group, small web PR (Recommended)"). Two other gateway notes carry `actionUrl: "/connections"` and had no row in `KIND_BY_TYPE` (`apps/web/src/pages/notifications/next/nt-format.ts`), so `kindOf` filed them under *Other* and drew the *Other* inbox mark:

- `mail_grant_absent`, "The house's mail reading is on, and nothing is backing it" (`apps/api-gateway/src/notifications/producers/mail-grant-absent.producer.ts:202`, link at `:206`).
- `mail_retention_deleted`, "Mirrored mail deleted" (`apps/api-gateway/src/communications/retention/raw-mail-retention.service.ts:896`, link at `:900`).

**Answered, 2026-10-05 (AskUserQuestion).** Question: "Two other bell notes, "mail access missing" and "mail retention deleted", link to Connections but still fall under "Other". Which group should they join?" The founder's answer, verbatim: "Connections".

**Fixed on the same branch.** `KIND_BY_TYPE` maps both types to *Connections*, so they draw the Connections plug and are counted on the rail's Connections row. Pinned in `nt-format.test.ts` (four cases, one per type for the register and one for the mark) and `NotificationsNext.test.tsx` (one line of each type makes the rail read `Connections 2 / 2`, with no *Other* and no *Vendor mail* row). Dropping either row fails 3 tests; mapping both to *Vendor mail* fails 5.
