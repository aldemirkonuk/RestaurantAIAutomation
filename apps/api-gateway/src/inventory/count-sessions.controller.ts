import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  OrganizationsService,
  RestaurantRoleUnreadableError,
} from "../organizations/organizations.service";
import { CountSessionsService } from "./count-sessions.service";

type SessionUser = { userId?: string; restaurantId?: string } | undefined;

/**
 * A stock-take walked shelf by shelf (F-1544). The house and the person come
 * from the verified token, never from the path or the body (ADR 0141, ADR
 * 0078's attribution rule), so no route here names a restaurant.
 *
 * Who may do what: an owner or a manager opens and stops a count (ADR 0238 /
 * 0334); anyone in the house counts -- takes a shelf, says it is done, parks
 * an item the house does not carry. An opening count is the owner's or a
 * manager's alone (ADR 0335 §3).
 */
@ApiTags("inventory")
@Controller("count-sessions")
@UseGuards(JwtAuthGuard)
export class CountSessionsController {
  constructor(
    private readonly sessions: CountSessionsService,
    private readonly organizations: OrganizationsService,
  ) {}

  private who(user: SessionUser): { house: string; userId: string } {
    if (!user?.userId || !user?.restaurantId) {
      throw new HttpException(
        "This session names no person or no house, so nothing was counted.",
        HttpStatus.FORBIDDEN,
      );
    }
    return { house: user.restaurantId, userId: user.userId };
  }

  /** Owner or manager here; a failed read is a 503, never a refusal. */
  private isManager(house: string, userId: string) {
    return async () => {
      try {
        const role = await this.organizations.readRestaurantRole(userId, house);
        return role === "owner" || role === "manager";
      } catch (e) {
        if (e instanceof RestaurantRoleUnreadableError) {
          throw new HttpException(
            "Who you are in this house could not be read just now. Try again.",
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        throw e;
      }
    };
  }

  @Get()
  @ApiOperation({ summary: "This house's open counts, newest first" })
  async listOpen(@CurrentUser() user: SessionUser) {
    const { house } = this.who(user);
    return this.sessions.listOpen(house);
  }

  @Post()
  @ApiOperation({
    summary:
      "Open a count over the leaf shelves under the chosen zones (owner or manager)",
  })
  async open(
    @Body() body: { kind?: string; zoneIds?: string[]; openKey?: string },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "open a stock count",
    );
    return this.sessions.open(house, userId, body ?? {});
  }

  @Get(":sessionId")
  @ApiOperation({
    summary:
      "A count's shelves in walk order and the items expected on each, never how many (blind count)",
  })
  async pull(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    return this.sessions.pull(house, sessionId, userId);
  }

  @Post(":sessionId/shelves/:locationId/claim")
  @ApiOperation({ summary: "Take a shelf to count it" })
  async claim(
    @Param("sessionId") sessionId: string,
    @Param("locationId") locationId: string,
    @Body() body: { takeOver?: boolean },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    return this.sessions.claim(house, sessionId, locationId, userId, {
      takeOver: body?.takeOver === true,
      isManager: this.isManager(house, userId),
    });
  }

  @Post(":sessionId/shelves/:locationId/done")
  @ApiOperation({
    summary:
      "Say a shelf is done: each expected item not found posts a count of 0 through the one count writer",
  })
  async shelfDone(
    @Param("sessionId") sessionId: string,
    @Param("locationId") locationId: string,
    @Body()
    body: {
      clientDoneId?: string;
      zeroItemIds?: string[];
      countedAgoMs?: number;
    },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    return this.sessions.shelfDone(
      house,
      sessionId,
      locationId,
      userId,
      body ?? {},
      this.isManager(house, userId),
    );
  }

  @Post(":sessionId/parked")
  @ApiOperation({
    summary:
      "Park an item the house does not carry, for review (nothing is created)",
  })
  async park(
    @Param("sessionId") sessionId: string,
    @Body()
    body: {
      clientLineId?: string;
      locationId?: string;
      description?: string;
      countedQty?: number;
      countedAgoMs?: number;
    },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    return this.sessions.park(house, sessionId, userId, body ?? {});
  }

  @Post(":sessionId/abandon")
  @ApiOperation({
    summary: "Stop a count (owner or manager); the counts it already made stay",
  })
  async abandon(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "stop a stock count",
    );
    return this.sessions.abandon(house, sessionId, userId);
  }

  // F-1544 lane 4: the review. Anyone in the house may read it; what the
  // books expected, the difference and its value are the owner's and the
  // manager's (DASH-G6). Every act on it is theirs alone.
  private async manages(house: string, userId: string, act: string) {
    await this.organizations.assertCanManageRestaurant(userId, house, act);
  }

  @Get(":sessionId/review")
  @ApiOperation({
    summary:
      "A count's review: each shelf's lines, shelves not counted, held and parked lines, bottles probably moved, lines after sign-off. The books and money for owner or manager only.",
  })
  async review(
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    const seesMoney = await this.isManager(house, userId)();
    return this.sessions.review(house, sessionId, seesMoney);
  }

  @Post(":sessionId/held/:heldLineId/use")
  @ApiOperation({
    summary:
      "Use a held line (owner or manager): it posts through the one count writer as its counter, and the shelf's other held lines are set aside",
  })
  async useHeld(
    @Param("sessionId") sessionId: string,
    @Param("heldLineId") heldLineId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "settle a stock count");
    return this.sessions.useHeldLine(house, sessionId, heldLineId, userId);
  }

  @Post(":sessionId/held/:heldLineId/drop")
  @ApiOperation({ summary: "Set a held line aside (owner or manager)" })
  async dropHeld(
    @Param("sessionId") sessionId: string,
    @Param("heldLineId") heldLineId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "settle a stock count");
    return this.sessions.dropHeldLine(house, sessionId, heldLineId, userId);
  }

  @Post(":sessionId/parked/:parkedId/carry")
  @ApiOperation({
    summary:
      "Count a parked line as one of the house's items (owner or manager), through the one count writer",
  })
  async carryParked(
    @Param("sessionId") sessionId: string,
    @Param("parkedId") parkedId: string,
    @Body() body: { inventoryId?: string },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "settle a stock count");
    return this.sessions.carryParked(
      house,
      sessionId,
      parkedId,
      userId,
      body ?? {},
    );
  }

  @Post(":sessionId/parked/:parkedId/drop")
  @ApiOperation({ summary: "Set a parked line aside (owner or manager)" })
  async dropParked(
    @Param("sessionId") sessionId: string,
    @Param("parkedId") parkedId: string,
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "settle a stock count");
    return this.sessions.dropParked(house, sessionId, parkedId, userId);
  }

  @Post(":sessionId/shelves/:locationId/recount")
  @ApiOperation({
    summary: "Send a shelf back to be counted again (owner or manager)",
  })
  async recount(
    @Param("sessionId") sessionId: string,
    @Param("locationId") locationId: string,
    @Body() body: { seenRound?: number },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "send a shelf back to be counted");
    return this.sessions.askRecount(
      house,
      sessionId,
      locationId,
      userId,
      body ?? {},
    );
  }

  @Post(":sessionId/sign-off")
  @ApiOperation({
    summary:
      "Sign a count off as complete (owner or manager); stamps last counted for items counted on every shelf they sit on",
  })
  async signOff(
    @Param("sessionId") sessionId: string,
    @Body() body: { evenIfUnfinished?: boolean },
    @CurrentUser() user: SessionUser,
  ) {
    const { house, userId } = this.who(user);
    await this.manages(house, userId, "sign off a stock count");
    return this.sessions.signOff(house, sessionId, userId, body ?? {});
  }
}
