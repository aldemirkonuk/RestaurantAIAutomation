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
    // ADR 0096 — this fall-through was RE-EXAMINED and deliberately KEPT.
    //
    // The temptation is to refuse here instead of warning. It cannot be done at
    // this point, and the reason is ordering, not caution: Nest runs global
    // guards before controller guards, this guard is an APP_GUARD
    // (`app.module.ts`) and `JwtAuthGuard` is not — it is applied per
    // controller with `@UseGuards`. So on a correctly guarded, correctly
    // authenticated route, `request.user` is ALSO undefined here, because
    // passport has not run yet. This branch cannot tell "route with no guard"
    // from "route whose guard is about to run and will pass". Refusing would
    // 403 every authenticated route in the gateway.
    //
    // What was actually wrong is that the warning was the ONLY thing that would
    // ever notice a guardless route, and a warning in a log nobody reads is not
    // a control. That gap is now closed OUTSIDE the request path, where the
    // question is answerable: `scripts/check_route_exposure.py` fails CI when
    // any route declares neither an auth guard nor `@Public()`. Static analysis
    // can see the decorators that this guard, at this moment, cannot.
    //
    // Making refusal possible here would mean promoting `JwtAuthGuard` to an
    // APP_GUARD and marking every genuinely public route `@Public()` — a real
    // option, a larger change than this one, and a founder decision. Filed in
    // ADR 0096's rejected alternatives rather than done quietly.
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
