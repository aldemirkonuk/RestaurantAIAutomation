import { IsEmail, IsNotEmpty } from "class-validator";

/** Body of POST /auth/change-unverified-email. */
export class ChangeUnverifiedEmailDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email: string;
}
