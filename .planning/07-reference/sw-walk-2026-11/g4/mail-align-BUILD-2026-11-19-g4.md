# g4 mail-align build, 2026-11-19

Gap verified real at owner tips: web #1916 (feat/g3-mail-web-all-conversations) called POST/DELETE /mail/consent, sent a `kind` query to GET /mail/people and read `reader.readAll`; #1917 declares none of these (it adds grant id `gmail_read_all` on /integrations/oauth/*, a `kind` column and RPC withholding).

PRs: #1916 (commit 1707c1f4f pushed on its branch), #1917 body only (no code change; no real bug found). Merge order: #1917 before #1916, noted in both bodies.

Change (web): agree = /authorize/gmail_read_all consent screen; reads-all = GET /integrations/oauth/house-grants (live gmail_read_all grant, owner/manager only); stop = PUT house-grants/:id/access {houseUses:false}; offer gated on GET /integrations/oauth/catalog; kind chips filter client-side, no kind param.
Tests: MailTab.gateway-contract.test.tsx (routes/verbs/queries parsed from gateway controllers), MailTab.all-conversations.test.tsx reworked.
Mutation: stop -> DELETE /mail/consent plus params.kind: 4 tests failed; restored.
Results: tsc --noEmit (apps/web) clean; vitest src/pages/communications src/services 41 files, 648 passed, 1 skipped; vite build ok.

Left (not done):
- Gateway read side: conversations/mail.service.ts (people/thread/summary) is vendor-only (`kind: "vendor"` hardcoded); no open PR widens it. Team/guest rows and fromAddress/toAddresses will not reach the Mail tab until a gateway PR on the #1453 mail stack does. Needs a gateway lane.
- One contract test (gateway source declares gmail_read_all) is runIf: it runs once #1917 is under the branch; skipped now.
- #1916 is stacked on fix/r59-mail-list-holds-height (#1834).

Browser checks owed: listed in the #1916 body (offer -> consent screen -> return; stop flips; staff sees no offer and no house-grants request; chips make no new /mail/people request; failed grants read does not claim vendor-only).
