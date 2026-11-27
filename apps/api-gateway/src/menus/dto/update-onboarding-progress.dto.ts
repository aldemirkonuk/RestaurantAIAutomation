import { IsBoolean, IsOptional } from "class-validator";

export class UpdateOnboardingProgressDto {
  @IsBoolean()
  @IsOptional()
  menu_uploaded?: boolean;

  @IsBoolean()
  @IsOptional()
  vendor_added?: boolean;

  @IsBoolean()
  @IsOptional()
  team_member_invited?: boolean;

  @IsBoolean()
  @IsOptional()
  checklist_dismissed?: boolean;

  /** "No team yet" on the invite step (true), or taken back (false). */
  @IsBoolean()
  @IsOptional()
  no_team_yet?: boolean;
}
