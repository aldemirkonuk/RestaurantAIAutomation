import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from "class-validator";

/**
 * An owner names a person who may send to vendors with one hold (ADR 0112 F12).
 *
 * A class so the global ValidationPipe checks it (an inline type is recorded as
 * `Object` and skipped). `limitAmount`, `limitCurrency` and `expiresAt` accept
 * `null`, but the SERVICE refuses a body that leaves any of them OUT: "no
 * limit" and "never expires" are answers an owner gives, not defaults a missing
 * field stands in for (ADR 0116).
 */
export class IssueAuthorityGrantDto {
  @ApiProperty({ description: "The person (public.users.user_id) the owner names" })
  @IsUUID()
  granteeUserId!: string;

  @ApiProperty({ description: "What the grant covers. Only vendor_send exists." })
  @IsIn(["vendor_send"])
  scope!: "vendor_send";

  @ApiPropertyOptional({
    description:
      "The largest single money act covered, in limitCurrency. null = no money limit, which covers letters only. Required as a key.",
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  limitAmount?: number | null;

  @ApiPropertyOptional({
    description: "ISO 4217 code of the limit; null exactly when limitAmount is null. Required as a key.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  limitCurrency?: string | null;

  @ApiPropertyOptional({
    description: "When the grant stops counting; null = until revoked. Required as a key.",
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
