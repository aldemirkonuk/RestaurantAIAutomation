import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty({ description: "Template type: email, sms, etc." })
  @IsString()
  type: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  type?: string;
}

export class TemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  subject?: string;

  @ApiProperty()
  body: string;

  /** true on a vendor letter row whose words are kept for those who may send
   *  it (F-1358): `body` is then empty because it was left out, not blank. */
  @ApiPropertyOptional()
  bodyWithheld?: boolean;

  @ApiProperty()
  type: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
