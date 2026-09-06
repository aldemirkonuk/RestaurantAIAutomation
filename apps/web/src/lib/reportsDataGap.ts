/**
 * What /reports should say when its charts are empty.
 *
 * The banner said "Sales revenue needs a connected POS and is not shown here"
 * over 44 ingested `pos_checks`, 34 depleted bottles and 55 consumption rows
 * (POS lens, defect 9). The POS was connected. It had been sending all night.
 * The actual gap was that those checks carried no money —
 * `total`/`subtotal`/`tip` were NULL on 44 of 44 rows — so an owner reading the
 * banner would go and re-connect an integration that was already working.
 *
 * Naming the wrong cause is not a smaller error than naming no cause. It sends
 * someone to fix the wrong thing.
 *
 * This is a pure function so the wording is testable without mounting the page,
 * and so the three cases stay visibly three: not connected, connected but
 * carrying nothing, and we could not tell.
 */

export type ReportsGapKind =
  | "no_pos_connected"
  | "pos_sends_no_money"
  | "pos_status_unknown"
  | "no_purchasing_data";

export interface ReportsGap {
  kind: ReportsGapKind;
  title: string;
  body: string;
  /** Null when there is nothing useful to send the owner to. */
  action: { label: string; href: string } | null;
}

export interface ReportsGapInput {
  /** Vendor purchase-order spend in the window. */
  totalSpend: number;
  /** Purchase orders in the window. */
  totalOrders: number;
  /** `pos_checks` in the last 30 days, or null when the status read failed. */
  posChecks: number | null;
  /** True when the /pos-hub/status read itself failed. */
  posStatusUnavailable: boolean;
}

/**
 * `null` means there is no gap worth a banner — the charts have something to
 * draw. A banner over real data is noise, and noise is how people learn to
 * scroll past warnings.
 */
export function describeReportsGap(input: ReportsGapInput): ReportsGap | null {
  const hasPurchasing = input.totalSpend > 0 || input.totalOrders > 0;
  if (hasPurchasing) return null;

  const purchasingLine =
    "These charts track vendor spend from your purchase orders, not sales. Place or import orders to populate them.";

  if (input.posStatusUnavailable) {
    // We could not ask. Saying "connect a POS" here would be a guess, and
    // saying nothing would let an outage read as a clean bill of health.
    return {
      kind: "pos_status_unknown",
      title: "No purchasing data yet",
      body: `${purchasingLine} We could not check whether your POS is connected, so nothing here is a statement about it.`,
      action: null,
    };
  }

  if ((input.posChecks ?? 0) > 0) {
    // The POS is connected and sending. The gap is what the checks carry.
    return {
      kind: "pos_sends_no_money",
      title: "No purchasing data yet",
      body:
        `${purchasingLine} Your POS is connected and has sent ${input.posChecks} check(s) — ` +
        "but those checks carry no money, so sales revenue cannot be computed from them. " +
        "This is a gap in what the POS sends, not in the connection.",
      action: { label: "View POS status", href: "/settings?tab=pos" },
    };
  }

  return {
    kind: "no_pos_connected",
    title: "No purchasing data yet",
    body: `${purchasingLine} Sales revenue needs a connected POS and is not shown here.`,
    action: { label: "Configure POS", href: "/settings?tab=pos" },
  };
}
