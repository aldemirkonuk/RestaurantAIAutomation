import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Min } from "class-validator";

/**
 * `POST /settings/data-terms/acceptances` (ADR 0207 round 4). Both fields must
 * be the CURRENT terms' version and digest, read from `GET /settings/data-terms`
 * just before — a mismatch is 409, not a validation error: the request is
 * well-formed, the terms changed under it.
 */
export class AcceptDataTermsDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({ example: "3f2a9c…64 hex chars" })
  @IsString()
  digest: string;
}
