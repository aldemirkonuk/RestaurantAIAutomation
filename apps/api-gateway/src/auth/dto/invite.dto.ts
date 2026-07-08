import { IsString, IsOptional, IsEmail, IsIn } from "class-validator";

export class InviteDto {
  @IsString() restaurantId: string;
  @IsOptional() @IsEmail() targetEmail?: string;
  @IsOptional() @IsIn(["owner", "manager", "staff"]) role?: string;
}
