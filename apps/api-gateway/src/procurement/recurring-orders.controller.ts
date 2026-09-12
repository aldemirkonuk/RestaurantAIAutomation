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
import { CurrentUser } from "../auth/decorators/current-user.decorator";

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

  @Put(":restaurantId/:id")
  @ApiOperation({ summary: "Update a recurring order" })
  async update(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @Body() body: UpdateRecurringOrderDto,
  ) {
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
  @ApiOperation({ summary: "Deactivate a recurring order" })
  async deactivate(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
  ) {
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

  @Post(":restaurantId/execute-check")
  @ApiOperation({
    summary: "Manually trigger recurring order check (dev/test)",
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
