import { Link } from 'react-router-dom'
import { ArrowLeft, Cookie, Database, KeyRound, Share2, LineChart, Bug } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'

/**
 * Privacy notice.
 *
 * Written to match what the code actually does rather than boilerplate: the app
 * sets no cookies, keeps session tokens in localStorage, ships interaction
 * telemetry disabled, defaults partner sharing to off, and sends only a
 * pseudonymous id (never email or name) to error tracking — see
 * lib/error-tracking.ts, which strips PII before every event leaves the browser.
 * If any of those change, this page has to change with them.
 */
export default function Privacy() {
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
            body="Mudavym sets no tracking or advertising cookies. We don't use a cookie-consent banner because there is nothing to consent to. Your sign-in session is kept in your browser's local storage instead of a cookie, and it is cleared when you sign out."
          />

          <Section
            icon={KeyRound}
            title="Signing in with Google"
            body="If you sign in with Google, we receive your email address, name, and profile picture from Google to identify your account. We never receive your Google password, and signing in this way grants no access to your Gmail or Drive."
          />

          <Section
            icon={Database}
            title="Connected integrations"
            body="Connecting Google Drive or Microsoft Excel grants Mudavym permission to write files on your behalf. We request the narrowest scopes that work — access is limited to files Mudavym creates, not your whole drive. The access and refresh tokens are encrypted before being stored, and you can revoke a connection at any time from Settings → Integrations, which also revokes it at the provider."
          />

          <Section
            icon={LineChart}
            title="Product analytics"
            body="Interaction telemetry is off unless your deployment explicitly enables it and you turn on Usage analytics in Settings. When it is on, what leaves the browser is a page name, an event type, an optional element name, and a number — never text you typed, never text the app rendered, and never the contents of your inventory."
          />

          <Section
            icon={Bug}
            title="Error and performance monitoring"
            body="When a deployment configures error tracking (Sentry), crashes and slow requests are reported so we can fix them. What is sent is technical: the error type and stack trace, the page or request involved, browser and app-version details, and two opaque identifiers — your account id and your restaurant id — which mean nothing outside our own database. Your email address and your name are never sent. Reports are scrubbed of contact details, addresses and credentials before they leave the app, and request parameters are reported by name without their values. If no error-tracking key is configured, nothing is sent at all."
          />

          <Section
            icon={Share2}
            title="Sharing with partners"
            body="Data sharing with logistics and POS partners is off by default and stays off until you turn it on and confirm which partner you are connecting. We do not sell your data, and we do not share it with advertisers."
          />
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-900">Your controls</p>
          <ul className="mt-2.5 space-y-1.5 text-sm text-gray-600">
            <li>
              Review permissions and analytics in{' '}
              <Link to="/settings" className="font-medium text-wine-600 hover:text-wine-700">
                Settings → Services &amp; permissions
              </Link>
              .
            </li>
            <li>
              Disconnect integrations in{' '}
              <Link to="/settings" className="font-medium text-wine-600 hover:text-wine-700">
                Settings → Integrations
              </Link>
              .
            </li>
            <li>
              Unlink a sign-in provider or delete your account from{' '}
              <Link to="/profile" className="font-medium text-wine-600 hover:text-wine-700">
                your profile
              </Link>
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
