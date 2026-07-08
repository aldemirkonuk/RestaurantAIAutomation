import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class ApproveDraftDto {
  @ApiPropertyOptional({
    description: "Modified draft content (omit to approve as-is)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  modifiedContent?: string;

  @ApiPropertyOptional({ description: "Manager notes for audit log" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  managerNotes?: string;

  @ApiPropertyOptional({ description: "Additional CC email addresses" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}
