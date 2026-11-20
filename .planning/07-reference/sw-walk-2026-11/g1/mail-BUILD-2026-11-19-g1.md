# g1 mail-build (2026-11-19): STOPPED at FORK, nothing built

PRs: none. Branches: none. Tests/mutation: none run (no code written).

## Gap verified real at origin/main (fetched 2026-11-19)
- house-inbox.service.ts:589 builds `from:(<vendor book chunk>) after:<cursor>`; header doc at :53 says the same. Reader is vendor-only.
- r21 BUILD doc O1 (BUILD-2026-11-13-r21.md) names the gap; its "Why not now" says widening the reader widens the gmail_read consent boundary and the consent copy must change with it.
- No `house_mail` table exists in supabase/ (grep hits only unrelated house-mail-archive files).
- No open PR matches guest / team mail / house_mail / non-vendor.

## Why stopped (FORK)
The brief assumed a founder/ADR decision before building ("FORK FIRST ... if approved"). No approval is in the record, and the task text cannot grant it. The change reads people's private non-vendor mail (guests, staff) from a connected mailbox, which is a consent and privacy boundary change, not just a feature. A builder should not widen it unilaterally.

## Decisions needed (for the Opus pass / founder)
1. Allowlist shape for non-vendor senders: approved domains only (staff domain) vs. explicit addresses vs. Gmail label-scoped. Brief says "approved senders/domains only"; who approves, and where is it stored?
2. Guest mail: is reading it in scope at all, or only team mail? Guest addresses are third-party personal data.
3. New consent sentence for MailSetup and the Connections grant text, plus whether existing grants must be re-consented (gmail_read grants given under the old sentence).
4. Retention/redaction for house_mail bodies (store headers+snippet only vs. body).

## Planned build once approved (unchanged from brief)
Migration house_mail (restaurant_id, thread key, from/to, kind team|guest|vendor, RLS by restaurant) past all main+open-PR versions; widen reader query for approved senders only; extend mail_people RPC union and mail.types person kind; kind chip in MailTab people rows; update consent copy in MailSetup + Connections.
Tests owed: gateway jest (non-vendor stored under receiving house only; non-granted house reads nothing) with house-scope mutation check; vitest guest row renders its kind; tsc, vite build.

## Browser checks owed
None yet (nothing built).
