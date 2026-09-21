import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * A person asking for their house's recommendations digest.
 *
 * No `restaurantId` and no `userId`: both come from the session. The service
 * repeats the weekday rule (weekly needs one, daily takes none) because it is a
 * rule about the pair, which a per-field decorator cannot state.
 */
export class DigestSubscriptionDto {
  @ApiProperty({ enum: ["daily", "weekly"] })
  @IsIn(["daily", "weekly"])
  frequency!: "daily" | "weekly";

  @ApiPropertyOptional({
    description:
      "ISO weekday, 1 = Monday … 7 = Sunday. Required for weekly; omit for daily.",
    minimum: 1,
    maximum: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;
}
