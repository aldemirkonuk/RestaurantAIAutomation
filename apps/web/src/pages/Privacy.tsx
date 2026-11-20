import { PublicShell } from '../components/mudavym/PublicShell'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@mudavym.com'

/**
 * Privacy notice.
 *
 * Written to match what the code actually does rather than boilerplate: the app
 * sets no cookies, keeps session tokens in localStorage, ships interaction
 * telemetry disabled, defaults partner sharing to off, and sends only a
 * pseudonymous id (never email or name) to error tracking — see
 * lib/error-tracking.ts, which strips PII before every event leaves the browser.
 * If any of those change, this page has to change with them.
 *
 * The "Questions you ask Mudavym" section below is ADR 0145's 2026-09-22
 * (round 6y) founder answer, verbatim: "Add to /privacy now" — a short, plain
 * training notice, in the wording drawn from the same ADR's round-6r notice
 * for the Terms page and /ask (neither page exists yet) and from
 * AskTrainingSection.tsx's Settings copy, updated for what round 6y itself
 * decided: a question asked while a house is opted out is never used for
 * training even after the house opts back in (asked_while_opted_out,
 * migration 20260922220600), and — round 6y's other answer, "Text-free until
 * lawyer" — any export carries no question text at all today, not names
 * removed from text that is exported.
 *
 * [2026-09-28, ADR 0145 round 6z, founder's pick verbatim: "Add a plain line
 * now (Recommended)". Both copies of the section (the plate and the legacy `<Section>`)
 * now say that, to answer it, a question is sent to an AI model provider
 * outside Turkey. The provider is not named: the brief (its words, not his)
 * said to name it only if the repository already names it publicly, and no
 * public page does (the signed-in Studio command bar and the admin panel
 * say "Claude"; neither is public). This is a separate fact from the training
 * notice: the question is sent to be answered whatever the house's training
 * choice is; training only governs a later, optional export.]
 */
export default function Privacy() {
  const { user } = useAuth()
  return (
    <PublicShell
      title="Privacy & data"
      measure="document"
      eyebrow="The public record"
      homeHref="/login"
      voice="What the product stores, what connections permit, and where to review your choices."
      footer={
        user ? (
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
        )
      }
    >
      <div className="mdv-pub__prose">
        <section className="mdv-pub__plate">
          <h2>Your account and browser</h2>
          <p>
            Mudavym stores your account details and the restaurant records you
            enter. Sign-in tokens are kept in browser local storage and
            removed when you sign out. Browser storage also remembers
            interface preferences.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Signing in with a provider</h2>
          <p>
            Signing in with Google identifies your account using your email
            address and name. Mudavym does not receive your Google password.
            Connecting a working service, such as Drive or email, is a
            separate permission.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Connected services</h2>
          <p>
            Each provider presents its requested permissions before you
            connect. These vary: Google Drive uses access to files created or
            selected for the app; Microsoft Excel requests file read and write
            access to your OneDrive. Connected credentials are encrypted when
            stored. Review the specific connection before granting access.
          </p>
          <p>
            Disconnecting stops Mudavym using the saved connection. Review
            your provider account as well to manage provider-side permissions
            and files already created there.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Tools acting for you</h2>
          <p>
            Restaurant connections can expose tools that read or change
            records. Where a connection asks for your consent, review its
            listed tools and permissions first. An owner configuring a
            connection and your consent for it to act in your name are
            separate choices.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Questions you ask Mudavym</h2>
          <p>
            When someone in your house asks Mudavym a question, we keep the
            question, the answer, and how the answer was reached, so it can be
            checked later. To answer it, the question is sent to an AI model
            provider outside Turkey. Your house&apos;s owner can turn training use off
            for the whole house, in Settings → Training use — asking and
            answering keep working the same either way. A question asked while
            training is off is never used for training, even if the owner
            turns it back on afterward. If we ever export questions to improve
            Mudavym, that export carries no question text at all, only facts
            such as which kind of question it was and when it was asked. No
            training has started.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Tracking and advertising</h2>
          <p>
            Mudavym sets no tracking or advertising cookies. We do not sell
            your data, and we do not share it with advertisers. Sharing
            between your own connected services follows the permissions you
            grant for each one and is off by default.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Usage and error reporting</h2>
          <p>
            The deployment controls whether optional interaction telemetry and
            Sentry error monitoring are enabled. Error reports can include
            technical details, page or request information and account or
            restaurant identifiers. The application filters contact details,
            credentials and request values before reporting. The app's own
            code makes no third-party font request: every face it uses is
            served from mudavym.com itself.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Published information</h2>
          <p>
            A vendor catalogue that is published is accessible without signing
            in. Its listings and published contact details can be read by
            visitors and search engines. Check these details before
            publication.
          </p>
        </section>
        <section className="mdv-pub__plate">
          <h2>Your controls</h2>
          <ul>
            <li>
              Review your identity and personal permissions, unlink a sign-in
              provider, or delete your account in{' '}
              <Link className="mdv-link" to="/profile">
                your profile
              </Link>
              .
            </li>
            <li>
              Review services available to your restaurant in{' '}
              <Link className="mdv-link" to="/connections">
                Connections
              </Link>
              . Available controls depend on your role and which features your
              restaurant has enabled.
            </li>
            <li>
              Where an older page is enabled, connection controls remain under{' '}
              <Link className="mdv-link" to="/settings">
                Settings
              </Link>
              .
            </li>
            <li>
              Read the{' '}
              <Link className="mdv-link" to="/terms">
                Terms of Service
              </Link>{' '}
              for what using Mudavym means.
            </li>
            <li>
              Questions about this notice:{' '}
              <a className="mdv-link" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              .
            </li>
          </ul>
        </section>
      </div>
    </PublicShell>
  )
}
