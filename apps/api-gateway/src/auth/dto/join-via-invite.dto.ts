import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Length,
} from "class-validator";

export class JoinViaInviteDto {
  @IsString() @Length(8, 8) code: string;
  @IsString() name: string;
  @IsEmail() email: string;
  @MinLength(8) password: string;
  /**
   * The second secret from the invite mail's link (`#k=`), present only when
   * the person came from that mail (ADR 0229 fork 9, item 77). Without it the
   * join still works, and the new account is unverified.
   */
  @IsOptional() @IsString() @MaxLength(128) emailSecret?: string;
}
