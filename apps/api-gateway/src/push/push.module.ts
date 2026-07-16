import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ExpoPushService } from "./expo-push.service";

@Module({
  imports: [DatabaseModule],
  providers: [ExpoPushService],
  exports: [ExpoPushService],
})
export class PushModule {}
