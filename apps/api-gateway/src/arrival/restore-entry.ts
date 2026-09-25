import { ConflictException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { Target } from "./arrival-contract";

/** Shared transport only. Each register's owning service supplies a literal
 * target; no browser payload selects arbitrary tables or before-values. */
export async function restoreArrivalEntry(
  db: DatabaseService,
  target: Target,
  restaurantId: string,
  actorId: string,
  batchId: string,
  rowId: string,
) {
  const { data, error } = await db.client.rpc("arrival_restore_entry", {
    p_restaurant_id: restaurantId,
    p_actor_id: actorId,
    p_batch_id: batchId,
    p_row_id: rowId,
    p_target: target,
  });
  if (error)
    throw new ConflictException(
      "This entry could not be restored, or it changed after the seal. Its newer state was left intact.",
    );
  return data as { restored: boolean; sharedCatalogueRetained: boolean };
}
