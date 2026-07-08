import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import {
  CreateEventDto,
  CreateEventResponseDto,
  EventListResponseDto,
  EventResponseDto,
  GetEventsQueryDto,
} from "./dto/event.dto";

interface EventRow {
  id: string;
  restaurant_id: string;
  user_id: string | null;
  event_type: string;
  source_page: string;
  payload: Record<string, any>;
  schema_version: number;
  idempotency_key: string | null;
  trace_id: string | null;
  correlation_id: string | null;
  created_at: string;
}

// Metrics counters (in-memory, would be replaced by Prometheus/StatsD in production)
interface EventMetrics {
  totalIngested: number;
  totalDeduped: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  errors: number;
  lastReset: Date;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly metrics: EventMetrics = {
    totalIngested: 0,
    totalDeduped: 0,
    byType: {},
    bySource: {},
    errors: 0,
    lastReset: new Date(),
  };

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly websocketGateway: WebsocketGateway,
  ) {
    // Reset metrics every hour (in production, use proper metrics system)
    setInterval(() => this.resetMetrics(), 60 * 60 * 1000);
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): EventMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics counters
   */
  private resetMetrics(): void {
    this.logger.log({
      message: "Resetting event metrics",
      metrics: { ...this.metrics },
    });
    this.metrics.totalIngested = 0;
    this.metrics.totalDeduped = 0;
    this.metrics.byType = {};
    this.metrics.bySource = {};
    this.metrics.errors = 0;
    this.metrics.lastReset = new Date();
  }

  /**
   * Increment metric counters
   */
  private incrementMetrics(
    eventType: string,
    sourcePage: string,
    deduped: boolean,
  ): void {
    this.metrics.totalIngested++;
    if (deduped) {
      this.metrics.totalDeduped++;
    }
    this.metrics.byType[eventType] = (this.metrics.byType[eventType] || 0) + 1;
    this.metrics.bySource[sourcePage] =
      (this.metrics.bySource[sourcePage] || 0) + 1;
  }

  async createEvent(
    restaurantId: string,
    userId: string,
    dto: CreateEventDto,
  ): Promise<CreateEventResponseDto> {
    const startTime = Date.now();
    const schemaVersion = dto.schemaVersion ?? 1;
    const idempotencyKey = dto.idempotencyKey?.trim() || null;

    // Structured log: Event ingestion started
    this.logger.log({
      message: "Event ingestion started",
      restaurantId,
      userId,
      eventType: dto.eventType,
      sourcePage: dto.sourcePage,
      idempotencyKey,
      traceId: dto.traceId,
      correlationId: dto.correlationId,
      schemaVersion,
    });

    const insertPayload = {
      restaurant_id: restaurantId,
      user_id: userId,
      event_type: dto.eventType,
      source_page: dto.sourcePage,
      payload: dto.payload,
      schema_version: schemaVersion,
      idempotency_key: idempotencyKey,
      trace_id: dto.traceId?.trim() || null,
      correlation_id: dto.correlationId?.trim() || null,
    };

    const { data, error } = await this.databaseService.supabase
      .from("events")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      const isDuplicate =
        error.code === "23505" ||
        error.message?.includes("uq_events_idempotency");

      if (isDuplicate && idempotencyKey) {
        const existing = await this.findByIdempotencyKey(
          restaurantId,
          idempotencyKey,
        );

        if (existing) {
          const duration = Date.now() - startTime;
          this.incrementMetrics(dto.eventType, dto.sourcePage, true);

          // Structured log: Event deduplicated
          this.logger.log({
            message: "Event deduplicated",
            restaurantId,
            eventId: existing.id,
            eventType: dto.eventType,
            sourcePage: dto.sourcePage,
            idempotencyKey,
            durationMs: duration,
          });

          return {
            ...existing,
            deduped: true,
          };
        }
      }

      this.metrics.errors++;

      // Structured log: Event ingestion failed
      this.logger.error({
        message: "Event ingestion failed",
        restaurantId,
        eventType: dto.eventType,
        sourcePage: dto.sourcePage,
        idempotencyKey,
        errorCode: error.code,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      throw error;
    }

    const duration = Date.now() - startTime;
    this.incrementMetrics(dto.eventType, dto.sourcePage, false);

    // Structured log: Event ingestion completed
    this.logger.log({
      message: "Event ingestion completed",
      restaurantId,
      eventId: data.id,
      eventType: dto.eventType,
      sourcePage: dto.sourcePage,
      idempotencyKey,
      durationMs: duration,
    });

    this.websocketGateway.server
      .to(`restaurant:${restaurantId}`)
      .emit("event:new", data);

    return {
      ...this.mapEventRow(data),
      deduped: false,
    };
  }

  async listEvents(
    restaurantId: string,
    query: GetEventsQueryDto,
  ): Promise<EventListResponseDto> {
    const startTime = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    // Structured log: List events query started
    this.logger.debug({
      message: "List events query started",
      restaurantId,
      filters: {
        eventType: query.eventType,
        sourcePage: query.sourcePage,
        after: query.after,
        before: query.before,
      },
      pagination: { page, limit },
    });

    let supabaseQuery = this.databaseService.supabase
      .from("events")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    if (query.eventType) {
      supabaseQuery = supabaseQuery.eq("event_type", query.eventType);
    }

    if (query.sourcePage) {
      supabaseQuery = supabaseQuery.eq("source_page", query.sourcePage);
    }

    if (query.after) {
      supabaseQuery = supabaseQuery.gt("created_at", query.after);
    }

    if (query.before) {
      supabaseQuery = supabaseQuery.lt("created_at", query.before);
    }

    const { data, error, count } = await supabaseQuery
      .order("created_at", { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error({
        message: "List events query failed",
        restaurantId,
        errorCode: error.code,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    const events = (data || []).map((row: EventRow) => this.mapEventRow(row));
    const total = count ?? events.length;

    // Structured log: List events query completed
    this.logger.debug({
      message: "List events query completed",
      restaurantId,
      resultCount: events.length,
      total,
      hasMore: fromIndex + events.length < total,
      durationMs: Date.now() - startTime,
    });

    return {
      events,
      total,
      page,
      limit,
      hasMore: fromIndex + events.length < total,
    };
  }

  private async findByIdempotencyKey(
    restaurantId: string,
    idempotencyKey: string,
  ): Promise<EventResponseDto | null> {
    const { data, error } = await this.databaseService.supabase
      .from("events")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return null;
    }

    return this.mapEventRow(data as EventRow);
  }

  private mapEventRow(row: EventRow): EventResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      userId: row.user_id || undefined,
      eventType: row.event_type as any,
      sourcePage: row.source_page as any,
      payload: row.payload,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key || undefined,
      traceId: row.trace_id || undefined,
      correlationId: row.correlation_id || undefined,
      createdAt: row.created_at,
    };
  }
}
