import { IsEmail, IsIn } from "class-validator";

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsIn(["owner", "manager", "staff"])
  role: "owner" | "manager" | "staff";
}
