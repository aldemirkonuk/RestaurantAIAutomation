import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { TENANT_BYPASS_KEY } from './tenant.decorator';

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

    const bypass = this.reflector.getAllAndOverride<boolean>(TENANT_BYPASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no authenticated user, allow through — JwtAuthGuard should enforce where required.
    // Log a warning in dev so silent bypasses are visible.
    if (!user?.restaurantId) {
      if (!user) {
        this.logger.warn(
          `TenantGuard: No authenticated user on ${request.method} ${request.url} — ensure JwtAuthGuard is applied if this route requires auth`,
        );
      }
      return true;
    }

    const tenantId = String(user.restaurantId);
    request.tenantId = tenantId;

    const paramTenant = request.params?.restaurantId || request.params?.restaurant_id;
    const queryTenant = request.query?.restaurantId || request.query?.restaurant_id;
    const bodyTenant = request.body?.restaurantId || request.body?.restaurant_id;

    const candidates = [paramTenant, queryTenant, bodyTenant].filter(Boolean).map(String);
    const mismatch = candidates.find((value) => value !== tenantId);

    if (mismatch) {
      throw new ForbiddenException('Tenant isolation violation');
    }

    return true;
  }
}
