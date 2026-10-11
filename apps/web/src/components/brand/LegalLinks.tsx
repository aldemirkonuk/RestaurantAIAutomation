import { Link } from 'react-router-dom'

/**
 * The privacy notice and the terms, one line under /login and /register
 * (F-1252). Those two pages are where a stranger hands over an address, and
 * before this every link to /privacy sat on a signed-in page.
 *
 * `house` follows the same switch as the page (`usePublicDesign()`): token
 * colours on the house path, today's palette off it.
 */
export function LegalLinks({ house = false }: { house?: boolean }) {
  const link = house
    ? 'underline text-seal hover:text-seal-deep'
    : 'underline text-gray-500 hover:text-gray-700'
  return (
    <nav
      aria-label="Privacy and terms"
      className={house ? 'mt-6 text-center text-xs !text-inkm-3' : 'mt-6 text-center text-xs text-gray-400'}
    >
      <Link to="/privacy" className={link}>
        Privacy &amp; data
      </Link>
      {' · '}
      <Link to="/terms" className={link}>
        Terms
      </Link>
    </nav>
  )
}
