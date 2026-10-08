import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { SetVendorTermsDto } from "./dto/vendor-terms.dto";
import { VendorTermsService, type VendorTermsReadout } from "./vendor-terms.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { assertVendorWriter } from "../providers/vendor-write-gate";

/**
 * The terms register.
 *
 * TENANT SCOPE, taken from the signed token. Neither route accepts a restaurant
 * id from the caller — `@CurrentUser("restaurantId")` reads the JWT claim that
 * `JwtAuthGuard` has already matched against the request
 * (`common/tenant/assert-tenant-match.ts`), so there is no id to tamper with.
 * The write additionally re-checks that the named provider belongs to this house
 * inside the row filter (`VendorTermsService.requireProvider`), because a guard
 * that scopes the RESTAURANT does not by itself scope the PROVIDER.
 *
 * ROLE. Not owner-only, and not open to every member either. This header used
 * to say "record it, do not restrict it" so the person who phones the vendor
 * could write a cutoff down the moment they were told it. VEN-W30 (founder,
 * 2026-10-08, "Staff read only") replaced that: staff read the vendor book and
 * every write to it — terms included — is a manager's or an owner's act, asked
 * through `assertVendorWriter`. The author still goes into `system_audit_log`.
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("vendor-terms")
@UseGuards(JwtAuthGuard, TenantGuard)
export class VendorTermsController {
  constructor(
    private readonly terms: VendorTermsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Every vendor's terms, with where each field came from",
    description:
      "Per vendor: delivery weekdays, order cutoff, minimum order, lead time and payment terms, each carrying its own source — stated by the house (with who and when), read off the vendor record, inferred from this tenant's orders (with the receipt count and a confidence), or unknown with the reason. A value indistinguishable from its column default is reported as UNKNOWN, not as a term.",
  })
  @ApiResponse({ status: 200, description: "The terms readout" })
  async read(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<VendorTermsReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there are no vendor terms to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.terms.read(restaurantId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to read the vendor terms",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(":providerId")
  @ApiOperation({
    summary: "Record what the house was told about one vendor",
    description:
      "An absent field is left as it was; an explicit null WITHDRAWS the statement, so a house can say 'we were wrong, nobody told us that'. The response carries `audited` and `auditReason` so a change whose audit row failed is visible rather than assumed.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  async write(
    @CurrentUser("restaurantId") restaurantId: string,
    @Param("providerId") providerId: string,
    @Body() dto: SetVendorTermsDto,
    @Req() req: { user?: { userId?: string } },
  ) {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const author = req.user?.userId;
    if (!author) {
      throw new HttpException(
        "This session names no person, so nothing was recorded.",
        HttpStatus.FORBIDDEN,
      );
    }
    // VEN-W30: staff read the vendor book; changing it is a manager's or an owner's act.
    await assertVendorWriter(
      this.organizations,
      author,
      restaurantId,
      "Recording a vendor's terms",
    );
    try {
      // The author comes from the JWT and nowhere else. `public.users.user_id`,
      // never `auth.users` — the two are disjoint and no FK would catch it.
      return await this.terms.write(
        restaurantId,
        providerId,
        dto,
        author,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to record the vendor terms",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
