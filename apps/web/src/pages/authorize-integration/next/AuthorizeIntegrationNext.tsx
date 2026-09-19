import { useParams, useSearchParams } from 'react-router-dom'
import { AuthorizeShell } from '../AuthorizeShell'
import { HoldToApprove } from '../../../components/mudavym/HoldToApprove'
import type { StatuteCitation } from '../../../services/api/integrations'
import { useIntegrationConsent } from '../useIntegrationConsent'
import { sameSiteReturnPath } from '../consent-browser'
import './consent.css'

function Citations({ values }: { values: StatuteCitation[] }) {
  return <ul className="mdv-consent-citations">{values.map(value => <li key={`${value.statute}:${value.url}`}>
    <a href={value.url} target="_blank" rel="noopener noreferrer">{value.statute}</a>
    <p>{value.says}</p><small>Read {value.fetchedOn}</small>
  </li>)}</ul>
}

export default function AuthorizeIntegrationNext() {
  const { integrationId } = useParams<{ integrationId: string }>()
  const [search] = useSearchParams()
  const returnPath = sameSiteReturnPath(search.get('returnPath'))
  const consent = useIntegrationConsent(integrationId, returnPath)
  const doc = consent.disclosure
  const entry = doc?.integration
  const retention = doc?.retention
  // A single exit: the Cancel button below already returns to `returnPath`
  // (and disables itself mid-redirect); a second footer link doing the same
  // thing was a duplicate exit (KL audit J12). `homeHref` stays -- it is the
  // shell's own "leave the flow entirely" affordance, not this page's.
  //
  // `chrome="ambient"`: `PageGate` (App.tsx) already wraps this component in
  // a `HouseHeader` whenever it is mounted at all -- see AuthorizeShell.tsx.
  return <AuthorizeShell chrome="ambient" title={entry ? `Connect ${entry.label}` : 'Permission to connect'}
    eyebrow="A personal permission" voice={doc?.statements.personalAccount} measure="document"
    homeHref="/profile">
    <div className="mdv-consent">
      {consent.error ? <div role="alert" className="mdv-alert"><p>{consent.error}</p><button className="mdv-btn" onClick={consent.reload}>Read again</button></div>
        : !doc ? <p role="status">Reading the permission and this house’s retention facts…</p>
        : <>
          <p className="mdv-consent-intro">{doc.integration.description}</p>
          {!doc.integration.available ? <p className="mdv-alert" role="status">{doc.integration.unavailableReason ?? 'This integration is unavailable on this deployment.'}</p> : <>
            <section><h2>What this permission allows</h2><ol className="mdv-consent-scopes">
              {doc.integration.scopes.map((scope, index) => <li key={scope.scope}>
                <span className="mdv-consent-number">{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{scope.label}</h3><p>{scope.reason}</p><code>{scope.scope}</code></div>
              </li>)}
            </ol></section>
            <section><h2>What is not requested</h2><ul>{doc.integration.notRequested.map(value => <li key={value}>{value}</li>)}</ul></section>
            <section><h2>Where it goes</h2><dl className="mdv-consent-facts">
              {([
                ['What we read', doc.integration.dataHandling?.reads],
                ['What we never read', doc.integration.dataHandling?.doesNotRead],
                ['Where it lands', doc.integration.dataHandling?.landsIn],
                ['Who can see it', doc.integration.dataHandling?.visibleTo],
                ['How long it stays', doc.integration.dataHandling?.keptFor],
              ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'The deployment did not supply this disclosure.'}</dd></div>)}
            </dl></section>
            {doc.integration.mirrorsMail && <section><h2>The house’s copy of the mail</h2>
              {!retention ? <p role="alert">The retention facts are unavailable. This permission cannot be approved yet.</p> : <>
                <p>{retention.split}</p>
                <div className="mdv-consent-window"><strong>{retention.figureDays}</strong><span>days for the mail itself</span></div>
                <p>{retention.windowIntro}</p><p>{retention.basis}</p>
                <p className="mdv-note">{doc.statements.retentionCadence}</p>
                {retention.storedAt && <p className="mdv-note">Stored derivation: {retention.storedAt}</p>}
                <h3>The order’s facts</h3><p>{retention.jurisdiction.factsFloorYears} years · {retention.jurisdiction.label}</p>
                <p>{retention.jurisdiction.why}</p>
                {retention.jurisdiction.defaultedBecause && <p className="mdv-alert">{retention.jurisdiction.defaultedBecause}</p>}
                <Citations values={retention.jurisdiction.citations} />
                <Citations values={retention.storageLimitation} />
                <h3>If you disconnect</h3><p>{retention.revocation}</p>
                <h3>Keeping your own copy</h3>
                {!retention.archive ? <p className="mdv-alert">The archive choice could not be described.</p> : <>
                  <p>{retention.archive.intro}</p>
                  <ul>{Object.values(retention.archive.options).map(value => <li key={value}>{value}</li>)}</ul>
                  <p>{retention.archive.says}</p>
                  {retention.archive.unavailableBecause && <p className="mdv-alert">{retention.archive.unavailableBecause}</p>}
                  {retention.archive.paidTierRefusal && <p>{retention.archive.paidTierRefusal}</p>}
                  {retention.archive.jurisdictionNote && <p>{retention.archive.jurisdictionNote}</p>}
                </>}
              </>}
            </section>}
            <section className="mdv-consent-seal">
              <p>{doc.statements.providerNext} {doc.statements.tokenStorage} {doc.statements.revocation}</p>
              <a className="mdv-link" href="/privacy">Privacy notice</a>
              {consent.actionError && <div className="mdv-alert" role="alert"><p>{consent.actionError}</p><button className="mdv-btn" onClick={consent.reload}>Read current permission</button></div>}
              <HoldToApprove key={`${doc.integration.id}:${doc.digest}`} onChallenge={consent.challenge} onApprove={consent.approve}
                disabled={consent.redirecting || (doc.integration.mirrorsMail === true && !retention)}
                label={`Hold to continue to ${doc.integration.providerLabel}`} approvedLabel={`Opening ${doc.integration.providerLabel}`}
                boundSummary={`Permission for ${doc.integration.label}, with the words and retention facts shown above.`} />
              <button className="mdv-btn" disabled={consent.redirecting} onClick={() => window.location.assign(returnPath)}>Cancel</button>
            </section>
          </>}
        </>}
    </div>
  </AuthorizeShell>
}
