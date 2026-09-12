/**
 * HelpNext — the Mudavym redesign of `/help`, behind `mudavym_design_help`
 * (ADR 0133, the new-pages wave). Verdict: KEEP — "new one better".
 *
 * A DOCUMENT in the house voice. The shipping page is four cards, a FAQ and
 * two contact links whose defaults mail a domain the project does not own
 * (help.md §9, §12). This page keeps the shape a stuck person needs — one way
 * to reach a person, one way back into the product's own guidance — and adds
 * the question that comes before both: is it me, or the service?
 *
 *   I.   The service — `GET /api/v1/health/ready`, read live, printed with its
 *        latency, its build and the gateway's own database word. Checking,
 *        answered (ready or not) and unreachable are three stated states.
 *   II.  Reach a person — the two build variables, read with no fallback. An
 *        unset one is a sentence ("no support address is configured for this
 *        deployment"), never an address; a configured one opens a mail with
 *        the diagnostics block already in it, and the block can be copied.
 *   III. The house answers — `/ask` ("Mudavym answers here"), drawn as not yet
 *        available unless `mudavym_design_ask` is on for this house; Ask AI,
 *        the bar every page already has, opened from here by its own event;
 *        and the sommelier desk, with only the words that page can honour
 *        today (it answers from a local rulebook — the model is not connected).
 *   IV.  Questions people ask — `hp-faq.ts`, in-place expansion on `settle`,
 *        deep-linkable by `#slug`.
 *   V.   Ways back in — Learn & Help (named, not opened: its state is the
 *        sidebar's own), the app guide, Services & permissions, the profile.
 *
 * No overlay. Nothing on this page is committed, so nothing is sealed.
 * Motions: `MOTIONS.md` beside this file, mirrored in 06-pages/help.md §1b.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Wordmark } from '@/components/mudavym';
import { ink, settle } from '@/lib/mudavym/motion';
import { trackGuidance } from '@/guidance/analytics';
import { MONO, SANS, SERIF, ensureFraunces, fmtClock, fmtLatency, fmtSince, shortCommit } from './hp-format';
import { FAQ_ENTRIES, findFaq } from './hp-faq';
import { databaseWord, serviceNextStep, serviceSentence } from './hp-service';
import { useHelpNextData, type CopyOutcome } from './useHelpNextData';

const PAGE_CSS = `
.mudavym .hp-ink { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing} }
.mudavym .hp-focus:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; border-radius: 8px }
.mudavym .hp-link { color: var(--seal-deep); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px }
.mudavym .hp-link:hover { color: var(--seal) }
.mudavym .hp-btn { font: 500 13px/1 ${SANS}; color: var(--ink-1); background: transparent; border: 1px solid var(--ink-3); border-radius: 8px; padding: 8px 12px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px }
.mudavym .hp-btn:hover { background: var(--paper-1); border-color: var(--ink-2) }
.mudavym .hp-btn:disabled { color: var(--ink-3); cursor: default; background: transparent; border-color: var(--paper-2) }
.mudavym .hp-btn--seal { color: var(--seal-deep); border-color: var(--seal-ring) }
.mudavym .hp-btn--seal:hover { background: var(--seal-tint); border-color: var(--seal) }
.mudavym .hp-card { border: 1px solid var(--paper-2); border-radius: 12px; padding: 16px 18px; background: var(--paper-0) }
.mudavym .hp-row { border-top: 1px solid var(--paper-2); padding: 14px 0 }
.mudavym .hp-row:last-child { border-bottom: 1px solid var(--paper-2) }
.mudavym .hp-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${settle.ms}ms ${settle.easing} }
.mudavym .hp-fold[data-open="true"] { grid-template-rows: 1fr }
.mudavym .hp-fold > div { overflow: hidden; min-height: 0 }
.mudavym .hp-chev { transition: transform ${settle.ms}ms ${settle.easing}; color: var(--ink-3) }
.mudavym .hp-chev[data-open="true"] { transform: rotate(180deg) }
.mudavym .hp-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; background: none; border: 0; padding: 13px 0; cursor: pointer; color: var(--ink-1); font: 500 14.5px/1.4 ${SANS} }
.mudavym .hp-faq-q:hover { color: var(--seal-deep) }
.mudavym .hp-grid2 { display: grid; gap: 12px; grid-template-columns: 1fr }
@media (min-width: 640px) { .mudavym .hp-grid2 { grid-template-columns: 1fr 1fr } }
@media (prefers-reduced-motion: reduce) {
  .mudavym .hp-ink, .mudavym .hp-fold, .mudavym .hp-chev { transition: none !important }
}
`;

export interface HelpNextProps {
  /** Force a ground regardless of app theme (ADR 0042). */
  ground?: 'paper' | 'charcoal';
}

