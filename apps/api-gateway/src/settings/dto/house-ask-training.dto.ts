import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/**
 * The body of `PUT /settings/ask-training` (ADR 0145, founder 2026-09-21,
 * "Same as the wine pool (Recommended)"). Only the house's owner may send it;
 * the service checks the role in the house, not this body.
 */
export class SetHouseAskTrainingDto {
  @ApiProperty({
    description:
      "true keeps this house's /ask questions out of any training export; false allows them (the default). Answering questions and the house's own folio book are not affected.",
    example: true,
  })
  @IsBoolean({ message: "Say true to keep this house's questions out of training, or false to allow it. Nothing was recorded." })
  optedOut!: boolean;
}
