import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Headers,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OneTapActionsService } from "./one-tap-actions.service";
import {
  CreateOneTapActionDto,
  UpdateOneTapActionDto,
  ExecuteActionDto,
  OneTapActionResponseDto,
  OneTapActionListResponseDto,
  OneTapActionStatus,
} from "./dto/one-tap-action.dto";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * One-Tap Actions — CRUD, execution, and WebSocket sync.
 *
 * AUTHENTICATION IS LOAD-BEARING HERE, not defensive style. The globally
 * registered TenantGuard deliberately returns true for unauthenticated requests
 * (see its own comment: "JwtAuthGuard should enforce where required"), so before
 * this decorator existed every route on this controller answered anyone on the
 * internet — verified live: `GET /one-tap-actions/<id>` returned 500 rather than
 * 401, i.e. it reached the database.
 *
 * TENANCY comes from the token, never from the request. It used to arrive as a
 * path parameter, which meant a caller named the tenant they wanted to read or
 * write. The by-id routes were worse: they took only an actionId and looked the
 * restaurant_id up FROM the action purely to address the WebSocket emit — so any
 * caller holding a UUID could read, execute or delete another restaurant's
 * action. Ownership is now asserted in the service.
 *
 * ROUTES WERE ALSO WRONG. The web client calls
 * `GET /one-tap-actions?restaurantId=…` and `POST /one-tap-actions/:id/execute`,
 * while this controller declared `/:restaurantId` and `/action/:id/execute` —
 * both 404'd, and `getOneTapActions()` swallowed the failure with
 * `catch { return [] }`, so the dashboard rendered an empty list forever and the
 * feature looked merely unused rather than broken. The shapes below match what
 * the client actually sends; the restaurantId query parameter is accepted for
 * compatibility but is authorised against the token rather than trusted.
 */
