import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../auth/decorators/public.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import {
  INTEGRATION_DEFINITIONS,
  MIRRORING_INTEGRATION_IDS,
  isIntegrationId,
} from "./integrations-oauth.constants";

type AuthedRequest = Request & {
  user: { userId: string; restaurantId?: string | null };
};

@Controller("integrations/oauth")
export class IntegrationsOauthController {
  private readonly logger = new Logger(IntegrationsOauthController.name);

  constructor(
    private readonly service: IntegrationsOauthService,
    private readonly organizations: OrganizationsService,
  ) {}

  private house(req: AuthedRequest): { userId: string; restaurantId: string } {
    const restaurantId = req.user.restaurantId ?? null;
    if (!restaurantId) {
      throw new BadRequestException(
        "This session has no active restaurant, so the house's grants cannot be addressed.",
      );
    }
    return { userId: req.user.userId, restaurantId };
  }

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
      integrations: Object.values(INTEGRATION_DEFINITIONS).map(
        (definition) => ({
          id: definition.id,
          provider: definition.provider,
          label: definition.label,
          providerLabel: definition.providerLabel,
          description: definition.description,
          scopes: definition.scopes,
          notRequested: definition.notRequested,
          // What is fetched, what is deliberately not, where it lands and who
          // can read it. Served rather than written into the page for the same
          // reason the scope list is: a consent screen that composes its own
          // copy can drift from what the server actually does, and a privacy
          // sentence that has drifted is worse than none.
          dataHandling: definition.dataHandling,
          // Whether consenting to this grant puts a copy of a person's mail
          // into the house's book, and therefore whether the retention
          // disclosure applies to it (ADR 0118, retention). Served rather than
          // inferred on the page from the id, which would get `gmail_send`
          // wrong: it is a Gmail grant that reads nothing and mirrors nothing.
          mirrorsMail: MIRRORING_INTEGRATION_IDS.includes(definition.id),
          available: availability[definition.id].available,
          unavailableReason: availability[definition.id].reason ?? null,
        }),
      ),
    };
  }

  /**
   * This person's grants, in THIS restaurant.
   *
   * The tenant comes from the signed token and is passed through (G21): before
   * 2026-09-03 the service filtered on the user alone, so a grant made in one
   * restaurant was listed while standing in another. A session with no tenant
   * still gets the person's whole list — that is a question about a person.
   */
  @Get("connections")
  @UseGuards(JwtAuthGuard)
  async connections(@Req() req: AuthedRequest) {
    return {
      success: true,
      connections: await this.service.listConnections(
        req.user.userId,
        req.user.restaurantId ?? null,
      ),
    };
  }

  /**
   * Every personal grant recorded against this restaurant — `/connections`
   * Register III.
   *
   * MANAGER OR OWNER. "A manager may SEE, not approve, what a member has
   * personally connected" (founder, 2026-09-03); this is the seeing. Nothing on
   * this route can end a member's grant, and no pending state exists to
   * approve.
   */
  @Get("house-grants")
  @UseGuards(JwtAuthGuard)
  async houseGrants(@Req() req: AuthedRequest) {
    const { userId, restaurantId } = this.house(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "see what members have connected to this house",
    );
    return {
      success: true,
      ...(await this.service.listHouseGrants(restaurantId)),
    };
  }

  /**
   * Stop, or resume, this house's use of one member's grant.
   *
   * The member keeps the grant. The house stops asking for a token — enforced
   * at `getAccessToken`, the single door feature code uses, not by hiding a
   * button.
   */
  @Put("house-grants/:connectionId/access")
  @UseGuards(JwtAuthGuard)
  async setHouseGrantAccess(
    @Req() req: AuthedRequest,
    @Param("connectionId") connectionId: string,
    @Body() body: { houseUses?: boolean; reason?: string },
  ) {
    const { userId, restaurantId } = this.house(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "change what this house uses of a member's grant",
    );
    if (typeof body?.houseUses !== "boolean") {
      throw new BadRequestException(
        "Say whether the house uses this grant: houseUses must be true or false.",
      );
    }
    return {
      success: true,
      ...(await this.service.setHouseGrantAccess({
        restaurantId,
        connectionId,
        managerUserId: userId,
        houseUses: body.houseUses,
        reason: body.reason ?? null,
      })),
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
