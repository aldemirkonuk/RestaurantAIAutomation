import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class RequestPasswordResetDto {
  @IsEmail({}, { message: "Please provide a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email: string;
}

export class ResetPasswordDto {
  @IsUUID(undefined, { message: "Invalid or expired reset token" })
  token: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  newPassword: string;
}
