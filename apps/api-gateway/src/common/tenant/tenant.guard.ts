import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { TENANT_BYPASS_KEY } from "./tenant.decorator";
import { assertTenantMatch } from "./assert-tenant-match";

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

    // The comparison itself lives in assert-tenant-match.ts, because THIS guard
    // cannot reach it on a normal request. TenantGuard is an APP_GUARD and
    // JwtAuthGuard is not, and Nest runs global guards first — so `request.user`
    // is still unset here and every authenticated route fell through the
    // no-user branch. JwtAuthGuard now performs the same assertion right after
    // authentication, which is where it can actually decide.
    //
    // This call is kept as a backstop for anything that populates `request.user`
    // before the global stage. It is a no-op otherwise, and no longer the only
    // thing standing between one tenant and another.
    if (!request.user) {
      this.logger.warn(
        `TenantGuard: No authenticated user on ${request.method} ${request.url} — ensure JwtAuthGuard is applied if this route requires auth`,
      );
      return true;
    }

    if (request.user.restaurantId) {
      request.tenantId = String(request.user.restaurantId);
    }
    assertTenantMatch(request);
    return true;
  }
}
