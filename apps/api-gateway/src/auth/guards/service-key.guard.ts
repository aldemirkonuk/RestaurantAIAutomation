import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";

/**
 * ADR 0099 — authenticate a SERVICE caller, not a user.
 *
 * The Python orchestrator calls `POST /communications/email` to send approved
 * vendor mail. It has no user session and no JWT, so `JwtAuthGuard` can only
 * ever refuse it — which is exactly what happened from `fdaa7fa0` (2026-08-25)
 * onwards, silently, on the one route that sends vendor email.
 *
 * This does NOT introduce a second secret. `ADMIN_API_KEY` in the `X-Admin-Key`
 * header is already the gateway↔orchestrator service credential, used in both
 * directions:
 *   gateway → orchestrator  `common/orchestrator/orchestrator.service.ts:72,97`
 *   orchestrator verifier   `services/agent-orchestrator/api/health_routes.py:230`
 * This is the same scheme pointed the other way, and it is deliberately modelled
 * on that verifier's fail-closed shape.
 *
 * FAILS CLOSED. An unset or empty `ADMIN_API_KEY` DENIES every request. The
 * tempting one-liner — `if (header === expected) return true` — is a hole with
 * this shape: unset expected + absent header compare equal as `""`, so removing
 * the secret would open the route to the internet. A missing secret is a
 * misconfiguration, never a permission.
 *
 * Scope: apply this per route, never at class level, and never as an APP_GUARD.
 * It authenticates a machine; it carries no tenant and no user, so a route using
 * it must derive neither from `request.user`.
 */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    // process.env fallback: ConfigService does not inherit process.env in every
    // Nest test-module context (the same reason gmail.service.ts reads both).
    const expected = (
      this.configService?.get<string>("ADMIN_API_KEY", "") ||
      process.env.ADMIN_API_KEY ||
      ""
    ).trim();

    if (!expected) {
      throw new UnauthorizedException(
        "Service authentication is not configured (ADMIN_API_KEY is unset) — refusing.",
      );
    }

    const request = context.switchToHttp().getRequest();
    const raw = request?.headers?.["x-admin-key"];
    const presented = (Array.isArray(raw) ? raw[0] : raw) ?? "";

    if (typeof presented !== "string" || presented.length === 0) {
      throw new UnauthorizedException("Invalid or missing X-Admin-Key");
    }

    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expected, "utf8");
    // timingSafeEqual throws on a length mismatch, so length is compared first
    // and a wrong-length key is refused without leaking the right length.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid or missing X-Admin-Key");
    }

    return true;
  }
}
