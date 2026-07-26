import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import axios from "axios";

const AGENT_ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://localhost:8000";

interface ApprovalOptions {
  modifiedMessage?: string;
  managerNotes?: string;
  approvalChannel: string;
}

interface ListConversationsOptions {
  restaurantId?: string;
  providerId?: string;
  orderId?: string;
  orderNumber?: string;
  channel?: string;
  direction?: string;
  sentiment?: string;
  dateFrom?: string;
  dateTo?: string;
  quarter?: string;
  year?: string;
  month?: string;
  search?: string;
  status?: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const ALLOWED_SENTIMENTS = new Set([
  "positive",
  "neutral",
  "negative",
  "unclassified",
]);
const ALLOWED_DIRECTIONS = new Set(["inbound", "outbound"]);

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  // ── New: Listing & Filtering ──────────────────────────────────────

  /**
   * List conversations with comprehensive filtering and pagination
   */
  async listConversations(options: ListConversationsOptions) {
    try {
      const { page, limit, sortBy, sortOrder } = options;
      const offset = (page - 1) * limit;

      const orderJoin = options.orderNumber
        ? `procurement_orders!inner(id, order_number, quantity, status, negotiated_price, final_price, inventory:inventory_id(wine_name))`
        : `procurement_orders(id, order_number, quantity, status, negotiated_price, final_price, inventory:inventory_id(wine_name))`;

      let query = this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          `
          *,
          providers (id, name),
          ${orderJoin}
        `,
          { count: "exact" },
        );

      // Apply filters
      if (options.restaurantId) {
        query = query.eq("restaurant_id", options.restaurantId);
      }
      if (options.providerId) {
        query = query.eq("provider_id", options.providerId);
      }
      if (options.orderId) {
        query = query.eq("order_id", options.orderId);
      }
      if (options.orderNumber) {
        query = query.ilike(
          "procurement_orders.order_number",
          `%${options.orderNumber.trim()}%`,
        );
      }
      if (options.channel) {
        query = query.eq("channel", options.channel);
      }
      // Direction may be stored as OUTBOUND/INBOUND (legacy) or lowercase —
      // match case-insensitively via ilike exact pattern.
      if (options.direction) {
        const dir = options.direction.trim().toLowerCase();
        if (!ALLOWED_DIRECTIONS.has(dir)) {
          throw new Error(
            `Invalid direction "${options.direction}". Use inbound or outbound.`,
          );
        }
        query = query.ilike("direction", dir);
      }
      if (options.sentiment) {
        const sent = options.sentiment.trim().toLowerCase();
        if (!ALLOWED_SENTIMENTS.has(sent)) {
          throw new Error(
            `Invalid sentiment "${options.sentiment}". Use positive, neutral, negative, or unclassified.`,
          );
        }
        if (sent === "unclassified") {
          // Align with client normalizeSentiment: null OR empty string
          query = query.or("detected_sentiment.is.null,detected_sentiment.eq.");
        } else {
          query = query.ilike("detected_sentiment", sent);
        }
      }
      if (options.dateFrom) {
        query = query.gte("created_at", options.dateFrom);
      }
      if (options.dateTo) {
        query = query.lte("created_at", options.dateTo);
      }
      if (options.search) {
        query = query.ilike("message_text", `%${options.search}%`);
      }
      if (options.status) {
        query = query.eq("delivery_status", options.status);
      }

      // Quarter filter: convert Q1-Q4 + year to date range
      if (options.quarter && options.year) {
        const yr = parseInt(options.year, 10);
        const q = parseInt(options.quarter.replace("Q", ""), 10);
        const startMonth = (q - 1) * 3;
        const qStart = new Date(yr, startMonth, 1).toISOString();
        const qEnd = new Date(yr, startMonth + 3, 0, 23, 59, 59).toISOString();
        query = query.gte("created_at", qStart).lte("created_at", qEnd);
      } else if (options.year && options.month) {
        const yr = parseInt(options.year, 10);
        const mo = parseInt(options.month, 10) - 1;
        const mStart = new Date(yr, mo, 1).toISOString();
        const mEnd = new Date(yr, mo + 1, 0, 23, 59, 59).toISOString();
        query = query.gte("created_at", mStart).lte("created_at", mEnd);
      } else if (options.year) {
        const yr = parseInt(options.year, 10);
        query = query
          .gte("created_at", new Date(yr, 0, 1).toISOString())
          .lte("created_at", new Date(yr, 11, 31, 23, 59, 59).toISOString());
      }

      // Sorting
      const validSortFields = ["created_at", "sent_at", "received_at"];
      const sortField = validSortFields.includes(sortBy)
        ? sortBy
        : "created_at";
      query = query.order(sortField, { ascending: sortOrder === "asc" });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        this.logger.error(`List conversations error: ${error.message}`);
        throw new Error(error.message);
      }

