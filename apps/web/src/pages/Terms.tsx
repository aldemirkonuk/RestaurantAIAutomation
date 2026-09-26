import { PublicShell } from '../components/mudavym/PublicShell'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@mudavym.com'

/**
 * Terms of Service.
 *
 * G9 (census, 2026-09-25): `/terms` is required by ADR 0145's round-6r
 * notice ("A notice in our Terms and on /ask") and by the owner data-terms
 * acceptance work — but no route existed. `Privacy.tsx:21-27` and
 * `ADR 0145:1040-1130` both said so explicitly: no Terms page, no /ask page,
 * so those notice lines had nowhere to land and were folded into `/privacy`
 * instead (its "Questions you ask Mudavym" section, round 6y).
 *
 * OD-132/OD-124 already set the pattern this page follows: the founder's
 * 2026-09-18 ruling on `/privacy`'s own legal-facts gap was "hold as is per
 * now but will be dealt later after the web deployment finishes" — a page
 * that states verified product behaviour, and is explicit with the reader
 * about the legal facts it cannot yet state (entity name, dispute venue,
 * governing law), rather than inventing them. Founder Q11, 2026-09-22:
 * "keep placeholder text for now; lawyer later." This page is that
 * placeholder for the Terms half — clearly labelled as one, not dressed up
 * as a reviewed contract.
 *
 * Once the training notice's other half exists (round 6r wanted it on
 * `/ask` too; `/ask` itself is still unbuilt per G9), it lands there as its
 * own section — nothing here should be read as already covering `/ask`.
 */
export default function Terms() {
  const { user } = useAuth()
  return (
    <PublicShell
      title="Terms of Service"
      measure="document"
      eyebrow="The public record"
      homeHref="/login"
      voice="What using Mudavym means today, stated plainly, ahead of legal review."
      footer={
        <>
          Read the{' '}
          <Link className="mdv-link" to="/privacy">
            privacy notice
          </Link>{' '}
          for what the product stores and what a connection can read.
        </>
      }
    >
      <div className="mdv-pub__prose">
        <section className="mdv-pub__plate" style={{ borderLeft: '3px solid var(--ink-3)' }}>
          <h2>This page is a placeholder</h2>
          <p>
            This text has not been reviewed by a lawyer. It states, as plainly as we
            can, what using Mudavym means today. It is not a final Terms of Service,
            it will change, and nothing here should be read as legal advice in
            either direction. Questions about this page:{' '}
            <a className="mdv-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Using Mudavym</h2>
          <p>
            An account belongs to one person. A restaurant (a &quot;house&quot;) is
            run by the people its owner or manager adds to it, and what each
            person can see or change follows their role in that house. You are
            responsible for what is entered under your account and for keeping
            your sign-in secure.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>What you connect</h2>
          <p>
            Connecting a service such as Google Drive or Microsoft Excel grants
            Mudavym only the permissions that provider's own consent screen
            lists. Disconnecting stops Mudavym using that connection; it does not
            change anything already written on the provider's side. See{' '}
            <Link className="mdv-link" to="/privacy">
              Privacy &amp; data
            </Link>{' '}
            for what each connection can read or change.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Vendor and provider terms</h2>
          <p>
            Where a house records its own terms with a vendor or provider —
            payment terms, delivery windows, contact details — those are the
            house's own record, stated by the house or inferred from what it
            sends and receives. They are not Mudavym's terms with you, and
            Mudavym is not a party to them.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Questions you ask Mudavym</h2>
          <p>
            The same notice as{' '}
            <Link className="mdv-link" to="/privacy">
              Privacy &amp; data
            </Link>
            &apos;s &quot;Questions you ask Mudavym&quot; section applies here: a
            house's owner controls whether that house's questions may be used to
            improve Mudavym, asking and answering work the same either way, and a
            question asked while that choice is off is never used even after it
            is turned back on.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Changes</h2>
          <p>
            This page will change as it is reviewed and as the product changes
            with it. We do not expect to change it silently for anything that
            affects what you have already agreed to.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Contact</h2>
          <p>
            Questions about these terms:{' '}
            <a className="mdv-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .{' '}
            {user ? (
              <>
                Review your account and connections in{' '}
                <Link className="mdv-link" to="/profile">
                  your profile
                </Link>
                .
              </>
            ) : (
              <>
                <Link className="mdv-link" to="/login">
                  Sign in
                </Link>{' '}
                to review your account and connections.
              </>
            )}
          </p>
        </section>
      </div>
    </PublicShell>
  )
}
