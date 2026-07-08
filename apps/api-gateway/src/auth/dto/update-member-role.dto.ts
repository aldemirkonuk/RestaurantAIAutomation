import { IsIn } from "class-validator";

export class UpdateMemberRoleDto {
  @IsIn(["owner", "manager", "staff"])
  role: "owner" | "manager" | "staff";
}