      // Flatten nested inventory.wine_name onto procurement_orders.wine_name
      // so the frontend can keep a single wine_name field.
      const conversations = (data || []).map((row: any) => {
        const order = row.procurement_orders;
        if (!order) return row;
        const wineName = order.inventory?.wine_name ?? order.wine_name ?? null;
        const { inventory: _inv, ...rest } = order;
        return {
          ...row,
          procurement_orders: {
            ...rest,
            wine_name: wineName,
          },
        };
      });

      return {
        conversations,
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      this.logger.error(`Failed to list conversations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a full conversation thread by threadId
   */
  async getThread(threadId: string) {
    try {
      // Thread matching: if thread_id column exists use it, otherwise
      // fall back to grouping by order_id (pre-email-tracking migration)
      const { data, error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          `
          *,
          providers (id, name),
          procurement_orders (id, order_number, quantity, status, negotiated_price)
        `,
        )
        .eq("order_id", threadId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      const messages = data || [];
      const provider = messages[0]?.providers || null;
      const order = messages[0]?.procurement_orders || null;

      return {
        thread_id: threadId,
        message_count: messages.length,
        first_message_at: messages[0]?.created_at || null,
        last_message_at: messages[messages.length - 1]?.created_at || null,
        summary: null,
        summary_updated_at: null,
        provider,
        order,
        messages: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          channel: m.channel,
          message_text: m.message_text,
          ai_generated: m.ai_generated,
          detected_intent: m.detected_intent,
          detected_sentiment: m.detected_sentiment,
          sent_at: m.sent_at,
          received_at: m.received_at,
          created_at: m.created_at,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get thread: ${error.message}`);
      throw error;
    }
  }

  /**
   * Regenerate summary for a conversation's thread
   */
  async regenerateSummary(conversationId: string) {
    try {
      // Get the thread_id for this conversation
      const { data: conv, error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .select("id, order_id")
        .eq("id", conversationId)
        .single();

      if (error || !conv) {
        return { success: false, error: "Conversation not found" };
      }

      // Publish event to trigger summarization in the EmailParsingAgent
      try {
        await axios.post(`${AGENT_ORCHESTRATOR_URL}/api/v1/events/publish`, {
          exchange: "email.events",
          routing_key: "email.summarize.requested",
          payload: {
            order_id: conv.order_id,
            conversation_id: conversationId,
            requested_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        this.logger.warn(`Could not publish summarization event: ${e.message}`);
      }

      return {
        success: true,
        order_id: conv.order_id,
        message: "Summary regeneration requested",
      };
    } catch (error) {
      this.logger.error(`Failed to regenerate summary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get aggregated conversation statistics
   */
  async getStats(restaurantId?: string) {
    try {
      let baseQuery = this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          "id, channel, direction, provider_id, detected_sentiment, created_at",
        );

      if (restaurantId) {
        baseQuery = baseQuery.eq("restaurant_id", restaurantId);
      }

      const { data, error } = await baseQuery;

      if (error) {
        throw new Error(error.message);
      }

      const conversations = data || [];

      // Aggregate stats
      const byChannel: Record<string, number> = {};
      const byDirection: Record<string, number> = {};
      const byProvider: Record<string, number> = {};
      const bySentiment: Record<string, number> = {};
      const byMonth: Record<string, number> = {};

      for (const c of conversations) {
        // By channel
        byChannel[c.channel] = (byChannel[c.channel] || 0) + 1;
        // By direction (normalize casing)
        const dir = String(c.direction || "")
          .trim()
          .toLowerCase();
        if (dir) byDirection[dir] = (byDirection[dir] || 0) + 1;
        // By provider
        if (c.provider_id) {
          byProvider[c.provider_id] = (byProvider[c.provider_id] || 0) + 1;
        }
        // By sentiment (normalize; null → unclassified)
        const sent = String(c.detected_sentiment || "")
          .trim()
          .toLowerCase();
        const sentKey = sent || "unclassified";
        bySentiment[sentKey] = (bySentiment[sentKey] || 0) + 1;
        // By month
        if (c.created_at) {
          const monthKey = c.created_at.substring(0, 7); // YYYY-MM
          byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
        }
      }

      return {
        total: conversations.length,
        byChannel,
        byDirection,
        byProvider,
        bySentiment,
        byMonth,
      };
    } catch (error) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<any> {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          `
          *,
          providers (
            id,
            name,
            contact_email,
            contact_phone
          ),
          procurement_orders (
            id,
            order_number,
            quantity,
            status,
            negotiated_price,
            final_price
          )
        `,
        )
        .eq("id", conversationId)
        .single();

      if (error) {
        this.logger.error(`Supabase error: ${error.message}`);
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      this.logger.error(`Failed to get conversation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all pending conversations
   */
  async getPendingConversations(restaurantId?: string): Promise<any[]> {
    try {
      let query = this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          `
          *,
          providers (name),
          procurement_orders (id, order_number, quantity, status, negotiated_price)
        `,
        )
        .eq("delivery_status", "pending")
        .order("created_at", { ascending: true });

      if (restaurantId) {
        query = query.eq("restaurant_id", restaurantId);
      }

      const { data, error } = await query;

      if (error) {
        this.logger.error(`Supabase error: ${error.message}`);
        throw new Error(error.message);
      }

      return data || [];
    } catch (error) {
      this.logger.error(
        `Failed to get pending conversations: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Approve conversation
   * Updates database and publishes conversation.approved event
   */
  async approveConversation(
    conversationId: string,
    options: ApprovalOptions,
  ): Promise<{ success: boolean; messageSent: boolean; error?: string }> {
    try {
      // 1. Update conversation in database
      const updates: any = {
        manager_approval_status: options.modifiedMessage
          ? "modified"
          : "approved",
        approval_channel: options.approvalChannel,
        resumed_at: new Date().toISOString(),
      };

      if (options.modifiedMessage) {
        updates.manager_approved_message = options.modifiedMessage;
      }

      if (options.managerNotes) {
        updates.manager_notes = options.managerNotes;
      }

      // Calculate time to approval
      const conversation = await this.getConversation(conversationId);
      if (conversation.paused_at) {
        const pausedAt = new Date(conversation.paused_at);
        const now = new Date();
        const diffSeconds = Math.floor(
          (now.getTime() - pausedAt.getTime()) / 1000,
        );
        updates.time_to_approval_seconds = diffSeconds;
      }

      const { error: updateError } = await this.databaseService.supabase
        .from("procurement_conversations")
        .update(updates)
        .eq("id", conversationId);

      if (updateError) {
        this.logger.error(
          `Failed to update conversation: ${updateError.message}`,
        );
        return {
          success: false,
          messageSent: false,
          error: updateError.message,
        };
      }

      // 2. Publish conversation.approved event to RabbitMQ
      try {
        await axios.post(`${AGENT_ORCHESTRATOR_URL}/api/v1/events/publish`, {
          exchange: "conversation.events",
          routing_key: "conversation.approved",
          payload: {
            conversation_id: conversationId,
            approval_channel: options.approvalChannel,
            modified: !!options.modifiedMessage,
          },
        });

        this.logger.log(
          `✅ Published conversation.approved event for ${conversationId}`,
        );
      } catch (eventError) {
        this.logger.error(`Failed to publish event: ${eventError.message}`);
        // Don't fail the request if event publishing fails
      }

      return { success: true, messageSent: true };
    } catch (error) {
      this.logger.error(`Failed to approve conversation: ${error.message}`);
      return { success: false, messageSent: false, error: error.message };
    }
  }

  /**
   * Edit message (without approving yet)
   */
  async editMessage(
    conversationId: string,
    newMessage: string,
    managerNotes?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updates: any = {
        manager_approved_message: newMessage,
      };

      if (managerNotes) {
        updates.manager_notes = managerNotes;
      }

      const { error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .update(updates)
        .eq("id", conversationId);

      if (error) {
        this.logger.error(`Failed to edit message: ${error.message}`);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to edit message: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject conversation
   * Updates database and publishes conversation.rejected event
   */
  async rejectConversation(
    conversationId: string,
    reason?: string,
    managerNotes?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Update conversation in database
      const updates: any = {
        manager_approval_status: "rejected",
        resumed_at: new Date().toISOString(),
      };

      if (reason) {
        updates.manager_notes = managerNotes
          ? `${reason} - ${managerNotes}`
          : reason;
      } else if (managerNotes) {
        updates.manager_notes = managerNotes;
      }

      const { error: updateError } = await this.databaseService.supabase
        .from("procurement_conversations")
        .update(updates)
        .eq("id", conversationId);

      if (updateError) {
        this.logger.error(
          `Failed to update conversation: ${updateError.message}`,
        );
        return { success: false, error: updateError.message };
      }

      // 2. Publish conversation.rejected event to RabbitMQ
      try {
        await axios.post(`${AGENT_ORCHESTRATOR_URL}/api/v1/events/publish`, {
          exchange: "conversation.events",
          routing_key: "conversation.rejected",
          payload: {
            conversation_id: conversationId,
            reason,
          },
        });

        this.logger.log(
          `✅ Published conversation.rejected event for ${conversationId}`,
        );
      } catch (eventError) {
        this.logger.error(`Failed to publish event: ${eventError.message}`);
        // Don't fail the request if event publishing fails
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to reject conversation: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
