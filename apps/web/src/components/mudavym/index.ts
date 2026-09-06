/** Mudavym brand components. Import as `@/components/mudavym`. */

export { Wordmark, type WordmarkProps } from './Wordmark';
export { Seal, type SealProps } from './Seal';
export { HoldToApprove, type HoldToApproveProps } from './HoldToApprove';
/**
 * `StripeCardPanel` is deliberately NOT re-exported here.
 *
 * It imports `stripe-card-panel.css`, and a CSS import inside a barrel is a
 * side effect no bundler tree-shakes: `App.tsx` takes `PageGate` from this file,
 * so every chunk that touches the barrel would carry the card panel's rules
 * whether or not it can show a card. Its two callers — `/profile`'s
 * `PaymentRegister` and `/connections`' Register II — import it by path.
 */
export { PageGate, type PageGateProps } from './PageGate';
export { HouseHeader, type HouseHeaderProps } from './HouseHeader';
export { HouseBell } from './HouseBell';
export { HouseUserMenu } from './HouseUserMenu';
export { DayStrip, type DayStripProps, type DayStripDay } from './DayStrip';
export {
  DAY_LETTER,
  fmtLongDay,
  localToday,
  monthDays,
  monthLabel,
  monthOf,
  recordWords,
  shiftMonth,
  type DayRecords,
} from './dayStripDates';
export {
  Sheet,
  Panel,
  Popover,
  type OverlayProps,
  type PopoverProps,
  type OverlayShape,
} from './Sheet';
export { Stub, type StubProps } from './Stub';
