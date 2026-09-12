import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ALLOW_UNVERIFIED_KEY } from "../decorators/allow-unverified.decorator";
import { TokenBlacklistService } from "../services/token-blacklist.service";
import { assertTenantMatch } from "../../common/tenant/assert-tenant-match";
import { ALLOWS_TENANT_CHANGE_KEY } from "../../common/tenant/allows-tenant-change.decorator";
import { assertEmailVerified } from "../assert-email-verified";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private reflector: Reflector,
    private tokenBlacklistService: TokenBlacklistService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring("Bearer ".length)
      : null;

    if (token) {
      const isBlacklisted =
        await this.tokenBlacklistService.isBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException("Token is blacklisted");
      }
    }

    const canActivate = (await super.canActivate(context)) as boolean;
    if (canActivate && request.user) {
      // Tenant isolation runs HERE, not in the global TenantGuard.
      //
      // Nest executes guards global → controller → route. TenantGuard is an
      // APP_GUARD (app.module.ts:129) and this guard is not, so TenantGuard ran
      // before passport had set `request.user`, hit its own `if (!user) return
      // true` branch, and never reached its comparison — on every authenticated
      // route. Tenant isolation was, in practice, not enforced at all.
      //
      // This is the first line at which the answer is knowable. The block that
      // used to sit here computed two UUID regexes and discarded both results.
      //
      // A route marked @AllowsTenantChange() is exempt from the BODY-derived
      // names only — path and query are still compared. Without it, the one
      // route that exists to change tenants was refused before the membership
      // check that authorises it could run, so no user with access to more
      // than one restaurant could ever switch (verified in production
      // 2026-09-01: three such users, none able to move).
      const allowsTenantChange = this.reflector.getAllAndOverride<boolean>(
        ALLOWS_TENANT_CHANGE_KEY,
        [context.getHandler(), context.getClass()],
      );
      assertTenantMatch(request, {
        allowBodyTenantChange: allowsTenantChange === true,
      });

      // Email verification runs here for the same reason (OD-79). It used to
      // exist only in the browser, comparing a field the API never sent.
      const allowUnverified = this.reflector.getAllAndOverride<boolean>(
        ALLOW_UNVERIFIED_KEY,
        [context.getHandler(), context.getClass()],
      );
      assertEmailVerified(request, allowUnverified === true);
    }
    return canActivate;
  }
}
