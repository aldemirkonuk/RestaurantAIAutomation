import { Link, useLocation } from 'react-router-dom'
import { EndpaperShell } from './EndpaperShell'
import './book-states.css'

/**
 * The 404 for a visitor who is not signed in (and the in-app one's public
 * sibling): a ruled page with its corner torn away, one sentence, one way home.
 * It used to be a silent redirect to the sign-in screen, which told a person
 * who mistyped a link that they had been logged out.
 */
export function BookNotFound() {
  const { pathname } = useLocation()
  return (
    <EndpaperShell kicker="The house" houseLine="Kept, page by page." folio="404">
      <div className="mdv-bs" data-testid="book-not-found">
        <div className="mdv-bs-page">
          <h2 className="mdv-ep-leaf-title">That page isn&rsquo;t in the book.</h2>
          <p className="mdv-ep-leaf-lede">Nothing is written at this address.</p>
          <p className="mdv-bs-path">{pathname}</p>
          <Link to="/" className="mdv-bs-home">
            Back to the front of the book
          </Link>
        </div>
      </div>
    </EndpaperShell>
  )
}

export default BookNotFound
