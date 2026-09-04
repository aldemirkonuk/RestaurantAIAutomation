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
import { OrganizationsService } from "../organizations/organizations.service";
import { McpConnectionsService } from "./mcp-connections.service";
import {
  CallMcpToolDto,
  CreateMcpConnectionDto,
  GrantMcpToolDto,
  McpConnectionResponse,
  McpRuntimeStateResponse,
  McpToolCallResponse,
  SetHouseConsentDto,
  SetMcpConsentDto,
  SetMcpSecretDto,
} from "./dto/mcp-connection.dto";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * `/mcp-connections` — the model-context register on `/connections`.
 *
 * Every route is JWT-guarded and the restaurant comes from the token, never
 * from a parameter, so there is no id a caller can substitute to read, probe or
 * revoke another house's servers.
 *
 * WHO MAY DO WHAT (ADR 0114)
 * --------------------------
 *   read the register  — any member of the house. The attachment is the
 *                        house's, and a member is entitled to know what acts
 *                        in the room they work in.
 *   declare / revoke /
 *   set a secret /
 *   grant a tool       — MANAGER OR OWNER. `assertCanManageRestaurant`, the
 *                        same rule the restaurant record and the payment
 *                        register use.
 *   consent / withdraw — the CALLER, for the caller, and nobody else. There is
 *                        no user id parameter on that path in any shape.
 *   call a tool        — anyone who has consented, for a tool granted as a
 *                        read; a manager holding the seal, for a tool granted
 *                        as a write.
 *
 * WHAT IS NOT HERE
 * ----------------
 * No route mints, reads back or echoes a secret. No route calls a tool that has
 * not been granted by name — that refusal is in the service, in one method,
 * with a spec per refusal path.
 */
@ApiTags("mcp-connections")
@Controller("mcp-connections")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class McpConnectionsController {
  constructor(
    private readonly service: McpConnectionsService,
    private readonly organizations: OrganizationsService,
  ) {}

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

  private async manager(
    req: Request & { user: AuthenticatedUser },
    action: string,
  ): Promise<{ userId: string; restaurantId: string }> {
    const scope = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      scope.userId,
      scope.restaurantId,
      action,
    );
    return scope;
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
  @ApiOperation({ summary: "The model-context servers this house has declared" })
  @ApiResponse({
    status: 200,
    description:
      "Servers, newest first, revoked included. `consent` is the CALLER's own; `consent.liveCount` is how many people have given theirs.",
  })
  async list(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<McpConnectionResponse[]> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.list(restaurantId, userId);
  }

  @Post()
  @ApiOperation({ summary: "Declare a model-context server for this house" })
  @ApiResponse({ status: 201, description: "The stored server" })
  @ApiResponse({
    status: 403,
    description: "Only managers and owners declare what may act for the house.",
  })
  async create(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: CreateMcpConnectionDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      "declare a model-context server for this house",
    );
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
    const { userId, restaurantId } = await this.manager(
      req,
      "call a model-context server",
    );
    return this.service.probe(restaurantId, userId, id);
  }

  @Put(":id/secret")
  @ApiOperation({ summary: "Set or clear this server's bearer credential" })
  @ApiResponse({ status: 200, description: "The row; the secret is never returned" })
  async setSecret(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetMcpSecretDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      "change a model-context server's credential",
    );
    return this.service.setSecret(restaurantId, userId, id, dto.secret);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke a model-context server (soft)" })
  @ApiResponse({ status: 200, description: "The revoked server" })
  async revoke(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      "revoke a model-context server",
    );
    return this.service.revoke(restaurantId, userId, id);
  }

  /**
   * The caller's own consent. No user id is accepted here in any shape, so
   * "record someone else's consent" is not a request this API can express.
   */
  @Put(":id/consent")
  @ApiOperation({
    summary: "Agree, or stop agreeing, that this server may act in your name",
  })
  @ApiResponse({
    status: 200,
    description:
      "The row. Withdrawing removes only your authority — the house's attachment and everyone else's consent are untouched.",
  })
  async setConsent(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetMcpConsentDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.setConsent(restaurantId, userId, id, dto.given);
  }

  /**
   * The HOUSE's side of somebody else's consent.
   *
   * A manager may SEE what a member has connected and may stop the house using
   * it; they may not approve it, hold it pending, or remove the member's own
   * credential. The route can express exactly that and nothing more.
   */
  @Put(":id/house-consent")
  @ApiOperation({
    summary: "Stop, or resume, this house's use of one person's consent",
  })
  @ApiResponse({
    status: 200,
    description:
      "The row. The person's own consent and their own credential are untouched — only the house's use of it changes.",
  })
  @ApiResponse({
    status: 404,
    description:
      "That person never consented, so there is nothing for the house to withdraw. Not reported as a success.",
  })
  async setHouseConsent(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetHouseConsentDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      "change this house's use of a member's consent",
    );
    return this.service.setHouseConsent(
      restaurantId,
      userId,
      id,
      dto.userId,
      dto.houseUses,
    );
  }

  @Put(":id/tools/:tool")
  @ApiOperation({ summary: "Grant one tool, by name" })
  @ApiResponse({
    status: 200,
    description:
      "The row with the grant on it. `writes` is required: whether a tool commits the house is the granting manager's judgement, and no layer defaults it.",
  })
  async grantTool(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("tool") tool: string,
    @Body() dto: GrantMcpToolDto,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      `grant the tool "${tool}"`,
    );
    return this.service.grantTool(restaurantId, userId, id, tool, dto.writes);
  }

  @Delete(":id/tools/:tool")
  @ApiOperation({ summary: "Revoke one tool grant" })
  @ApiResponse({ status: 200, description: "The row without that grant" })
  async revokeTool(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("tool") tool: string,
  ): Promise<McpConnectionResponse> {
    const { userId, restaurantId } = await this.manager(
      req,
      `revoke the tool "${tool}"`,
    );
    return this.service.revokeTool(restaurantId, userId, id, tool);
  }

  /**
   * Call one granted tool.
   *
   * 200 with a body describing what happened, including a failure — the same
   * rule the probe follows. The refusals that DO throw are the gate's:
   * no consent, no grant, not a manager for a write, or a write without the
   * seal. Those are 403s, because they are decisions about authority rather
   * than reports about a server.
   */
  @Post(":id/tools/:tool/call")
  @HttpCode(200)
  @ApiOperation({ summary: "Call one granted tool on a declared server" })
  @ApiResponse({
    status: 200,
    description:
      "What the call did. `status` is the transport and the protocol; `isError` is the tool's own verdict on its own work.",
  })
  @ApiResponse({
    status: 403,
    description:
      "No consent, no grant for that tool, not a manager for a tool granted as a write, or a write that did not arrive sealed.",
  })
  async callTool(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("tool") tool: string,
    @Body() dto: CallMcpToolDto,
  ): Promise<McpToolCallResponse> {
    const { userId, restaurantId } = this.scope(req);
    return this.service.callTool(
      restaurantId,
      userId,
      id,
      tool,
      dto.args ?? {},
      dto.sealed === true,
    );
  }
}
