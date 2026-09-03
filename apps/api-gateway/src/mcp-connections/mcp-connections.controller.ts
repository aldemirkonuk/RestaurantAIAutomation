import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
 * substitute to read or revoke another house's servers.
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
