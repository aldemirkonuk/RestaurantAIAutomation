import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReadingFolioStore } from "./reading-folio.store";
import { ReadingCommitService } from "./reading-commit.service";

/** No Procurement dependency: commitment checks can import this module safely. */
@Module({ imports: [DatabaseModule], providers: [ReadingFolioStore, ReadingCommitService], exports: [ReadingFolioStore, ReadingCommitService] })
export class ReadingsModule {}
