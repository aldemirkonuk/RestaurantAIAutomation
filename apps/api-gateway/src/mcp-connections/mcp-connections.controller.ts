import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { McpConnectionsService } from "./mcp-connections.service";
import {
  CreateMcpConnectionDto,
  McpConnectionResponse,
  McpRuntimeStateResponse,
  SetMcpSecretDto,
} from "./dto/mcp-connection.dto";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * `/mcp-connections` — the Model context register on `/profile`.
 *
 * Every route is JWT-guarded and BOTH scopes come from the token: the user id
 * and the restaurant id. Neither is a parameter, so there is no id a caller can
 * substitute to read, probe or revoke another house's servers.
 *
 * WHAT IS NOT HERE
 * ----------------
 * There is no `POST /:id/tools/:name`, and no route of any other shape that
 * calls a tool. `tools/list` is a read; `tools/call` can send an email or place
 * an order, which is the commitment guardrail's subject (ADR 0013). The absence
 * is the decision, not a backlog item — `GET /mcp-connections/runtime` reports
 * it as `invocation.enabled: false` with that reason, so the page states it
 * from the server rather than from page prose.
 */
@ApiTags("mcp-connections")
@Controller("mcp-connections")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class McpConnectionsController {
  constructor(private readonly service: McpConnectionsService) {}

  private scope(req: Request & { user: AuthenticatedUser }): {
    userId: string;
    restaurantId: string;
  } {
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException("Missing user identity");
    if (!user.restaurantId) {
      // Not an empty list. A token with no tenant cannot address a register, and
      // saying so is the difference between "you have no servers" and "we could
      // not tell whose servers to look for".
      throw new BadRequestException(
        "This session has no active restaurant, so a model-context register cannot be addressed.",
      );
    }
    return { userId: user.userId, restaurantId: user.restaurantId };
  }

  /**
   * Declared BEFORE the `:id` routes and on a literal path, so a connection can
   * never be addressed as `runtime` and shadow it.
   */
  @Get("runtime")
  @ApiOperation({
    summary: "What this deployment can do with a model-context server",
  })
  @ApiResponse({ status: 200, description: "Secret storage and invocation state" })
  runtime(
    @Req() req: Request & { user: AuthenticatedUser },
  ): McpRuntimeStateResponse {
    // Scoped anyway: this says what the DEPLOYMENT can do, but it is not a
    // question an unauthenticated caller gets to ask about our configuration.
    this.scope(req);
    return this.service.runtimeState();
  }

  @Get()
  @ApiOperation({ summary: "List model-context servers for this user + restaurant" })
  @ApiResponse({ status: 200, description: "Servers, newest first, revoked included" })
  async list(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<McpConnectionResponse[]> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.list(userId, restaurantId);
  }

  @Post()
  @ApiOperation({ summary: "Declare a model-context server" })
  @ApiResponse({ status: 201, description: "The stored server" })
  async create(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: CreateMcpConnectionDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.create(userId, restaurantId, dto);
  }

  /**
   * Call the server and record what answered.
   *
   * 200, not 201: nothing is created, and the response is the row as it now
   * stands. A handshake that FAILED is still a 200 — the probe succeeded in
   * finding out that the server is unreachable, and turning that into a 5xx
   * would make a broken third-party server indistinguishable from a broken
   * gateway.
   */
  @Post(":id/probe")
  @HttpCode(200)
  @ApiOperation({ summary: "Shake hands with a declared server and list its tools" })
  @ApiResponse({ status: 200, description: "The row, with the probe recorded" })
  async probe(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.probe(userId, restaurantId, id);
  }

  @Put(":id/secret")
  @ApiOperation({ summary: "Set or clear this server's bearer credential" })
  @ApiResponse({ status: 200, description: "The row; the secret is never returned" })
  async setSecret(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetMcpSecretDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.setSecret(userId, restaurantId, id, dto.secret);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke a model-context server (soft)" })
  @ApiResponse({ status: 200, description: "The revoked server" })
  async revoke(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.revoke(userId, restaurantId, id);
  }
}
