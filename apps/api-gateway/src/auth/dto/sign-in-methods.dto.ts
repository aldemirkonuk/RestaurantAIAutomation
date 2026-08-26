import { IsEmail, IsNotEmpty } from "class-validator";

/**
 * Body of `POST /auth/sign-in-methods`.
 *
 * A POST with a body rather than a GET with `?email=` on purpose: the address
 * is personal data, and a query string ends up in access logs, proxy caches
 * and browser history. `GET /auth/check-email` predates this and does put the
 * address in the URL — that is the pattern this endpoint deliberately does not
 * copy. See ADR 0024.
 */
export class SignInMethodsDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email: string;
}
