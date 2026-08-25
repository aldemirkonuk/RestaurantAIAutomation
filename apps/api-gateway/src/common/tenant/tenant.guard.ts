import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { TENANT_BYPASS_KEY } from "./tenant.decorator";

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const bypass = this.reflector.getAllAndOverride<boolean>(
      TENANT_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypass) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Which tenant, if any, this request is asking about. Computed before the
    // early returns because the no-tenant-on-the-user case now depends on it.
    const paramTenant =
      request.params?.restaurantId || request.params?.restaurant_id;
    const queryTenant =
      request.query?.restaurantId || request.query?.restaurant_id;
    const bodyTenant =
      request.body?.restaurantId || request.body?.restaurant_id;

    const candidates = [paramTenant, queryTenant, bodyTenant]
      .filter(Boolean)
      .map(String);

    // No authenticated user: allow through — JwtAuthGuard is what enforces auth,
    // and @Public routes legitimately arrive here with no user. Log so a route
    // that SHOULD be guarded and isn't stays visible.
    if (!user) {
      this.logger.warn(
        `TenantGuard: No authenticated user on ${request.method} ${request.url} — ensure JwtAuthGuard is applied if this route requires auth`,
      );
      return true;
    }

    // Authenticated, but the session carries no tenant. Until 2026-08-25 this
    // returned true unconditionally, so a logged-in user with no restaurant
    // assigned could name ANY restaurant in a param, query, or body and read or
    // write it — the one genuine tenant-isolation hole in this guard, since a
    // user WITH a tenant is already caught by the mismatch check below.
    //
    // Deny only when the request actually names a tenant. A tenantless user
    // hitting a tenantless route (profile, settings, restaurant creation during
    // onboarding) is ordinary and must keep working.
    if (!user.restaurantId) {
      if (candidates.length > 0) {
        this.logger.warn(
          `TenantGuard: user ${user.userId ?? "unknown"} has no restaurantId but named tenant(s) ${candidates.join(", ")} on ${request.method} ${request.url}`,
        );
        throw new ForbiddenException("Tenant isolation violation");
      }
      return true;
    }

    const tenantId = String(user.restaurantId);
    request.tenantId = tenantId;

    const mismatch = candidates.find((value) => value !== tenantId);

    if (mismatch) {
      throw new ForbiddenException("Tenant isolation violation");
    }

    return true;
  }
}
