import { IsEmail, IsString, MinLength, Length } from "class-validator";

export class JoinViaInviteDto {
  @IsString() @Length(8, 8) code: string;
  @IsString() name: string;
  @IsEmail() email: string;
  @MinLength(8) password: string;
}
