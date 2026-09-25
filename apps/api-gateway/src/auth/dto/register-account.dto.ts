import { IsEmail, IsString, MinLength } from "class-validator";

export class RegisterAccountDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class RegisterGoogleAccountDto {
  @IsString()
  token: string;
}
