import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  CreateOrderDto,
  OrderFilterDto,
  OrderListResponseDto,
  OrderResponseDto,
  UpdateOrderDto,
  VerifyReceiptDto,
} from "./dto/procurement.dto";
import { ApproveDraftDto } from "./dto/approve-draft.dto";
import { ProcurementService } from "./procurement.service";

/**
 * `?quantityReceivedInOrderUom=` -> a whole non-negative count, or a 400 that
 * says why.
 *
 * The count is IN THE ORDER'S OWN unit_type — the same unit `quantity` is stated
 * in — which is why the parameter says so in its own name. The old
 * `?quantityReceived=` named no unit and is accepted as a deprecated alias; see
 * `readDeliveredQuantity` below for the conflict rule.
 *
 * Exported so the failure cases can be asserted directly. Absent stays absent:
 * `undefined` means "the caller did not say", which is a real and common answer
 * (the web client never sends one) and is resolved from the order downstream.
 * It is NOT the same as a value that could not be understood, and the whole
 * point of this function is that the two stop looking alike.
 */
export function parseDeliveredQuantity(
  raw: string | undefined,
  paramName = "quantityReceivedInOrderUom",
): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return undefined;

  const text = String(raw).trim();
  const value = Number(text);

  if (!Number.isFinite(value))
    throw new BadRequestException(`${paramName} must be a number; got "${text}".`);
  if (!Number.isInteger(value))
    throw new BadRequestException(
      `${paramName} must be a whole number of units; got "${text}".`,
    );
  if (value < 0)
    throw new BadRequestException(
      `${paramName} cannot be negative; got "${text}".`,
    );

  return value;
}

/**
 * Read the delivered count from either the canonical query parameter or its
 * deprecated unitless alias.
 *
 * Both present and EQUAL is fine; both present and DIFFERENT is a 400 naming
 * both. A server that quietly preferred one would be choosing a delivered
 * quantity by a rule nobody can see, which is the same defect class as the
 * unitless parameter itself.
 *
 * Exported for direct assertion, like `parseDeliveredQuantity`.
 */
export function readDeliveredQuantity(
  canonical: string | undefined,
  deprecatedAlias: string | undefined,
): number | undefined {
  const fromCanonical = parseDeliveredQuantity(
    canonical,
    "quantityReceivedInOrderUom",
  );
  const fromAlias = parseDeliveredQuantity(deprecatedAlias, "quantityReceived");

  if (
    fromCanonical !== undefined &&
    fromAlias !== undefined &&
    fromCanonical !== fromAlias
  ) {
    throw new BadRequestException(
      `quantityReceivedInOrderUom=${fromCanonical} disagrees with its deprecated alias ` +
        `quantityReceived=${fromAlias}. They name the same quantity, so one of them is wrong ` +
        `and the server must not choose. Send only quantityReceivedInOrderUom.`,
    );
  }

  return fromCanonical ?? fromAlias;
}

