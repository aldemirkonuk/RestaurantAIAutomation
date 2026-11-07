import {
  IsUUID,
  Matches,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

/** A code sent together with a token is refused: one proof per request. */
@ValidatorConstraint({ name: "codeOrTokenNotBoth" })
class CodeOrTokenNotBoth implements ValidatorConstraintInterface {
  validate(_code: unknown, args: ValidationArguments): boolean {
    return (args.object as VerifyEmailDto).token === undefined;
  }
  defaultMessage(): string {
    return "Send the link's token or the code, not both.";
  }
}

/**
 * Body of POST /auth/verify-email: the link's token, OR the six-digit code
 * the same mail carries (onboarding OB-3) -- exactly one of them.
 *
 * `email_verifications.token` is a `uuid DEFAULT gen_random_uuid()` column,
 * so every real link carries a UUID. A class (not an inline type) is what lets
 * the global ValidationPipe see this: an inline `{ token: string }` erases to
 * `Object` and is skipped. The message is the one a bad link already got.
 *
 * The code is six digits; spaces a person typed between them are allowed and
 * stripped by `SignInCodesService.verify`. Neither field, or both, is refused.
 */
export class VerifyEmailDto {
  // Checked unless a code alone was sent: a body with neither still answers
  // "Invalid verification token", as it did before the code existed.
  @ValidateIf(
    (o: VerifyEmailDto) => o.code === undefined || o.token !== undefined,
  )
  @IsUUID(undefined, { message: "Invalid verification token" })
  token?: string;

  @ValidateIf((o: VerifyEmailDto) => o.code !== undefined)
  @Matches(/^\s*(\d\s*){6}$/, {
    message: "Type the 6-digit code from the email.",
  })
  @Validate(CodeOrTokenNotBoth)
  code?: string;
}
