import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PasskeysController } from "./passkeys.controller";
import { PasskeysService } from "./passkeys.service";

/** ADR 0222 (Proposed): passkey enrolment, revocation and check on /profile. */
@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PasskeysController],
  providers: [PasskeysService],
  exports: [PasskeysService],
})
export class PasskeysModule {}