/* ── small kit ─────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: 0 }}>
      {children}
    </p>
  );
}

function Section({ n, id, title, children }: { n: string; id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} style={{ marginTop: 34 }}>
      <Eyebrow>{n}</Eyebrow>
      <h2 id={`${id}-h`} style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.15, margin: '4px 0 12px' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Mono({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 12, color: dim ? 'var(--ink-3)' : 'var(--ink-2)' }}>{children}</span>
  );
}

function Prose({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: muted ? 'var(--ink-3)' : 'var(--ink-2)', margin: '6px 0 0' }}>
      {children}
    </p>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export default function HelpNext({ ground }: HelpNextProps) {
  const data = useHelpNextData();
  const location = useLocation();
  const navigate = useNavigate();
  const { service, support } = data;

  useEffect(() => { ensureFraunces(); }, []);

  // A hash is a deep link into the FAQ: `/help#invite-team` opens that entry.
  const [openSlug, setOpenSlug] = useState<string | null>(() => findFaq(location.hash)?.slug ?? null);
  useEffect(() => {
    const e = findFaq(location.hash);
    if (!e) return;
    setOpenSlug(e.slug);
    document.getElementById(`hp-faq-${e.slug}`)?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const [showBlock, setShowBlock] = useState(false);
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const copy = useCallback(async () => {
    setCopied(await data.copyDiagnostics());
  }, [data]);

  const answered = service.kind === 'answered';

  return (
    <div
      className="mudavym"
      data-ground={ground}
      style={{ minHeight: '100vh', background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}
    >
      <style>{PAGE_CSS}</style>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '26px 18px 72px' }}>
        {/* ── The opening ───────────────────────────────────────────── */}
        <header>
          <Wordmark size={13} />
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '6px 0 0' }}>
            Help &amp; Support · {data.house.name ?? 'this house'}
          </p>
          <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
            When something is wrong, start here<span style={{ color: 'var(--seal)' }}>.</span>
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '8px 0 0', maxWidth: 640 }}>
            A straight answer on whether the service is up, one way to reach a person, and one way back into
            the product’s own guidance.
          </p>
        </header>

        <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.5, margin: '16px 0 4px' }} />

        {/* ── I. The service ────────────────────────────────────────── */}
        <Section n="I · The service" id="hp-service" title="Is the service up?">
          <p role="status" aria-live="polite" style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.4, color: 'var(--ink-1)', margin: 0 }}>
            {serviceSentence(service)}
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
            {service.kind === 'checking' && <Mono dim>one request in flight</Mono>}
            {service.kind === 'unreachable' && (
              <>
                <Mono>client said: {service.error}</Mono>
                <Mono dim>gave up after {fmtLatency(service.latencyMs)}</Mono>
              </>
            )}
            {answered && (
              <>
                <Mono>answered {service.httpStatus} in {fmtLatency(service.latencyMs)}</Mono>
                <Mono>database {databaseWord(service)}</Mono>
                <Mono>build {shortCommit(service.commit)}</Mono>
                <Mono>{fmtSince(service.bootedAt, service.readAt)}</Mono>
                {!service.ready && service.reason && <Mono>reason: {service.reason}</Mono>}
                {!service.ready && !service.reason && service.supabaseClient && (
                  <Mono>client {service.supabaseClient}</Mono>
                )}
              </>
            )}
          </div>
          <Prose>{serviceNextStep(service)}</Prose>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="hp-btn hp-ink hp-focus" onClick={data.recheck} disabled={service.kind === 'checking'}>
              {service.kind === 'checking' ? 'Checking' : 'Check again'}
            </button>
            {service.kind !== 'checking' && <Mono dim>read at {fmtClock(service.readAt)} by this page</Mono>}
          </div>
          <p style={{ margin: '12px 0 0' }}>
            <Mono dim>GET /api/v1/health/ready · public route · the gateway memoises its own answer for 5 s</Mono>
          </p>
        </Section>

        {/* ── II. Reach a person ────────────────────────────────────── */}
        <Section n="II · A person" id="hp-contact" title="Reach a person">
          <div className="hp-grid2">
            <div className="hp-card">
              <Eyebrow>Email</Eyebrow>
              {support.email.state === 'configured' && (
                <>
                  <p style={{ fontFamily: MONO, fontSize: 14, margin: '8px 0 0', wordBreak: 'break-all', color: 'var(--ink-1)' }}>
                    {support.email.address}
                  </p>
                  <Prose>Opens a message with the block below already in it, so the first reply is not a request for it.</Prose>
                  <div style={{ marginTop: 12 }}>
                    <a className="hp-btn hp-btn--seal hp-ink hp-focus" href={data.mailto ?? `mailto:${support.email.address}`}>
                      Write to support
                    </a>
                  </div>
                </>
              )}
              {support.email.state === 'unconfigured' && (
                <>
                  <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4, margin: '8px 0 0' }}>
                    No support address is configured for this deployment.
                  </p>
                  <Prose muted>Nothing is mailed to a default. The address is set when the app is built.</Prose>
                  <p style={{ margin: '8px 0 0' }}><Mono dim>VITE_SUPPORT_EMAIL — unset at build time</Mono></p>
                </>
              )}
              {support.email.state === 'unusable' && (
                <>
                  <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4, margin: '8px 0 0' }}>
                    The configured address cannot be used: {support.email.why}.
                  </p>
                  <p style={{ margin: '8px 0 0', wordBreak: 'break-all' }}><Mono dim>VITE_SUPPORT_EMAIL = {support.email.raw}</Mono></p>
                </>
              )}
            </div>

            <div className="hp-card">
              <Eyebrow>Slack</Eyebrow>
              {support.slack.state === 'configured' && (
                <>
                  <p style={{ fontFamily: MONO, fontSize: 14, margin: '8px 0 0', wordBreak: 'break-all', color: 'var(--ink-1)' }}>
                    {support.slack.host}
                  </p>
                  <Prose>The Mudavym support channel. Paste the block below into your first message.</Prose>
                  <div style={{ marginTop: 12 }}>
                    <a className="hp-btn hp-btn--seal hp-ink hp-focus" href={support.slack.url} target="_blank" rel="noopener noreferrer">
                      Open the channel
                    </a>
                  </div>
                </>
              )}
              {support.slack.state === 'unconfigured' && (
                <>
                  <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4, margin: '8px 0 0' }}>
                    No support channel is configured for this deployment.
                  </p>
                  <Prose muted>No link is drawn to a default workspace.</Prose>
                  <p style={{ margin: '8px 0 0' }}><Mono dim>VITE_SUPPORT_SLACK_URL — unset at build time</Mono></p>
                </>
              )}
              {support.slack.state === 'unusable' && (
                <>
                  <p style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.4, margin: '8px 0 0' }}>
                    The configured channel link cannot be used: {support.slack.why}.
                  </p>
                  <p style={{ margin: '8px 0 0', wordBreak: 'break-all' }}><Mono dim>VITE_SUPPORT_SLACK_URL = {support.slack.raw}</Mono></p>
                </>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="hp-faq-q hp-ink hp-focus"
              aria-expanded={showBlock}
              aria-controls="hp-block"
              onClick={() => setShowBlock((v) => !v)}
              style={{ padding: '10px 0' }}
            >
              <span>What support will need</span>
              <ChevronDown size={16} className="hp-chev" data-open={showBlock} aria-hidden />
            </button>
            <div id="hp-block" className="hp-fold" data-open={showBlock} aria-hidden={!showBlock}>
              <div>
                <pre style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', background: 'var(--paper-1)', border: '1px solid var(--paper-2)', borderRadius: 10, padding: '12px 14px', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {data.diagnostics}
                </pre>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button type="button" className="hp-btn hp-ink hp-focus" onClick={() => void copy()}>
                    Copy the block
                  </button>
                  {copied === 'copied' && <Mono>Copied.</Mono>}
                  {copied === 'unavailable' && <Mono>This browser gives no clipboard here — select the text and copy it.</Mono>}
                  {copied === 'failed' && <Mono>The browser refused the copy — select the text and copy it.</Mono>}
                </div>
                <Prose muted>
                  Nothing in the block leaves this page until you send it. Absences are written as “not recorded”.
                </Prose>
              </div>
            </div>
          </div>
          <p style={{ margin: '12px 0 0' }}>
            <Mono dim>both addresses are read once, when the app is built — changing them is a redeploy, not a setting</Mono>
          </p>
        </Section>

        {/* ── III. The house answers ────────────────────────────────── */}
        <Section n="III · The house" id="hp-answers" title="The house answers">
          <div className="hp-row" style={{ borderTop: '1px solid var(--paper-2)' }}>
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>Mudavym answers here.</p>
            {data.askOn ? (
              <>
                <Prose>A page of its own, with the conversation kept and the seal on anything written.</Prose>
                <div style={{ marginTop: 10 }}>
                  <Link className="hp-btn hp-btn--seal hp-ink hp-focus" to="/ask">Open</Link>
                </div>
              </>
            ) : (
              <>
                <Prose muted>Not yet available for this house.</Prose>
                <p style={{ margin: '6px 0 0' }}><Mono dim>/ask · mudavym_design_ask is off here</Mono></p>
              </>
            )}
          </div>
          <div className="hp-row">
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>Ask AI, on any page.</p>
            <Prose>
              Ask for something in words; what comes back is a proposal you confirm, never an act taken for you.
              A refusal always says why.
            </Prose>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="hp-btn hp-btn--seal hp-ink hp-focus" onClick={() => data.openAskAi()}>
                Open Ask AI
              </button>
              <Mono dim>or press ⌘⇧K</Mono>
            </div>
          </div>
          <div className="hp-row">
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>The sommelier desk.</p>
            <Prose>
              Pairings, pricing, reorders and floor coaching, in three voices. Today it answers from a local
              rulebook: the model behind it is not connected yet, so treat what it says as a starting point.
            </Prose>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hp-btn hp-ink hp-focus"
                onClick={() => {
                  trackGuidance('wine_agent_fab_clicked', { source: 'help' });
                  navigate('/sommelier');
                }}
              >
                Open the sommelier desk
              </button>
            </div>
          </div>
        </Section>

        {/* ── IV. Questions ─────────────────────────────────────────── */}
        <Section n="IV · Questions" id="hp-faq" title="Questions people ask">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--paper-2)' }}>
            {FAQ_ENTRIES.map((e) => {
              const open = openSlug === e.slug;
              return (
                <li key={e.slug} id={`hp-faq-${e.slug}`} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                  <button
                    type="button"
                    className="hp-faq-q hp-ink hp-focus"
                    aria-expanded={open}
                    aria-controls={`hp-faq-${e.slug}-a`}
                    onClick={() => setOpenSlug(open ? null : e.slug)}
                  >
                    <span>{e.question}</span>
                    <ChevronDown size={16} className="hp-chev" data-open={open} aria-hidden />
                  </button>
                  <div id={`hp-faq-${e.slug}-a`} className="hp-fold" data-open={open} aria-hidden={!open}>
                    <div>
                      <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '0 0 13px', maxWidth: 680 }}>
                        {e.answer}
                        {e.goes && (
                          <>
                            {' '}
                            <Link className="hp-link hp-ink" to={e.goes.to}>{e.goes.label}</Link>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: '10px 0 0' }}>
            <Mono dim>each answer links straight to /help#its-slug</Mono>
          </p>
        </Section>

        {/* ── V. Ways back in ───────────────────────────────────────── */}
        <Section n="V · Ways back in" id="hp-back" title="Ways back in">
          <div className="hp-row" style={{ borderTop: '1px solid var(--paper-2)' }}>
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>Learn &amp; Help.</p>
            <Prose>
              At the bottom of the sidebar. Replay any page’s tour, or bring back the tips you dismissed. It opens
              from the sidebar only; this page names it rather than pretending to a switch it does not hold.
            </Prose>
          </div>
          <div className="hp-row">
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>The app guide.</p>
            <Prose>Activate the wine list, then walk through inventory, orders and the rest in order.</Prose>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hp-btn hp-ink hp-focus"
                onClick={() => {
                  trackGuidance('guide_card_clicked', { cardId: 'help-get-started' });
                  navigate('/get-started?tab=use');
                }}
              >
                Open the app guide
              </button>
            </div>
          </div>
          <div className="hp-row">
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>Services &amp; permissions.</p>
            <Prose>Email, web and privacy access, in Settings. Separate from the tours.</Prose>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hp-btn hp-ink hp-focus"
                onClick={() => {
                  trackGuidance('services_visited', { source: 'help' });
                  navigate('/settings?tab=services');
                }}
              >
                Manage services
              </button>
            </div>
          </div>
          <div className="hp-row">
            <p style={{ fontFamily: SERIF, fontSize: 17, margin: 0 }}>Your profile.</p>
            <Prose>Password, connected sign-ins and what may act as you. Yours, not the restaurant’s.</Prose>
            <div style={{ marginTop: 10 }}>
              <Link className="hp-btn hp-ink hp-focus" to="/profile">Open your profile</Link>
            </div>
          </div>
        </Section>

        <footer style={{ marginTop: 34 }}>
          <Prose muted>Prefer no tips? Dismiss them once; Learn &amp; Help brings them back.</Prose>
          <p style={{ margin: '10px 0 0' }}>
            <Mono dim>
              this page reads one route, GET /api/v1/health/ready, and two build variables, VITE_SUPPORT_EMAIL and
              VITE_SUPPORT_SLACK_URL · nothing on it is stored
            </Mono>
          </p>
        </footer>
      </div>
    </div>
  );
}
