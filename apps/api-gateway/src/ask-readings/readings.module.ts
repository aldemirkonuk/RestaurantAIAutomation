import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReadingFolioStore } from "./reading-folio.store";

/**
 * The Reading folio store, with no Procurement dependency.
 *
 * ADR 0145 fork 3 (the Reading travels with the draft and is re-run at the
 * order's approval seal) is HELD out of this module until the Ask confirm path
 * that attaches a folio to an order exists: a commit service with no caller
 * would put a column read into every order insert and approval for no user
 * value (KL audit J8, 2026-09-17).
 */
@Module({
  imports: [DatabaseModule],
  providers: [ReadingFolioStore],
  exports: [ReadingFolioStore],
})
export class ReadingsModule {}
