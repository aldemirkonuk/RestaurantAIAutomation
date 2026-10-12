# 0337 — A removed person's name in the audit trail is pseudonymised when their five years run out

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** coordinator under founder delegation 2026-10-11 (industry standard)
- **Keywords:** F-704, system_audit_log, team_member_removed, display_name, position, pseudonymisation, retention, five-year purge, wage-record-retention, former staff, GDPR, KVKK, storage limitation
- **Links:** [ADR 0215](0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md) Decision item 12 (the five-year clock); `apps/api-gateway/src/team/wage-record-retention.service.ts`; `apps/api-gateway/src/team/team.service.ts:1402-1413` (what the removal row stores); migration `20260925120500_recommendation_actions_created_by_kept_two_years.sql:5-11` (the founder: the audit trail keeps who acted); sim ledger F-704 and S195

## Context

When a person is removed from `/team`, the `team_member_removed` row in `system_audit_log` stores their `display_name` and `position` in `changes` (`team.service.ts:1402-1413`). Their shifts, leave, wages, credentials and departure are deleted five years after they leave, by the nightly job in `wage-record-retention.service.ts` (ADR 0215 item 12). Nothing deletes or touches `system_audit_log`, so the name and position outlive every other record of the person (F-704). The w-privacy lane changed only copy, because the audit trail's retention is a founder ruling.

That ruling, quoted in `20260925120500:5-11`, is: *"an audit trail that forgets who acted is no longer an audit trail"*. It protects **who acted** (the actor).

### The delegation (verbatim)

The founder, 2026-10-11: *"If your decision is high industry standard, just do it. Do not ask me. If there is architecture decision to be made, then ask me in simple list form ever."* (in full in [ADR 0335](0335-a-house-brings-its-vendors-and-opening-stock-in-from-a-spreadsheet.md))

## Options considered

1. **Keep the name for ever (as built).** The trail is complete. But a former employee's name and job title are kept indefinitely after every other record of them is gone. That breaks the storage-limitation principle in GDPR Art. 5(1)(e) and KVKK Art. 4(2)(d).
2. **Delete the removal rows at five years.** Tidy. But it cuts holes in the audit trail, against the founder's ruling.
3. **Keep the rows, and replace the removed person's name and position with a stable pseudonym** ("Former staff #3F2A") when their five years run out. This is pseudonymisation in the sense of GDPR Art. 4(5), the usual way to keep an audit trail while ending the retention of personal data. **Chosen.**

## Decision

**When a removed person's five-year clock runs out, the same nightly job that deletes their other records replaces their name and job title in the audit trail with a stable pseudonym. Every row stays, and so does who acted.**

1. **Only the subject's personal fields change:** `changes.display_name` and `changes.position` on rows about that team member (`entity_type = 'team_member'`, `entity_id` = them). The pseudonym is the same on every row of the same person, so the trail still reads as one person's history.
2. **The actor is never touched.** `actor_id`, the action, the dates and the access-role change stay as written. This keeps the founder's 2026-09-22 rule, because the trail does not forget who acted.
3. **Same clock and same job** as ADR 0215 item 12. No new schedule or second retention number.
4. **The former-staff history says so.** After five years it shows the pseudonym, together with a sentence that names were removed after five years.

## Consequences

- No personal field about a former employee outlives the five-year clock, and the audit trail keeps every row.
- Someone who knew the person can still recognise them from dates and roles. Pseudonymisation is not anonymisation, which is the accepted trade-off for keeping the trail.
- This needs a migration that extends the retention job. It is stated here and built by its own lane.
- Revisit if a regulator or the founder sets a fixed retention for the audit trail itself (the signal is a ruling about `system_audit_log` rows, not names).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created under the founder's delegation (sim S195) |
