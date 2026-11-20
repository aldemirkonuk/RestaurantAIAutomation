# Brief: scope every mail-sender lookup to the receiving house (QA r25 BLOCKER, cross-tenant)
Tier: opus-head (tenancy). Stack: new DRAFT on #957 (fix/mail-sender-exact-match @8aed182e8).
Evidence: qa-report/round25-pr-retest-exact-match.md
1. Python `EmailParsingAgent._find_provider_by_email` and both `EmailIntelAgent` sender lookups: require restaurant_id; no house → letter unattributed (kept visible, not dropped).
2. Gateway shared-Gmail path publishes no restaurant_id: communications.controller.ts:1291 and :1431 → carry the receiving house into the event; bridge consumer must refuse an event without it.
3. Spec + pytest: two houses, same vendor address, letter to house A → filed under A's vendor/order only; red on #957.
4. Same class: members.service.ts:601 raw global ilike → escaped + scoped.
5. Comment fix: PostgREST turns escaped `*` into literal `%` → correct the "can only miss" comment.
6. Tests for the 4 untested call sites: prospects.service.ts ×2, email_intel_agent.py ×2.
7. Unify with #954's ilikeExactly / MAIL-SENDER-LOOKUP-IS-EXACT when stacks meet.
Rules: DRAFT, ff only, ≤30K per PR (split gateway/Python as #955/#956 did), red runs, never query prod.
