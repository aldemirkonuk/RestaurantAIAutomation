import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";

export type Role = "owner" | "manager" | "staff";

/**
 * `@Roles(...)` means exactly the roles it lists (ADR 0164, the founder's "Keep
 * managers in", 2026-09-18).
 *
 * Until 2026-09-18 a route that listed `owner` OR `manager` let `owner`,
 * `manager` and `admin` through, whichever of the two it named. So
 * `@Roles("owner")` on ten routes read "owners only" and admitted managers, and
 * no route could be owner-only by decorator at all. The founder kept managers
 * in on those ten routes; they now say `@Roles("owner", "manager")`, which is
 * what they always did, and `@Roles("owner")` now means owner.
 *
 * `admin` is no longer let in by a route that does not list it. No
 * `users.role`, `user_restaurant_access.role` or `organization_members.role` in
 * production holds `admin` (measured read-only 2026-09-18: the two tables with
 * CHECKs allow owner|manager|staff, and `users.role` holds only those three),
 * so no session loses access by it. `route-access.spec.ts` pins every guarded
 * route's admitted roles against the table measured before this change, minus
 * `admin`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true; // No roles required
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return false;
    }

    const userRole = user.role ? String(user.role).toLowerCase() : "";

    return requiredRoles.some((role) => userRole === role.toLowerCase());
  }
}
