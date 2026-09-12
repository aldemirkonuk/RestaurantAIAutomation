/** Mudavym brand components. Import as `@/components/mudavym`. */

export { Wordmark, type WordmarkProps } from './Wordmark';
export { Seal, type SealProps } from './Seal';
export { HoldToApprove, type HoldToApproveProps } from './HoldToApprove';
export { PageGate, type PageGateProps } from './PageGate';
// Sheet/Panel/Popover — the ADR 0112 overlay primitive (one modal policy,
// three shapes, one component file). Brought over standalone with /logs,
// which is the first page on main to use it; HouseHeader/DayStrip and the
// rest of ADR 0112's census-wide rollout are not part of this addition.
export {
  Sheet,
  Panel,
  Popover,
  type OverlayProps,
  type PopoverProps,
  type OverlayShape,
} from './Sheet';
