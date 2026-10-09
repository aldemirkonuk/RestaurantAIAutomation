/**
 * Camera counting at the door: one bottle per bottle held up (F-405).
 *
 * expo-camera reports a code again and again while it stays in frame, so a
 * time throttle (the old 900 ms) counted a bottle held for three seconds as
 * three or four. A read counts only when it starts a new SIGHTING: the code
 * was out of view for at least SIGHTING_GAP_MS. Holding a bottle still counts
 * it once however long it is held.
 *
 * Only retail bottle codes count (EAN-13, EAN-8, UPC-A, UPC-E: 8, 12 or 13
 * digits). A QR on the invoice or a case label is never a bottle. An order is
 * one wine, and the order carries no barcode of its own (no route sends one,
 * and the wine library holds none), so the first bottle code read in a
 * scanning run becomes that run's wine: a different code afterwards is not
 * counted and the person is told so. Decision note: reconcile/
 * mobile-session-decisions.md.
 */

export const SIGHTING_GAP_MS = 700;

/** The camera's types; the check below is on the digits, not the type name. */
export const BOTTLE_BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

export interface ScanRun {
  /** The bottle code this run counts; null until the first one is read. */
  wineCode: string | null;
  /**
   * When each code was last seen, for the sighting gap — per code, so two
   * labels in frame at once cannot alternate their way into extra counts.
   */
  lastSeenAt: Record<string, number>;
}

export const newScanRun = (): ScanRun => ({
  wineCode: null,
  lastSeenAt: {},
});

export type ScanOutcome = "counted" | "same-bottle" | "other-wine" | "not-a-bottle";

export function isBottleCode(data: string): boolean {
  return /^(\d{8}|\d{12,13})$/.test(data);
}

export function readScan(
  run: ScanRun,
  data: string,
  now: number,
): { run: ScanRun; outcome: ScanOutcome } {
  const code = String(data ?? "").trim();
  if (!isBottleCode(code)) return { run, outcome: "not-a-bottle" };
  const sameSighting = now - (run.lastSeenAt[code] ?? -Infinity) < SIGHTING_GAP_MS;
  const seen = { ...run, lastSeenAt: { ...run.lastSeenAt, [code]: now } };
  if (sameSighting) return { run: seen, outcome: "same-bottle" };
  if (run.wineCode != null && code !== run.wineCode) {
    return { run: seen, outcome: "other-wine" };
  }
  return { run: { ...seen, wineCode: code }, outcome: "counted" };
}
