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
  threadKey?: string;
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collapse the quarter / month / year filters into one concrete created_at window,
 * combined with any explicit dateFrom / dateTo.
 */
function resolveDateWindow(options: {
  dateFrom?: string;
  dateTo?: string;
  quarter?: string;
  year?: string;
  month?: string;
}): { from: string | null; to: string | null } {
  let from = options.dateFrom || null;
  let to = options.dateTo || null;

  const widen = (start: Date, end: Date) => {
    from = from
      ? new Date(
          Math.max(new Date(from).getTime(), start.getTime()),
        ).toISOString()
      : start.toISOString();
    to = to
      ? new Date(Math.min(new Date(to).getTime(), end.getTime())).toISOString()
      : end.toISOString();
  };

  if (options.quarter && options.year) {
    const yr = parseInt(options.year, 10);
    const q = parseInt(options.quarter.replace("Q", ""), 10);
    const startMonth = (q - 1) * 3;
    widen(
      new Date(yr, startMonth, 1),
      new Date(yr, startMonth + 3, 0, 23, 59, 59),
    );
  } else if (options.year && options.month) {
    const yr = parseInt(options.year, 10);
    const mo = parseInt(options.month, 10) - 1;
    widen(new Date(yr, mo, 1), new Date(yr, mo + 1, 0, 23, 59, 59));
  } else if (options.year) {
    const yr = parseInt(options.year, 10);
    widen(new Date(yr, 0, 1), new Date(yr, 11, 31, 23, 59, 59));
  }

  return { from, to };
}

/**
 * Flatten nested inventory.wine_name onto procurement_orders.wine_name so the
 * frontend can keep a single wine_name field.
 */
