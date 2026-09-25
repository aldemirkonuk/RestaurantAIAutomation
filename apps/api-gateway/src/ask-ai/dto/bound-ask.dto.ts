import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { QUESTION_DISPOSITIONS } from "../../ask-readings/reading-catalogue";
import { FeedbackLabel, FeedbackStep } from "../../ask-readings/reading-folio.store";
import { QuestionClass, ReadingArgs } from "../../ask-readings/reading.types";

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

/**
 * A person's label on one step of their own ask (ADR 0145, 2026-09-21
 * amendment). The step is named because "wrong" means three different things
 * -- the question was misunderstood (pick), the wrong cells were shown
 * (compose / knowledge), or the house's records are wrong (books) -- and only
 * the first two could ever teach a model anything.
 */
export class AskFeedbackDto {
  @IsIn(["pick", "compose", "knowledge", "books"]) step!: FeedbackStep;
  @IsIn(["correct", "incorrect"]) label!: FeedbackLabel;
  /** The question class the person meant, when the pick was wrong. */
  @IsOptional() @IsIn(Object.keys(QUESTION_DISPOSITIONS)) goldClass?: QuestionClass;
}
