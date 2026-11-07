import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { RecurringOrdersService } from "./recurring-orders.service";
import {
  CreateRecurringOrderDto,
  UpdateRecurringOrderDto,
} from "./dto/recurring-order.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NonProductionGuard } from "../communications/guards/non-production.guard";
import { PlatformOperatorGuard } from "../common/orchestrator/platform-operator.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../organizations/organizations.service";

@ApiTags("recurring-orders")
/**
 * OD-20 — guarded at class level 2026-08-25.
 *
 * This controller had no guard and no @Public(). It was not protected by
 * TenantGuard either: that guard fails OPEN by design —
 * "If no authenticated user, allow through — JwtAuthGuard should enforce where
 * required" (tenant.guard.ts) — and nothing here required it.
 *
 * Verified live before the fix: GET /api/v1/dashboard/stats/<uuid> returned 200
 * with JSON to an unauthenticated caller.
 *
 * Routes that are genuinely public must now say so with @Public(), so intent is
 * recorded rather than inferred from an absent decorator.
 */
@UseGuards(JwtAuthGuard)
@Controller("recurring-orders")
export class RecurringOrdersController {
  constructor(
    private readonly recurringOrdersService: RecurringOrdersService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get(":restaurantId")
  @ApiOperation({ summary: "List all recurring orders for a restaurant" })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiResponse({ status: 200, description: "List of recurring orders" })
  async list(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.recurringOrdersService.listRecurringOrders(
        restaurantId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to list recurring orders",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/:id")
  @ApiOperation({ summary: "Get a specific recurring order" })
  async getOne(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
  ) {
    try {
      return await this.recurringOrdersService.getRecurringOrder(
        restaurantId,
        id,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Recurring order not found",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post(":restaurantId")
  @ApiOperation({ summary: "Create a new recurring order" })
  @ApiResponse({
    status: 400,
    description:
      "A field this endpoint cannot honour, an unreadable unit, or a case quantity " +
      "with no pack size. The body was previously typed as a TypeScript interface, " +
      "which is erased at runtime and validated nothing.",
  })
  async create(
    @Param("restaurantId") restaurantId: string,
    @Body() body: CreateRecurringOrderDto,
    // The actor comes from the verified token, never from the body. The old
    // `body.userId || "system"` let a caller claim to be anyone, and "system"
    // is not a uuid — `recurring_orders.created_by` has an FK to
    // public.users(user_id) and would have raised 22P02 on it.
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.recurringOrdersService.createRecurringOrder(
        restaurantId,
        user?.userId,
        body,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create recurring order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * EDIT AND DEACTIVATE NEED A MANAGER OR AN OWNER (ADR 0246).
   *
   * Founder, 2026-10-01: "Managers and owners only (Recommended)". The 08:00
   * cron raises a schedule's order as the schedule's `created_by`, so a staff
   * edit to a manager's schedule was raised as the manager. These two routes
   * now run `assertCanManageRestaurant`, the check that order cancel and the
   * settings registers use, before the schedule row is read or written. That
   * check reads the caller's active access row for this house and, when that
   * read fails or finds no active row, falls back to the legacy `users` row
   * (its role, when its restaurant_id is this house; organizations.service.ts
   * lookupRestaurantRole). An active access row decides on its own, so an
   * active staff row gets 403 even when the legacy row says manager. When the
   * access read fails or finds no active row, a legacy owner/manager of this
   * house is admitted, and anyone else gets 403, including a caller for whom
   * both reads fail. Creating a schedule is unchanged: staff may.
   */
  @Put(":restaurantId/:id")
  @ApiOperation({
    summary: "Update a recurring order (managers and owners only)",
  })
  async update(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @Body() body: UpdateRecurringOrderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    await this.organizations.assertCanManageRestaurant(
      user?.userId,
      restaurantId,
      "edit a recurring order schedule",
    );
    try {
      return await this.recurringOrdersService.updateRecurringOrder(
        restaurantId,
        id,
        body,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to update recurring order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/:id")
  @ApiOperation({
    summary: "Deactivate a recurring order (managers and owners only)",
  })
  async deactivate(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    await this.organizations.assertCanManageRestaurant(
      user?.userId,
      restaurantId,
      "deactivate a recurring order schedule",
    );
    try {
      return await this.recurringOrdersService.deleteRecurringOrder(
        restaurantId,
        id,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to deactivate recurring order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * NON-PRODUCTION, PLATFORM OPERATORS ONLY (ADR 0243).
   *
   * This runs the 08:00 cron body, `executeDueRecurringOrders`, which reads
   * every house's due `recurring_orders` and executes them. It never used the
   * `:restaurantId` in its path, so "your house" was only what the URL said:
   * at c47fd8a01 any signed-in member of any house could fire every house's
   * due schedules early, with `JwtAuthGuard` as the route's only controller or
   * route guard (817-route audit). The path house is still compared with the session's by
   * `JwtAuthGuard`; it does not narrow the run.
   *
   * Callers: a search of the web (`RecurringOrders.tsx` calls list, create,
   * update and delete only), mobile, services/, scripts/ and the workflows
   * found none. It was dev/test scaffolding by its own summary, so it gets the
   * dev/test posture: `NonProductionGuard` first, then
   * `PlatformOperatorGuard`. In production the action runs for no one: a
   * caller that the class `JwtAuthGuard` admits (verified email, a chosen
   * house, and a path house equal to the session's) gets 404 from
   * `NonProductionGuard`, operators included; anyone else gets
   * `JwtAuthGuard`'s answer first, because class guards run before route
   * guards: 401 if not signed in, 403 for a path naming another house, an
   * unverified email, or a session in no house. Outside production,
   * `PlatformOperatorGuard` (the `/health/agent-operations` gate) admits only
   * a platform operator. The real runner, the in-process
   * `@Cron("0 8 * * *")`, is untouched.
   */
  @Post(":restaurantId/execute-check")
  @UseGuards(NonProductionGuard, PlatformOperatorGuard)
  @ApiOperation({
    summary:
      "Run the daily recurring-order check for EVERY house's due schedules (dev/test; non-production, platform operators only)",
  })
  async manualExecuteCheck() {
    try {
      await this.recurringOrdersService.executeDueRecurringOrders();
      return { status: "ok", message: "Recurring order check executed" };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to execute recurring order check",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
