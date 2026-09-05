import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { ProcurementService } from "../procurement/procurement.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import {
  CreateOneTapActionDto,
  UpdateOneTapActionDto,
  ExecuteActionDto,
  OneTapActionResponseDto,
  OneTapActionListResponseDto,
  OneTapActionStatus,
  OneTapActionType,
  OneTapPriority,
} from "./dto/one-tap-action.dto";
import {
  DELIVERY_WITHOUT_ORDER,
  ONE_TAP_DELIVER_ACT,
  deliverySealArgs,
  dispositionOf,
} from "./one-tap-workflow";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import {
  ORDER_GOODS_ARRIVED_STATUSES,
  readOrderStatus,
  statusInWords,
} from "../procurement/order-transitions";

/** Every column the seal path reads off an order, for `check_read_columns_exist.py`. */
const ORDER_SEAL_COLUMNS = "id, restaurant_id, status, quantity, bottles_total";

/**
 * One-Tap Actions Service
 *
 * Manages one-tap actions for quick manager workflows:
 * - CRUD operations for actions
 * - Real-time sync via WebSocket
 * - Action execution and tracking
 * - Integration with backend workflows
 *
 * ===========================================================================
 * WHAT "EXECUTE" MEANS HERE, SINCE 2026-09-05
 * ===========================================================================
 * It used to mean: stamp the row `completed`, then call `triggerWorkflow`,
 * which was three `// TODO` branches and a default log. So the one control on
 * the dashboard rail that carries the house seal reported success for a
 * reorder, a delivery and a price change that had not happened — a claim about
 * a write, made by the thing that did not make it (ADR 0083).
 *
 * Now the disposition of the action's TYPE decides, and it decides BEFORE
 * anything is written (`one-tap-workflow.ts`):
 *
 *   * `workflow` (today: `delivery_confirm` alone) — the seal is redeemed, the
 *     real service is called, and only then is the row stamped. The order in
 *     which those three happen is the whole safety property: proven, done,
 *     recorded.
 *   * `record` (`custom`) — marking it done IS the act. Recorded, and the row
 *     says so in `execution_result` rather than leaving a reader to assume a
 *     workflow ran.
 *   * `unbuilt` (everything else) — refused with a whole sentence, and the row
 *     stays `pending`. An action marked done for a workflow that never ran is
 *     a lie that outlives the toast that told it.
 *
 * THE SPENT SEAL IS ALSO THE IDEMPOTENCY GUARD. `markDelivered` books stock
 * through the ledger; running it twice would book it twice. A seal is good for
 * exactly one act, so a retry after a successful delivery is refused by the
 * seal rather than by a flag this service would have to remember to check.
 */
@Injectable()
export class OneTapActionsService {
  private readonly logger = new Logger(OneTapActionsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly websocketGateway: WebsocketGateway,
    // Required, never @Optional(). An optional ProcurementService that failed
    // to resolve would turn every delivery confirmation back into a silent
    // record — the exact fault this change exists to remove, reintroduced as a
    // DI accident nothing would report.
    private readonly procurementService: ProcurementService,
    private readonly sealChallengeService: SealChallengeService,
  ) {}

  /**
   * Get all actions for a restaurant
   */
  async getActions(
    restaurantId: string,
    status?: OneTapActionStatus,
  ): Promise<OneTapActionListResponseDto> {
    const client = this.dbService.getClient();

    let query = client
      .from("one_tap_actions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to fetch actions: ${error.message}`);
      throw error;
    }

    const actions = (data || []).map(this.mapToResponse);
    const pending = actions.filter(
      (a) => a.status === OneTapActionStatus.PENDING,
    ).length;
    const completed = actions.filter(
      (a) => a.status === OneTapActionStatus.COMPLETED,
    ).length;

    return {
      actions,
      total: actions.length,
      pending,
      completed,
    };
  }

