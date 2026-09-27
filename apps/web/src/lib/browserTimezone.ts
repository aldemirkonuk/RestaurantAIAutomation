/**
 * The zone the person's own browser reports, for a sign-up form to send —
 * and `undefined`, never a throw, when the browser will not say.
 *
 * Item 62 (2026-09-27), founder verbatim: *"Browser zone, else none
 * (Recommended)"* — rejected "Save nothing" (which would throw away a
 * perfectly good browser answer) and "Keep New York default" (the fault ADR
 * 0116 already removed from `restaurants.timezone` itself). `Register.tsx`
 * and `GetStarted.tsx` already called
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` directly, unguarded — a
 * page that renders it (`GetStarted.tsx`'s "Timezone · {timezone}" line) or a
 * submit handler that reads it can throw before the request is even sent, on
 * whatever runtime does not implement `Intl` fully. This wraps that one call
 * so the field is simply OMITTED (`undefined` drops out of `JSON.stringify`,
 * so the gateway sees no `timezone` key at all) rather than the sign-up
 * itself failing over a display nicety.
 *
 * The gateway re-validates whatever arrives against `Intl` on its own side
 * (`resolveSignUpTimezone`, `apps/api-gateway/src/auth/sign-up-timezone.ts`)
 * and stores NULL for anything it does not recognise — this helper is a
 * courtesy to the request, not the source of truth for what gets written.
 */
export function getBrowserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
