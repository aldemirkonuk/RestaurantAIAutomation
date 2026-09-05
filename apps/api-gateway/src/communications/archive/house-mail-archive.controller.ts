/**
 * `/communications/archive` — the house's own copy of its mail (ADR 0118 D16).
 *
 * FOUR ROUTES: one read, one seal mint, and two sealed writes.
 *
 * WHY BOTH WRITES ARE SEALED (ADR 0107, and the founder's extension of it on
 * 2026-09-04 from MCP tool calls to order approval and to payments).
 *
 *   CHOOSING  turns Mudavym's deletion of a person's mirrored mail into a
 *             deletion that happens ONLY after a copy has left for a third
 *             party's storage, or into a deletion with no copy at all. Both
 *             directions are consequential and neither is reversible by the
 *             next request.
 *   EXPORTING copies every vendor reply this house holds — bodies, headers and
 *             attachment bytes out of a private bucket — into a Google Drive.
 *             Nothing here can un-copy it. A role check answers "may this
 *             ROLE"; only a seal answers "did this PERSON, over these
 *             arguments, a moment ago".
 *
 * The seal's subject is the RESTAURANT (`subjectKind: "house_mail_export"`),
 * because the act is on the house's whole book rather than on one row, and its
 * `args` carry the mode and the connection so a seal minted to choose "export to
 * Drive A" cannot be spent to choose "export to Drive B".
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { HouseMailArchiveService } from "./house-mail-archive.service";
import {
  ARCHIVE_ARM_ACTION,
  ARCHIVE_EXPORT_ACTION,
  HOUSE_MAIL_ARCHIVE_MODES,
  type HouseMailArchiveMode,
} from "./house-mail-archive.constants";

interface Actor {
  id: string;
  restaurantId: string;
}

interface ChallengeBody {
  act: "choose" | "export";
  mode?: string;
  connectionId?: string | null;
}

interface ChooseBody {
  mode: string;
  connectionId?: string | null;
}

@ApiTags("Communications")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("communications/archive")
export class HouseMailArchiveController {
  constructor(
    private readonly archive: HouseMailArchiveService,
    private readonly seals: SealChallengeService,
  ) {}

  /**
   * The arguments a seal is minted over, in ONE place.
   *
   * A second copy of these would be a second seal that looks identical and is
   * not — `billing.controller.ts` states the same rule about the card-on-file
   * arguments and imports rather than restates them.
   */
  private chooseArgs(
    mode: HouseMailArchiveMode,
    connectionId: string | null,
  ): Record<string, unknown> {
    return { act: "choose", mode, connectionId };
  }

  private exportArgs(): Record<string, unknown> {
    return { act: "export" };
  }

  private modeOf(raw: unknown): HouseMailArchiveMode {
    const value = String(raw ?? "");
    if (
      !(HOUSE_MAIL_ARCHIVE_MODES as readonly string[]).includes(value)
    ) {
      throw new BadRequestException(
        `"${value}" is not one of the three answers this restaurant can give. They are: ${HOUSE_MAIL_ARCHIVE_MODES.join(", ")}.`,
      );
    }
    return value as HouseMailArchiveMode;
  }

  @Get()
  @ApiOperation({
    summary:
      "Which archive this restaurant chose, whether it is armed, and — when it is not — the sentence saying why not",
  })
  @ApiResponse({
    status: 200,
    description:
      "`chosen: false` means NO row exists: nobody has been asked, which is a different fact from a recorded `none`. `armed` is whether the mode is actually operating; an unarmed mode changes nothing and `refusedBecause` says why. A `mudavym_archive` row is unarmed on every deployment until OD-23 fixes a price.",
  })
  async settings(@CurrentUser() user: Actor) {
    return {
      success: true,
      archive: await this.archive.settingsFor(user.restaurantId),
    };
  }

  @Post("seal-challenge")
  @HttpCode(200)
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Begin the hold on choosing an archive or running an export; returns a one-time seal the write has to carry back",
  })
  @ApiResponse({
    status: 200,
    description:
      "`challenge` is spendable exactly once, by this person, for this act, over these arguments. A seal minted to choose one destination cannot be spent to choose another.",
  })
  async challenge(@CurrentUser() user: Actor, @Body() body: ChallengeBody) {
    if (body?.act === "export") {
      return this.seals.issue({
        restaurantId: user.restaurantId,
        actorUserId: user.id,
        subjectKind: "house_mail_export",
        subjectId: user.restaurantId,
        action: ARCHIVE_EXPORT_ACTION,
        args: this.exportArgs(),
      });
    }
    const mode = this.modeOf(body?.mode);
    return this.seals.issue({
      restaurantId: user.restaurantId,
      actorUserId: user.id,
      subjectKind: "house_mail_export",
      subjectId: user.restaurantId,
      action: ARCHIVE_ARM_ACTION,
      args: this.chooseArgs(mode, body?.connectionId ?? null),
    });
  }

  @Post()
  @HttpCode(200)
  @Roles("owner", "manager")
  @ApiHeader({
    name: "X-Seal-Challenge",
    required: true,
    description:
      "The one-time seal minted by POST /communications/archive/seal-challenge with `act: \"choose\"`, over the same mode and connection.",
  })
  @ApiOperation({
    summary:
      "Record this restaurant's archive answer, and arm it when arming is possible",
  })
  @ApiResponse({
    status: 200,
    description:
      "`own_cloud` is armed only after the folder is actually resolved in the restaurant's Drive; if that fails the choice is recorded UNARMED with the reason and the window still applies. `mudavym_archive` is recorded and NEVER armed while OD-23 is open, and the answer says so in words — it is not a silent free tier and it is not a silent no-op.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not a manager or owner, or carried no redeemed seal.",
  })
  async choose(
    @CurrentUser() user: Actor,
    @Body() body: ChooseBody,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const mode = this.modeOf(body?.mode);
    const connectionId = body?.connectionId ?? null;
    const { sealId } = await this.seals.redeem({
      restaurantId: user.restaurantId,
      actorUserId: user.id,
      subjectKind: "house_mail_export",
      subjectId: user.restaurantId,
      action: ARCHIVE_ARM_ACTION,
      args: this.chooseArgs(mode, connectionId),
      challenge: challenge ?? null,
    });

    const archive = await this.archive.choose({
      restaurantId: user.restaurantId,
      actorUserId: user.id,
      mode,
      connectionId,
      sealId,
    });
    return { success: true, archive };
  }

  @Post("export")
  @HttpCode(200)
  @Roles("owner", "manager")
  @ApiHeader({
    name: "X-Seal-Challenge",
    required: true,
    description:
      "The one-time seal minted by POST /communications/archive/seal-challenge with `act: \"export\"`.",
  })
  @ApiOperation({
    summary:
      "Write every mirrored reply this restaurant still holds into its own archive, now",
  })
  @ApiResponse({
    status: 200,
    description:
      "Returns `considered`, `exported`, `failed` and one outcome per conversation. A conversation that could not be written is a FAILURE with a stated reason, never absence — and the retention sweep will hold it rather than delete it. A run that exported nothing still records its count.",
  })
  async runExport(
    @CurrentUser() user: Actor,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const { sealId } = await this.seals.redeem({
      restaurantId: user.restaurantId,
      actorUserId: user.id,
      subjectKind: "house_mail_export",
      subjectId: user.restaurantId,
      action: ARCHIVE_EXPORT_ACTION,
      args: this.exportArgs(),
      challenge: challenge ?? null,
    });

    return {
      success: true,
      run: await this.archive.runExport({
        restaurantId: user.restaurantId,
        trigger: "requested",
        sealId,
      }),
    };
  }
}
