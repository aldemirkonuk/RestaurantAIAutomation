import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { NotificationsController } from "./notifications.controller";
import { WebsocketModule } from "../websocket/websocket.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DatabaseModule } from "../database/database.module";
import { PushModule } from "../push/push.module";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { VendorIntelModule } from "../vendor-intel/vendor-intel.module";
import { ProducerLedgerService } from "./producers/producer-ledger.service";
import { GoalReachedProducer } from "./producers/goal-reached.producer";
import { CeilingHeldProducer } from "./producers/ceiling-held.producer";
import { DeliveryRecordedProducer } from "./producers/delivery-recorded.producer";
import { InvoiceConfirmedProducer } from "./producers/invoice-confirmed.producer";
import { SaleRecordProducer } from "./producers/sale-record.producer";
import { MarketPriceProducer } from "./producers/market-price.producer";
import { GrantSuspendedProducer } from "./producers/grant-suspended.producer";
import { AddedToolProducer } from "./producers/added-tool.producer";
import { NotificationProducersService } from "./producers/notification-producers.service";

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    WebsocketModule,
    forwardRef(() => CommunicationsModule),
    DatabaseModule,
    PushModule,
    // The goal-reached producer asks `GoalsService.getGoalProgress` for the
    // number rather than re-summing the metric, and the sale-record producer
    // asks `getPosRevenueWindow` whether a POS is wired at all. forwardRef for
    // the same reason CalendarModule uses one: AuthModule already imports
    // CommunicationsModule and this module imports both, so a plain import here
    // sits on a cycle. `scripts/check_gateway_boots.sh` is what proves it
    // resolves — tsc and jest cannot see a Nest injector.
    forwardRef(() => AnalyticsModule),
    // The market-price producer calls `VendorComparisonService
    // .belowTrailingAverage` — the SAME read `GET /vendor-intel/below-average`
    // serves the page's market box — rather than repeating its arithmetic, so
    // the box and the book cannot disagree about the same bottle.
    forwardRef(() => VendorIntelModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    LowStockAlertsService,
    // The producers (p4 fourth pass). The ledger is the only thing that writes;
    // the six below only decide what happened.
    ProducerLedgerService,
    GoalReachedProducer,
    CeilingHeldProducer,
    DeliveryRecordedProducer,
    InvoiceConfirmedProducer,
    SaleRecordProducer,
    MarketPriceProducer,
    GrantSuspendedProducer,
    AddedToolProducer,
    NotificationProducersService,
  ],
  exports: [
    NotificationsService,
    LowStockAlertsService,
    NotificationProducersService,
  ],
})
export class NotificationsModule {}
