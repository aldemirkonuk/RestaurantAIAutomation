import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DistributorFeedController } from "./distributor-feed.controller";
import { DistributorFeedService } from "./distributor-feed.service";
import { PriceCodeMappingsService } from "./price-code-mappings.service";
import { CatalogIngestService } from "./catalog-ingest.service";
import { OrganizationsModule } from "../organizations/organizations.module";

/**
 * AuthModule is required, not optional: the controller is guarded by
 * JwtAuthGuard and RolesGuard, and a guard resolves in the context of the module
 * declaring the controller — the same reason PriceIndexModule and
 * VendorIntelModule import it.
 *
 * `OrganizationsModule` is imported for `assertCanManageRestaurant`: stating
 * what a distributor's price code means is a manager-or-owner act, and so is
 * withdrawing one (ADR 0126 Q3).
 *
 * No schedule and no fetcher. Nothing here reaches the network. The database
 * writes in the module are the manager's own statements about price codes,
 * their withdrawals, and the class-C sightings admitted from a catalogue a
 * PERSON handed over (`CatalogIngestService`, ADR 0126 batch 56). The catalogue
 * register itself is read-only.
 *
 * `CatalogIngestService` is exported because the file arrives at the document
 * door — `POST /procurement/documents` — and not at a second door of this
 * module's own. `ProcurementModule` imports this module to reach it; the
 * dependency runs one way, because nothing here imports procurement.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule, OrganizationsModule],
  controllers: [DistributorFeedController],
  providers: [
    DistributorFeedService,
    PriceCodeMappingsService,
    CatalogIngestService,
  ],
  exports: [
    DistributorFeedService,
    PriceCodeMappingsService,
    CatalogIngestService,
  ],
})
export class DistributorFeedModule {}
