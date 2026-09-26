import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommunicationsModule } from "../communications/communications.module";
import { PasskeysController } from "./passkeys.controller";
import { PasskeysService } from "./passkeys.service";
import { SignInCodesService } from "./sign-in-codes.service";
import { SignInController } from "./sign-in.controller";

/**
 * ADR 0222 / ADR 0229 (Proposed): passkeys on /profile, and the two sign-in
 * doors that are not a password -- a passkey, or an emailed code.
 */
@Module({
  imports: [AuthModule, forwardRef(() => CommunicationsModule)],
  controllers: [PasskeysController, SignInController],
  providers: [PasskeysService, SignInCodesService],
  exports: [PasskeysService],
})
export class PasskeysModule {}
