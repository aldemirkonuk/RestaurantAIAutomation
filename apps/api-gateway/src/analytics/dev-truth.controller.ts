import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { assertTenantMatch } from "../common/tenant/assert-tenant-match";
import { PlatformOperatorService } from "../common/orchestrator/platform-operator.service";
import { DevTruthService } from "./dev-truth.service";

type SessionUser =
  | { userId?: string; restaurantId?: string | null }
  | null
  | undefined;

/**
 * Dev-only truth surfaces, backing `/dev/truth` (tabs reach · asof · swallow)
 * in the web app.
 *
 * GUARDED FOUR TIMES, on purpose, in this order:
 *  1. `NODE_ENV === "production"` returns 404 from every route, for everybody —
 *     the module is still mounted, so a route that silently disappeared cannot
 *     be mistaken for a route that never existed. It runs before the developer
 *     check so production answers "not found" to a developer and a customer
 *     alike.
 *  2. `JwtAuthGuard`, because these read tenant row counts. The analytics
 *     controller's own comment records that it was once unauthenticated by
 *     omission; nothing here repeats that.
 *  3. Developers only (founder, 2026-09-29: "only devs can open it"). The
 *     Studio `developer` role, read from `user_roles` by
 *     `PlatformOperatorService.isDeveloper` — the same rows the web's
 *     `requiredStudioRole` gate is built from, so the page and its data agree
 *     on who a developer is. 403 otherwise, before any row is read.
 *  4. The `:restaurantId` must be the session's own house. `JwtAuthGuard`
 *     already runs `assertTenantMatch` over path params; it runs again here so
 *     the refusal is this controller's own, pinned by its spec, and does not
 *     rest on a guard a later refactor could reorder.
 *
 * These are throwaway. They exist to make three specific claims checkable by a
 * human, and they should be deleted when the claims stop needing checking.
 */
@ApiExcludeController()
@Controller("analytics/dev")
@UseGuards(JwtAuthGuard)
export class DevTruthController {
  constructor(
    private readonly devTruth: DevTruthService,
    private readonly operators: PlatformOperatorService,
  ) {}

  private async admit(user: SessionUser, restaurantId: string) {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
    if (!(await this.operators.isDeveloper(user?.userId))) {
      throw new ForbiddenException("dev/truth is for developers only.");
    }
    assertTenantMatch({
      user: {
        userId: user?.userId,
        restaurantId: user?.restaurantId ?? undefined,
      },
      params: { restaurantId },
    });
  }

  /** A: does the reachable number mean what it says? */
  @Get("reach/:restaurantId")
  async reach(
    @Param("restaurantId") restaurantId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.admit(user, restaurantId);
    return this.devTruth.reach(restaurantId);
  }

  /** D: is anything reading as empty because it broke? */
  @Get("swallow/:restaurantId")
  async swallow(
    @Param("restaurantId") restaurantId: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.admit(user, restaurantId);
    return this.devTruth.swallow(restaurantId);
  }

  /** B: would you have said this before you knew? */
  @Get("asof/:restaurantId")
  async asOf(
    @Param("restaurantId") restaurantId: string,
    @CurrentUser() user: SessionUser,
    @Query("cutoff") cutoff?: string,
  ) {
    await this.admit(user, restaurantId);
    return this.devTruth.asOf(
      restaurantId,
      cutoff || new Date().toISOString(),
    );
  }
}
