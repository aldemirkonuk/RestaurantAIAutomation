import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Length,
} from "class-validator";
import { Transform } from "class-transformer";
import { tooLong } from "../house-opening";

export class JoinViaInviteDto {
  @IsString() @Length(8, 8) code: string;
  // The same cap /register and PATCH /auth/me keep (F-243), so the name a
  // join saves is one /profile can save again; trimmed, so a name of spaces
  // is no name (F-897).
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100, { message: tooLong("Your name", 100) })
  name: string;
  @IsEmail() email: string;
  @MinLength(8) password: string;
  /**
   * The second secret from the invite mail's link (`#k=`), present only when
   * the person came from that mail (ADR 0229 fork 9, item 77). Without it the
   * join still works, and the new account is unverified.
   */
  @IsOptional() @IsString() @MaxLength(128) emailSecret?: string;
}
