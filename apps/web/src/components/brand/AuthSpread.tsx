import { useId, type ReactNode } from 'react'
import { EndpaperShell } from './EndpaperShell'
import '../mudavym/sheet.css'

const HELD = { 'aria-hidden': true, style: { visibility: 'hidden' } } as const

export interface AuthSpreadProps {
  /**
   * The page's one H1, set in Fraunces. Left out only while a page is still
   * deciding what it is (a flow that has not yet read where the person is),
   * so no heading names a step that may not be shown.
   */
  title?: ReactNode
  /** One sentence of house voice under the title. */
  voice?: ReactNode
  /**
   * Keep the title and voice in the layout (same text, same box) but hide them
   * from the eye and from assistive tech, for a page that is still reading
   * where the person stands and may send them on without showing the step.
   */
  holdHeading?: boolean
  /** Small-caps line on the endpaper. */
  eyebrow: string
  /** The endpaper's own line. Defaults to the sign-in book's. */
  houseLine?: string
  tag?: string
  /** Top-right label on the leaf: a step count belongs here and nowhere else. */
  folio?: string
  /** Links under the form. */
  footer?: ReactNode
  /**
   * Which leaf is showing. Defaults to the title when it is a string, so a
   * page whose title changes turns its leaf and one whose title stays does not.
   */
  pageKey?: string
  wide?: boolean
  children: ReactNode
}

/**
 * The open book of /get-started, its only user so far; it is written so the
 * other doors that are not sign-in can take it. `EndpaperShell` (the endpaper
 * and ruled leaf of /login and /register) with one Fraunces H1, a lede, a
 * `<main>` landmark and the 52px hairline fields of `.mdv-spread`.
 */
export function AuthSpread({
  title,
  voice,
  holdHeading = false,
  eyebrow,
  houseLine = 'Kept, page by page.',
  tag = "Every house's book looks the same on the inside.",
  folio,
  footer,
  pageKey,
  wide = false,
  children,
}: AuthSpreadProps) {
  const mainId = `mdv-spread-main-${useId().replace(/:/g, '')}`
  return (
    <EndpaperShell
      kicker={eyebrow}
      houseLine={houseLine}
      tag={tag}
      folio={folio}
      pageKey={pageKey ?? (typeof title === 'string' ? title : undefined)}
      wide={wide}
    >
      <main id={mainId} tabIndex={-1} className="mdv-spread-main mdv-spread">
        {title ? (
          <h1 className="mdv-spread-title" {...(holdHeading ? HELD : {})}>
            {title}
          </h1>
        ) : null}
        {voice ? (
          <p className="mdv-spread-lede" {...(holdHeading ? HELD : {})}>
            {voice}
          </p>
        ) : <div style={{ height: 28 }} aria-hidden />}
        {children}
        {footer ? <footer className="mdv-spread-foot">{footer}</footer> : null}
      </main>
    </EndpaperShell>
  )
}

export default AuthSpread
