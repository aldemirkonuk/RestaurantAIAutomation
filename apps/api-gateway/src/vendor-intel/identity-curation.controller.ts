import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { IdentityService } from "./identity.service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Curation of provisional bottle identities — Mudavym's, not a house's.
 *
 * ADR 0124 Q3, the founder's call of 2026-09-05: *"Provisional on the item,
 * curated into the library."* A house may name a bottle the library does not
 * have; that identity is provisional, named to the person and the house, and it
 * waits here until Mudavym promotes it into the shared library and the item is
 * re-pointed.
 *
 * WHY THIS IS ITS OWN CONTROLLER AND NOT THREE MORE ROUTES ON VendorIntelController.
 * That class carries `@UseGuards(JwtAuthGuard, RolesGuard)` and
 * `@Roles("owner", "manager")`. Nest runs class guards before method guards and
 * requires ALL of them to pass, so `@Public()` would silence the JWT check and
 * then `RolesGuard` would refuse anyway — it reads `request.user`, and a service
 * key carries no user. Splitting is not cosmetic: it is the only way these
 * routes can be gated by the key rather than by a role, and `ServiceKeyGuard`'s
 * own header says to apply it per route and never at class level.
 *
 * THERE IS NO PLATFORM-ADMIN ROLE, AND THIS DOES NOT INVENT ONE. `RolesGuard`
 * knows owner, manager and staff — all three are roles WITHIN a house, and a
 * fourth invented to hold a curation queue would be a permission system created
 * as a side effect. The `X-Admin-Key` / `ADMIN_API_KEY` service credential ADR
 * 0099 settled already means "not a tenant", and it FAILS CLOSED on an unset or
 * empty key. This is the same shape `POST /communications/email` and the
 * experiment both-arms report use.
 *
 * NO TENANCY IS DERIVED HERE. A service key carries no house, so nothing in
 * this file reads `request.user` — every route names its subject by id.
 */
@ApiTags("Vendor Intelligence")
@Controller("identity-curation")
export class IdentityCurationController {
  constructor(private readonly identity: IdentityService) {}

  /**
   * What is waiting, oldest first.
   *
   * A failed read is a failure with its reason; the service throws rather than
   * returning an empty queue, because "nothing to curate" and "we could not ask"
   * are different facts and only one of them means there is nothing to do.
   */
  @Get("queue")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Provisional identities awaiting curation, oldest first — platform admin only",
  })
  async queue(@Query("limit") limit?: string) {
    const n = limit ? Number(limit) : undefined;
    return {
      success: true,
      ...(await this.identity.curationQueue(
        Number.isFinite(n) && (n as number) > 0 ? (n as number) : 50,
      )),
    };
  }

  /**
   * Promote one provisional identity into the shared library.
   *
   * `masterWineId` attaches it to an entry that already exists; omitting it
   * creates one. Either way every house item naming this identity is
   * re-pointed at the library row, and how many were re-pointed is REPORTED —
   * zero is a real answer and is printed rather than implied away.
   *
   * The house's original assertion is untouched: `asserted_for_restaurant_id`,
   * `asserted_by` and `asserted_at` stay exactly as the house left them, which
   * is the founder's "keeping the house's original assertion as provenance".
   */
  @Post("promote")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Promote a provisional identity into the library and re-point the items — platform admin only",
  })
  async promote(
    @Body()
    body: { identityId?: string; masterWineId?: string; note?: string },
  ) {
    if (!body?.identityId || !UUID_RE.test(body.identityId)) {
      throw new BadRequestException("identityId must be an identity id.");
    }
    if (body?.masterWineId && !UUID_RE.test(body.masterWineId)) {
      throw new BadRequestException(
        "masterWineId must be a library row id, or be omitted to create one.",
      );
    }
    return {
      success: true,
      ...(await this.identity.promote({
        identityId: body.identityId,
        masterWineId: body.masterWineId ?? null,
        note: body.note ?? null,
        // A service key names no person. `curated_by` stays NULL rather than
        // being filled with a stand-in, and `curation_note` is where the human
        // reason goes — an invented actor is worse than an absent one.
        curatedBy: null,
      })),
    };
  }

  /**
   * Decline one. The identity is NOT deleted and the house keeps it.
   *
   * A reason is required. "Declined" with no reason is a verdict the house
   * cannot act on, and this queue is the only place the house ever hears back.
   */
  @Post("decline")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Decline a provisional identity, with a reason the house can read — platform admin only",
  })
  async decline(@Body() body: { identityId?: string; reason?: string }) {
    if (!body?.identityId || !UUID_RE.test(body.identityId)) {
      throw new BadRequestException("identityId must be an identity id.");
    }
    if (!body?.reason || !body.reason.trim()) {
      throw new BadRequestException("A decline states its reason.");
    }
    return {
      success: true,
      ...(await this.identity.decline({
        identityId: body.identityId,
        reason: body.reason,
        curatedBy: null,
      })),
    };
  }
}
