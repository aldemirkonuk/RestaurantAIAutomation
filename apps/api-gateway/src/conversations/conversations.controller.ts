import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
  ForbiddenException,
  Headers,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { ConversationsService } from "./conversations.service";
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";

type AuthUser = { userId: string; restaurantId: string };

/**
 * The caller's house, from the verified token and nowhere else. A session that
 * names no house has no conversation of its own to act on, so it is refused
 * rather than handed an unfiltered query.
 */
function houseOf(user: AuthUser): string {
  if (!user?.restaurantId) {
    throw new ForbiddenException("This session names no restaurant.");
  }
  return user.restaurantId;
}

interface ApproveConversationDto {
  approved: boolean;
  modified_message?: string;
  manager_notes?: string;
  approval_channel: "push_notification" | "onetap_center" | "web_app";
}

/**
 * The body of the approve seal mint. A class so the ValidationPipe checks it
 * (an inline type is recorded as `Object` and skipped).
 */
class ApproveConversationSealDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  modified_message?: string;
}

interface EditMessageDto {
  new_message: string;
  manager_notes?: string;
}

interface RejectConversationDto {
  reason?: string;
  manager_notes?: string;
}

@ApiTags("Conversations")
@ApiBearerAuth()
// Every route here reads or mutates vendor communications, and approve/reject send
// real email. The controller previously carried no guard at all, so the whole surface
// was reachable unauthenticated via the service-role key (which bypasses RLS).
//
// Every by-id route below answers only for the caller's own house, and a row in
// another house is a 404, the same answer as a row that does not exist (ADR 0147;
// ADR 0171). Approve, edit and reject also take a role: they decide what a vendor is
// told, so only an owner or a manager may (ADR 0116; ADR 0162 — the role IN THIS
// house, which is what `RolesGuard` reads from the token).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("conversations")
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(private readonly conversationsService: ConversationsService) {}

  // ── New: Listing & Filtering Endpoints ────────────────────────────

  /**
   * List all conversations with pagination and comprehensive filters
   */
  @Get()
  @ApiOperation({ summary: "List conversations with pagination and filters" })
  @ApiQuery({ name: "restaurantId", required: false })
  @ApiQuery({ name: "providerId", required: false })
  @ApiQuery({ name: "orderId", required: false })
  @ApiQuery({ name: "orderNumber", required: false })
  @ApiQuery({ name: "threadKey", required: false })
  @ApiQuery({ name: "channel", required: false })
  @ApiQuery({ name: "direction", required: false })
  @ApiQuery({ name: "sentiment", required: false })
  @ApiQuery({ name: "dateFrom", required: false })
  @ApiQuery({ name: "dateTo", required: false })
  @ApiQuery({ name: "quarter", required: false })
  @ApiQuery({ name: "year", required: false })
  @ApiQuery({ name: "month", required: false })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "sortBy", required: false })
  @ApiQuery({ name: "sortOrder", required: false })
  async listConversations(
    @CurrentUser() user: AuthUser,
    @Query("providerId") providerId?: string,
    @Query("orderId") orderId?: string,
    @Query("orderNumber") orderNumber?: string,
    @Query("threadKey") threadKey?: string,
    @Query("channel") channel?: string,
    @Query("direction") direction?: string,
    @Query("sentiment") sentiment?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("quarter") quarter?: string,
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: string,
  ) {
    try {
      return await this.conversationsService.listConversations({
        // Always the caller's own tenant. Previously this came from a query param, so
        // omitting it returned every restaurant's conversations in one response.
        restaurantId: user.restaurantId,
        providerId,
        orderId,
        orderNumber,
        threadKey,
        channel,
        direction,
        sentiment,
        dateFrom,
        dateTo,
        quarter,
        year,
        month,
        search,
        status,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        sortBy: sortBy || "created_at",
        sortOrder: (sortOrder as "asc" | "desc") || "desc",
      });
    } catch (error) {
      this.logger.error(
        `Failed to list conversations: ${error.message}`,
        error.stack,
      );
      const msg = String(error?.message || "");
      if (msg.startsWith("Invalid ")) {
        throw new HttpException(msg, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to list conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * List conversations paginated by thread, so a thread is never split across pages.
   */
  @Get("threads")
  @ApiOperation({ summary: "List conversations paginated by thread" })
  @ApiQuery({ name: "providerId", required: false })
  @ApiQuery({ name: "orderNumber", required: false })
  @ApiQuery({ name: "threadKey", required: false })
  @ApiQuery({ name: "channel", required: false })
  @ApiQuery({ name: "direction", required: false })
  @ApiQuery({ name: "sentiment", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "dateFrom", required: false })
  @ApiQuery({ name: "dateTo", required: false })
  @ApiQuery({ name: "quarter", required: false })
  @ApiQuery({ name: "year", required: false })
  @ApiQuery({ name: "month", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  async listConversationThreads(
    @CurrentUser() user: AuthUser,
    @Query("providerId") providerId?: string,
    @Query("orderNumber") orderNumber?: string,
    @Query("threadKey") threadKey?: string,
    @Query("channel") channel?: string,
    @Query("direction") direction?: string,
    @Query("sentiment") sentiment?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("quarter") quarter?: string,
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.conversationsService.listConversationThreads({
        restaurantId: user.restaurantId,
        providerId,
        orderNumber,
        threadKey,
        channel,
        direction,
        sentiment,
        status,
        search,
        dateFrom,
        dateTo,
        quarter,
        year,
        month,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        sortBy: "created_at",
        sortOrder: "desc",
      });
    } catch (error) {
      this.logger.error(
        `Failed to list conversation threads: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to list conversation threads",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a full conversation thread by threadId
   */
  @Get("thread/:threadId")
  @ApiOperation({ summary: "Get all messages in a conversation thread" })
  async getThread(
    @CurrentUser() user: AuthUser,
    @Param("threadId") threadId: string,
  ) {
    try {
      return await this.conversationsService.getThread(
        threadId,
        user.restaurantId,
      );
    } catch (error) {
      this.logger.error(`Failed to get thread: ${error.message}`, error.stack);
      throw new HttpException(
        "Failed to get thread",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all conversations with a specific provider
   */
  @Get("by-provider/:providerId")
  @ApiOperation({ summary: "Get all conversations with a vendor" })
  async getByProvider(
    @Param("providerId") providerId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.conversationsService.listConversations({
        providerId,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        sortBy: "created_at",
        sortOrder: "desc",
      });
    } catch (error) {
      this.logger.error(
        `Failed to get provider conversations: ${error.message}`,
      );
      throw new HttpException(
        "Failed to get conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all conversations for a specific order
   */
  @Get("by-order/:orderId")
  @ApiOperation({ summary: "Get all conversations for an order" })
  async getByOrder(@Param("orderId") orderId: string) {
    try {
      return await this.conversationsService.listConversations({
        orderId,
        page: 1,
        limit: 100,
        sortBy: "created_at",
        sortOrder: "asc",
      });
    } catch (error) {
      this.logger.error(`Failed to get order conversations: ${error.message}`);
      throw new HttpException(
        "Failed to get conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Trigger summary regeneration for a conversation/thread
   */
  @Post(":conversationId/summarize")
  @ApiOperation({ summary: "Regenerate AI summary for a conversation thread" })
  async regenerateSummary(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
  ) {
    const restaurantId = houseOf(user);
    try {
      return await this.conversationsService.regenerateSummary(
        conversationId,
        restaurantId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to regenerate summary: ${error.message}`);
      throw new HttpException(
        "Failed to regenerate summary",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get aggregated conversation statistics
   */
  @Get("stats/overview")
  @ApiOperation({ summary: "Get aggregated conversation statistics" })
  async getStats(@CurrentUser() user: AuthUser) {
    try {
      return await this.conversationsService.getStats(user.restaurantId);
    } catch (error) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      throw new HttpException(
        "Failed to get stats",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Existing: Pending Conversations ───────────────────────────────

  /**
   * Get all pending conversations
   */
  @Get("pending/list")
  async getPendingConversations(@CurrentUser() user: AuthUser) {
    const restaurantId = houseOf(user);
    this.logger.log("Fetching pending conversations");
    try {
      const conversations =
        await this.conversationsService.getPendingConversations(restaurantId);
      return { conversations, count: conversations.length };
    } catch (error) {
      this.logger.error(
        `Failed to fetch pending conversations: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to fetch pending conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Existing: Single Conversation ─────────────────────────────────

  /**
   * Get conversation by ID
   */
  @Get(":conversationId")
  async getConversation(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
  ) {
    const restaurantId = houseOf(user);
    this.logger.log(`Fetching conversation ${conversationId}`);

    try {
      const conversation = await this.conversationsService.getConversation(
        conversationId,
        restaurantId,
      );

      if (!conversation) {
        throw new HttpException("Conversation not found", HttpStatus.NOT_FOUND);
      }

      return {
        conversation_id: conversation.id,
        order_id: conversation.order_id,
        provider: conversation.provider,
        messages: conversation.messages || [],
        status: conversation.manager_approval_status,
        paused_at: conversation.paused_at,
        time_to_approval: conversation.time_to_approval_seconds,
        ai_message: conversation.message_text,
        conversation_context: conversation.conversation_context,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to fetch conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to fetch conversation",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Begin the hold on an approval: a one-time seal over the message the agent
   * would release, its recipient and this conversation (ADR 0175 D9,
   * 2026-09-21). Who may: an owner, a manager or a grantee (D10) — checked in
   * the service, not by `@Roles`, because a grant is a row, not a token role.
   */
  @Post(":conversationId/approve-seal-challenge")
  async issueApproveSeal(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body() body: ApproveConversationSealDto,
  ) {
    const restaurantId = houseOf(user);
    return this.conversationsService.issueApproveSeal(
      conversationId,
      restaurantId,
      user?.userId ?? "",
      body?.modified_message ?? null,
    );
  }

  /**
   * Approve AI conversation
   * Triggers conversation.approved event for procurement agent to resume
   *
   * SEALED AND GATED SINCE 2026-09-21 (ADR 0175 D9/D10). It carried
   * `@Roles("owner", "manager")` and took the message from the body unsealed.
   * D10 adds a grantee, which a token role cannot express, so WHO is checked
   * in the service (`VendorSendAuthorityService`) and the seal is redeemed
   * over the exact words it would release. The reject path (`approved:
   * false`) sends nothing and keeps its own `@Roles` on `/reject`.
   */
  @Post(":conversationId/approve")
  async approveConversation(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body() body: ApproveConversationDto,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const restaurantId = houseOf(user);
    this.logger.log(
      `Approving conversation ${conversationId} via ${body.approval_channel}`,
    );

    try {
      if (!body.approved) {
        // Declining sends nothing, but it is still an owner's or a manager's
        // call: the `/reject` route's own @Roles is not on this path, so the
        // role is checked here in the words RolesGuard would use.
        const role = String((user as { role?: string })?.role ?? "").toLowerCase();
        if (role !== "owner" && role !== "manager" && role !== "admin") {
          throw new ForbiddenException("Only an owner or a manager may decline this message.");
        }
        return await this.rejectConversation(user, conversationId, {
          reason: "Manager declined approval",
          manager_notes: body.manager_notes,
        });
      }

      const result = await this.conversationsService.approveConversation(
        conversationId,
        restaurantId,
        {
          modifiedMessage: body.modified_message,
          managerNotes: body.manager_notes,
          approvalChannel: body.approval_channel,
        },
        { userId: user?.userId ?? "", challenge },
      );

      if (!result.success) {
        throw new HttpException(
          result.error || "Approval failed",
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        message_sent: result.messageSent,
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to approve conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to approve conversation",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Edit AI message before sending
   */
  @Put(":conversationId/message")
  @Roles("owner", "manager")
  async editMessage(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body() body: EditMessageDto,
  ) {
    const restaurantId = houseOf(user);
    this.logger.log(`Editing message for conversation ${conversationId}`);

    try {
      if (!body.new_message || body.new_message.trim().length === 0) {
        throw new HttpException(
          "Message cannot be empty",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.conversationsService.editMessage(
        conversationId,
        restaurantId,
        body.new_message,
        body.manager_notes,
      );

      if (!result.success) {
        throw new HttpException(
          result.error || "Edit failed",
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        conversation_id: conversationId,
        updated_message: body.new_message,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to edit message: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to edit message",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reject AI conversation
   * Triggers conversation.rejected event
   */
  @Post(":conversationId/reject")
  @Roles("owner", "manager")
  async rejectConversation(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body() body: RejectConversationDto,
  ) {
    const restaurantId = houseOf(user);
    this.logger.log(`Rejecting conversation ${conversationId}`);

    try {
      const result = await this.conversationsService.rejectConversation(
        conversationId,
        restaurantId,
        body.reason,
        body.manager_notes,
      );

      if (!result.success) {
        throw new HttpException(
          result.error || "Rejection failed",
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        success: true,
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to reject conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        "Failed to reject conversation",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
