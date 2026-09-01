import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DevTruthService } from "./dev-truth.service";

/**
 * Dev-only truth surfaces, backing `/dev/reach`, `/dev/swallow` and `/dev/asof`
 * in the web app.
 *
 * GUARDED TWICE, on purpose:
 *  1. `NODE_ENV === "production"` returns 404 from every route — the module is
 *     still mounted, so a route that silently disappeared cannot be mistaken for
 *     a route that never existed. It says "not found" deliberately rather than
 *     failing to register.
 *  2. `JwtAuthGuard`, because these read tenant row counts. The analytics
 *     controller's own comment records that it was once unauthenticated by
 *     omission; nothing here repeats that.
 *
 * These are throwaway. They exist to make three specific claims checkable by a
 * human, and they should be deleted when the claims stop needing checking.
 */
@ApiExcludeController()
@Controller("analytics/dev")
@UseGuards(JwtAuthGuard)
export class DevTruthController {
  constructor(private readonly devTruth: DevTruthService) {}

  private assertNotProduction() {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
  }

  /** A: does the reachable number mean what it says? */
  @Get("reach/:restaurantId")
  async reach(@Param("restaurantId") restaurantId: string) {
    this.assertNotProduction();
    return this.devTruth.reach(restaurantId);
  }

  /** D: is anything reading as empty because it broke? */
  @Get("swallow/:restaurantId")
  async swallow(@Param("restaurantId") restaurantId: string) {
    this.assertNotProduction();
    return this.devTruth.swallow(restaurantId);
  }

  /** B: would you have said this before you knew? */
  @Get("asof/:restaurantId")
  async asOf(
    @Param("restaurantId") restaurantId: string,
    @Query("cutoff") cutoff?: string,
  ) {
    this.assertNotProduction();
    return this.devTruth.asOf(
      restaurantId,
      cutoff || new Date().toISOString(),
    );
  }
}
