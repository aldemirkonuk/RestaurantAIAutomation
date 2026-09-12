/** Mudavym brand components. Import as `@/components/mudavym`. */

export { Wordmark, type WordmarkProps } from './Wordmark';
export { Seal, type SealProps } from './Seal';
export { HoldToApprove, type HoldToApproveProps } from './HoldToApprove';
export { PageGate, type PageGateProps } from './PageGate';
/**
 * `Sheet`/`Panel`/`Popover` (ADR 0112's overlay primitive) are deliberately
 * NOT re-exported here, for the same reason `StripeCardPanel` above is not:
 * `Sheet.tsx` imports `sheet.css` as a side effect, and a CSS import inside
 * a barrel is a side effect no bundler tree-shakes. This barrel is already
 * imported for `PageGate` by pages that render neither an overlay nor a
 * payment panel; re-exporting Sheet here would ship its stylesheet into
 * every one of those bundles regardless. Import by path:
 * `from '@/components/mudavym/Sheet'`.
 */
