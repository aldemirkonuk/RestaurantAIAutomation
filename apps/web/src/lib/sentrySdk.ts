/**
 * The part of @sentry/react that lib/error-tracking.ts uses, loaded with
 * `import()` after the first paint. Named re-exports, so the build keeps only
 * these and what they need: a dynamic import of the package itself would
 * carry the whole SDK (replay, feedback, tracing), about 450 KB raw.
 */
export {
  init,
  captureException,
  captureMessage,
  setUser,
  setContext,
  setTag,
  addBreadcrumb,
} from '@sentry/react'
