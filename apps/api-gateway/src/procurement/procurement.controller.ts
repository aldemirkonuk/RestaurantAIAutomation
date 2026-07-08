import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateOrderDto,
  OrderFilterDto,
  OrderListResponseDto,
  OrderResponseDto,
  UpdateOrderDto,
} from './dto/procurement.dto';
import { ApproveDraftDto } from './dto/approve-draft.dto';
import { ProcurementService } from './procurement.service';

@ApiTags('procurement')
@Controller('procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Create procurement order' })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  @ApiResponse({ status: 403, description: 'No active vendors — cannot place orders (reason: no_vendors)' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.createOrder(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      // Re-throw ForbiddenException (no_vendors guard) as-is with 403
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create procurement order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders')
  @ApiOperation({ summary: 'List procurement orders (paginated)' })
  @ApiResponse({ status: 200, type: OrderListResponseDto })
  async listOrders(
    @Query() query: OrderFilterDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderListResponseDto> {
    try {
      return await this.procurementService.listOrders(user.restaurantId, query);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch procurement orders',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/pending/count')
  @ApiOperation({ summary: 'Get count of pending procurement orders' })
  @ApiResponse({ status: 200 })
  async getPendingOrderCount(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ count: number }> {
    try {
      const pending = await this.procurementService.listPendingOrders(user.restaurantId);
      return { count: pending.length };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch pending order count',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/pending')
  @ApiOperation({ summary: 'Get pending procurement orders' })
  @ApiResponse({ status: 200, type: [OrderResponseDto] })
  async listPendingOrders(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto[]> {
    try {
      return await this.procurementService.listPendingOrders(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch pending orders',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/history')
  @ApiOperation({ summary: 'Get procurement order history with filters' })
  @ApiResponse({ status: 200, type: OrderListResponseDto })
  async listOrderHistory(
    @Query() query: OrderFilterDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderListResponseDto> {
    try {
      return await this.procurementService.listOrders(user.restaurantId, query);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch order history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get procurement order details' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getOrder(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.getOrder(user.restaurantId, orderId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('orders/:id')
  @ApiOperation({ summary: 'Update procurement order' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async updateOrder(
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.updateOrder(
        user.restaurantId,
        orderId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || 'Failed to update order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('orders/:id')
  @ApiOperation({ summary: 'Cancel procurement order' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async cancelOrder(
    @Param('id') orderId: string,
    @Query('reason') reason: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.cancelOrder(
        user.restaurantId,
        orderId,
        user.userId,
        reason,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to cancel order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/approve')
  @ApiOperation({ summary: 'Approve procurement order' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async approveOrder(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.approveOrder(
        user.restaurantId,
        orderId,
        user.userId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to approve order',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/deliver')
  @ApiOperation({ summary: 'Mark procurement order delivered' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async markDelivered(
    @Param('id') orderId: string,
    @Query('quantityReceived') quantityReceived: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      const parsedQuantity = quantityReceived ? Number(quantityReceived) : undefined;
      return await this.procurementService.markDelivered(
        user.restaurantId,
        orderId,
        user.userId,
        parsedQuantity,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to mark order delivered',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PHASE 32: AI DRAFT MANAGEMENT
  // =========================================================================

  @Post('orders/:id/approve-draft')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Approve AI email draft and trigger send to provider' })
  @ApiResponse({ status: 200, description: 'Draft approved and sent' })
  async approveDraft(
    @Param('id') orderId: string,
    @Body() dto: ApproveDraftDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ conversationId: string; sentAt: string }> {
    try {
      return await this.procurementService.approveDraft(user.restaurantId, orderId, dto);
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to approve draft',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/generate-ai-reply')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Run the autonomous responder on the latest inbound vendor reply',
    description:
      'Understands the most recent vendor reply for this order and stages a one-tap-approve AI draft. ' +
      'Used to process replies that predate the feature or to recover missed ones.',
  })
  @ApiResponse({ status: 200, description: 'Responder triggered (draft staged asynchronously)' })
  async generateAiReply(
    @Param('id') orderId: string,
    @Body() body: { instruction?: string; regenerate?: boolean; force?: boolean },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ triggered: boolean; draftId?: string; needsApproval?: boolean; autoSendScheduled?: boolean; reason?: string }> {
    try {
      return await this.procurementService.generateAiReply(user.restaurantId, orderId, {
        instruction: body?.instruction,
        regenerate: body?.regenerate,
        force: body?.force,
      });
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to generate AI reply',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/manual-reply')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send a manager-written threaded reply to the provider' })
  @ApiResponse({ status: 200, description: 'Manual reply sent and recorded on the thread' })
  async manualReply(
    @Param('id') orderId: string,
    @Body() body: { content: string; ccEmails?: string[] },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ conversationId: string; sentAt: string }> {
    try {
      return await this.procurementService.manualReply(
        user.restaurantId,
        orderId,
        body?.content,
        body?.ccEmails,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to send manual reply',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/ai-pause')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Pause or resume AI autonomy for this order' })
  @ApiResponse({ status: 200 })
  async setAiPaused(
    @Param('id') orderId: string,
    @Body() body: { paused: boolean },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ paused: boolean }> {
    try {
      return await this.procurementService.setOrderAiPaused(user.restaurantId, orderId, !!body?.paused);
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to update AI pause state',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders/:id/cancel-scheduled-send')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Undo a scheduled auto-send (revert it to a one-tap-approval draft)' })
  @ApiResponse({ status: 200 })
  async cancelScheduledSend(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ cancelled: boolean }> {
    try {
      return await this.procurementService.cancelScheduledSend(user.restaurantId, orderId);
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to cancel scheduled send',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id/deal-proposal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the latest AI-detected deal proposal for this order (or null)' })
  @ApiResponse({ status: 200 })
  async getDealProposal(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<Record<string, any> | null> {
    try {
      return await this.procurementService.getDealProposal(user.restaurantId, orderId);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to load deal proposal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('orders/:id/confirm-deal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm an AI-detected deal: commit the order and optionally email the vendor' })
  @ApiResponse({ status: 200 })
  async confirmDeal(
    @Param('id') orderId: string,
    @Body() body: { finalPrice?: number; quantity?: number; sendConfirmation?: boolean },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ confirmed: boolean; sentConfirmation: boolean }> {
    try {
      return await this.procurementService.confirmDeal(user.restaurantId, orderId, {
        finalPrice: body?.finalPrice,
        quantity: body?.quantity,
        sendConfirmation: body?.sendConfirmation,
      });
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(error.message || 'Failed to confirm deal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('orders/:id/dismiss-deal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Decline an AI-detected deal without committing (order stays in negotiation)' })
  @ApiResponse({ status: 200 })
  async dismissDeal(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ dismissed: boolean }> {
    try {
      return await this.procurementService.dismissDeal(user.restaurantId, orderId);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to dismiss deal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('orders/:id/discard-draft')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Discard AI email draft without sending' })
  @ApiResponse({ status: 200 })
  async discardDraft(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      return await this.procurementService.discardDraft(user.restaurantId, orderId);
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to discard draft',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('orders/:id/draft')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Edit AI email draft content before approval' })
  @ApiResponse({ status: 200 })
  async editDraft(
    @Param('id') orderId: string,
    @Body() dto: ApproveDraftDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      return await this.procurementService.editDraft(
        user.restaurantId,
        orderId,
        dto.modifiedContent,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || 'Failed to edit draft',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id/conversations')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get all email conversations for a specific order (all statuses)' })
  @ApiResponse({ status: 200 })
  async getOrderConversations(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.procurementService.getOrderConversations(user.restaurantId, orderId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get order conversations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id/attachments')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "List an order's persisted email attachments (with signed URLs)" })
  @ApiResponse({ status: 200 })
  async getOrderAttachments(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.procurementService.getOrderAttachments(user.restaurantId, orderId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get order attachments',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id/draft')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get pending AI email draft for an order' })
  @ApiResponse({ status: 200 })
  async getPendingDraft(
    @Param('id') orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ draft: Record<string, any> | null }> {
    try {
      const draft = await this.procurementService.getPendingDraft(user.restaurantId, orderId);
      // Always return a JSON object so the browser receives Content-Type: application/json
      // and a non-empty body. Returning `null` directly causes NestJS to send Content-Length: 0
      // which Safari DevTools flags as an error and Axios deserialises as an empty string.
      return { draft };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get draft',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PHASE 34: CONVERSATION READ ENDPOINTS
  // =========================================================================

  @Get('conversations/active')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get all PENDING_APPROVAL conversations with order + provider data' })
  @ApiResponse({ status: 200 })
  async getActiveConversations(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.procurementService.getActiveConversations(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to fetch active conversations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('conversations/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get completed/sent procurement conversation history' })
  @ApiResponse({ status: 200 })
  async getConversationHistory(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.procurementService.getConversationHistory(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to fetch conversation history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