@ApiTags("one-tap-actions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("one-tap-actions")
export class OneTapActionsController {
  constructor(private readonly oneTapActionsService: OneTapActionsService) {}

  /**
   * Reject a caller asking about a restaurant that is not theirs.
   *
   * Explicitly 403 rather than silently substituting the token's restaurant: a
   * caller that asked for tenant B and received tenant A's data would have no way
   * to know, and neither would we.
   */
  private assertOwnRestaurant(
    requested: string | undefined,
    user: AuthedUser,
  ): void {
    if (requested && requested !== user.restaurantId) {
      throw new HttpException(
        "That restaurant is not yours.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: "Get one-tap actions for the caller's restaurant",
    description:
      "restaurantId is taken from the token. The query parameter is accepted only for client compatibility and 403s if it names another tenant.",
  })
  @ApiQuery({ name: "status", enum: OneTapActionStatus, required: false })
  @ApiQuery({ name: "restaurantId", required: false })
  @ApiResponse({ status: 200, type: OneTapActionListResponseDto })
  async getActions(
    @CurrentUser() user: AuthedUser,
    @Query("status") status?: OneTapActionStatus,
    @Query("restaurantId") restaurantId?: string,
  ): Promise<OneTapActionListResponseDto> {
    this.assertOwnRestaurant(restaurantId, user);
    try {
      return await this.oneTapActionsService.getActions(
        user.restaurantId,
        status,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch actions",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Declared before ":actionId" so the literal path wins — otherwise "pending"
  // is parsed as an action UUID and every request 404s on a bad lookup.
  @Get("pending")
  @ApiOperation({
    summary: "Get pending one-tap actions for the caller's restaurant",
  })
  @ApiResponse({ status: 200, type: [OneTapActionResponseDto] })
  async getPendingActions(
    @CurrentUser() user: AuthedUser,
  ): Promise<OneTapActionResponseDto[]> {
    try {
      return await this.oneTapActionsService.getPendingActions(
        user.restaurantId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch pending actions",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @ApiOperation({
    summary: "Create a one-tap action for the caller's restaurant",
    description:
      'The creator is the authenticated user. It was previously the literal string "system", which is not an author.',
  })
  @ApiResponse({ status: 201, type: OneTapActionResponseDto })
  async createAction(
    @Body() dto: CreateOneTapActionDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.createAction(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to create action",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":actionId")
  @ApiOperation({ summary: "Get a single one-tap action" })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({
    status: 403,
    description: "Action belongs to another restaurant",
  })
  @ApiResponse({ status: 404, description: "Action not found" })
  async getAction(
    @Param("actionId") actionId: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.getAction(
        actionId,
        user.restaurantId,
      );
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to fetch action",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(":actionId")
  @ApiOperation({ summary: "Update a one-tap action" })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  async updateAction(
    @Param("actionId") actionId: string,
    @Body() dto: UpdateOneTapActionDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.updateAction(
        actionId,
        user.restaurantId,
        dto,
      );
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to update action",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Begin the hold on a one-tap action that really does something.
   *
   * Declared before nothing and shadowing nothing: `:actionId/seal-challenge`
   * and `:actionId/execute` are distinct literal tails, so route order does not
   * matter here the way it did for `GET pending`.
   *
   * The seal is minted when the gesture STARTS. A token fetched at the moment
   * of execution would be one more thing the same request asked for itself —
   * the assertion model with extra steps (founder, 2026-09-04; ADR 0116
   * addendum). Only an action whose type is a real workflow gets one; a written
   * note and an unbuilt act are both refused here, in words, rather than handed
   * a seal for an act that will not run.
   */
  @Post(":actionId/seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal this action's execution has to carry back",
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act`. The seal is bound to this manager, the ORDER the card points at, the act `deliver`, and the stock that is about to move: it cannot be spent by another person, on another order, for an approval, or after the order's quantity or state changed.",
  })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 201, description: "The seal, once" })
  @ApiResponse({
    status: 400,
    description:
      "This action is a written note, or its act is not built, or the order is already booked in. The body's `message` is the whole sentence and the page renders it verbatim.",
  })
  async issueExecutionSeal(
    @Param("actionId") actionId: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    try {
      return await this.oneTapActionsService.issueExecutionSeal(
        actionId,
        user.restaurantId,
        user.userId,
      );
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to issue the seal",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":actionId/execute")
  @ApiOperation({
    summary: "Execute a one-tap action",
    description:
      "Path shape matches what the web client sends. The executor is the authenticated user, which is the whole point of an action log. An action whose type is a real workflow (today: delivery_confirm) redeems the seal, runs the write and only then records it; a written note is recorded; anything else is refused and the row stays pending.",
  })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  @ApiResponse({
    status: 400,
    description:
      "The act is not built, the card names no order, or the order is already delivered. Nothing was changed.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The seal was absent, already spent, issued to somebody else, issued for another order or act, or issued before the order changed. The body's `message` is the whole sentence.",
  })
  @ApiQuery({ name: "restaurantId", required: false })
  async executeAction(
    @Param("actionId") actionId: string,
    @Body() dto: ExecuteActionDto,
    @CurrentUser() user: AuthedUser,
    @Query("restaurantId") restaurantId?: string,
    // The seal travels in a HEADER, matching `POST /procurement/orders/:id/approve`
    // — it is not one of the arguments it is a seal OVER.
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<OneTapActionResponseDto> {
    this.assertOwnRestaurant(restaurantId, user);
    try {
      return await this.oneTapActionsService.executeAction(
        actionId,
        user.restaurantId,
        user.userId,
        dto,
        challenge ?? null,
      );
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to execute action",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":actionId/cancel")
  @ApiOperation({ summary: "Cancel a one-tap action" })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 200, type: OneTapActionResponseDto })
  async cancelAction(
    @Param("actionId") actionId: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<OneTapActionResponseDto> {
    try {
      return await this.oneTapActionsService.cancelAction(
        actionId,
        user.restaurantId,
      );
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to cancel action",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":actionId")
  @ApiOperation({ summary: "Delete a one-tap action (soft delete)" })
  @ApiParam({ name: "actionId", description: "Action UUID" })
  @ApiResponse({ status: 200, description: "Action deleted" })
  async deleteAction(
    @Param("actionId") actionId: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<{ success: boolean }> {
    try {
      await this.oneTapActionsService.deleteAction(actionId, user.restaurantId);
      return { success: true };
    } catch (error) {
      if (error.status) throw error;
      throw new HttpException(
        error.message || "Failed to delete action",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
