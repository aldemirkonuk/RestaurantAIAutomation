import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { ReadingArgs } from "../../ask-readings/reading.types";

export class ReadingArgsDto implements ReadingArgs {
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) subjectText?: string;
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
}
export class BoundAskDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(1) @MaxLength(2000) utterance!: string;
  @IsIn(["page", "panel"]) origin!: "page" | "panel";
  @IsOptional() @IsString() @MaxLength(80) readingId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) readingVersion?: number;
  @IsOptional() @ValidateNested() @Type(() => ReadingArgsDto) args?: ReadingArgsDto;
  @IsOptional() @IsUUID() previousFolioId?: string;
}
