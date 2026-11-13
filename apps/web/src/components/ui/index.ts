// The primitives come from their own folder, not the `@wineops/ui` root. The
// root also re-exports the Tremor charts, and Tremor is not marked
// side-effect free, so importing the root from this eager barrel put Tremor,
// Recharts and Headless UI (about 540 KB) in the entry chunk of every page
// (r18 bundle walk, 2026-11-13). src/__tests__/entry-chunk.test.ts guards it.
export {
  Button,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Input,
  // The primitives sub-path, not the `@wineops/ui` barrel: the barrel also
  // re-exports the Tremor charts, and the sign-in pages import this file, so
  // the barrel made every stranger on /login or /register download Tremor and
  // recharts (2026-11-07 bundle QA). `bundle-first-paint.test.ts` pins this.
} from '@wineops/ui/components/primitives'
export type { ButtonProps, CardProps, BadgeProps, InputProps } from '@wineops/ui/components/primitives'

export * from './empty-state'
export * from './loading-skeleton'
export * from './error-state'
export * from './form'
export * from './ContextMenu'
