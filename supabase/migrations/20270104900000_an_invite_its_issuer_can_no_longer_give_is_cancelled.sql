-- F-1087: an invite its issuer can no longer give is cancelled, once, for the
-- invites left over from before a demotion cancelled them (F-1066).
--
-- Since F-1066 `MembersService.updateMemberRole` expires the pending invites
-- a demoted person issued that their new role cannot issue, and every
-- removal path has done the same since 2026-09-19 (`cancelPendingInvitesFrom`).
-- Invites from demotions made before that stayed live: Settings listed them,
-- /invite/:code previewed them, and /team kept their stand-in, until someone
-- tried to join and acceptance refused them on the issuer re-check.
--
-- The rule is the gateway's `grantRefusal(role, invite.role, "invite")`
-- (apps/api-gateway/src/auth/role-grant.ts, ADR 0162), read against the
-- issuer's ACTIVE `user_restaurant_access` row in the invite's house, exactly
-- as acceptance reads it: an owner issues owner, manager or staff; a manager
-- issues manager or staff; anyone else, or no active row, issues nothing.
--
-- Data only, no schema change. Cancelling is what `cancelPendingInvitesFrom`
-- does: `expires_at` set to now, nothing else touched. Only pending invites
-- (unused, not yet expired) are read, so a second run finds nothing to do.
-- The /team read retires the stand-ins of expired invites on its own
-- (`retireLapsedInvitePlaceholders`), so no roster row is written here.

update public.organization_invites as i
   set expires_at = now()
 where i.used_at is null
   and i.expires_at > now()
   and not exists (
     select 1
       from public.user_restaurant_access a
      where a.user_id = i.invited_by
        and a.restaurant_id = i.restaurant_id
        and a.is_active = true
        and (
              a.role = 'owner'
           or (a.role = 'manager' and i.role in ('manager', 'staff'))
        )
   );
