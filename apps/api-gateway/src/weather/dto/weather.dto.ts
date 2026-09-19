import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601, IsOptional } from "class-validator";

/**
 * `GET /calendar/weather?from&to`.
 *
 * Dates only, and both optional: the calendar always knows its own window, and
 * a caller that omits them gets the issuer's own horizon from today.
 */
export class GetWeatherQueryDto {
  @ApiProperty({ required: false, example: "2026-09-01" })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, example: "2026-09-30" })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
