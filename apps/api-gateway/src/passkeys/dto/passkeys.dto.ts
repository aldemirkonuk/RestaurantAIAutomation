import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/**
 * Bodies of the passkey routes (ADR 0222, Locked 2026-09-27). The service re-checks
 * every field it relies on; these decorators exist so the global
 * ValidationPipe (`whitelist`, `forbidNonWhitelisted`) lets the fields through
 * and refuses anything else.
 */

export class StartPasskeyRegistrationDto {
  @ApiPropertyOptional({
    description:
      "The six-digit code emailed by POST /passkeys/step-up/code. Needed only when the sign-in is older than ten minutes (founder 2026-09-25, item 29).",
    example: "042917",
  })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  emailCode?: string;
}

export class PasskeySignInVerifyDto {
  @ApiProperty({
    description: "The id returned by POST /auth/passkey/options.",
  })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({
    description: "The browser's AuthenticationResponseJSON, unchanged.",
  })
  @IsObject()
  response!: Record<string, unknown>;
}

export class EmailCodeRequestDto {
  @ApiProperty({ example: "you@restaurant.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class EmailCodeVerifyDto {
  @ApiProperty({ example: "you@restaurant.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: "042917" })
  @IsString()
  @MaxLength(12)
  code!: string;

  @ApiPropertyOptional({
    description:
      "This device's memory of the house THIS email last used, as [{ userId, houseId, usedAt }] (ADR 0164). A hint only: the server checks it against active memberships before naming a house, exactly as it does for a password sign-in.",
  })
  @IsOptional()
  lastHouses?: unknown;
}

export class FinishPasskeyRegistrationDto {
  @ApiProperty({ description: "The id returned by the options call." })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({
    description: "The browser's RegistrationResponseJSON, unchanged.",
  })
  @IsObject()
  response!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "A name for this passkey, at most 60 characters.",
    example: "Work laptop",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nickname?: string;
}

export class FinishPasskeyCheckDto {
  @ApiProperty({ description: "The id returned by the check-options call." })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({
    description: "The browser's AuthenticationResponseJSON, unchanged.",
  })
  @IsObject()
  response!: Record<string, unknown>;
}
