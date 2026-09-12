/** Mudavym brand components. Import as `@/components/mudavym`. */

export { Wordmark, type WordmarkProps } from './Wordmark';
export { Seal, type SealProps } from './Seal';
export { HoldToApprove, type HoldToApproveProps } from './HoldToApprove';
export { PageGate, type PageGateProps } from './PageGate';
// Sheet/Panel/Popover — the ADR 0112 overlay primitive (one modal policy,
// three shapes, one component file). Landed standalone: HouseHeader,
// DayStrip and the rest of ADR 0112's app-wide census rollout are not part
// of this addition. The first consumer is /logs (a separate PR).
export {
  Sheet,
  Panel,
  Popover,
  type OverlayProps,
  type PopoverProps,
  type OverlayShape,
} from './Sheet';
