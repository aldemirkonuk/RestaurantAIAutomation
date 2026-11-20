# g3 mail-gw build, 2026-11-19

PR: #1917 (draft) https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1917
Branch: feat/mail-reads-every-conversation-gw, head 0de8fce42977ca5a04a93f27da952d6bc14d897d, base origin/main c459b0a12.
Gap verified real at base (house-inbox.service.ts from:(book) + post-check discard).

Forks as decided: (a) new id gmail_read_all with own words; (b) old grants stay vendor-bound, a holder of both read via the wide one only; (c) rows mirrored under the wide grant's id, revoke deletes them (vendor tombstoned, team/guest deleted whole); (d) kind/from_address/to_addresses on each row.

My calls beyond the brief: team/guest rows owner+manager only; no attachment bytes for team/guest; query `after:N -in:sent -in:drafts`; wide listing takes oldest 250 of full listing, >5000 ids = failed read; accept/revoke = the generic /integrations/oauth/:id routes (no new route); provider_id made nullable with CHECK (kind<>'vendor' OR provider_id IS NOT NULL).

Tests: tsc (both configs) clean; jest communications+orchestrator+conversations+integrations 80 suites / 1561 passed; 11 mutants all killed; migration guards pass.

Left: web (consent entry for gmail_read_all on /connections, MailTab kind chips, from/to display, waiting state); the retention owner notice still says "mirrored vendor replies" for the wide grant's rows; other readers of procurement_conversations (about 20 files) not audited for team/guest rows (they key on provider/order, which these rows lack, but weekly-report style counts were not checked); conflicts with #1760 (statusFor) and #1599 (empty-book branch) to resolve at merge.

Browser checks owed: see PR #1917 body (5 checks). Not run: local stack and browser were off limits.
