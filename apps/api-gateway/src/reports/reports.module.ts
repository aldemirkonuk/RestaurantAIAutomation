import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { ReportExportsController } from "./exports/report-exports.controller";
import { ReportExportsService } from "./exports/report-exports.service";
import { ReportCuttingReader } from "./exports/report-cutting-reader.service";
import { ReportExportRetentionCron } from "./exports/report-export-retention.cron";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  // AnalyticsModule: an export reads a cutting through the same analytics
  // services the /reports page reads (OD-81, ReportCuttingReader).
  imports: [DatabaseModule, AuthModule, AnalyticsModule],
  // ORDER IS LOAD-BEARING. Nest registers routes in this order, and
  // ReportsController's `GET /reports/:id` would otherwise answer
  // `GET /reports/exports` with id = "exports".
  controllers: [ReportExportsController, ReportsController],
  // ReportExportRetentionCron: the daily 90-day sweep (ScheduleModule.forRoot()
  // is registered once, globally, in app.module.ts — a provider only needs the
  // @Cron decorator, not a local ScheduleModule import, to be picked up).
  providers: [
    ReportsService,
    ReportExportsService,
    ReportCuttingReader,
    ReportExportRetentionCron,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
