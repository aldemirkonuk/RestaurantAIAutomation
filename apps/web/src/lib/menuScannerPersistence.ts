/**
 * Menu Scanner persistence (§2 of .planning/INVENTORY_ADD_REMOVE_SCENARIOS.md).
 *
 * Everything now goes through the bulk endpoint, which resolves-or-creates the
 * Master Library row server-side. That removes the old dead end: a detected wine
 * with no library match used to be reported as "needs manual add" and dropped,
 * whereas it is now recorded against a provisional (tier 3) library entry and
 * flagged as such so nobody mistakes it for a curated wine.
 *
 * Per-line failures never abort the batch, so the caller always gets one result
 * per submitted row and can leave the failures on screen to retry.
 */
import { bulkCreateInventoryItems } from '../services/api/inventory'
import type {
  BulkCreateInventoryResult,
  BulkInventoryLine,
  BulkInventoryLineResult,
} from '../services/api/types'
import type { DetectedWine } from '../services/wineDetection'
import { nextBatchRowKey, type BatchReceiveRow } from '../components/inventory/BatchReceiveGrid'

/** Default case-ish quantity for a confident read. */
const SCAN_DEFAULT_QTY = 6
/** Below this, the OCR read is shaky enough that a blind bulk quantity would be a lie. */
const LOW_CONFIDENCE = 0.6

export interface MenuScannerPersistResult {
  /** Brand new inventory rows. */
  added: BulkInventoryLineResult[]
  /** Wine was already in inventory, so the quantity was appended to the existing row. */
  stockAdded: BulkInventoryLineResult[]
  /** A previously removed row came back. */
  reactivated: BulkInventoryLineResult[]
  /** Succeeded, but had no Master Library match — a provisional library entry was created. */
  provisional: BulkInventoryLineResult[]
  failed: BulkInventoryLineResult[]
}

/**
 * Seeds grid rows from accepted detections. Low-confidence reads get a
 * quantity of 1 and no location so they need a deliberate look, without holding
 * up bulk-filling the confident rows around them.
 */
export function detectedWinesToBatchRows(wines: DetectedWine[]): BatchReceiveRow[] {
  return wines.map((wine) => {
    const shaky = wine.confidence < LOW_CONFIDENCE
    const known = wine.inMasterLibrary && !!wine.masterWineId
    return {
      key: nextBatchRowKey('scan'),
      wineId: known ? wine.masterWineId : undefined,
      draft: known
        ? undefined
        : {
            name: wine.name,
            producer: wine.producer,
            vintage: wine.vintage ?? null,
            country: wine.country,
            region: wine.region,
            grapeVariety: wine.grapeVariety ?? wine.grape,
          },
      name: wine.name,
      producer: wine.producer,
      vintage: wine.vintage ?? null,
      quantity: shaky ? 1 : SCAN_DEFAULT_QTY,
      // Deliberately blank: the only price on a wine list is the menu price, and
      // seeding a cost basis from it would silently wreck WAC.
      cost: '',
      isSample: false,
      selected: false,
      hint: shaky ? `Low confidence read (${Math.round(wine.confidence * 100)}%) — check before saving` : undefined,
    }
  })
}

/** Buckets a bulk response by outcome. Provisional rows also appear in their status bucket. */
export function groupBulkResult(result: BulkCreateInventoryResult): MenuScannerPersistResult {
  const grouped: MenuScannerPersistResult = {
    added: [],
    stockAdded: [],
    reactivated: [],
    provisional: [],
    failed: [],
  }
  for (const line of result.results) {
    switch (line.status) {
      case 'created':
        grouped.added.push(line)
        break
      case 'stock_added':
        grouped.stockAdded.push(line)
        break
      case 'reactivated':
        grouped.reactivated.push(line)
        break
      case 'failed':
        grouped.failed.push(line)
        break
    }
    if (line.status !== 'failed' && line.libraryMatched === false) {
      grouped.provisional.push(line)
    }
  }
  return grouped
}

/** Accumulates results across retry attempts so a final summary counts everything that landed. */
export function mergePersistResults(
  a: MenuScannerPersistResult,
  b: MenuScannerPersistResult,
): MenuScannerPersistResult {
  return {
    added: [...a.added, ...b.added],
    stockAdded: [...a.stockAdded, ...b.stockAdded],
    reactivated: [...a.reactivated, ...b.reactivated],
    provisional: [...a.provisional, ...b.provisional],
    // Only the latest attempt's failures are still outstanding.
    failed: b.failed,
  }
}

export async function persistBatchToInventory(
  items: BulkInventoryLine[],
  options: { source: string; reason?: string },
): Promise<MenuScannerPersistResult> {
  const result = await bulkCreateInventoryItems({
    items,
    source: options.source,
    ...(options.reason ? { reason: options.reason } : {}),
  })
  return groupBulkResult(result)
}

/** Turns a persistence result into one human-readable toast-friendly summary line. */
export function summarizeMenuScanPersist(result: MenuScannerPersistResult): string {
  const parts: string[] = []
  if (result.added.length) parts.push(`${result.added.length} added`)
  if (result.stockAdded.length) parts.push(`${result.stockAdded.length} restocked`)
  if (result.reactivated.length) parts.push(`${result.reactivated.length} reactivated`)
  if (result.provisional.length) parts.push(`${result.provisional.length} new to the library`)
  if (result.failed.length) parts.push(`${result.failed.length} failed`)
  return parts.join(' · ') || 'No wines to add'
}
