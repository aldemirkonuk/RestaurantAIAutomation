import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CreateMcpConnectionDto,
  McpConnectionResponse,
} from "./dto/mcp-connection.dto";

/**
 * Model-context (MCP) servers, per user per restaurant.
 *
 * THE READ THROWS. It does not return `[]`.
 * ----------------------------------------
 * `/profile`'s Connections register had to INFER a failed read from an empty
 * array, because `integrations-oauth.service.ts:485-488` logs its query error
 * and returns `[]` — so on the wire, "the query failed" and "nothing is
 * connected" are the same response. That inference is correct today and fragile
 * forever, and it is filed as G3. This module does not repeat it: a query error
 * becomes a 500 with the message the database gave, and the page renders words
 * about a failed read instead of an empty list that reads as "no servers".
 *
 * TENANCY COMES FROM THE JWT, NOT THE BODY.
 * Every method takes `restaurantId` from the controller, which takes it from
 * `req.user.restaurantId` — the signed claim, re-resolved on every request by
 * `JwtStrategy.validate`. Nothing in the request body can widen the scope.
 */
@Injectable()
export class McpConnectionsService {
  private readonly logger = new Logger(McpConnectionsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private static row(r: Record<string, unknown>): McpConnectionResponse {
    return {
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
      createdAt: String(r.created_at),
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
      status: r.revoked_at ? "revoked" : "active",
    };
  }

  /**
   * Every server this user has declared for this restaurant, newest first,
   * including revoked ones — a revoked grant that vanishes is indistinguishable
   * from one that never existed.
   */
  async list(
    userId: string,
    restaurantId: string,
  ): Promise<McpConnectionResponse[]> {
    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .select(
        "id, name, url, scopes, created_at, last_used_at, revoked_at",
      )
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(
        `Failed to list MCP connections: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `The model-context register could not be read: ${error.message}`,
      );
    }

    return (data ?? []).map((r) =>
      McpConnectionsService.row(r as Record<string, unknown>),
    );
  }

  async create(
    userId: string,
    restaurantId: string,
    dto: CreateMcpConnectionDto,
  ): Promise<McpConnectionResponse> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("A server needs a name");

    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .insert({
        user_id: userId,
        restaurant_id: restaurantId,
        name,
        url: dto.url.trim(),
        scopes: dto.scopes ?? [],
      })
      .select(
        "id, name, url, scopes, created_at, last_used_at, revoked_at",
      )
      .single();

    if (error) {
      // 23505 is the partial unique index on (user, restaurant, lower(name)).
      // Reported as a conflict with the real reason rather than a 500, because
      // "you already have a live server called that" is something the operator
      // can act on.
      if (error.code === "23505") {
        throw new ConflictException(
          `A live model-context server called "${name}" already exists here. Revoke it first, or choose another name.`,
        );
      }
      this.logger.error(`Failed to add MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not added: ${error.message}`,
      );
    }

    return McpConnectionsService.row(data as Record<string, unknown>);
  }

  /**
   * Soft revoke, scoped by user AND restaurant so an id from another tenant
   * cannot be revoked by guessing it. A second revoke is a 404, not a silent
   * success — "already gone" and "never yours" must not report the same way as
   * "revoked just now".
   */
  async revoke(
    userId: string,
    restaurantId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(
        "id, name, url, scopes, created_at, last_used_at, revoked_at",
      )
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to revoke MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not revoked: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No live model-context server with that id belongs to you here.",
      );
    }

    return McpConnectionsService.row(data as Record<string, unknown>);
  }
}
