import { PublicShell } from '../../components/mudavym/PublicShell'

/**
 * /notes/gmail-session: a short, dated summary of the Gmail and house-mail
 * handoff, public on purpose and unlisted (ADR 0356).
 *
 * The route is deliberately absent from PUBLIC_ROUTES (lib/seo/routes.ts), so
 * the shell serves it the closed head (`noindex, nofollow`), robots.txt
 * disallows it and the sitemap omits it (ADR 0158). Anyone holding the URL can
 * read it; nobody finds it by search.
 *
 * This page is a stub on purpose: the full brief is not published. It names no
 * decision ids, pull requests, branches or source paths.
 */
export default function GmailSession() {
  return (
    <PublicShell
      title="Gmail session prompt"
      measure="document"
      eyebrow="Working note"
      homeHref="/login"
      voice="A short summary of the house-mail handoff, as of 2026-11-01."
    >
      <div className="mdv-pub__prose">
        <section className="mdv-pub__plate">
          <p>
            <strong>
              A point-in-time note from 2026-11-01. It is not current policy: CLAUDE.md and the ADRs
              govern, and the facts below may have changed.
            </strong>
          </p>
          <p>
            This is the short version of the brief for taking over the Gmail and house-mail work.
            The full brief is kept private.
          </p>
        </section>

        <section className="mdv-pub__plate">
          <h2>Two jobs</h2>
          <ol>
            <li>Finish an open fix for how inbound vendor mail is filed to a house.</li>
            <li>
              Bring the Letter Bench v4 design into /communications as the new mail terminal,
              mapping every control to a real endpoint before any code is written.
            </li>
          </ol>
          <p>Each job gets its own branch and its own pull request. The first is finished before the second starts.</p>
        </section>
      </div>
    </PublicShell>
  )
}
