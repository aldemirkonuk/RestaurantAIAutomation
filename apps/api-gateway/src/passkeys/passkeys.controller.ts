import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RateLimit } from "../common/rate-limit";
import { requestSource } from "./request-source";
import {
  FinishPasskeyCheckDto,
  FinishPasskeyRegistrationDto,
  StartPasskeyRegistrationDto,
} from "./dto/passkeys.dto";
import {
  PasskeysService,
  type PasskeyReadout,
  type PasskeyReceipt,
} from "./passkeys.service";

/**
 * The caller's own passkeys (ADR 0222, Proposed; ADR 0134 §7, founder
 * 2026-09-21: "Passkey + paste (Recommended)").
 *
 * Every route acts on the signed token's person. None takes a user id in any
 * shape, so there is no way to enrol, list or revoke a passkey for somebody
 * else. The house is the token's and only decides eligibility (owner or
 * manager in this house) and where the audit row is filed.
 *
 * The ceremony's origin is the request's own `Origin` header -- the page the
 * person is on -- and the RP ID follows from it (`relying-party.ts`).
 */
@ApiTags("passkeys")
@ApiBearerAuth("JWT-auth")
@Controller("passkeys")
@UseGuards(JwtAuthGuard)
export class PasskeysController {
  constructor(private readonly passkeys: PasskeysService) {}

  @Get()
  @ApiOperation({
    summary:
      "Your passkeys, including removed ones, and whether you may add one here",
    description:
      "`readable: false` means the list could not be READ, which is never the same as having none.",
  })
  async list(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
  ): Promise<PasskeyReadout> {
    return this.passkeys.list(userId, restaurantId ?? null);
  }

  @Post("registration/options")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Start adding a passkey -- owners and managers; a sign-in in the last ten minutes, or an emailed code",
  })
  @ApiResponse({
    status: 403,
    description:
      "Not an owner or manager here; or `code: STEP_UP_REQUIRED` -- the sign-in is older than ten minutes and no emailed code came with the request.",
  })
  async startRegistration(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @CurrentUser("authTime") authTime: number | null | undefined,
    @Headers("origin") origin: string | undefined,
    @Body() dto: StartPasskeyRegistrationDto,
  ) {
    return this.passkeys.startRegistration(
      userId,
      restaurantId ?? null,
      origin,
      authTime ?? null,
      dto?.emailCode,
    );
  }

  @Post("step-up/code")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 600, keyPrefix: "passkey-step-up" })
  @ApiOperation({
    summary:
      "Email your own address a six-digit code, to add a passkey when the sign-in is older than ten minutes",
  })
  async sendStepUpCode(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @Req() req: Request,
  ) {
    return this.passkeys.sendStepUpCode(
      userId,
      restaurantId ?? null,
      requestSource(req),
    );
  }

  @Post("registration/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Finish adding a passkey; audited, and the person is told",
  })
  async finishRegistration(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @Headers("origin") origin: string | undefined,
    @Body() dto: FinishPasskeyRegistrationDto,
  ): Promise<PasskeyReceipt> {
    return this.passkeys.finishRegistration(
      userId,
      restaurantId ?? null,
      origin,
      dto.challengeId,
      dto.response,
      dto.nickname,
    );
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Remove one of your passkeys; audited, and the person is told",
  })
  async revoke(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<PasskeyReceipt> {
    return this.passkeys.revoke(userId, restaurantId ?? null, id);
  }

  @Post("check/options")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Start checking that one of your passkeys still answers",
  })
  async startCheck(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @Headers("origin") origin: string | undefined,
  ) {
    return this.passkeys.startCheck(userId, restaurantId ?? null, origin);
  }

  @Post("check/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Finish the check; audited. Grants nothing -- no point of action accepts a passkey yet (ADR 0112 F11).",
  })
  async finishCheck(
    @CurrentUser("userId") userId: string,
    @CurrentUser("restaurantId") restaurantId: string | undefined,
    @Headers("origin") origin: string | undefined,
    @Body() dto: FinishPasskeyCheckDto,
  ): Promise<PasskeyReceipt> {
    return this.passkeys.finishCheck(
      userId,
      restaurantId ?? null,
      origin,
      dto.challengeId,
      dto.response,
    );
  }
}
