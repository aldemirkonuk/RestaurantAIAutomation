import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { tooLong } from "../house-opening";

export class RegisterAccountDto {
  // The same cap PATCH /auth/me keeps (update-profile.dto.ts), so the name
  // /register accepts is one /get-started can save again (F-243).
  @IsString()
  @MinLength(2)
  @MaxLength(100, { message: tooLong("Your name", 100) })
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
