import { Panel } from '@/components/mudavym'
import { MenuScannerTab } from './MenuScannerTab'

interface MenuScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onWinesDetected: (wines: any[]) => void
}

/**
 * F-613: the scanner sits in the house Panel (ADR 0112), which names it as a
 * dialog, moves focus in, keeps it there, closes on Escape, hands focus back
 * to "Read a menu", and closes with a named button — the hand-built overlay
 * it replaces did none of that.
 */
export function MenuScannerModal({ isOpen, onClose, onWinesDetected }: MenuScannerModalProps) {
  return (
    <Panel
      open={isOpen}
      onClose={onClose}
      label="Read a menu. Upload a photo or file of your wine list and see the wines on it. Nothing is written until you answer for each wine."
      eyebrow="Cellar"
      title="Read a menu"
    >
      <MenuScannerTab onWinesDetected={onWinesDetected} />
    </Panel>
  )
}
