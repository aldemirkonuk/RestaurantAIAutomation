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

  /**
   * The person's answer on the invite step: the house has no team yet (true)
   * or that answer is taken back (false). Settles the team step while the
   * house has no invite.
   */
  @IsBoolean()
  @IsOptional()
  no_team_yet?: boolean;
}
