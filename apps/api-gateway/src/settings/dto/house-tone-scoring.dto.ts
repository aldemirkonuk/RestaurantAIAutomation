import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/**
 * The one field of `PUT /settings/vendor-tone-scoring` (ADR 0207, round 3):
 * whether this house's inbound vendor mail is read by Jev, names removed first.
 */
export class SetHouseToneScoringDto {
  @ApiProperty({
    description:
      "true sends this house's inbound vendor mail to Jev (TypeSafe) with emails, phone numbers and person names removed first, to be read on a point scale; false stops it. Off by default.",
    example: false,
  })
  @IsBoolean({
    message:
      "Send true to have Jev read this house's vendor mail, or false to stop it. Nothing was recorded.",
  })
  enabled: boolean;
}
