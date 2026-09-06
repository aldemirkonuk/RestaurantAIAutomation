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
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { MintMcpKeyDto } from "./dto/mcp-key.dto";
import { McpCredentialsService } from "./mcp-credentials.service";
import { READ_SCOPES } from "./tool-catalog";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * `/mcp-server-keys` — "Your assistant's key" on `/connections`.
 *
 * The INBOUND half of the register. `/mcp-connections` records servers this
 * house may call; this records the keys assistants present to us. They sit on
 * one page and must never share a route prefix: a reader who confuses the two
 * has confused "we may call them" with "they may read us", which is the
 * difference between an outbound dependency and an inbound door.
 *
 * WHO MAY DO WHAT
 * ---------------
 *   read the register — any member of the house. A member is entitled to know
 *                       what may read the room they work in.
 *   mint / revoke     — MANAGER OR OWNER, via `assertCanManageRestaurant`, the
 *                       same rule the outbound register, the restaurant record
 *                       and the payment register use.
 *
 * The secret is returned by `mint` and by nothing else. There is no route that
 * reads a key back, and adding one would defeat the hash.
 */
@ApiTags("mcp-server-keys")
@Controller("mcp-server-keys")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class McpKeysController {
  constructor(
    private readonly credentials: McpCredentialsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** The tenant comes from the token. A request with no house is told so. */
  private house(request: Request): { userId: string; restaurantId: string } {
    const user = request.user as AuthenticatedUser | undefined;
    if (!user?.userId) {
      throw new UnauthorizedException("No authenticated user on this request.");
    }
    if (!user.restaurantId) {
      throw new BadRequestException(
        "This token carries no restaurant, so there is no house to mint a key for. Sign in against a restaurant first.",
      );
    }
    return { userId: user.userId, restaurantId: user.restaurantId };
  }

  @Get()
  @ApiOperation({
    summary: "Keys assistants may present to the Mudavym MCP server",
  })
  async list(@Req() request: Request) {
    const { restaurantId } = this.house(request);
    return {
      keys: await this.credentials.list(restaurantId),
      // The vocabulary a minter may choose from, served rather than duplicated
      // in the web app: one list, and the page cannot offer a scope the server
      // does not honour.
      grantableScopes: READ_SCOPES,
      rateLimit: McpCredentialsService.describeLimiter(),
    };
  }

  @Post()
  @ApiOperation({
    summary: "Mint a key. The secret is returned once and never again.",
  })
  async mint(@Req() request: Request, @Body() dto: MintMcpKeyDto) {
    const { userId, restaurantId } = this.house(request);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "mint an MCP server key",
    );
    const minted = await this.credentials.mint({
      restaurantId,
      label: dto.label,
      scopes: dto.scopes ?? [],
      createdBy: userId,
    });
    return {
      ...minted,
      shownOnce: true,
      notice:
        "Copy this now. It is stored only as a hash, so nobody — including Mudavym — can show it again. If it is lost, revoke it and mint another.",
    };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke a key. Takes effect on the next call." })
  async revoke(
    @Req() request: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const { userId, restaurantId } = this.house(request);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "revoke an MCP server key",
    );
    // The service answers `{revoked:false, reason}` rather than throwing when
    // nothing matched, so the page can say WHICH nothing happened instead of
    // rendering a success it did not get.
    return this.credentials.revoke({
      restaurantId,
      credentialId: id,
      revokedBy: userId,
    });
  }
}
