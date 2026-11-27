import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { CommunicationsModule } from "../communications/communications.module";
import { SetupReminderController } from "./setup-reminder.controller";
import { SetupReminderService } from "./setup-reminder.service";

/** Its own module: it needs CommunicationsModule, and HouseModule stays a leaf. */
@Module({
  imports: [DatabaseModule, CommunicationsModule],
  controllers: [SetupReminderController],
  providers: [SetupReminderService],
})
export class SetupReminderModule {}
