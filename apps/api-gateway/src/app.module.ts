import { join } from "path";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_INTERCEPTOR, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ProcurementModule } from "./procurement/procurement.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ReportsModule } from "./reports/reports.module";
import { WebsocketModule } from "./websocket/websocket.module";
import { DatabaseModule } from "./database/database.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { PosHubModule } from "./pos-hub/pos-hub.module";
import { OneTapActionsModule } from "./one-tap-actions/one-tap-actions.module";
import { ToastModule } from "./toast/toast.module";
import { EventsModule } from "./events/events.module";
import { CalendarModule } from "./calendar/calendar.module";
import { InventoryLedgerModule } from "./inventory-ledger/inventory-ledger.module";
import { ProvidersModule } from "./providers/providers.module";
import { CommunicationsModule } from "./communications/communications.module";
import { SettingsModule } from "./settings/settings.module";
import { WinesModule } from "./wines/wines.module";
import { StorageLocationsModule } from "./storage-locations/storage-locations.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { UserPreferencesModule } from "./user-preferences/user-preferences.module";
import { RestaurantTemplatesModule } from "./restaurant-templates/restaurant-templates.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { RestaurantsModule } from "./restaurants/restaurants.module";
import { TeamModule } from "./team/team.module";
import { VendorCatalogueModule } from "./vendor-catalogue/vendor-catalogue.module";
import { DistributorDiscoveryModule } from "./distributor-discovery/distributor-discovery.module";
import { MenusModule } from "./menus/menus.module";
import { MobileModule } from "./mobile/mobile.module";
import { PushModule } from "./push/push.module";
import {
  ErrorTrackingModule,
  SentryInterceptor,
} from "./common/error-tracking";
import { RateLimitModule, RateLimitGuard } from "./common/rate-limit";
import { CacheModule } from "./common/cache/cache.module";
import { TenantGuard } from "./common/tenant/tenant.guard";
import { OrchestratorModule } from "./common/orchestrator/orchestrator.module";
import { UxOptimizerModule } from "./ux-optimizer/ux-optimizer.module";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      // Load monorepo root .env regardless of cwd (dist/ vs src/). Later entries override earlier.
      envFilePath: [
        join(__dirname, "..", "..", "..", ".env"),
        join(__dirname, "..", "..", ".env"),
        ".env",
        ".env.local",
      ],
    }),

    // Scheduling for cron jobs
    ScheduleModule.forRoot(),

    // Core modules
    ErrorTrackingModule, // Global error tracking (Sentry)
    RateLimitModule, // API rate limiting
    CacheModule, // Redis caching layer
    OrchestratorModule, // NestJS -> Python bridge (HTTP + RabbitMQ)
    DatabaseModule,
    AuthModule,

    // Feature modules
    DashboardModule, // Aggregated dashboard endpoint (API Bus pattern)
    AnalyticsModule, // Quantitative analytics engine (finance/stats/risk/forecast)
    UxOptimizerModule, // Self-learning UX agent (observe → propose → gated ship → learn)
    PosHubModule, // MultiPOS ingestion hub (canonical checks → pos_checks)
    OneTapActionsModule, // One-tap actions with backend persistence
    ToastModule, // Toast POS API integration
    InventoryModule,
    InventoryLedgerModule, // Immutable inventory transaction ledger
    ProcurementModule,
    NotificationsModule,
    ReportsModule,
    EventsModule,
    ProvidersModule,
    WinesModule,
    StorageLocationsModule, // Storage locations and wine-to-location mappings
    CalendarModule, // Calendar with recurrence support
    CommunicationsModule, // Gmail, SMS, and scheduled communications
    ConversationsModule, // Procurement conversation history, threads, summaries
    SettingsModule, // Restaurant settings and feature flags
    OrganizationsModule, // Multi-tenant org hierarchy (branches, chains)
    RestaurantsModule, // Per-restaurant membership (URA roster + invites)
    TeamModule, // Team ops: schedules, shifts, coverage, labor, certs, performance
    VendorCatalogueModule, // Admin-curated vendor catalogue with search/detail endpoints
    DistributorDiscoveryModule, // Territory-gated distributor map search (geo + portfolio facets)
    MenusModule, // Menu import (scan/CSV/manual) + onboarding progress
    UserPreferencesModule, // User preference storage (JSONB)
    RestaurantTemplatesModule, // Communication templates CRUD
    PushModule, // Expo push sender for the mobile app
    MobileModule, // Mobile decision feed, today-pulse, device registry, idempotency

    // Real-time communication
    WebsocketModule,
  ],
  controllers: [],
  providers: [
    // Global guards
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    // Global interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryInterceptor,
    },
  ],
})
export class AppModule {}
