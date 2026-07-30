import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../auth/decorators/public.decorator";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import {
  INTEGRATION_DEFINITIONS,
  isIntegrationId,
} from "./integrations-oauth.constants";

type AuthedRequest = Request & {
  user: { userId: string; restaurantId?: string | null };
};

@Controller("integrations/oauth")
export class IntegrationsOauthController {
  private readonly logger = new Logger(IntegrationsOauthController.name);

  constructor(private readonly service: IntegrationsOauthService) {}

  /**
   * Scope disclosure for the authorization page.
   *
   * The consent screen reads its copy from here rather than hardcoding it, so
   * what the user is shown cannot drift from what we actually request.
   */
  @Get("catalog")
  @UseGuards(JwtAuthGuard)
  async catalog() {
    const availability = this.service.availability();

    return {
      success: true,
      integrations: Object.values(INTEGRATION_DEFINITIONS).map((definition) => ({
        id: definition.id,
        provider: definition.provider,
        label: definition.label,
        providerLabel: definition.providerLabel,
        description: definition.description,
        scopes: definition.scopes,
        notRequested: definition.notRequested,
        available: availability[definition.id].available,
        unavailableReason: availability[definition.id].reason ?? null,
      })),
    };
  }

  @Get("connections")
  @UseGuards(JwtAuthGuard)
  async connections(@Req() req: AuthedRequest) {
    return {
      success: true,
      connections: await this.service.listConnections(req.user.userId),
    };
  }

  /**
   * Starts the handshake. Returns the URL as JSON instead of issuing a 302 so
   * the SPA can decide between a redirect and a popup, and so an expired
   * session surfaces as a normal 401 rather than a bounce to the provider.
   */
  @Post(":integrationId/authorize")
  @UseGuards(JwtAuthGuard)
  async authorize(
    @Req() req: AuthedRequest,
    @Param("integrationId") integrationId: string,
    @Query("returnPath") returnPath?: string,
  ) {
    if (!isIntegrationId(integrationId)) {
      throw new BadRequestException("Unknown integration");
    }

    const { authorizationUrl } = await this.service.createAuthorizationUrl({
      userId: req.user.userId,
      restaurantId: req.user.restaurantId ?? null,
      integrationId,
      returnPath,
    });

    this.logger.log(
      `Authorization started for ${integrationId} by user ${req.user.userId}`,
    );

    return { success: true, authorizationUrl };
  }

  /**
   * Provider redirect target. Public by necessity — the browser arrives here
   * from Google/Microsoft without our Authorization header. Trust comes from
   * the single-use `state` row, not from the session.
   */
  @Get(":provider/callback")
  @Public()
  async callback(
    @Param("provider") provider: string,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    const destination = await this.service.handleCallback({
      provider,
      code,
      state,
      error,
    });
    return res.redirect(destination);
  }

  @Delete(":integrationId")
  @UseGuards(JwtAuthGuard)
  async disconnect(
    @Req() req: AuthedRequest,
    @Param("integrationId") integrationId: string,
  ) {
    if (!isIntegrationId(integrationId)) {
      throw new BadRequestException("Unknown integration");
    }
    await this.service.disconnect(req.user.userId, integrationId);
    return { success: true, message: "Integration disconnected" };
  }
}
