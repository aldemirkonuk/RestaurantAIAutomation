import { IsUUID } from "class-validator";

/**
 * Body of POST /auth/verify-email.
 *
 * `email_verifications.token` is a `uuid DEFAULT gen_random_uuid()` column,
 * so every real link carries a UUID. A class (not an inline type) is what lets
 * the global ValidationPipe see this: an inline `{ token: string }` erases to
 * `Object` and is skipped. The message is the one a bad link already got.
 */
export class VerifyEmailDto {
  @IsUUID(undefined, { message: "Invalid verification token" })
  token: string;
}
