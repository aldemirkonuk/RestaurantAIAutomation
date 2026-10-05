## Two more notes that send the reader to /connections still land under "Other" on the bell page — OPEN — 2026-10-05

Found while giving `pos_import_refused` a register on `fix/bell-files-refused-checks` (ADR 0281's F7, founder: "Own group, small web PR (Recommended)"). Two other gateway notes carry `actionUrl: "/connections"` and have no row in `KIND_BY_TYPE` (`apps/web/src/pages/notifications/next/nt-format.ts`), so `kindOf` files them under *Other* and draws the *Other* inbox mark:

- `mail_grant_absent`, "The house's mail reading is on, and nothing is backing it" (`apps/api-gateway/src/notifications/producers/mail-grant-absent.producer.ts:202`, link at `:206`).
- `mail_retention_deleted`, "Mirrored mail deleted" (`apps/api-gateway/src/communications/retention/raw-mail-retention.service.ts:896`, link at `:900`).

`grep -rn "mail_grant_absent\|mail_retention_deleted" apps/web/src` returns nothing.

**Fix.** One `KIND_BY_TYPE` row each, plus a case in `nt-format.test.ts`. Which register each belongs to (*Connections*, where the link goes, or *Vendor mail*, which is what the notes are about) is a register choice to ask, not to assume. Not done on this branch: the founder's F7 answer named `pos_import_refused` only, and one operation per branch.
