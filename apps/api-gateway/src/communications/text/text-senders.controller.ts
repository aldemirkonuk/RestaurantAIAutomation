/**
 * `/communications/text-senders` — the house's text senders, and each person's
 * consent to be reached on one (ADR 0121, ADR 0114's shape).
 *
 * TWO DIFFERENT GATES ON ONE CONTROLLER, ON PURPOSE
 * -------------------------------------------------
 * ADR 0114's rule is "house declares, each person consents", and the placement
 * follows the rule rather than the noun: declaring, requesting and revoking a
 * SENDER are the house's acts and run `assertCanManageRestaurant`; consenting
 * and withdrawing are the PERSON's and are deliberately open to any member of
 * the restaurant. That is the same split the 2026-09-04 collapse made when it
 * moved four of `/profile`'s MCP acts to `/connections` and left
 * `PUT /mcp-connections/:id/consent` where it was — because `/connections` is
 * manager-only, and moving the consent would have left a staff member with no
 * way at all to stop something acting in their name.
 *
 * NO ROUTE HERE SENDS ANYTHING, AND NONE SUBMITS A REGISTRATION.
 * `POST /request` RECORDS a request with the fee and timeline it was shown; it
 * does not hand a house's legal identity to a registrar. The submitting act is
 * sealed under ADR 0121 and this build has no route that performs it, which is
 * stated on the response rather than left to be inferred from its absence.
 *
 * Tenancy comes from the SIGNED token (`@CurrentUser()`), never from a body
 * field or a path parameter.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../../organizations/organizations.service";
import { TextSenderService } from "./text-sender.service";
import {
  TEXT_SENDER_DEFINITIONS,
  requirementFor,
  surveyedMarkets,
} from "./text-senders.catalogue";
import {
  DeclareOwnSenderDto,
  RequestRegistrationDto,
  RevokeSenderDto,
  TextConsentDto,
} from "./text-senders.dto";

interface Actor {
  id: string;
  restaurantId: string;
}

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications/text-senders")
export class TextSendersController {
  constructor(
    private readonly senders: TextSenderService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * What this house has, and what each path would need.
   *
   * Readable by any member: a staff member deciding whether to consent is owed
   * the answer to "who would be texting me, and from what number".
   */
  @Get()
  @ApiOperation({
    summary:
      "This house's WhatsApp and SMS senders, the two ways to get one, and what each market's registrar requires",
  })
  @ApiResponse({
    status: 200,
    description:
      "`readable: false` means the read FAILED and is not the same answer as a house with no sender. Every fee and timeline is a sentence carrying its source and fetch date, never a bare number.",
  })
  async readout(@CurrentUser() user: Actor) {
    const readout = await this.senders.readout(user.restaurantId);
    const mine = await this.senders.myConsent(user.restaurantId, user.id);

    /**
     * The crew-wide count is a MANAGER's fact and a staff member's business is
     * their own consent. Asked rather than assumed, and a refusal returns
     * `null` — which the composer renders as "not yours to see", never as zero.
     * Zero and "we may not tell you" are different sentences.
     */
    let crewConsents: number | null = null;
    try {
      await this.organizations.assertCanManageRestaurant(
        user.id,
        user.restaurantId,
        "read how many people in this restaurant have consented to be texted",
      );
      crewConsents = await this.senders.liveConsentCount(user.restaurantId);
    } catch {
      crewConsents = null;
    }

    return {
      senders: {
        whatsapp: readout.whatsapp,
        sms: readout.sms,
      },
      readable: readout.readable,
      reason: readout.reason,
      catalogue: TEXT_SENDER_DEFINITIONS,
      surveyedMarkets: {
        whatsapp: surveyedMarkets("whatsapp"),
        sms: surveyedMarkets("sms"),
      },
      /**
       * Stated by the server rather than assumed by the page. Nothing on this
       * deployment can hand a message to a transport, and a surface that drew
       * an enabled control would be claiming otherwise.
       */
      transport: {
        built: false,
        words:
          "No provider credential for a per-house sender exists on this deployment, so nothing can leave through one yet. The shared Plivo number is deliberately not a fallback: on a shared number a STOP reply opts a person out of every restaurant here, for five years.",
      },
      myConsent: mine,
      /**
       * Live consents in this house. `null` means either the caller may not see
       * it or the count could not be read — the composer says "not known" and
       * never prints a zero it did not measure.
       */
      crewConsents,
    };
  }

  /** What a house in this market would have to hand over, per channel. */
  @Get("requirements")
  @ApiOperation({
    summary:
      "What a house must provide to register, per channel per market — the checklist a registrar actually applies",
  })
  requirements(@CurrentUser() _user: Actor) {
    return {
      whatsapp: TEXT_SENDER_DEFINITIONS.whatsapp_business.markets,
      sms: TEXT_SENDER_DEFINITIONS.sms_sender.markets,
      /**
       * A market this build did not survey returns `null` from
       * `requirementFor`, and the surface says "not surveyed" rather than
       * drawing an empty checklist — an empty list reads as "nothing needed",
       * which is the absence-as-health shape one layer up from the data.
       */
      unsurveyedMeans:
        "A market absent from these lists was not surveyed in this build. That is not the same as a market with no requirements.",
    };
  }

  /** The house connects a sender it already owns. Manager or owner. */
  @Post("own")
  @ApiOperation({
    summary:
      "Connect a sender this house already owns. Lands in `requested`, never `connected`: a declared sender is not a proven one.",
  })
  async declareOwn(
    @CurrentUser() user: Actor,
    @Body() dto: DeclareOwnSenderDto,
  ) {
    await this.organizations.assertCanManageRestaurant(
      user.id,
      user.restaurantId,
      "connect a text sender for this restaurant",
    );
    const row = await this.senders.declareOwn({
      restaurantId: user.restaurantId,
      declaredBy: user.id,
      channel: dto.channel,
      market: dto.market,
      identity: dto.identity,
      identityKind: dto.identityKind,
      displayName: dto.displayName ?? null,
      provider: dto.provider ?? null,
      vaultSecretRef: dto.vaultSecretRef ?? null,
    });
    return {
      sender: row,
      requirement: requirementFor(dto.channel, dto.market),
      words:
        "Recorded. Nothing sends through it yet: a sender is only sendable once a live probe has reached it, and this build has no probe.",
    };
  }

  /** The house asks Mudavym to register one. Manager or owner. */
  @Post("request")
  @ApiOperation({
    summary:
      "Ask Mudavym to register a sender in THIS HOUSE's name. Records the request with the fee and the timeline it was shown; submits nothing.",
  })
  async requestRegistration(
    @CurrentUser() user: Actor,
    @Body() dto: RequestRegistrationDto,
  ) {
    await this.organizations.assertCanManageRestaurant(
      user.id,
      user.restaurantId,
      "request a text sender registration for this restaurant",
    );
    const row = await this.senders.requestRegistration({
      restaurantId: user.restaurantId,
      declaredBy: user.id,
      channel: dto.channel,
      market: dto.market,
      legalName: dto.legalName,
      registeredAddress: dto.registeredAddress,
      taxIdRef: dto.taxIdRef ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      contactName: dto.contactName,
      contactEmail: dto.contactEmail,
      useCase: dto.useCase,
      sampleMessages: dto.sampleMessages,
      optInDescription: dto.optInDescription,
    });
    return {
      sender: row,
      requirement: requirementFor(dto.channel, dto.market),
      submitted: false,
      words:
        "Recorded, and NOT submitted. Handing this house's legal identity to a registrar is a sealed act under ADR 0121, and no route in this build performs it. The fee and the timeline on the row are what you were shown today; they are kept so you can read them back when the registrar answers.",
    };
  }

  /** A manager stops the house using a sender. */
  @Post("revoke")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Stop this house using a sender. A soft revoke: the row stays so the record that it existed survives.",
  })
  async revoke(@CurrentUser() user: Actor, @Body() dto: RevokeSenderDto) {
    await this.organizations.assertCanManageRestaurant(
      user.id,
      user.restaurantId,
      "revoke a text sender for this restaurant",
    );
    return this.senders.revoke({
      restaurantId: user.restaurantId,
      senderId: dto.senderId,
      revokedBy: user.id,
      reason: dto.reason,
    });
  }

  // ── The person's half. Any member; never a manager on their behalf. ──────

  @Get("consent")
  @ApiOperation({ summary: "Your own consent to be texted by this house." })
  myConsent(@CurrentUser() user: Actor) {
    return this.senders.myConsent(user.restaurantId, user.id);
  }

  @Post("consent")
  @ApiOperation({
    summary:
      "Agree that this house may text you at a number you state. Yours alone: no route lets a manager record, approve or restore it for you.",
  })
  async consent(@CurrentUser() user: Actor, @Body() dto: TextConsentDto) {
    const consent = await this.senders.consent({
      restaurantId: user.restaurantId,
      userId: user.id,
      phone: dto.phone,
      channel: dto.channel,
    });
    return {
      consent,
      words:
        "Recorded. It changes nothing on its own: this house still needs a sender of its own before anything can reach you, and you can withdraw this at any time.",
    };
  }

  @Delete("consent")
  @ApiOperation({
    summary:
      "Withdraw it. The row is kept with the time and the reason, never deleted — a revocation has to be recorded and honoured, and a deleted row records nothing.",
  })
  async withdraw(@CurrentUser() user: Actor) {
    const result = await this.senders.withdraw({
      restaurantId: user.restaurantId,
      userId: user.id,
      via: "person",
    });
    return {
      ...result,
      words:
        result.withdrawn > 0
          ? "Withdrawn. This house may not text you, and the withdrawal is on the record."
          : "Nothing to withdraw: you had no live consent in this restaurant.",
    };
  }
}