@ApiTags("procurement")
@Controller("procurement")
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Post("orders")
  @ApiOperation({ summary: "Create procurement order" })
  @ApiResponse({ status: 201, type: OrderResponseDto })
  @ApiResponse({
    status: 403,
    description: "No active vendors — cannot place orders (reason: no_vendors)",
  })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.createOrder(
        user.restaurantId,
        user.userId,
        dto,
        // A request that arrived on this endpoint carried a JWT and a human
        // pressed something. Stated here rather than read from the body: a
        // client must not be able to claim an agent order was manual.
        { source: "manual" },
      );
    } catch (error) {
      // Re-throw every deliberate HTTP refusal as-is. Flattening them to 500
      // turned the unit guard's 400 ("an order in cases needs a pack size")
      // into "Failed to create procurement order", which is unactionable and
      // reads as a server fault rather than as a question for the caller.
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Failed to create procurement order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders")
  @ApiOperation({ summary: "List procurement orders (paginated)" })
  @ApiResponse({ status: 200, type: OrderListResponseDto })
  async listOrders(
    @Query() query: OrderFilterDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderListResponseDto> {
    try {
      return await this.procurementService.listOrders(user.restaurantId, query);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch procurement orders",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/pending/count")
  @ApiOperation({ summary: "Get count of pending procurement orders" })
  @ApiResponse({ status: 200 })
  async getPendingOrderCount(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ count: number }> {
    try {
      const pending = await this.procurementService.listPendingOrders(
        user.restaurantId,
      );
      return { count: pending.length };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch pending order count",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/pending")
  @ApiOperation({ summary: "Get pending procurement orders" })
  @ApiResponse({ status: 200, type: [OrderResponseDto] })
  async listPendingOrders(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto[]> {
    try {
      return await this.procurementService.listPendingOrders(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch pending orders",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/history")
  @ApiOperation({ summary: "Get procurement order history with filters" })
  @ApiResponse({ status: 200, type: OrderListResponseDto })
  async listOrderHistory(
    @Query() query: OrderFilterDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderListResponseDto> {
    try {
      return await this.procurementService.listOrders(user.restaurantId, query);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch order history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/:id")
  @ApiOperation({ summary: "Get procurement order details" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getOrder(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.getOrder(user.restaurantId, orderId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch("orders/:id")
  @ApiOperation({ summary: "Update procurement order" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async updateOrder(
    @Param("id") orderId: string,
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
        error.message || "Failed to update order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/cancel-seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal this order's cancellation has to carry back",
  })
  @ApiResponse({
    status: 201,
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act` — the act is `cancel`, so this token cannot be spent on `POST orders/:id/approve` and an approval's cannot be spent on the cancel. The seal is bound to this actor, this order, this act, and the order's total, vendor and STATE: it cannot be spent after the wine arrives.",
  })
  @ApiResponse({
    status: 422,
    description:
      "The same refusal `DELETE orders/:id` would give. A seal is not minted for a cancellation this house will not perform — an order whose goods have arrived, or one already closed.",
  })
  async issueOrderCancelSealChallenge(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    return this.procurementService.issueOrderCancelSealChallenge(
      user.restaurantId,
      orderId,
      user.userId,
    );
  }

  /**
   * Cancel an order. The verb says DELETE and nothing is deleted — the row
   * moves to CANCELLED — and that mismatch is kept rather than fixed here,
   * because renaming it would break the legacy desk mid-flight for no gain the
   * seal does not already give. Named as a follow-up in ADR 0125.
   */
  @Delete("orders/:id")
  @ApiOperation({
    summary: "Cancel procurement order, behind a redeemed seal and a reason",
  })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  @ApiResponse({
    status: 400,
    description:
      "No reason was given. A cancellation has to say why; the reason is written to `rejection_reason` and is the only account of why this wine was not bought.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The seal was absent, already spent, issued to somebody else, issued for a different order, issued for a different act, or issued before the order's total, vendor or state changed. The body's `message` is the whole sentence and is rendered verbatim by the page.",
  })
  @ApiResponse({
    status: 422,
    description:
      "This house does not allow that state change — the order's goods have arrived, or it is already closed. `message` names the state, the reason, and what to do instead.",
  })
  async cancelOrder(
    @Param("id") orderId: string,
    @Query("reason") reason: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
    // The seal travels in the SAME header as the approval's, so a caller has
    // one thing to learn and the two acts cannot be confused by shape — only
    // by the act the token was minted for, which the seal service compares.
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.cancelOrder(
        user.restaurantId,
        orderId,
        user.userId,
        reason,
        challenge ?? null,
      );
    } catch (error) {
      // A refusal is not a server fault. Every throw here used to be re-wrapped
      // as a 500, so the 400 that says a reason is needed, the 403 that says
      // the seal was not proven and the 422 that says the wine is already on
      // the shelf would all have reached the browser as "Internal Server Error"
      // with their sentences buried inside.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to cancel order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * What this house's approval rules say about every order still waiting.
   *
   * Read-only and one call for the whole house. `/orders` uses it to render the
   * hold-to-approve ceremony DISABLED, with the rule and the amount in words,
   * for a person whose role cannot seal that row — never hidden, because a
   * control that disappears teaches nothing.
   *
   * It is a courtesy, not the gate. `POST orders/:id/approve` decides
   * independently and the page prints its refusal too.
   *
   * Declared as `order-approval-gate` rather than `orders/approval-gate` so it
   * can never be shadowed by, or shadow, a future `orders/:id` route.
   */
  @Get("order-approval-gate")
  @ApiOperation({
    summary: "Who may seal which pending order, and why not",
    description:
      "Per pending order: the role the house's rules demand, which rules fired with the numbers that fired them, which could not be tested, and whether the caller's role satisfies it. `policySet: false` means this house has recorded no rule at all — which is not the same as 'anyone, any amount'.",
  })
  @ApiResponse({ status: 200, description: "The gate readout" })
  async orderApprovalGate(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.procurementService.approvalGate(user.restaurantId, user.userId);
  }

  /**
   * The currency the agreement sheet should offer, and why.
   *
   * ADR 0117 Q31. Declared as `agreement-currency` rather than under `orders/`
   * so it can never be shadowed by, or shadow, `orders/:id` — the same reason
   * `order-approval-gate` sits where it does.
   *
   * A GET with no side effects. `code: null` is a real answer and the sheet
   * renders it as one: it means neither this vendor's paper nor this house
   * states a currency, and after ADR 0117 Q30 cleared every unattributable
   * `USD` to NULL that is a state live houses are in.
   */
  @Get("agreement-currency")
  @ApiOperation({
    summary: "The currency to offer on a new agreement line, and the evidence for it",
    description:
      "Resolves in order: what this vendor last billed this house in (procurement_documents.currency, by the document's own date), then the house's own reporting currency (restaurants.currency), then nothing. `basis` names which rung answered so the sheet can show the evidence rather than just the suggestion; `code: null` means the person must choose or the line records no currency at all. Nothing is converted anywhere.",
  })
  @ApiResponse({ status: 200, description: "The offered default and its basis" })
  async agreementCurrency(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Query("providerId") providerId?: string,
  ) {
    return this.procurementService.agreementCurrencyForVendor(
      user.restaurantId,
      providerId ?? null,
    );
  }

  /**
   * Begin the hold. Returns a one-time seal, once.
   *
   * The token is returned HERE and nowhere else, and it is minted at the moment
   * the gesture STARTS — a token fetched at the moment of approval would be one
   * more thing the same request asked for itself, which is the assertion model
   * with extra steps (founder, 2026-09-04; ADR 0116 addendum).
   *
   * Everything that would refuse the approval refuses the seal first, so a
   * manager is never handed a seal that is going to be refused two seconds
   * later.
   */
  @Post("orders/:id/seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal this order's approval has to carry back",
  })
  @ApiResponse({
    status: 201,
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act`. The seal is bound to this actor, this order, this act and this order's own figures: it cannot be spent by another person, on another order, or after the order's total changes.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The same refusal `POST orders/:id/approve` would give. A seal is not issued for a call that is refused for another reason.",
  })
  async issueOrderSealChallenge(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    return this.procurementService.issueOrderSealChallenge(
      user.restaurantId,
      orderId,
      user.userId,
    );
  }

  @Post("orders/:id/approve")
  @ApiOperation({ summary: "Approve procurement order, behind a redeemed seal" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  @ApiResponse({
    status: 403,
    description:
      "Either this house's approval rules require a role the caller does not hold, or the seal was absent, already spent, issued to somebody else, issued for a different order, or issued before the order's total changed. The body's `message` is the whole sentence and is rendered verbatim by the page.",
  })
  async approveOrder(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
    // The seal travels in a HEADER rather than a body field so that DELETE and
    // PATCH writes elsewhere can carry it identically, and so that a caller
    // cannot confuse it with the arguments it is a seal OVER.
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.approveOrder(
        user.restaurantId,
        orderId,
        user.userId,
        challenge ?? null,
      );
    } catch (error) {
      // A refusal is not a server fault. Before the approval gate existed
      // (ADR 0116) every throw from this method was re-wrapped as a 500, so a
      // 403 carrying the reason a person was stopped would have reached the
      // browser as "Internal Server Error" with the sentence buried in it.
      // HttpExceptions carry their own status and their own body; pass them.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to approve order",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/deliver")
  @ApiOperation({ summary: "Mark procurement order delivered" })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async markDelivered(
    @Param("id") orderId: string,
    @Query("quantityReceivedInOrderUom")
    quantityReceivedInOrderUom: string | undefined,
    // DEPRECATED ALIAS of the parameter above; it named no unit. Kept so a
    // deployed client still holding the old name keeps working. Removable once
    // no such client can reach this endpoint.
    @Query("quantityReceived") quantityReceived: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    // A raw @Query string is not a number, and `Number("abc")` is NaN. NaN is
    // not null or undefined, so `quantityReceived ?? order.quantity` does NOT
    // fall through it: the service used to resolve NaN, fail its `> 0` test,
    // and mark the order DELIVERED with no stock booked — and answer 200 OK.
    // The caller is told what is wrong instead of being quietly given a
    // successful-looking no-op.
    //
    // Parsed OUTSIDE the try below on purpose: that catch rewrites everything it
    // sees, so a BadRequestException thrown inside it would reach the client as
    // a 500.
    const parsedQuantity = readDeliveredQuantity(
      quantityReceivedInOrderUom,
      quantityReceived,
    );

    try {
      return await this.procurementService.markDelivered(
        user.restaurantId,
        orderId,
        user.userId,
        parsedQuantity,
      );
    } catch (error) {
      // An HttpException already carries its own status AND its own body; the
      // re-wrap below keeps only `message` and throws the rest away. That was
      // survivable while every refusal here was a bare sentence, and is not now
      // that a second delivery is refused with `409 { reason, orderId, status,
      // deliveredAt, message }` — a client that branches on `reason` would have
      // received prose and had to parse it. Same shape as the approve route
      // above, for the same reason.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to mark order delivered",
        // Preserve the status the service chose. Without this a 404 for a
        // missing order is reported as a 500, which is a different claim.
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/verify-receipt")
  @ApiOperation({
    summary:
      "Three-way match a delivered order (PO vs invoice vs physical count); apply corrections, then complete or hold open as a backorder",
  })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  @ApiResponse({
    status: 422,
    description:
      "Invoice price differs from the agreed price and no override reason was given",
  })
  async verifyReceipt(
    @Param("id") orderId: string,
    @Body() body: VerifyReceiptDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<OrderResponseDto> {
    try {
      return await this.procurementService.verifyReceipt(
        user.restaurantId,
        orderId,
        user.userId,
        body ?? {},
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to verify receipt",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PHASE 32: AI DRAFT MANAGEMENT
  // =========================================================================

  @Post("orders/:id/approve-draft")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Approve AI email draft and trigger send to provider",
  })
  @ApiResponse({ status: 200, description: "Draft approved and sent" })
  async approveDraft(
    @Param("id") orderId: string,
    @Body() dto: ApproveDraftDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ conversationId: string; sentAt: string }> {
    try {
      return await this.procurementService.approveDraft(
        user.restaurantId,
        orderId,
        dto,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to approve draft",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/generate-ai-reply")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Run the autonomous responder on the latest inbound vendor reply",
    description:
      "Understands the most recent vendor reply for this order and stages a one-tap-approve AI draft. " +
      "Used to process replies that predate the feature or to recover missed ones.",
  })
  @ApiResponse({
    status: 200,
    description: "Responder triggered (draft staged asynchronously)",
  })
  async generateAiReply(
    @Param("id") orderId: string,
    @Body()
    body: { instruction?: string; regenerate?: boolean; force?: boolean },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{
    triggered: boolean;
    draftId?: string;
    needsApproval?: boolean;
    autoSendScheduled?: boolean;
    reason?: string;
  }> {
    try {
      return await this.procurementService.generateAiReply(
        user.restaurantId,
        orderId,
        {
          instruction: body?.instruction,
          regenerate: body?.regenerate,
          force: body?.force,
        },
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to generate AI reply",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/manual-reply")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Send a manager-written threaded reply to the provider",
  })
  @ApiResponse({
    status: 200,
    description: "Manual reply sent and recorded on the thread",
  })
  async manualReply(
    @Param("id") orderId: string,
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
        error.message || "Failed to send manual reply",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/ai-pause")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Pause or resume AI autonomy for this order" })
  @ApiResponse({ status: 200 })
  async setAiPaused(
    @Param("id") orderId: string,
    @Body() body: { paused: boolean },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ paused: boolean }> {
    try {
      return await this.procurementService.setOrderAiPaused(
        user.restaurantId,
        orderId,
        !!body?.paused,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to update AI pause state",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/cancel-scheduled-send")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Undo a scheduled auto-send (revert it to a one-tap-approval draft)",
  })
  @ApiResponse({ status: 200 })
  async cancelScheduledSend(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ cancelled: boolean }> {
    try {
      return await this.procurementService.cancelScheduledSend(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to cancel scheduled send",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/:id/deal-proposal")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Get the latest AI-detected deal proposal for this order (or null)",
  })
  @ApiResponse({ status: 200 })
  async getDealProposal(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<Record<string, any> | null> {
    try {
      return await this.procurementService.getDealProposal(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to load deal proposal",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/confirm-deal")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Confirm an AI-detected deal: commit the order and optionally email the vendor",
  })
  @ApiResponse({ status: 200 })
  async confirmDeal(
    @Param("id") orderId: string,
    @Body()
    body: {
      finalPrice?: number;
      quantity?: number;
      sendConfirmation?: boolean;
    },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ confirmed: boolean; sentConfirmation: boolean }> {
    try {
      return await this.procurementService.confirmDeal(
        user.restaurantId,
        orderId,
        {
          finalPrice: body?.finalPrice,
          quantity: body?.quantity,
          sendConfirmation: body?.sendConfirmation,
        },
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to confirm deal",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/dismiss-deal")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Decline an AI-detected deal without committing (order stays in negotiation)",
  })
  @ApiResponse({ status: 200 })
  async dismissDeal(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ dismissed: boolean }> {
    try {
      return await this.procurementService.dismissDeal(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to dismiss deal",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("orders/:id/discard-draft")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Discard AI email draft without sending" })
  @ApiResponse({ status: 200 })
  async discardDraft(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      return await this.procurementService.discardDraft(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new HttpException(
        error.message || "Failed to discard draft",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch("orders/:id/draft")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Edit AI email draft content before approval" })
  @ApiResponse({ status: 200 })
  async editDraft(
    @Param("id") orderId: string,
    @Body() dto: ApproveDraftDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    // `modifiedContent` is OPTIONAL on the DTO, and `editDraft` requires a
    // string — it raises BadRequest for empty content. Omitting the field
    // therefore produced a 400 from the service that this catch converted into
    // a **500**, telling the caller the server broke when the caller had simply
    // left out a required field. Found by the OD-107 measurement.
    if (!dto.modifiedContent || dto.modifiedContent.trim().length === 0) {
      throw new BadRequestException("modifiedContent is required");
    }

    try {
      return await this.procurementService.editDraft(
        user.restaurantId,
        orderId,
        dto.modifiedContent,
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      // A 4xx from the service is the CALLER's problem and must survive the
      // catch. Collapsing it to 500 is what hid the defect above.
      if (error instanceof BadRequestException) throw error;
      throw new HttpException(
        error.message || "Failed to edit draft",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/:id/conversations")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Get all email conversations for a specific order (all statuses)",
  })
  @ApiResponse({ status: 200 })
  async getOrderConversations(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.procurementService.getOrderConversations(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to get order conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/:id/attachments")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "List an order's persisted email attachments (with signed URLs)",
  })
  @ApiResponse({ status: 200 })
  async getOrderAttachments(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.procurementService.getOrderAttachments(
        user.restaurantId,
        orderId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to get order attachments",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("orders/:id/draft")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Get pending AI email draft for an order" })
  @ApiResponse({ status: 200 })
  async getPendingDraft(
    @Param("id") orderId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ draft: Record<string, any> | null }> {
    try {
      const draft = await this.procurementService.getPendingDraft(
        user.restaurantId,
        orderId,
      );
      // Always return a JSON object so the browser receives Content-Type: application/json
      // and a non-empty body. Returning `null` directly causes NestJS to send Content-Length: 0
      // which Safari DevTools flags as an error and Axios deserialises as an empty string.
      return { draft };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to get draft",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // PHASE 34: CONVERSATION READ ENDPOINTS
  // =========================================================================

  @Get("conversations/active")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Get all PENDING_APPROVAL conversations with order + provider data",
  })
  @ApiResponse({ status: 200 })
  async getActiveConversations(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.procurementService.getActiveConversations(
        user.restaurantId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to fetch active conversations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("conversations/history")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get completed/sent procurement conversation history",
  })
  @ApiResponse({ status: 200 })
  async getConversationHistory(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.procurementService.getConversationHistory(
        user.restaurantId,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to fetch conversation history",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
