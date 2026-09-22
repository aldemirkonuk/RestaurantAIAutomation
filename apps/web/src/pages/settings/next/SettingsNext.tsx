/**
 * SettingsNext — the Mudavym redesign of `/settings`, behind
 * `mudavym_design_settings` (ADR 0044 p4 wave).
 *
 * The founder's verdict, verbatim: *"I kind of like the Editorial. I think
 * that's the best way to go — or Federation, it doesn't matter. But I feel
 * like there should be more."* — KEEP (Editorial) · needs more.
 *
 * EDITORIAL, kept: a contents page and a register. Fraunces speaks the opening
 * and each register's name; the double rule under the heading is the account
 * ruled off.
 *
 * "MORE", and what it is NOT: not more toggles. Every setting is rendered as a
 * RECORD — what it changes said as a consequence rather than a feature name,
 * WHERE the value is kept (this restaurant · your account · this browser), and
 * WHEN it was last written, or an em dash naming why no date exists.
 *
 * Honesty (ADR 0020): a setting the product stores but never reads renders
 * WITHOUT a control, showing its stored value and the file that was grepped.
 * A read that fails says which register could not be read; a 403 says it was
 * refused. Neither ever renders as an empty list.
 *
 * SECOND PASS, 2026-09-03 — WHAT AN EM DASH COSTS WHEN IT IS WRONG
 * ----------------------------------------------------------------
 * The audit of the first pass found five false claims, all of one species: the
 * page asserting an absence it had not checked. The lesson is symmetric and is
 * now built into the page: a claim of absence is a claim, and it carries the
 * same burden of proof as a number.
 *
 * THIRD PASS, 2026-09-17 — SKETCH 109A: THE INTERVIEW
 * ----------------------------------------------------
 * The founder's review (ADR 0160): *"A with two grafts (Recommended)"* — C's
 * *read by* line under every answer, and B's day sheet as the editor for
 * opening hours. Direction A replaces "one register open at a time, sixteen
 * numbered tabs in five groups" with ONE continuously scrolling page: every
 * register on screen together, organised into the interview's fixed I–VII
 * order (`INTERVIEW_GROUPS`, `st-format.ts`) rather than the old five intent
 * groups. `?tab=` bookmarks still work — a recognised id scrolls the reader to
 * that register's own heading on first paint (`TAB_TO_ANCHOR` says which
 * group it lives in; each register keeps its own `id="st-section-<id>"` so the
 * landing is precise, not just "somewhere in the right group") — but the URL
 * is never rewritten by scrolling or by reading, because there is no more
 * "open register" for it to name.
 *
 * Two things sketch 109A drew that this pass did NOT build as drawn, named
 * rather than silently dropped (see settings.md §13.39 for the exact asks):
 *  - the certainty tally strip AS SKETCHED — counting an assistant-proposal
 *    system (ADR 0113) that has no endpoint for arbitrary settings fields
 *    yet, across every setting on the page. [Corrected 2026-09-19: the
 *    founder settled the ship-partial-vs-hold fork this left open ("Lane
 *    answers batch 2", ~09:30Z, `founder-sketch-decisions-106-115.md:132`):
 *    "ship the counted sentence now (from data, labelled 'computed here')".
 *    That interim IS built — `certaintyTallyLine`, below — over the nine rows
 *    this pass could carry a `cert` stamp to, said honestly as
 *    "certainty-stamped settings" rather than "settings", so the partial
 *    count is never dressed as a total. The "Waiting on you" rail stays held:
 *    it has no design of its own yet, and the founder's answer defers it
 *    ("… 'Waiting on you' rail later"), so building one now would be new,
 *    undesigned UI, not a fix.]
 *  - splitting Notifications' rows across IV ("the mapping") and VI ("your
 *    doors") per the sketch's own footer — the "mapping" half has no real
 *    vocabulary in this worktree yet (a different lane owns it), so the whole
 *    register stays under VI rather than half-rendering content that is not
 *    real.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { Wordmark } from '@/components/mudavym';
import { animate, ink, prefersReducedMotion, settle } from '@/lib/mudavym';
import { useMudavymDesign } from '@/lib/mudavym/useMudavymDesign';
import { SERIF } from './fonts';
import {
  CONNECTIONS_ANCHOR, INTERVIEW_GROUPS, KEPT_NOTE, MONO, SANS, SERIF,
  TAB_TO_ANCHOR, isCollapsedSection, isSectionId, keptTally, sectionsFor,
  word, type SectionId, type SectionSpec,
} from './st-format';
import { useSettingsNextData, type SettingsNextData } from './useSettingsNextData';
import { certaintyTallyLine } from './certaintyTally';
import { TeamSection } from './TeamSection';
import { ServicesSection } from './ServicesSection';
import { EmailSection } from './EmailSection';
import NotifySection from './NotifySection';
import { LocationsSection } from './LocationsSection';
import { MeasurementSection } from './MeasurementSection';
import { MapSection } from './MapSection';
import FeaturesSection from './FeaturesSection';
import { PosSection } from './PosSection';
import { CalendarSection } from './CalendarSection';
import { CellarSection } from './CellarSection';
import { VendorTermsSection } from './VendorTermsSection';
import { ThresholdsSection } from './ThresholdsSection';
import { LedgerSection } from './LedgerSection';
import { CurrencySection } from './CurrencySection';
import { CarryingCostSection } from './CarryingCostSection';
import { HoursSection } from './HoursSection';
import { DigestRow } from './DigestRow';

const CSS = `
.st-ink, .st-ink * { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}, transform ${ink.ms}ms ${ink.easing} }
.st-focus:focus-visible, .st-tab:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; border-radius: 8px }
.st-tab:hover { background: var(--paper-1); color: var(--ink-1) }
.st-disc { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${320}ms cubic-bezier(0.16, 1, 0.3, 1) }
.st-disc[data-open="true"] { grid-template-rows: 1fr }
.st-chev { transition: transform ${ink.ms}ms ${ink.easing} }
@media (prefers-reduced-motion: reduce) {
  .st-ink, .st-ink *, .st-disc, .st-chev { transition: none !important }
}
`;

/** "Fourteen" — a count word at the head of a sentence. */
function capitalise(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * The one place the sixteen registers meet their component. A `switch` rather
 * than a lookup table because two of the sixteen (`measurement`, `cellar`)
 * take no `data` prop — they read their own hook — and a uniform map would
 * either lie about that or force a prop neither wants.
 */
function renderRegister(id: SectionId, data: SettingsNextData) {
  switch (id) {
    case 'team': return <TeamSection data={data} />;
    case 'services': return <ServicesSection data={data} />;
    case 'email': return <EmailSection data={data} />;
    case 'notifications': return <NotifySection data={data} />;
    case 'locations': return <LocationsSection data={data} />;
    case 'measurement': return <MeasurementSection />;
    case 'map': return <MapSection data={data} />;
    case 'features': return <FeaturesSection data={data} />;
    case 'pos': return <PosSection data={data} />;
    case 'calendar': return <CalendarSection data={data} />;
    case 'cellar': return <CellarSection />;
    case 'vendor-terms': return <VendorTermsSection data={data} />;
    case 'thresholds': return <ThresholdsSection data={data} />;
    case 'ledger': return <LedgerSection data={data} />;
    case 'currency': return <CurrencySection data={data} />;
    case 'carrying-cost': return <CarryingCostSection data={data} />;
    default: return null;
  }
}

export interface SettingsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function SettingsNext({ ground }: SettingsNextProps) {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  /**
   * THE COLLAPSE (founder, 2026-09-04): "Move the registers and collapse the
   * four tabs." Four registers — Services, POS, Email, Calendar — become one
   * line pointing at `/connections`, but ONLY while that route exists.
   */
  const connectionsOn = useMudavymDesign('connections');
  const collapsed = connectionsOn && isCollapsedSection(tabParam);

  const data = useSettingsNextData();
  const live = useMemo(() => sectionsFor(connectionsOn), [connectionsOn]);
  // The tally strip's ship-now interim (see this file's own docblock above,
  // and settings.md §13.39) — computed from `data`, never the DOM.
  const tallyLine = certaintyTallyLine(data);

  const mainRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef(false);

  // A `?tab=` bookmark still has to land somewhere true. Every register is
  // already on screen, so "opening" it now means scrolling to its own heading
  // — once, on first paint, never resynced while the reader scrolls (a
  // scrollspy that rewrote the URL on scroll is exactly the failure a past
  // pass of this file already learned from).
  useEffect(() => {
    if (scrolledRef.current) return;
    if (!isSectionId(tabParam)) return;
    if (connectionsOn && isCollapsedSection(tabParam)) return; // the redirect below handles this id
    const el = document.getElementById(`st-section-${tabParam}`);
    if (!el || typeof el.scrollIntoView !== 'function') return;
    scrolledRef.current = true;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [tabParam, connectionsOn, live]);

  // The settle-in reveal, once, on first paint — `animate` collapses to the
  // end state instantly under reduced motion and returns `null` where WAAPI
  // is unavailable (jsdom), so this is inert rather than broken in tests.
  useEffect(() => {
    if (!mainRef.current) return;
    animate(
      mainRef.current,
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      settle,
    );
  }, []);

  const scrollToAnchor = useCallback((anchor: string) => {
    const el = document.getElementById(anchor);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }, []);

  // `?tab=services|pos|email|calendar` still has to land somewhere true. The
  // fragment is the register, not the page, so a bookmark to the till opens
  // on the till rather than at the top of a list it has to be found in again.
  if (collapsed && isCollapsedSection(tabParam)) {
    return <Navigate to={`/connections#${CONNECTIONS_ANCHOR[tabParam]}`} replace />;
  }

  // Staff never reach restaurant settings — client-side, exactly as before,
  // and the gateway refuses independently (each register's 403 branch says
  // so).
  if (data.role === 'staff') {
    return (
      <div className="mudavym" data-ground={ground} style={{ minHeight: '100vh', background: 'var(--paper-0)', color: 'var(--ink-1)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 20px' }}>
          <Wordmark size={13} />
          <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
            Ask a manager.
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '8px 0 0' }}>
            Team, locations, features and the rest belong to whoever runs the floor.
          </p>
          <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', margin: '14px 0 0' }}>
            Your own account is still yours: <Link to="/profile" style={{ color: 'var(--seal-deep)' }}>your profile</Link> and{' '}
            <Link to="/help" style={{ color: 'var(--seal-deep)' }}>help</Link> are both open to you.
          </p>
        </div>
      </div>
    );
  }

  // The interview groups, each carrying the registers `TAB_TO_ANCHOR` maps to
  // its anchor. Order within a group is `SECTIONS`' own order (`live` is
  // derived from it), so a register's position is still declared in exactly
  // one place.
  const groups = INTERVIEW_GROUPS.map((g) => ({
    ...g,
    members: live.filter((s) => TAB_TO_ANCHOR[s.id] === g.anchor),
  }));

  return (
    <div
      className="mudavym"
      data-ground={ground}
      style={{ minHeight: '100vh', background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}
    >
      <style>{CSS}</style>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '26px 18px 64px' }}>
        {/* ── The opening — Fraunces speaks ───────────────────────────── */}
        <header>
          <Wordmark size={13} />
          <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
            Settings<span style={{ color: 'var(--seal)' }}>.</span>
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '6px 0 0' }}>
            {capitalise(word(live.length))} registers — {keptTally(connectionsOn)}.
          </p>
          <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-4)', margin: '8px 0 0', maxWidth: 660 }}>
            Four of these registers now record <em>who</em> changed a setting and what it was before — Features,
            Vendor terms, Approval thresholds and Currency, read back under{' '}
            <button type="button" className="st-focus" onClick={() => scrollToAnchor('a-record')}
              style={{ font: 'inherit', color: 'var(--seal-deep)', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              What changed here
            </button>. The other {connectionsOn ? 'four' : 'eight'} write through services this pass did not touch, so their changes are still
            anonymous; where one is dated the date is shown with the word for what it is a date of, and where nothing
            dates it the line is an em dash naming the file it was checked against.
          </p>
          {tallyLine && (
            <p
              data-testid="st-certainty-tally"
              style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-4)', margin: '8px 0 0', maxWidth: 660 }}
            >
              {tallyLine}
            </p>
          )}
        </header>

        <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.5, margin: '16px 0 20px' }} />

        <div style={{ display: 'grid', gap: 26, gridTemplateColumns: 'minmax(0, 1fr)' }} className="st-layout">
          {/* ── Contents ─────────────────────────────────────────────── */}
          {/*
            THE TABLE OF CONTENTS, sketch 109A.

            Sixteen numbered register buttons became seven interview headings —
            the page no longer swaps a panel, so there is no "active" register
            to mark, only a place to jump. Each entry scrolls the reader to its
            own `<section>` rather than opening it, because everything below is
            already rendered.
          */}
          <nav aria-label="Settings registers" className="st-nav" style={{ alignSelf: 'start' }}>
            {groups.map((group) => (
              <a
                key={group.id}
                href={`#${group.anchor}`}
                onClick={(e) => { e.preventDefault(); scrollToAnchor(group.anchor); }}
                className="st-tab st-ink st-focus"
                style={{
                  display: 'flex', gap: 9, alignItems: 'baseline', padding: '6px 9px', marginBottom: 2,
                  borderRadius: 8, textDecoration: 'none', color: 'var(--ink-2)',
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--seal-deep)', minWidth: 14 }}>{group.roman}</span>
                <span style={{ display: 'block', minWidth: 0 }}>
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, display: 'block' }}>{group.title}</span>
                  <span style={{ fontFamily: SANS, fontSize: 10.5, lineHeight: 1.4, color: 'var(--ink-4)', display: 'block', maxWidth: 200 }}>
                    {group.hint}
                  </span>
                </span>
              </a>
            ))}

            {/*
              THE COLLAPSE, 2026-09-04 — four tabs become this one line. Not a
              numbered register: it leaves this page rather than living on it.
            */}
            {connectionsOn ? (
              <div style={{ margin: '14px 0 0' }}>
                <p
                  id="st-group-connections"
                  style={{
                    fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em',
                    textTransform: 'uppercase', color: 'var(--ink-4)', margin: '0 0 1px', padding: '0 9px',
                  }}
                >
                  Elsewhere
                </p>
                <Link
                  to="/connections"
                  className="st-tab st-ink st-focus"
                  aria-describedby="st-connections-note"
                  style={{
                    display: 'flex', gap: 9, alignItems: 'baseline', padding: '5px 9px',
                    borderRadius: 8, textDecoration: 'none',
                    borderLeft: '2px solid var(--seal-ring)', color: 'var(--ink-2)',
                  }}
                >
                  {/* ink-3, deliberately: aria-hidden icon glyph, not a caption — needs only WCAG's 3:1 non-text minimum. */}
                  <Plug size={12} strokeWidth={1.8} aria-hidden style={{ color: 'var(--ink-3)' }} />
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                    Connections — what acts for this house
                  </span>
                </Link>
                <p
                  id="st-connections-note"
                  style={{
                    fontFamily: SANS, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-4)',
                    margin: '3px 0 0', padding: '0 9px', maxWidth: 210,
                  }}
                >
                  Services, POS, Email and Calendar were four registers here
                  and are one list there, with the payment provider and the
                  servers the house has declared. Managers and owners only.
                </p>
              </div>
            ) : null}
          </nav>

          {/* ── The interview — every register, in its fixed order ─────── */}
          <main ref={mainRef} style={{ minWidth: 0 }}>
            {groups.map((group) => (
              <section key={group.id} id={group.anchor} aria-labelledby={`st-group-${group.id}`} style={{ marginBottom: 36 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', color: 'var(--seal-deep)' }}>
                    {group.roman}
                  </span>
                  <h2 id={`st-group-${group.id}`} style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
                    {group.title}
                  </h2>
                </div>
                <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-4)', margin: '4px 0 18px', maxWidth: 640 }}>
                  {group.hint}
                </p>

                {group.members.map((spec: SectionSpec) => (
                  <div
                    key={spec.id}
                    id={`st-section-${spec.id}`}
                    data-testid={`st-section-${spec.id}`}
                    data-section={spec.id}
                    style={{ margin: '0 0 28px' }}
                  >
                    <h3 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, letterSpacing: '-0.005em', margin: 0 }}>
                      {spec.title}
                    </h3>
                    <p style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 0' }}>
                      {spec.description}
                    </p>
                    <p style={{ fontFamily: SANS, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-4)', margin: '4px 0 14px' }}>
                      {KEPT_NOTE[spec.kind]}
                    </p>
                    {renderRegister(spec.id, data)}
                  </div>
                ))}

                {/* Graft B — the operating-hours day sheet gets its home here (ADR 0149 row 22). */}
                {group.id === 'house' && (
                  <div id="st-section-hours" data-testid="st-section-hours" style={{ margin: '0 0 28px' }}>
                    <h3 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, letterSpacing: '-0.005em', margin: 0 }}>
                      When is it open?
                    </h3>
                    <p style={{ fontFamily: SANS, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-4)', margin: '4px 0 14px' }}>
                      {KEPT_NOTE.restaurant}
                    </p>
                    <HoursSection data={data} />
                  </div>
                )}

                {/* The recommendations digest sender (ADR 0149 row 26). */}
                {group.id === 'own' && (
                  <div id="st-section-digest" data-testid="st-section-digest" style={{ margin: '0 0 28px' }}>
                    <DigestRow data={data} />
                  </div>
                )}
              </section>
            ))}
          </main>
        </div>

        <footer style={{ display: 'flex', flexDirection: 'column', gap: 10,
          borderTop: '1px solid var(--paper-2)', marginTop: 40, paddingTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <Wordmark size={13} />
            <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)', margin: 0 }}>
              A setting shown without a switch is one the product stores and never reads. It is listed, not hidden.
              A term shown as inferred was worked out from this house&rsquo;s own orders and is never written down as a fact.
            </p>
          </div>
          <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)', margin: 0 }}>
            Something wrong, or something missing here — <a href="mailto:support@mudavym.com" style={{ color: 'var(--seal-deep)' }}>support@mudavym.com</a>.
            The one address, here, on <Link to="/help" style={{ color: 'var(--seal-deep)' }}>help</Link>, on{' '}
            <Link to="/privacy" style={{ color: 'var(--seal-deep)' }}>privacy</Link>, and at the foot of every mail the product sends.
          </p>
        </footer>
      </div>
      {/*
        The side bar is sticky on desktop and scrolls on its own if it ever
        outgrows the viewport — a contents column that scrolls away is a
        contents column you stop using. It stays a plain wrapping list on
        narrow screens, where a fixed rail would eat the page.
      */}
      <style>{`@media (min-width: 900px) {
        .st-layout { grid-template-columns: 236px minmax(0, 1fr) !important }
        .st-layout > .st-nav { position: sticky; top: 18px; max-height: calc(100vh - 36px); overflow-y: auto }
      }`}</style>
    </div>
  );
}
