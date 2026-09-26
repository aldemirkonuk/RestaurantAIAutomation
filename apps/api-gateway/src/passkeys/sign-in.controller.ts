import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit } from "../common/rate-limit";
import {
  EmailCodeRequestDto,
  EmailCodeVerifyDto,
  PasskeySignInVerifyDto,
} from "./dto/passkeys.dto";
import { PasskeysService } from "./passkeys.service";
import { requestSource } from "./request-source";
import { SignInCodesService } from "./sign-in-codes.service";

/**
 * Signing in without a password (ADR 0222 / ADR 0229, Proposed; the founder,
 * 2026-09-25, item 29): "passkey (Face ID/Touch ID) IS a sign-in method;
 * logged-out with no passkey -> emailed one-time code." Password and Google
 * stay exactly as they are; these are two more doors to the same session.
 *
 * Every route here is used BEFORE the caller holds a token, so every one is
 * `@Public()` by decision (ADR 0096) and carries its own `@RateLimit` on top of
 * the global limiter. The proof each route checks -- a passkey assertion, or an
 * emailed code -- is the credential. Neither route mints a session itself: both
 * hand the proven account to `AuthService.issueSessionForVerifiedSignIn`, so
 * house membership (ADR 0164) and the session version (ADR 0225) apply exactly
 * as they do to a password.
 */
@ApiTags("auth")
@Controller("auth")
export class SignInController {
  constructor(
    private readonly passkeys: PasskeysService,
    private readonly codes: SignInCodesService,
    private readonly auth: AuthService,
  ) {}

  @Post("passkey/options")
  @Public()
  @RateLimit({ limit: 20, windowSeconds: 600, keyPrefix: "passkey-sign-in" })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Start signing in with a passkey. Names nobody: the device offers the passkey it holds.",
  })
  async passkeyOptions(@Headers("origin") origin: string | undefined) {
    return this.passkeys.startSignIn(origin);
  }

  @Post("passkey/verify")
  @Public()
  @RateLimit({
    limit: 20,
    windowSeconds: 600,
    keyPrefix: "passkey-sign-in-verify",
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Finish a passkey sign-in; returns a session." })
  @ApiResponse({
    status: 400,
    description:
      "One sentence for every refusal: unknown, removed or wrongly signed passkey alike.",
  })
  async passkeyVerify(
    @Headers("origin") origin: string | undefined,
    @Body() dto: PasskeySignInVerifyDto,
  ) {
    const { userId } = await this.passkeys.finishSignIn(
      origin,
      dto.challengeId,
      dto.response,
    );
    const tokens = await this.auth.issueSessionForVerifiedSignIn(
      userId,
      "passkey",
    );
    return { success: true, ...tokens };
  }

  @Post("email-code")
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 600, keyPrefix: "email-code" })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      "Email a six-digit sign-in code. The answer is the same whether or not the address has an account.",
  })
  async emailCode(@Body() dto: EmailCodeRequestDto, @Req() req: Request) {
    return this.codes.issueForSignIn(dto.email, requestSource(req));
  }

  @Post("email-code/verify")
  @Public()
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "email-code-verify" })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in with an emailed code; returns a session." })
  async emailCodeVerify(@Body() dto: EmailCodeVerifyDto) {
    const userId = await this.codes.verify("sign_in", dto.email, dto.code);
    const tokens = await this.auth.issueSessionForVerifiedSignIn(
      userId,
      "email_code",
    );
    return { success: true, ...tokens };
  }
}
