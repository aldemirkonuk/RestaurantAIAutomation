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
} from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { ApiTags, ApiOperation, ApiQuery } from "@nestjs/swagger";

interface ApproveConversationDto {
  approved: boolean;
  modified_message?: string;
  manager_notes?: string;
  approval_channel: "push_notification" | "onetap_center" | "web_app";
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
    @Query("restaurantId") restaurantId?: string,
    @Query("providerId") providerId?: string,
    @Query("orderId") orderId?: string,
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
        restaurantId,
        providerId,
        orderId,
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
   * Get a full conversation thread by threadId
   */
  @Get("thread/:threadId")
  @ApiOperation({ summary: "Get all messages in a conversation thread" })
  async getThread(@Param("threadId") threadId: string) {
    try {
      return await this.conversationsService.getThread(threadId);
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
  async regenerateSummary(@Param("conversationId") conversationId: string) {
    try {
      return await this.conversationsService.regenerateSummary(conversationId);
    } catch (error) {
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
  async getStats(@Query("restaurantId") restaurantId?: string) {
    try {
      return await this.conversationsService.getStats(restaurantId);
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
  async getPendingConversations() {
    this.logger.log("Fetching all pending conversations");
    try {
      const conversations =
        await this.conversationsService.getPendingConversations();
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
  async getConversation(@Param("conversationId") conversationId: string) {
    this.logger.log(`Fetching conversation ${conversationId}`);

    try {
      const conversation =
        await this.conversationsService.getConversation(conversationId);

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
      this.logger.error(
        `Failed to fetch conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        error.message || "Failed to fetch conversation",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Approve AI conversation
   * Triggers conversation.approved event for procurement agent to resume
   */
  @Post(":conversationId/approve")
  async approveConversation(
    @Param("conversationId") conversationId: string,
    @Body() body: ApproveConversationDto,
  ) {
    this.logger.log(
      `Approving conversation ${conversationId} via ${body.approval_channel}`,
    );

    try {
      if (!body.approved) {
        return this.rejectConversation(conversationId, {
          reason: "Manager declined approval",
          manager_notes: body.manager_notes,
        });
      }

      const result = await this.conversationsService.approveConversation(
        conversationId,
        {
          modifiedMessage: body.modified_message,
          managerNotes: body.manager_notes,
          approvalChannel: body.approval_channel,
        },
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
      this.logger.error(
        `Failed to approve conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        error.message || "Failed to approve conversation",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Edit AI message before sending
   */
  @Put(":conversationId/message")
  async editMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: EditMessageDto,
  ) {
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
      this.logger.error(
        `Failed to edit message: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        error.message || "Failed to edit message",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reject AI conversation
   * Triggers conversation.rejected event
   */
  @Post(":conversationId/reject")
  async rejectConversation(
    @Param("conversationId") conversationId: string,
    @Body() body: RejectConversationDto,
  ) {
    this.logger.log(`Rejecting conversation ${conversationId}`);

    try {
      const result = await this.conversationsService.rejectConversation(
        conversationId,
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
      this.logger.error(
        `Failed to reject conversation: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        error.message || "Failed to reject conversation",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
