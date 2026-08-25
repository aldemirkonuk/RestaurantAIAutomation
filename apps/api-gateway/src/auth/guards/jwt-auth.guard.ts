import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { TokenBlacklistService } from "../services/token-blacklist.service";
import { assertTenantMatch } from "../../common/tenant/assert-tenant-match";

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
      assertTenantMatch(request);
    }
    return canActivate;
  }
}
