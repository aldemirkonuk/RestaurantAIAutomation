# g2 mail-all build, 2026-11-19: STOPPED, ESCALATE (consent scope). No PR, no worktree, no code.

Gap verified real at origin/main c459b0a12: house-inbox.service.ts:589 builds `from:(<book chunk>) after:<cursor>`; the
post-check at ~:395 discards any sender not in the book (BOUND 1 + BOUND 2, file header lines 52-66). Reader cannot see non-vendor mail.

Why stopped (a rule the brief did not spell out):
- The live consent text each person agreed to says the opposite of the widening:
  integrations-oauth.constants.ts:236 "Read mail in your mailbox - used only for the vendors in this house's book";
  house-sender.service.ts:486 "reads only mail from the vendors already in this house's book".
- The file header calls vendor-only reading "a privacy property first" (ADR 0118 D8-D11: second grant read-only, house-declared, person-consented).
- Widening the read on existing grants would read mail those people did not consent to. A founder decision cannot widen a third party's consent.
- Unspecified by the brief: re-consent flow / new scope id (e.g. gmail_read_all) vs reuse of gmail_read; whether existing grants stay vendor-only until re-consented;
  retention + revocation of non-vendor rows (mirrored_by_grant_id deletion path, ADR 0118) and whether team/guest mail gets retention rules.
- Also: web side is a 20+ deep stacked chain (newest MailTab PR #1834 -> #1762 -> ... -> #1441); gateway reader has open PRs #1760 (base main) and #1599 chain on the same file.

Recommended build once decided (all independent of nothing else):
1. New integration id gmail_read_all (own consent copy, own disconnect); reader widens only for grants holding it; old grants stay vendor-bound.
2. Migration (version past main and all open PRs) adds procurement_conversations.kind text check in (vendor,team,guest) default vendor + from/to address columns if absent.
3. Kind classifier: vendor if sender in book, else team if matches house team member (same restaurant_id), else guest. House scoping from the grant only.
4. MailTab kind filter chips; letter sheet waiting state while chunk loads; each letter shows from and to.
5. Tests: classifier, cross-house never filed, old grant stays bounded; mutation; tsc; jest/vitest; vite build.

Browser checks owed: none yet (nothing built).
