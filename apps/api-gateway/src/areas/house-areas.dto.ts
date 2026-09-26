import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class SetAreaDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class SetMembershipDto {
  @IsOptional() @IsBoolean() lead?: boolean;
}

export class SetAwayDto {
  @IsString() @Matches(ISO_DAY) from!: string;
  @IsString() @Matches(ISO_DAY) until!: string;
}
