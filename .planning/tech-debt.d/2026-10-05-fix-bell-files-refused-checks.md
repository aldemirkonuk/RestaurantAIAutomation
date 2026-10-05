## Two more notes that send the reader to /connections still land under "Other" on the bell page — OPEN — 2026-10-05

Found while giving `pos_import_refused` a register on `fix/bell-files-refused-checks` (ADR 0281's F7, founder: "Own group, small web PR (Recommended)"). Two other gateway notes carry `actionUrl: "/connections"` and have no row in `KIND_BY_TYPE` (`apps/web/src/pages/notifications/next/nt-format.ts`), so `kindOf` files them under *Other* and draws the *Other* inbox mark:

- `mail_grant_absent`, "The house's mail reading is on, and nothing is backing it" (`apps/api-gateway/src/notifications/producers/mail-grant-absent.producer.ts:202`, link at `:206`).
- `mail_retention_deleted`, "Mirrored mail deleted" (`apps/api-gateway/src/communications/retention/raw-mail-retention.service.ts:896`, link at `:900`).

`grep -rn "mail_grant_absent\|mail_retention_deleted" apps/web/src` returns nothing.

**Fix.** One `KIND_BY_TYPE` row each, plus a case in `nt-format.test.ts`. Which register each belongs to (*Connections*, where the link goes, or *Vendor mail*, which is what the notes are about) is a register choice to ask, not to assume. Not done on this branch: the founder's F7 answer named `pos_import_refused` only, and one operation per branch.

## The notifications page note's sentences about the Connections register are stale — OPEN — 2026-10-05

- `.planning/06-pages/notifications.md:295-296` says a *Connections* row is "drawn and tallied correctly". It was drawn, but not tallied. The rail's "On this page" tally walks `KIND_ORDER` only (`registerTally` in `apps/web/src/pages/notifications/next/NotificationsNext.tsx`), and `KIND_ORDER` had no *Connections* entry. So a *Connections* line was never counted, and a book holding only such lines said "The book is open and empty." **Fixed on this branch:** *Connections* is in `KIND_ORDER`, between *Market* and *System* (the order `ICON_BY_KIND` already used). `nt-format.test.ts` now requires every register `KIND_BY_TYPE` names to be in `KIND_ORDER` and to draw its own mark.
- `.planning/06-pages/notifications.md:1924` (§13.31) and `:1942` (§13.33) still say `grant_suspended` and `mcp_tool_added` have no register. Both have had *Connections* rows in `KIND_BY_TYPE` since #289.

**Fix.** A docs pass on the page note: correct the "tallied" sentence, strike §13.31 and §13.33 as closed, and add `pos_import_refused` to the *Connections* paragraph. Not done here because this branch is limited to three files.
