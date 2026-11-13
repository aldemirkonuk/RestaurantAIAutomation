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
