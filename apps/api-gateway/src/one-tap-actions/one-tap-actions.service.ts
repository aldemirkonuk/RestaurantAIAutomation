import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
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

/**
 * One-Tap Actions Service
 *
 * Manages one-tap actions for quick manager workflows:
 * - CRUD operations for actions
 * - Real-time sync via WebSocket
 * - Action execution and tracking
 * - Integration with backend workflows
 */
@Injectable()
export class OneTapActionsService {
  private readonly logger = new Logger(OneTapActionsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly websocketGateway: WebsocketGateway,
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
   * Get a single action by ID
   */
  async getAction(actionId: string): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from("one_tap_actions")
      .select("*")
      .eq("id", actionId)
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
    dto: UpdateOneTapActionDto,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // First get the action to get restaurant_id
    const existing = await this.getAction(actionId);

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
   * Execute an action (mark as completed with result)
   */
  async executeAction(
    actionId: string,
    userId: string,
    dto: ExecuteActionDto,
  ): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // First get the action to get restaurant_id
    const existing = await this.getAction(actionId);

    const { data, error } = await client
      .from("one_tap_actions")
      .update({
        status: OneTapActionStatus.COMPLETED,
        executed_at: new Date().toISOString(),
        executed_by: userId,
        execution_result: dto.result || {},
      })
      .eq("id", actionId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to execute action: ${error.message}`);
      throw error;
    }

    const action = this.mapToResponse(data);

    // Trigger backend workflow based on action type
    await this.triggerWorkflow(action);

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
  async cancelAction(actionId: string): Promise<OneTapActionResponseDto> {
    const client = this.dbService.getClient();

    // First get the action to get restaurant_id
    const existing = await this.getAction(actionId);

    const { data, error } = await client
      .from("one_tap_actions")
      .update({
        status: OneTapActionStatus.CANCELLED,
      })
      .eq("id", actionId)
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
  async deleteAction(actionId: string): Promise<void> {
    const client = this.dbService.getClient();

    // First get the action to get restaurant_id
    const existing = await this.getAction(actionId);

    const { error } = await client
      .from("one_tap_actions")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", actionId);

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
   * Trigger backend workflow based on action type
   */
  private async triggerWorkflow(
    action: OneTapActionResponseDto,
  ): Promise<void> {
    switch (action.actionType) {
      case OneTapActionType.LOW_STOCK:
        // TODO: Trigger reorder workflow
        this.logger.log(`Triggering reorder workflow for action: ${action.id}`);
        break;

      case OneTapActionType.DELIVERY_CONFIRM:
        // TODO: Update inventory with delivered items
        this.logger.log(
          `Triggering delivery confirmation for action: ${action.id}`,
        );
        break;

      case OneTapActionType.PRICE_CHANGE:
        // TODO: Update price in system
        this.logger.log(`Triggering price update for action: ${action.id}`);
        break;

      default:
        this.logger.log(
          `No workflow defined for action type: ${action.actionType}`,
        );
    }
  }

  /**
   * Broadcast action update via WebSocket
   */
  private broadcastActionUpdate(
    restaurantId: string,
    event: string,
    data: any,
  ): void {
    this.websocketGateway.server
      .to(`restaurant:${restaurantId}`)
      .emit("one_tap_action", { event, data });
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
