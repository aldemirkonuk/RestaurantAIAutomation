import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SimposController } from "./simpos.controller";
import { SimposService } from "./simpos.service";

/**
 * SimPOS module — the fake POS terminal's backend (SimPOS testbed plan,
 * decisions C23-C31). Intentionally has no dependency on PosHubModule; the
 * two only ever talk over the signed webhook (decision C25).
 */
@Module({
  imports: [DatabaseModule],
  controllers: [SimposController],
  providers: [SimposService],
  exports: [SimposService],
})
export class SimposModule {}