function flattenWineName(rows: any[]): any[] {
  return rows.map((row: any) => {
    const order = row.procurement_orders;
    if (!order) return row;
    const wineName = order.inventory?.wine_name ?? order.wine_name ?? null;
    const { inventory: _inv, ...rest } = order;
    return { ...row, procurement_orders: { ...rest, wine_name: wineName } };
  });
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Publish a domain event to the orchestrator's event bus.
   *
   * KNOWN BROKEN, deliberately left in place. The orchestrator has no
   * `/api/v1/events` router — it registers only
   * `/api/v1/{admin,analytics,collect,onboarding,pos,preview,procurement,
   * quality,research,scan,studio}`, `/api/templates` and the unprefixed health
   * routes (`services/agent-orchestrator/main.py:151-186`). So every call here
   * returns 404 today. It is NOT deleted, because unlike the Toast forward these
   * three call sites have no alternative consumer: whether to build the bus or
   * retire the `conversations.*` approve/reject/summarise endpoints is an open
   * founder decision, not one this method may make.
   *
   * What it must never do again is hide that. It **throws**, at `error` level,
   * with the full outbound call in the log line. Callers may not report a
   * success they did not achieve (ADR 0020 — no fabricated answers).
   */
  private async publishEvent(
    exchange: string,
    routingKey: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = `${AGENT_ORCHESTRATOR_URL}/api/v1/events/publish`;
    try {
      await axios.post(url, {
        exchange,
        routing_key: routingKey,
        payload,
      });
    } catch (error) {
      const status = error?.response?.status;
      const permanent = status === 404 || status === 405;
      this.logger.error(
        `Event publish FAILED — POST ${url} exchange=${exchange} ` +
          `routing_key=${routingKey} status=${status ?? "no-response"}` +
          `${permanent ? " (PERMANENT: the orchestrator does not serve this route)" : ""}: ` +
          `${error.message}`,
      );
      throw new Error(
        `event bus unavailable (POST /api/v1/events/publish → ` +
          `${status ?? "no response"}${permanent ? ", route not served" : ""})`,
      );
    }
  }

  // ── New: Listing & Filtering ──────────────────────────────────────

  /**
   * List conversations with comprehensive filtering and pagination
   */
  async listConversations(options: ListConversationsOptions) {
    try {
      const { page, limit, sortBy, sortOrder } = options;
      const offset = (page - 1) * limit;

      // Always a LEFT join. An !inner join here silently drops every message that has
      // no order — which is most of them, since a negotiation precedes its order.
      // Order-number filtering runs off order_number_snapshot instead (see below).
      let query = this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          `
          *,
          providers (id, name),
          procurement_orders (id, order_number, quantity, status, negotiated_price, final_price, inventory:inventory_id(wine_name))
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
        // Snapshot rather than the joined column: it is kept in sync by trigger and
        // survives deletion of the order, so history stays searchable either way.
        query = query.ilike(
          "order_number_snapshot",
          `%${options.orderNumber.trim()}%`,
        );
      }
      if (options.threadKey) {
        query = query.eq("thread_key", options.threadKey);
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

      return {
        conversations: flattenWineName(data || []),
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
   * List conversations paginated BY THREAD rather than by message.
   *
   * Message-level pagination splits a thread across the pager, so a 6-message
   * negotiation renders as 4 + 2 and looks broken. Here the page boundary always
   * falls between threads: the RPC selects a page of thread keys, then every message
   * belonging to those threads is fetched in one go.
   */
  async listConversationThreads(options: ListConversationsOptions) {
    const { page, limit } = options;

    if (!options.restaurantId) {
      throw new Error("restaurantId is required to list conversation threads");
    }

    const direction = options.direction?.trim().toLowerCase();
    if (direction && !ALLOWED_DIRECTIONS.has(direction)) {
      throw new Error(
        `Invalid direction "${options.direction}". Use inbound or outbound.`,
      );
    }
    const sentiment = options.sentiment?.trim().toLowerCase();
    if (sentiment && !ALLOWED_SENTIMENTS.has(sentiment)) {
      throw new Error(
        `Invalid sentiment "${options.sentiment}". Use positive, neutral, negative, or unclassified.`,
      );
    }

    const window = resolveDateWindow(options);

    const { data: threadRows, error: threadError } =
      await this.databaseService.supabase.rpc("list_conversation_threads", {
        p_restaurant_id: options.restaurantId,
        p_provider_id: options.providerId ?? null,
        p_channel: options.channel ?? null,
        p_direction: direction ?? null,
        p_sentiment: sentiment ?? null,
        p_status: options.status ?? null,
        p_search: options.search ?? null,
        p_order_number: options.orderNumber ?? null,
        p_thread_key: options.threadKey ?? null,
        p_date_from: window.from,
        p_date_to: window.to,
        p_limit: limit,
        p_offset: (page - 1) * limit,
      });

    if (threadError) {
      this.logger.error(`List threads error: ${threadError.message}`);
      throw new Error(threadError.message);
    }

    const threads = (threadRows || []) as any[];
    const total = Number(threads[0]?.total_threads ?? 0);
    const keys = threads.map((t) => t.thread_key);

    if (keys.length === 0) {
      return {
        conversations: [],
        threads: [],
        total,
        page,
        limit,
        totalPages: 0,
      };
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        *,
        providers (id, name),
        procurement_orders (id, order_number, quantity, status, negotiated_price, final_price, inventory:inventory_id(wine_name))
      `,
      )
      .eq("restaurant_id", options.restaurantId)
      .in("thread_key", keys)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`List thread messages error: ${error.message}`);
      throw new Error(error.message);
    }

    return {
      conversations: flattenWineName(data || []),
      threads: threads.map((t) => ({
        key: t.thread_key,
        messageCount: Number(t.message_count),
        firstAt: t.first_at,
        lastAt: t.last_at,
        orderId: t.order_id,
        orderNumber: t.order_number,
        providerId: t.provider_id,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a full conversation thread by threadId
   */
  async getThread(threadId: string, restaurantId: string) {
    try {
      const select = `
          *,
          providers (id, name),
          procurement_orders (id, order_number, quantity, status, negotiated_price)
        `;

      // Tenant scope is mandatory: thread keys are derived from Gmail thread ids, so
      // without this any authenticated user could read another restaurant's entire
      // negotiation history by guessing or replaying a key.
      const scoped = () =>
        this.databaseService.supabase
          .from("procurement_conversations")
          .select(select)
          .eq("restaurant_id", restaurantId);

      // thread_key is the durable identity. Older callers (and saved links) may still
      // pass an order UUID, so fall back to order_id when the key matches nothing.
      let { data, error } = await scoped()
        .eq("thread_key", threadId)
        .order("created_at", { ascending: true });

      if (!error && (!data || data.length === 0) && UUID_RE.test(threadId)) {
        ({ data, error } = await scoped()
          .eq("order_id", threadId)
          .order("created_at", { ascending: true }));
      }

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

      // Publish event to trigger summarization in the EmailParsingAgent.
      // If this does not land, nothing was requested of anything — saying
      // "Summary regeneration requested" anyway is a fabricated success.
      try {
        await this.publishEvent("email.events", "email.summarize.requested", {
          order_id: conv.order_id,
          conversation_id: conversationId,
          requested_at: new Date().toISOString(),
        });
      } catch (e) {
        return {
          success: false,
          order_id: conv.order_id,
          error: `Summary regeneration could not be requested — ${e.message}. Nothing was queued.`,
        };
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

      // 2. Publish conversation.approved so the procurement agent resumes and
      //    sends the vendor message.
      //
      //    NOTHING IN THIS METHOD SENDS A MESSAGE. Until 2026-09-01 this
      //    returned `messageSent: true` unconditionally — including after the
      //    publish above had 404'd and been swallowed — so the endpoint
      //    reported a vendor message that was never sent. That is a fabricated
      //    success under ADR 0020, and it is now impossible: `messageSent` is
      //    only ever true where the gateway holds evidence of a send, and the
      //    gateway never holds that evidence.
      try {
        await this.publishEvent(
          "conversation.events",
          "conversation.approved",
          {
            conversation_id: conversationId,
            approval_channel: options.approvalChannel,
            modified: !!options.modifiedMessage,
          },
        );

        this.logger.log(
          `Published conversation.approved event for ${conversationId}`,
        );
      } catch (eventError) {
        return {
          success: false,
          messageSent: false,
          error:
            `The approval was recorded, but it could not be dispatched — ${eventError.message}. ` +
            `No message has been sent to the vendor.`,
        };
      }

      // The event was accepted. That is a dispatch, not a send — the agent may
      // still fail downstream — so we do not claim the message went out.
      return { success: true, messageSent: false };
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

      // 2. Publish conversation.rejected so the procurement agent resumes.
      //    Same rule as approve: if the dispatch does not land, the action did
      //    not complete and must not report success.
      try {
        await this.publishEvent(
          "conversation.events",
          "conversation.rejected",
          {
            conversation_id: conversationId,
            reason,
          },
        );

        this.logger.log(
          `Published conversation.rejected event for ${conversationId}`,
        );
      } catch (eventError) {
        return {
          success: false,
          error:
            `The rejection was recorded, but it could not be dispatched — ${eventError.message}. ` +
            `The agent has not been told to stop.`,
        };
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to reject conversation: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
