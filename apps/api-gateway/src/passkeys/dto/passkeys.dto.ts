import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
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
      "The account's current password. Required when the account has one (ADR 0222 fork 1, as built); an account without a password is refused until it sets one.",
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
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
