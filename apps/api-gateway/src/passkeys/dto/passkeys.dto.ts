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
 * Bodies of the passkey routes (ADR 0222, Proposed). The service re-checks
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
