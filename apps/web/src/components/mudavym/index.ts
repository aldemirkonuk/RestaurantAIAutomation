/** Mudavym brand components. Import as `@/components/mudavym`. */

export { Wordmark, type WordmarkProps } from './Wordmark';
export { Seal, type SealProps } from './Seal';
export { HoldToApprove, type HoldToApproveProps } from './HoldToApprove';
export { Select, type SelectProps, type SelectOption } from './Select';
export { CountInput, type CountInputProps } from './CountInput';
/**
 * `StripeCardPanel` is deliberately NOT re-exported here.
 *
 * It imports `stripe-card-panel.css`, and a CSS import inside a barrel is a
 * side effect no bundler tree-shakes: `App.tsx` takes `PageGate` from this file,
 * so every chunk that touches the barrel would carry the card panel's rules
 * whether or not it can show a card. Its two callers — `/profile`'s
 * `PaymentRegister` and `/connections`' Register II — import it by path.
 *
 * `PublicShell` is NOT re-exported here either, for that reason and one more.
 * It imports three stylesheets (`styles/mudavym.css`, `sheet.css`, its own),
 * and its only callers are the seven signed-out routes of ADR 0143 §1 — none of
 * which a signed-in person ever loads. A barrel edge would pin those rules into
 * the eager main chunk through `App.tsx:73`'s `PageGate` import, and worse, it
 * would silently defeat ever making `/forgot-password`, `/reset-password`,
 * `/verify-email`, `/invite/:code` and `/no-access` lazy — they are eagerly
 * imported today (App.tsx:66-70), which is exactly the kind of fact a barrel
 * edge makes invisible. `HouseHeader` is the deliberate counter-example: it is
 * in this file only because `PageGate`, which is in this file, renders it.
 * The seven pages import `PublicShell` by path.
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
export { Denied, Refused, type DeniedProps, type RefusedProps } from './Denied';
export { SheetStackProvider, type SheetStackProviderProps } from './SheetStack';
export {
  useSheetStack,
  SHEET_STACK_CAP,
  SHEET_STACK_REFUSAL,
  type SheetStackApi,
  type SheetStackEntry,
} from './sheetStackContext';
