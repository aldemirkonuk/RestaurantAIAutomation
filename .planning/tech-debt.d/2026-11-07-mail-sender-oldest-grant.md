## The house sender's fallback grant can be one Google has stopped honouring — OPEN — 2026-11-07

Filed by `fix/house-sender-picks-the-oldest-grant` (proposal G11, fork F7, decided under the founder's 2026-11-07 /goal).

**What is true.** When the person asking has no sending grant, `HouseSenderService.resolve` (`apps/api-gateway/src/communications/letters/house-sender.service.ts`) now takes the house's oldest live `gmail_send` grant (`connected_at`, then `id`), where it used to take whichever row PostgREST returned first. That makes the choice stable, but "live" still means only `revoked_at IS NULL`. A grant whose refresh Google refuses stays live and sendable on screen (the entry at `tech-debt.d/2026-10-01-fix-review-communications.md:5`). The oldest grant has had the longest time to go stale, so it is the most likely to be that one. If it is, every letter from an asker without a grant fails at send time, even when a younger grant in the house would work.

**What closes it.** The register entry above gets closed (a refused refresh is written onto the row), and the fallback then skips grants marked that way.

## "Oldest" means first connected, so revoking and reconnecting keeps a member's place — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** The connect upsert (`apps/api-gateway/src/integrations/integrations-oauth.service.ts`, `onConflict: "user_id,integration_id"`) does not write `connected_at`, and disconnect revokes the row in place. So a member who connected first, revoked, and reconnected months later is still the oldest grant and becomes the house's sender again. The choice is deterministic either way. The open question is whether a reconnect should count as a new consent. Nothing on production shows this happening yet. This branch does not measure that, because the lane never touches production.

**What closes it.** Either the upsert sets `connected_at` on a reconnect after a revoke (the rule becomes oldest still-standing consent), or this entry is struck as intended, with the reason written down.

## L5 (a)–(c) still owed: the order letter's fromName and the sender identity on procurement — OPEN — 2026-11-07

Filed with the entries above.

**What is true.** This branch carves only test (d) out of proposal L5 (`p4-scratch/sw-walk/mail/proposal.md` §3 Phase A). Parts (a)–(c) edit `procurement.service.ts`, and open PR #672 already changes that file. `communications.controller.ts` is also left alone, because open PRs #541 and #538 edit it.

**What closes it.** L5 (a)–(c) land after #672 merges.
