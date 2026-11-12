/**
 * "Scan a menu" on /inventory (InventoryNext, InventoryCommandPage,
 * AddWineToInventoryModal). Since the founder's MU-2 answer (2026-11-07,
 * "Repoint to menu reader") it opens the menu reader: see MenuReaderDialog.
 *
 * The props are kept so the three hosts need no change. `onWinesAdded` is
 * never called: the reader writes nothing to stock, so there is nothing for a
 * host to report as added (the old direct add-to-inventory is gone with it).
 */
import type { DetectedWine } from '../../services/wineDetection'
import type { MenuScannerPersistResult } from '../../lib/menuScannerPersistence'
import { MenuReaderDialog } from './MenuReaderDialog'

interface MenuScannerFlowProps {
  isOpen: boolean
  onClose: () => void
  /** Kept for the hosts' signature; never called (nothing is added to stock). */
  onWinesAdded?: (wines: DetectedWine[], result?: MenuScannerPersistResult) => void
  /** Kept for the hosts' signature; the house comes from the session. */
  restaurantId?: string
}

export function MenuScannerFlow({ isOpen, onClose }: MenuScannerFlowProps) {
  return <MenuReaderDialog isOpen={isOpen} onClose={onClose} />
}

export default MenuScannerFlow
