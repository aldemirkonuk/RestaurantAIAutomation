import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

/**
 * ADR 0019 D2 — demo/test scaffolding must be UNREACHABLE in production.
 *
 * The `test/*` and `test/e2e/step*` routes on CommunicationsController are
 * developer scaffolding that writes to real tables, approves real procurement
 * orders and sends real vendor email. Nine of them carried `@Public()`, so any
 * unauthenticated caller on the internet could drive them against production.
 *
 * Authentication alone is not the fix: an authenticated operator hitting
 * `step2-approve-reorder` still approves a live order with `approved_by:
 * "e2e-test-manager"`, and the read steps are not tenant-scoped. The routes have
 * no production purpose, so they get removed from the production surface
 * entirely — the same posture app.module.ts takes for SimposModule:
 *
 *     ...(process.env.NODE_ENV !== "production" ? [SimposModule] : [])
 *
 * A controller cannot be conditionally registered per-route, so this guard is
 * the route-level equivalent. It throws 404 rather than 403 so production does
 * not confirm the route exists at all.
 *
 * NODE_ENV is read per request (not cached at construction) so tests can flip it.
 */
@Injectable()
export class NonProductionGuard implements CanActivate {
  private readonly logger = new Logger(NonProductionGuard.name);

  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV !== "production") {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    this.logger.warn(
      `Blocked non-production route in production: ${
        request?.method ?? "?"
      } ${request?.url ?? request?.originalUrl ?? "?"}`,
    );
    // Default message "Not Found" — indistinguishable from an unmapped route.
    throw new NotFoundException();
  }
}
