import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  newPassword: string;

  /**
   * F-1347: the code emailed by POST /passkeys/step-up/code. Read only when
   * no password is set yet and the sign-in is older than ten minutes.
   */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  emailCode?: string;
}
