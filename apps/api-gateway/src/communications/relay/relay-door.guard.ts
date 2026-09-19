import { ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { ServiceKeyGuard } from "../../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { TokenBlacklistService } from "../../auth/services/token-blacklist.service";

/**
 * `POST /communications/email` — two doors, both locked (ADR 0149 #19,
 * 2026-09-16: *"Two doors, both locked"*).
 *
 * WHICH DOOR
 * ----------
 * The CREDENTIAL decides, and exactly one is ever consulted:
 *
 *   - an `X-Admin-Key` header is present (even an empty one) → the SERVICE door.
 *     `ServiceKeyGuard` decides, and it fails closed on an unset key. A wrong key
 *     is a 401 here; it never falls through to the JWT door, so a request cannot
 *     probe one credential and be admitted on the other.
 *   - no `X-Admin-Key` header → the PERSON door. The real `JwtAuthGuard` decides
 *     — passport's signature check, the token blacklist, the tenant match
 *     (`assertTenantMatch`, so a body `restaurantId` naming another house is a
 *     403) and email verification — none of it re-implemented here.
 *
 * The door is written onto the request as `relayDoor`, and the handler reads
 * THAT, never a body field, to decide which rules apply.
 *
 * WHY THIS EXTENDS JwtAuthGuard AND THE ROUTE IS `@Public()`
 * ---------------------------------------------------------
 * `CommunicationsController`'s class-level `JwtAuthGuard` would 401 the
 * orchestrator before any method guard ran (Nest runs class guards first and
 * requires all of them). `@Public()` makes that class guard stand aside — the
 * shape ADR 0099 used for the service door alone. But `@Public()` would ALSO
 * make a plain `JwtAuthGuard` stand aside on the person door, since it reads the
 * same metadata. So this guard hands its parent a reflector that answers
 * "not public" for `IS_PUBLIC_KEY` and passes every other key through: the
 * parent then runs its full check exactly as it does on any guarded route.
 * `@Public()` on this route therefore means "the decision is made by
 * RelayDoorGuard", never "unauthenticated" — and the spec proves a request with
 * no credential at all is a 401.
 */
export type RelayDoor = "orchestrator" | "person";

export function publicBlind(reflector: Reflector): Reflector {
  const blind = Object.create(reflector) as Reflector;
  blind.getAllAndOverride = ((key: unknown, targets: unknown) =>
    key === IS_PUBLIC_KEY
      ? false
      : reflector.getAllAndOverride(
          key as string,
          targets as Parameters<Reflector["getAllAndOverride"]>[1],
        )) as Reflector["getAllAndOverride"];
  return blind;
}

@Injectable()
export class RelayDoorGuard extends JwtAuthGuard {
  constructor(
    reflector: Reflector,
    tokenBlacklistService: TokenBlacklistService,
    private readonly configService: ConfigService,
  ) {
    super(publicBlind(reflector), tokenBlacklistService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = (request?.headers ?? {}) as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(headers, "x-admin-key")) {
      // Throws UnauthorizedException on an unset, empty, or wrong key.
      new ServiceKeyGuard(this.configService).canActivate(context);
      request.relayDoor = "orchestrator" satisfies RelayDoor;
      return true;
    }

    const admitted = (await super.canActivate(context)) as boolean;
    if (admitted) request.relayDoor = "person" satisfies RelayDoor;
    return admitted;
  }
}
