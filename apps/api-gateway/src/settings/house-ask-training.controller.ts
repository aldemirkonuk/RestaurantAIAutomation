import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { SetHouseAskTrainingDto } from "./dto/house-ask-training.dto";
import { HouseAskTrainingService, type HouseAskTrainingReadout } from "./house-ask-training.service";

/**
 * Whether this house's /ask questions may be used for training (ADR 0145,
 * founder 2026-09-21, his pick verbatim: "Same as the wine pool
 * (Recommended)" -- a notice, an owner opt-out per house, names removed before
 * any export, a lawyer before the first real training run).
 *
 * Its own controller under `/settings`, beside `SettingsController`, so the
 * consent route carries no dependency the other settings registers do not
 * need. The house is the token's, never a parameter. The read is any member of
 * the house; the write is the house's OWNER only, decided by the service
 * against the caller's role in this house (a manager is refused like anyone).
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class HouseAskTrainingController {
  constructor(private readonly houseAskTraining: HouseAskTrainingService) {}

  @Get("ask-training")
  @ApiOperation({
    summary: "Whether this house's /ask questions are kept out of training",
    description:
      "`optedOut: false` with `statedAt: null` means nobody has answered and the default is in force: not opted out. `readable: false` means the setting could not be READ, which is a different state and never the default.",
  })
  @ApiResponse({ status: 200, description: "The training choice readout" })
  async read(@CurrentUser("restaurantId") restaurantId: string): Promise<HouseAskTrainingReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no training choice to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseAskTraining.read(restaurantId);
  }

  @Put("ask-training")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Keep this house's /ask questions out of training, or allow them -- owner only",
    description:
      "Only the house's owner may change it; a manager is refused with 403 like anyone else. The response carries `audited` and `auditReason`, so a change whose audit row failed is visible rather than assumed.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({ status: 403, description: "The caller is not this house's owner." })
  async write(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseAskTrainingDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseAskTrainingReadout> {
    if (!restaurantId) {
      throw new HttpException("This session is not attached to a restaurant, so nothing was recorded.", HttpStatus.BAD_REQUEST);
    }
    // The author comes from the signed token (`public.users.user_id`).
    return this.houseAskTraining.write(restaurantId, dto?.optedOut, userId);
  }
}
