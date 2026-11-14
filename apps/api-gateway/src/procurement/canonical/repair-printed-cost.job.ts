/**
 * repair-printed-cost.job — walk every VERIFIED delivery's lots through
 * `repairPrintedCost` once (QA round 10a (7)).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx ts-node -T src/procurement/canonical/repair-printed-cost.job.ts [--restaurant <id>] [--apply]
 *
 * WHY. Before #816 a verify booked an invoice's PRINTED price (264 a case) as
 * one bottle's cost, and an accepted proposal's raw price likewise. A re-verify
 * now repairs such a lot, but nobody re-verifies a delivery that is done. This
 * job does it for all of them, with the same code the re-verify runs.
 *
 * DRY RUN IS THE DEFAULT. Without `--apply` it posts nothing and prints, as one
 * JSON object, every correction it WOULD make (`changes`: booked → per bottle)
 * and every lot it would leave and why (`flagged`). `--apply` posts through
 * `finalise_delivery_cost`, which writes an `inventory_lot_revaluations` row
 * per lot, so every correction is on the record and can be reversed.
 *
 * Running it against production is the founder's call; it was not run there.
 */

import { createClient } from "@supabase/supabase-js";
import type { DatabaseService } from "../../database/database.service";
import { CostFlag, CostRepair, DeliveryStockService } from "./delivery-stock.service";

export interface CostRepairReport {
  mode: "dry-run" | "apply";
  deliveries: number;
  changes: (CostRepair["changes"][number] & { restaurantId: string; deliveryId: string })[];
  flagged: (CostFlag & { restaurantId: string; deliveryId: string })[];
  /** A delivery that could not be checked. Never read as "nothing to repair". */
  errors: { restaurantId: string; deliveryId: string; error: string }[];
}

const PAGE = 500;

export async function runCostRepair(
  db: Pick<DatabaseService, "getClient">,
  opts: { apply?: boolean; restaurantId?: string } = {},
): Promise<CostRepairReport> {
  const stock = new DeliveryStockService(db as DatabaseService);
  const report: CostRepairReport = {
    mode: opts.apply ? "apply" : "dry-run",
    deliveries: 0,
    changes: [],
    flagged: [],
    errors: [],
  };
  for (let from = 0; ; from += PAGE) {
    let q = db
      .getClient()
      .from("deliveries")
      .select("id, restaurant_id")
      .not("verified_at", "is", null);
    if (opts.restaurantId) q = q.eq("restaurant_id", opts.restaurantId);
    const page = await q.order("id").range(from, from + PAGE - 1);
    // A failed read stops the walk: a partial report must not pass for a whole one.
    if (page.error) throw new Error(`verified deliveries could not be read: ${page.error.message}`);
    const rows = (page.data ?? []) as { id: string; restaurant_id: string }[];
    for (const { id: deliveryId, restaurant_id: restaurantId } of rows) {
      report.deliveries++;
      const r = await stock.repairPrintedCost(restaurantId, deliveryId, null, { dryRun: !opts.apply });
      if (!r.ok) {
        report.errors.push({ restaurantId, deliveryId, error: r.error });
        continue;
      }
      for (const c of r.value.changes) report.changes.push({ restaurantId, deliveryId, ...c });
      for (const f of r.value.flagged) report.flagged.push({ restaurantId, deliveryId, ...f });
    }
    if (rows.length < PAGE) break;
  }
  return report;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    process.stderr.write("repair-printed-cost: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required\n");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  process.stderr.write(`repair-printed-cost: ${apply ? "APPLYING to" : "dry run against"} ${new URL(url).host}\n`);
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  runCostRepair({ getClient: () => supabase } as Pick<DatabaseService, "getClient">, {
    apply,
    restaurantId: arg("--restaurant"),
  })
    .then((report) => {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      process.exit(report.errors.length ? 1 : 0);
    })
    .catch((err) => {
      process.stderr.write(`repair-printed-cost failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
