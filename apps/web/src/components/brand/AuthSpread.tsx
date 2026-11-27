import { useId, type ReactNode } from 'react'
import { EndpaperShell } from './EndpaperShell'
import '../mudavym/sheet.css'

export interface AuthSpreadProps {
  /**
   * The page's one H1, set in Fraunces. Left out only while a page is still
   * deciding what it is (a flow that has not yet read where the person is),
   * so no heading names a step that may not be shown.
   */
  title?: ReactNode
  /** One sentence of house voice under the title. */
  voice?: ReactNode
  /** Small-caps line on the endpaper ("Account access"). */
  eyebrow: string
  /** The endpaper's own line. Defaults to the sign-in book's. */
  houseLine?: string
  tag?: string
  /** Top-right label on the leaf: a step count belongs here and nowhere else. */
  folio?: string
  /** Links under the form ("Back to sign in"). */
  footer?: ReactNode
  /**
   * Which leaf is showing. Defaults to the title when it is a string, so a
   * page whose title changes (the request sent, the link spent) turns its leaf
   * and one whose title is the same does not.
   */
  pageKey?: string
  wide?: boolean
  children: ReactNode
}

/**
 * The open book for every door that is not sign-in itself: forgot-password,
 * reset-password, verify-email, no-access, the invite landing and get-started.
 * It is `EndpaperShell` (the same endpaper and ruled leaf as /login and
 * /register) with one H1 in Fraunces, a lede, a `<main>` landmark and the
 * 52px hairline fields of `endpaper.css` (`.mdv-spread`), so the person
 * meets one grammar at every door instead of a card, a plate and a third look.
 */
export function AuthSpread({
  title,
  voice,
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
        {title ? <h1 className="mdv-spread-title">{title}</h1> : null}
        {voice ? <p className="mdv-spread-lede">{voice}</p> : <div style={{ height: 28 }} aria-hidden />}
        {children}
        {footer ? <footer className="mdv-spread-foot">{footer}</footer> : null}
      </main>
    </EndpaperShell>
  )
}

export default AuthSpread
