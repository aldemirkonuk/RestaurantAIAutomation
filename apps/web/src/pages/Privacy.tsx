import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { Link } from 'react-router-dom'
import { ArrowLeft, Cookie, Database, KeyRound, MessageSquare, Share2, LineChart, Bug } from 'lucide-react'

import { BrandMark } from '../components/brand/BrandMark'
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

 */
export default function Privacy() {
  const publicDesign = usePublicDesign()
  const { user } = useAuth()
  if (publicDesign) {
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
              checked later. Your house&apos;s owner can turn training use off
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

  return (
    <div className="min-h-screen bg-[#FAF7F5] px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size={26} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
            Privacy &amp; data
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            What Mudavym stores, what leaves your browser, and what you control.
          </p>
        </div>

        <div className="space-y-4">
          <Section
            icon={Cookie}
            title="Cookies"
            body="Mudavym keeps sign-in tokens and interface preferences in browser local storage. Signing out removes your sign-in tokens. Connected services may have their own browser storage and privacy choices."
          />

          <Section
            icon={KeyRound}
            title="Signing in with Google"
            body="If you sign in with Google, we receive your email address and name from Google to identify your account. We never receive your Google password, and signing in this way grants no access to your Gmail or Drive."
          />

          <Section
            icon={Database}
            title="Connected integrations"
            body="Providers show their requested permissions before you connect. Google Drive uses access to files created or selected for the app; Microsoft Excel requests file read and write access to your OneDrive. Connected credentials are encrypted when stored. Disconnecting stops Mudavym using the saved connection; review your provider account to manage provider-side permissions and files already created there."
          />

          <Section
            icon={MessageSquare}
            title="Questions you ask Mudavym"
            body="When someone in your house asks Mudavym a question, we keep the question, the answer, and how the answer was reached, so it can be checked later. Your house's owner can turn training use off for the whole house, in Settings → Training use — asking and answering keep working the same either way. A question asked while training is off is never used for training, even if the owner turns it back on afterward. If we ever export questions to improve Mudavym, that export carries no question text at all, only facts such as which kind of question it was and when it was asked. No training has started."
          />

          <Section
            icon={LineChart}
            title="Product analytics"
            body="The deployment controls whether optional interaction telemetry is enabled. Personal connection consents and restaurant service settings serve different purposes; review the permissions listed for each connection. The app's own code makes no third-party font request: every face it uses is served from mudavym.com itself."
          />

          <Section
            icon={Bug}
            title="Error and performance monitoring"
            body="When the deployment enables Sentry, error and performance reports can include technical details, page or request information, browser and app-version details, and account or restaurant identifiers. The application filters contact details, credentials and request values before reporting."
          />

          <Section
            icon={Cookie}
            title="Tracking and advertising"
            body="Mudavym sets no tracking or advertising cookies. We do not sell your data, and we do not share it with advertisers."
          />

          <Section
            icon={Share2}
            title="Sharing with partners"
            body="Connected services can exchange restaurant records according to their requested permissions, and that sharing is off by default. A published vendor catalogue is accessible without signing in: its listings and published contact details can be read by visitors and search engines. Review the details before publication."
          />
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-900">Your controls</p>
          <ul className="mt-2.5 space-y-1.5 text-sm text-gray-600">
            <li>
              Review permissions and analytics in{' '}
              <Link
                to="/settings"
                className="font-medium text-wine-600 hover:text-wine-700"
              >
                Settings → Services &amp; permissions
              </Link>
              .
            </li>
            <li>
              Disconnect integrations in{' '}
              <Link
                to="/settings"
                className="font-medium text-wine-600 hover:text-wine-700"
              >
                Settings → Integrations
              </Link>
              .
            </li>
            <li>
              Unlink a sign-in provider or delete your account from{' '}
              <Link
                to="/profile"
                className="font-medium text-wine-600 hover:text-wine-700"
              >
                your profile
              </Link>
              .
            </li>
            <li>
              Questions about this notice:{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-wine-600 hover:text-wine-700"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </li>
          </ul>
        </div>

        <p className="mt-8 text-center">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to settings
          </Link>
        </p>
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType
  title: string
  body: string
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wine-50">
          <Icon className="h-4 w-4 text-wine-600" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">{body}</p>
        </div>
      </div>
    </section>
  )
}
