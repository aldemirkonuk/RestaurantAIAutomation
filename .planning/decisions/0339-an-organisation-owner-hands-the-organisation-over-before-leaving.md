# 0339 — An organisation owner hands the organisation over before their account can go

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** coordinator under founder delegation 2026-10-11 (industry standard)
- **Keywords:** F-750, F-836, organisation owner, organization_members, ORG_OWNER, ownership transfer, account deletion, deleteAccount, createLocation, NOT_ORGANISATION_OWNER
- **Links:** [ADR 0164](0164-sessions-follow-membership-and-several-houses-choose.md) decision 4 ("Organisation owners only" open a location) and OD-131(a); [ADR 0242](0242-one-removal-path-and-leaving-is-that-removal.md) (one removal path); `apps/api-gateway/src/auth/auth.service.ts` `deleteAccount` (the F-750 guard); sim ledger F-750, F-836, S195

## Context

Only an organisation owner may open a new location (ADR 0164 decision 4). Deleting a `users` row cascades its `organization_members` row away and nulls `organizations.owner_id`. So when the last organisation owner deleted their account, nobody could ever open a location in that organisation again (F-750).

The fix that shipped refuses the deletion outright: "You are the only owner of your organisation… it can't be deleted yet" (`auth.service.ts`, `deleteAccount`). That is because there is no route that makes someone else an organisation owner. The refusal is now the first answer (F-836), but it still leaves the person stuck, with nothing they can do.

### The delegation (verbatim)

The founder, 2026-10-11: *"If your decision is high industry standard, just do it. Do not ask me. If there is architecture decision to be made, then ask me in simple list form ever."* (in full in [ADR 0335](0335-a-house-brings-its-vendors-and-opening-stock-in-from-a-spreadsheet.md))

## Options considered

1. **Refuse for ever (as built).** Safe. But a founder who sells or leaves the business can never close their account.
2. **Promote someone automatically on deletion** (the longest-serving owner of a house, say). No dead end. But it hands the power to open locations to a person who never accepted it.
3. **An organisation owner names another member of the organisation as an owner. That person accepts, and then the first owner may step down or delete their account.** This is how Google Workspace, GitHub and Slack handle the last owner leaving. **Chosen.**

## Decision

**An organisation owner can make another member of the organisation an organisation owner. The new owner has to accept. Once the organisation has another owner, the first owner may step down or delete their account. Until then, the deletion refusal stays and points to the hand-over.**

1. **Who can be named:** a person with an active house membership in that organisation (as OD-131(a) requires for opening a location). Naming someone outside the organisation is refused.
2. **The new owner accepts.** An offer that is not accepted changes nothing, and it can be withdrawn.
3. **Each step is recorded in the logs** (offered, accepted, withdrawn, stepped down), and the other owners are told.
4. **The last owner cannot step down.** The organisation always keeps at least one owner. The F-750 guard in `deleteAccount` stays. Its words change to point to the hand-over ("Make someone else an owner of your organisation first").
5. **House ownership is separate.** This hands over the organisation, not any house. The house-owner guard and its own hand-over (`MembersService.updateMemberRole`) are unchanged.

## Consequences

- A departing owner has a way out that keeps the organisation able to open locations.
- The deletion refusal becomes something the person can act on, which closes F-836's complaint.
- Revisit if an organisation's only other member never accepts (the signal is a support request from a stuck owner). An admin-assisted transfer would then be a separate decision.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created under the founder's delegation (sim S195) |