  /**
   * Get pending actions for a restaurant
   */
  async getPendingActions(
    restaurantId: string,
  ): Promise<OneTapActionResponseDto[]> {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("one_tap_actions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "pending")
      .is("deleted_at", null)
      .or("expires_at.is.null,expires_at.gt.now()")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch pending actions: ${error.message}`);
      throw error;
    }

    return (data || []).map(this.mapToResponse);
  }

  /**
   * Get a single action by ID, scoped to the caller's restaurant.
   *
   * restaurantId is a REQUIRED filter in the query, not a check applied after the
   * row is fetched. This method used to take only an actionId and read
   * restaurant_id off the result purely to address the WebSocket broadcast, which
   * meant anyone holding a UUID could read another restaurant's action — and
   * every mutating method below routed its authorisation through here.
   *
   * A row belonging to another tenant returns 404 rather than 403: telling a
   * caller "that exists but is not yours" confirms the UUID is real, which is
   * information they should not get from an id they should not have.
   */
  async getAction(
    actionId: string,
    restaurantId: string,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("one_tap_actions")
      .select("*")
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Action not found: ${actionId}`);
    }

    return this.mapToResponse(data);
  }

  /**
   * Create a new action
   */
  async createAction(
    restaurantId: string,
    userId: string,
    dto: CreateOneTapActionDto,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("one_tap_actions")
      .insert({
        restaurant_id: restaurantId,
        user_id: userId,
        action_type: dto.actionType || OneTapActionType.CUSTOM,
        title: dto.title,
        description: dto.description,
        action_url: dto.actionUrl,
        priority: dto.priority || OneTapPriority.MEDIUM,
        color: dto.color || "wine",
        icon: dto.icon || "Zap",
        status: OneTapActionStatus.PENDING,
        related_wine_id: dto.relatedWineId,
        related_order_id: dto.relatedOrderId,
        related_provider_id: dto.relatedProviderId,
        metadata: dto.metadata || {},
        expires_at: dto.expiresAt,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create action: ${error.message}`);
      throw error;
    }

    const action = this.mapToResponse(data);

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(restaurantId, "action_created", action);

    this.logger.log(`Created action: ${action.id} - ${action.title}`);
    return action;
  }

  /**
   * Update an action
   */
  async updateAction(
    actionId: string,
    restaurantId: string,
    dto: UpdateOneTapActionDto,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // Throws 404 unless the action belongs to this restaurant.
    const existing = await this.getAction(actionId, restaurantId);

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.actionUrl !== undefined) updateData.action_url = dto.actionUrl;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.color !== undefined) updateData.color = dto.color;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

    const { data, error } = await client
      .from("one_tap_actions")
      .update(updateData)
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update action: ${error.message}`);
      throw error;
    }

    const action = this.mapToResponse(data);

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(existing.restaurantId, "action_updated", action);

    this.logger.log(`Updated action: ${action.id}`);
    return action;
  }

  /**
   * Mint the one-time seal this action's execution has to carry back.
   *
   * Everything that would refuse the execution refuses the seal FIRST, so a
   * manager is never handed a seal and then told two seconds later that it
   * meant nothing (the rule `procurement.controller.ts:317-322` states for
   * orders). That is why this method reads the order and its state rather than
   * only the card.
   *
   * A seal is issued ONLY for a `workflow` action. A `record` needs no proof —
   * nothing outside the card changes — and an `unbuilt` one must not be handed
   * a seal for an act that does not exist.
   */
  async issueExecutionSeal(
    actionId: string,
    restaurantId: string,
    actorUserId: string,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    // Throws 404 unless the action belongs to this restaurant.
    const action = await this.getAction(actionId, restaurantId);
    const order = await this.deliverableOrderFor(action);

    const issued = await this.sealChallengeService.issue({
      restaurantId,
      actorUserId,
      subjectKind: "procurement_order",
      subjectId: order.id,
      action: ONE_TAP_DELIVER_ACT,
      args: deliverySealArgs({
        actionId: action.id,
        orderId: order.id,
        quantity: order.quantity,
        bottlesTotal: order.bottles_total,
        status: order.status,
      }),
    });

    // `act`, not `action`: the same word the order route answers with
    // (`procurement.controller.ts:340`), so one client shape reads both.
    return {
      challenge: issued.challenge,
      expiresAt: issued.expiresAt,
      act: issued.action,
    };
  }

  /**
   * Read the order a delivery card points at, and refuse in words if this act
   * cannot be carried out on it.
   *
   * Shared by the mint and the redemption so the two cannot disagree about
   * which order, or about whether it is still deliverable. A split check here
   * would let a seal be minted against an order the write then refuses, which
   * is how a ceremony becomes decoration.
   */
  private async deliverableOrderFor(action: OneTapActionResponseDto): Promise<{
    id: string;
    quantity: unknown;
    bottles_total: unknown;
    status: unknown;
  }> {
    const disposition = dispositionOf(action.actionType);
    if (disposition.kind !== "workflow") {
      throw new BadRequestException(
        disposition.kind === "record"
          ? "This action is a note, not a workflow. Marking it done records the decision and needs no seal."
          : disposition.sentence,
      );
    }
    if (action.status !== OneTapActionStatus.PENDING) {
      throw new BadRequestException(
        `This action was already ${action.status}, so there is nothing left to carry out. Nothing was changed.`,
      );
    }
    if (!action.relatedOrderId) {
      throw new BadRequestException(DELIVERY_WITHOUT_ORDER);
    }

    const { data, error } = await this.dbService.supabase
      .from("procurement_orders")
      .select(ORDER_SEAL_COLUMNS)
      .eq("id", action.relatedOrderId)
      .eq("restaurant_id", action.restaurantId)
      .maybeSingle();

    // A read that FAILED is not a read that found nothing. Reporting a broken
    // connection as "no such order" would tell a manager their order is gone.
    if (error) {
      this.logger.error(
        `Failed to read order ${action.relatedOrderId} for one-tap action ${action.id}: ${error.message}`,
      );
      // Raised as a real exception rather than the bare PostgREST object: a
      // thrown `{ message }` is not an Error, so every caller that branches on
      // `instanceof` — and the controller's `error.status` check — sees
      // something it has no name for, and the person is told nothing.
      throw new InternalServerErrorException(
        `The order this card points at could not be read, so nothing was changed: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "The order this card points at is not in this house's book, so nothing was changed.",
      );
    }

    const order = data as unknown as {
      id: string;
      status: unknown;
      quantity: unknown;
      bottles_total: unknown;
    };

    // THIS REFUSAL STAYS FIRST, AND IT IS NO LONGER THE ONLY ONE.
    //
    // It was written when `markDelivered` had no guard of its own, so this was
    // the whole defence and it lived one caller deep. Since 2026-09-05 the
    // service refuses a second delivery for EVERY caller (`delivered-once.ts`,
    // `procurement.service.ts` `markDelivered`) with a 409. This check is kept,
    // and kept ahead of the seal, because of what it protects that the service
    // cannot: the seal is minted here and redeemed before `markDelivered` runs,
    // so a refusal that arrived only from the service would burn a one-shot
    // seal on an act the house was always going to decline, and the card could
    // not be retried.
    //
    // Widened to the whole goods-have-arrived set for the same reason. A
    // PARTIALLY_RECEIVED or COMPLETED order passed this check before and would
    // now be refused downstream — after the seal was spent.
    const arrived = readOrderStatus(order.status);
    if (arrived === ProcurementOrderStatus.DELIVERED) {
      throw new BadRequestException(
        "That order is already booked in as delivered, so nothing was changed. Booking it twice would double the stock.",
      );
    }
    if (arrived !== null && ORDER_GOODS_ARRIVED_STATUSES.includes(arrived)) {
      throw new BadRequestException(
        `That order is ${statusInWords(arrived)} — its wine has already been ` +
          `counted in, so nothing was changed. Confirming delivery from a card ` +
          `would book the whole order on top of what the receiving door has ` +
          `already recorded. Finish it at the receiving door instead.`,
      );
    }

    return {
      id: order.id,
      quantity: order.quantity,
      bottles_total: order.bottles_total,
      status: order.status,
    };
  }

  /**
   * Carry the action out, then record it.
   *
   * THE ORDER OF THESE THREE STEPS IS THE SAFETY PROPERTY:
   *   1. the seal is redeemed (for a `workflow` action) — proven;
   *   2. the real service runs — done;
   *   3. the row is stamped with what happened — recorded.
   *
   * It used to be (3) alone, with a log where (2) belongs. Stamping first means
   * a workflow that throws leaves a row saying the house did something it did
   * not do, and no later repair removes a row already written.
   *
   * If (3) fails after (2) succeeded, the delivery HAS happened and this throws:
   * the response must not say "confirmed" when the desk still shows the card,
   * and the spent seal stops a retry from booking the stock a second time.
   */
  async executeAction(
    actionId: string,
    restaurantId: string,
    userId: string,
    dto: ExecuteActionDto,
    challenge?: string | null,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // Throws 404 unless the action belongs to this restaurant.
    const existing = await this.getAction(actionId, restaurantId);
    const disposition = dispositionOf(existing.actionType);

    // Refused, and nothing written. The row stays pending, which is true.
    if (disposition.kind === "unbuilt") {
      throw new BadRequestException(disposition.sentence);
    }

    let result: Record<string, unknown>;

    if (disposition.kind === "workflow") {
      const order = await this.deliverableOrderFor(existing);

      await this.sealChallengeService.redeem({
        restaurantId,
        actorUserId: userId,
        subjectKind: "procurement_order",
        subjectId: order.id,
        action: ONE_TAP_DELIVER_ACT,
        args: deliverySealArgs({
          actionId: existing.id,
          orderId: order.id,
          quantity: order.quantity,
          bottlesTotal: order.bottles_total,
          status: order.status,
        }),
        challenge,
      });

      const delivered = await this.procurementService.markDelivered(
        restaurantId,
        order.id,
        userId,
      );

      // Explicit keys, every one of them a fact from the write that just
      // happened. No spread of the DTO: a record of an act should say what the
      // act did, not whatever the caller's object happened to contain.
      result = {
        act: ONE_TAP_DELIVER_ACT,
        orderId: delivered.id,
        orderNumber: delivered.orderNumber ?? null,
        status: delivered.status,
        quantityBooked: delivered.quantity ?? null,
        bottlesBooked: delivered.bottlesTotal ?? null,
        sealed: true,
        ranAt: new Date().toISOString(),
      };
    } else {
      // A note. Marking it done IS the act, and the record says exactly that
      // rather than leaving a reader to assume a workflow ran.
      result = {
        act: "record",
        note: "Recorded against the person who marked it done. No workflow runs for a written action.",
        sealed: false,
        ranAt: new Date().toISOString(),
      };
    }

    const { data, error } = await client
      .from("one_tap_actions")
      .update({
        status: OneTapActionStatus.COMPLETED,
        executed_at: new Date().toISOString(),
        executed_by: userId,
        execution_result: result,
      })
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to execute action: ${error.message}`);
      if (disposition.kind === "workflow") {
        this.logger.error(
          `ONE_TAP_DELIVERY_UNRECORDED action=${actionId} order=${String(result.orderId)} — ` +
            `the delivery was booked and the card was not updated. The seal is spent, so a retry will be refused.`,
        );
      }
      throw error;
    }

    const action = this.mapToResponse(data);

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(
      existing.restaurantId,
      "action_executed",
      action,
    );

    this.logger.log(`Executed action: ${action.id} - ${action.title}`);
    return action;
  }

  /**
   * Cancel an action
   */
  async cancelAction(
    actionId: string,
    restaurantId: string,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // Throws 404 unless the action belongs to this restaurant.
    const existing = await this.getAction(actionId, restaurantId);

    const { data, error } = await client
      .from("one_tap_actions")
      .update({
        status: OneTapActionStatus.CANCELLED,
      })
      .eq("id", actionId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to cancel action: ${error.message}`);
      throw error;
    }

    const action = this.mapToResponse(data);

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(
      existing.restaurantId,
      "action_cancelled",
      action,
    );

    this.logger.log(`Cancelled action: ${action.id}`);
    return action;
  }

  /**
   * Delete an action (soft delete)
   */
  async deleteAction(actionId: string, restaurantId: string): Promise<void> {
    const client = this.dbService.getClient();

    // Throws 404 unless the action belongs to this restaurant.
    const existing = await this.getAction(actionId, restaurantId);

    const { error } = await client
      .from("one_tap_actions")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", actionId)
      // Scoped as well as pre-checked. The getAction() call above already proves
      // ownership, but a delete that could touch any row given the right id is
      // one refactor away from doing so.
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`Failed to delete action: ${error.message}`);
      throw error;
    }

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(existing.restaurantId, "action_deleted", {
      id: actionId,
    });

    this.logger.log(`Deleted action: ${actionId}`);
  }

  /**
   * Create system-generated action (e.g., low stock alert)
   */
  async createSystemAction(
    restaurantId: string,
    actionType: OneTapActionType,
    title: string,
    description: string,
    options: {
      priority?: OneTapPriority;
      relatedWineId?: string;
      relatedOrderId?: string;
      relatedProviderId?: string;
      metadata?: Record<string, any>;
      expiresAt?: string;
    } = {},
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("one_tap_actions")
      .insert({
        restaurant_id: restaurantId,
        action_type: actionType,
        title,
        description,
        priority: options.priority || OneTapPriority.MEDIUM,
        color: this.getColorForActionType(actionType),
        icon: this.getIconForActionType(actionType),
        status: OneTapActionStatus.PENDING,
        related_wine_id: options.relatedWineId,
        related_order_id: options.relatedOrderId,
        related_provider_id: options.relatedProviderId,
        metadata: options.metadata || {},
        expires_at: options.expiresAt,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create system action: ${error.message}`);
      throw error;
    }

    const action = this.mapToResponse(data);

    // Broadcast to WebSocket clients
    this.broadcastActionUpdate(restaurantId, "action_created", action);

    this.logger.log(`Created system action: ${action.id} - ${action.title}`);
    return action;
  }

  /**
   * Broadcast action update via WebSocket
   */
  private broadcastActionUpdate(
    restaurantId: string,
    event: string,
    data: any,
  ): void {
    // Every caller of this runs AFTER its database write has committed, so a
    // broadcast failure must not propagate: it would return an error for an
    // operation that actually succeeded, and the client would retry a completed
    // execute. `server` is undefined until the gateway finishes initialising,
    // which previously threw "Cannot read properties of null (reading 'to')" from
    // inside a successful mutation.
    try {
      this.websocketGateway.server
        ?.to(`restaurant:${restaurantId}`)
        ?.emit("one_tap_action", { event, data });
    } catch (err: any) {
      this.logger.warn(
        `one-tap broadcast failed for ${event} (write already committed): ${err?.message}`,
      );
    }
  }

  /**
   * Map database row to response DTO
   */
  private mapToResponse(row: any): OneTapActionResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      userId: row.user_id,
      actionType: row.action_type,
      title: row.title,
      description: row.description,
      actionUrl: row.action_url,
      priority: row.priority,
      color: row.color,
      icon: row.icon,
      status: row.status,
      relatedWineId: row.related_wine_id,
      relatedOrderId: row.related_order_id,
      relatedProviderId: row.related_provider_id,
      metadata: row.metadata,
      executedAt: row.executed_at,
      executedBy: row.executed_by,
      executionResult: row.execution_result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Get default color for action type
   */
  private getColorForActionType(actionType: OneTapActionType): string {
    const colors: Record<OneTapActionType, string> = {
      [OneTapActionType.LOW_STOCK]: "rose",
      [OneTapActionType.PRICE_CHANGE]: "amber",
      [OneTapActionType.DELIVERY_CONFIRM]: "emerald",
      [OneTapActionType.INEQUALITY]: "purple",
      [OneTapActionType.VINTAGE_SUB]: "blue",
      [OneTapActionType.STOCK_RECEIPT]: "emerald",
      [OneTapActionType.CUSTOM]: "wine",
      [OneTapActionType.GMAIL_SEND]: "blue",
      [OneTapActionType.GMAIL_CONTEXTUAL]: "blue",
    };
    return colors[actionType] || "wine";
  }

  /**
   * Get default icon for action type
   */
  private getIconForActionType(actionType: OneTapActionType): string {
    const icons: Record<OneTapActionType, string> = {
      [OneTapActionType.LOW_STOCK]: "AlertTriangle",
      [OneTapActionType.PRICE_CHANGE]: "DollarSign",
      [OneTapActionType.DELIVERY_CONFIRM]: "Truck",
      [OneTapActionType.INEQUALITY]: "RefreshCw",
      [OneTapActionType.VINTAGE_SUB]: "Wine",
      [OneTapActionType.STOCK_RECEIPT]: "Package",
      [OneTapActionType.CUSTOM]: "Zap",
      [OneTapActionType.GMAIL_SEND]: "Mail",
      [OneTapActionType.GMAIL_CONTEXTUAL]: "Send",
    };
    return icons[actionType] || "Zap";
  }
}
