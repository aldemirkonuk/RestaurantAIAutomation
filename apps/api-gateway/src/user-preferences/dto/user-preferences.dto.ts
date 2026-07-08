import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString } from "class-validator";

export class UpdatePreferencesDto {
  @ApiProperty({ description: "Partial preferences object to deep-merge" })
  @IsObject()
  preferences: Record<string, any>;
}

export class UserPreferencesResponseDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  preferences: Record<string, any>;

  @ApiPropertyOptional()
  updatedAt?: string;
}
