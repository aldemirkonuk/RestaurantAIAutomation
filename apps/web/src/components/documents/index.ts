/** The canonical document's sections (ADR 0104 D2: one component, conditional sections). */

export {
  CanonicalSheet,
  type CanonicalSheetProps,
  type CorrectionWiring,
} from './CanonicalSheet'
export { CorrectionDialog, type CorrectionDialogProps } from './CorrectionDialog'
export {
  VerdictBlock,
  exceptionSentences,
  ladderDisagreement,
  type VerdictBlockProps,
} from './VerdictBlock'
export { DeliverySpine, type DeliverySpineProps } from './DeliverySpine'
export { ProvenanceHover, type ProvenanceHoverProps } from './ProvenanceHover'
export { OriginalPane, type OriginalPaneProps } from './OriginalPane'
export { DegradedNotice, degradedReasons, type DegradedNoticeProps } from './DegradedNotice'
export { DoorFrame, type DoorFrameProps } from './DoorFrame'
export { ProposalThread, type ProposalThreadProps } from './ProposalThread'
export { DeliveryGates, type DeliveryGatesProps } from './DeliveryGates'
export * from './canonical-format'
