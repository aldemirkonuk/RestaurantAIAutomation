import { SetMetadata } from "@nestjs/common";

export const ALLOWS_TENANT_CHANGE_KEY = "allowsTenantChange";

/**
 * Marks the one kind of route whose PURPOSE is to move the caller to another
 * tenant, and which must therefore be allowed to name a restaurant the caller
 * is not currently in.
 *
 * Deliberately NOT `@TenantBypass()`. That decorator is a whole-controller
 * escape hatch, it is currently inert (JwtAuthGuard never consults it), and it
 * already sits on four controllers — making it live would drop tenant
 * enforcement on all of them at once. This one exempts a single route, and
 * only from the BODY-derived names: a path or query parameter naming another
 * restaurant is still refused, so the route keeps full isolation over what it
 * reads.
 *
 * Applied today to `POST /auth/switch-restaurant` and nowhere else. Before it,
 * that endpoint was dead by construction — see assert-tenant-match.ts.
 */
export const AllowsTenantChange = () =>
  SetMetadata(ALLOWS_TENANT_CHANGE_KEY, true);
