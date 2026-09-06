/**
 * SettingsNext — the Mudavym redesign of `/settings`, behind
 * `mudavym_design_settings` (ADR 0044 p4 wave).
 *
 * The founder's verdict, verbatim: *"I kind of like the Editorial. I think
 * that's the best way to go — or Federation, it doesn't matter. But I feel
 * like there should be more."* — KEEP (Editorial) · needs more.
 *
 * EDITORIAL, kept: a contents page and a register. Fraunces speaks the opening
 * and each register's name; the index on the left is a book's table of
 * contents, numbered, with the storage each register uses stated beside it; the
 * double rule under the heading is the account ruled off. One register open at
 * a time, each deep-linked by `?tab=`: the legacy ten under their legacy names
 * in their legacy order, so no bookmark moves, plus `cellar` appended.
 *
 * "MORE", and what it is NOT: not more toggles. Every setting is rendered as a
 * RECORD — what it changes said as a consequence rather than a feature name,
 * WHERE the value is kept (this restaurant · your account · this browser), and
 * WHEN it was last written, or an em dash naming why no date exists. That third
 * line is the substance the section was missing, and it is also the honesty
 * mechanism: it forces every setting to declare its scope, which is how the
 * measurement register turned out to be kept in localStorage and the four
 * consent switches turned out to be read by nothing.
 *
 * Honesty (ADR 0020): a setting the product stores but never reads renders
 * WITHOUT a control, showing its stored value and the file that was grepped.
 * A read that fails says which register could not be read; a 403 says it was
 * refused. Neither ever renders as an empty list.
 *
 * SECOND PASS, 2026-09-03 — WHAT AN EM DASH COSTS WHEN IT IS WRONG
 * ----------------------------------------------------------------
 * The audit of the first pass found five false claims, all of one species: the
 * page asserting an absence it had not checked. One removed a working control
 * (quiet hours IS read, by `services/agent-orchestrator/agents/notification_agent.py:1487-1494`
 * — the first pass grepped three runtimes and there are four). Four printed "no
 * date exists" over dates the database was holding and the wire was dropping.
 *
 * The lesson is symmetric and is now built into the page: a claim of absence is
 * a claim, and it carries the same burden of proof as a number. Every "no
 * switch" line names the files grepped across ALL FOUR runtimes; the recurring
 * em-dash reasons — the ones several registers share — are enumerated in
 * `PROVENANCE_UNKNOWN` (`st-format.ts`) rather than retyped, and the ones that
 * are local to a single row stay local because each names the specific layer it
 * blames. Three of the four false dates were repaired at their source —
 * `organizations.service.ts` now returns `updated_at` for chains and branches,
 * and stamps it on a chain rename because that table has no trigger — and the
 * fourth was a camelCase field the page was reading in snake_case.
 *
 * Motions: `MOTIONS.md` in this directory, mirrored in 06-pages/settings.md §1b.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { Wordmark } from '@/components/mudavym';
import { animate, ink, turn } from '@/lib/mudavym';
import { useMudavymDesign } from '@/lib/mudavym/useMudavymDesign';
import { ensureFraunces } from './fonts';
import {
  CONNECTIONS_ANCHOR, KEPT_NOTE, MONO, SANS, SERIF,
  groupsFor, isCollapsedSection, isSectionId, keptTally, readingIndexFor,
  sectionSpec, sectionsFor, word, type SectionId,
} from './st-format';
import { useSettingsNextData } from './useSettingsNextData';
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

export interface SettingsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function SettingsNext({ ground }: SettingsNextProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  /**
   * THE COLLAPSE (founder, 2026-09-04): "Move the registers and collapse the
   * four tabs." Four tabs — Services, POS, Email, Calendar — become one line
   * pointing at `/connections`, but ONLY while that route exists. With the flag
   * off the route redirects to `/profile`, so collapsing into it would send a
   * reader who wanted the till to their own account.
   */
  const connectionsOn = useMudavymDesign('connections');
  const collapsed = connectionsOn && isCollapsedSection(tabParam);
  const [active, setActive] = useState<SectionId>(isSectionId(tabParam) ? tabParam : 'team');
  const panelRef = useRef<HTMLElement | null>(null);
  const firstPaint = useRef(true);

  useEffect(() => { ensureFraunces(); }, []);

  // The URL is the source of truth in one direction only: a deep link (or the
  // back button) moves the page. A scrollspy used to overwrite `?tab=` as the
  // reader scrolled, which silently broke the link they had just followed.
  useEffect(() => {
    if (connectionsOn && isCollapsedSection(tabParam)) return; // redirected below
    if (isSectionId(tabParam) && tabParam !== active) setActive(tabParam);
  }, [tabParam, connectionsOn]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A collapsed tab that was already open when the flag verdict arrived.
   *
   * The verdict is asynchronous, so a reader can be standing on `?tab=pos` with
   * the section rendered before the collapse is known. Falling back to `team`
   * is the only honest landing: the register they were reading is no longer on
   * this page, and leaving it rendered would be this page claiming a tab the
   * contents column says does not exist.
   */
  useEffect(() => {
    if (connectionsOn && isCollapsedSection(active)) setActive('team');
  }, [connectionsOn, active]);

  const open = useCallback(
    (id: SectionId) => {
      setActive(id);
      const next = new URLSearchParams(searchParams);
      next.set('tab', id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // The page turn — the reveal of a new register, once per change.
  useEffect(() => {
    if (firstPaint.current) { firstPaint.current = false; return; }
    if (!panelRef.current) return;
    animate(
      panelRef.current,
      [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
      turn,
    );
  }, [active]);

  /**
   * What is actually drawn.
   *
   * The flag verdict is asynchronous, so `active` can legitimately still be a
   * collapsed id for one render after it arrives. Deriving what is SHOWN,
   * rather than relying on the reset effect alone, means the POS register is
   * never painted for a frame on a page whose own contents column says it is
   * not here.
   */
  const shown: SectionId =
    connectionsOn && isCollapsedSection(active) ? 'team' : active;

  const data = useSettingsNextData(shown);
  const spec = useMemo(() => sectionSpec(shown), [shown]);
  const groups = useMemo(() => groupsFor(connectionsOn), [connectionsOn]);
  const live = useMemo(() => sectionsFor(connectionsOn), [connectionsOn]);
  const index = useMemo(
    () => readingIndexFor(connectionsOn, shown),
    [connectionsOn, shown],
  );

  // `?tab=services|pos|email|calendar` still has to land somewhere true. The
  // fragment is the register, not the page, so a bookmark to the till opens on
  // the till rather than at the top of a list it has to be found in again.
  if (collapsed && isCollapsedSection(tabParam)) {
    return <Navigate to={`/connections#${CONNECTIONS_ANCHOR[tabParam]}`} replace />;
  }

  // Staff never reach restaurant settings — client-side, exactly as before, and
  // the gateway refuses independently (each register's 403 branch says so).
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
          <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)', margin: '8px 0 0', maxWidth: 660 }}>
            Four of these registers now record <em>who</em> changed a setting and what it was before — Features,
            Vendor terms, Approval thresholds and Currency, read back under{' '}
            <button type="button" className="st-focus" onClick={() => open('ledger')}
              style={{ font: 'inherit', color: 'var(--seal-deep)', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              What changed here
            </button>. The other {connectionsOn ? 'four' : 'eight'} write through services this pass did not touch, so their changes are still
            anonymous; where one is dated the date is shown with the word for what it is a date of, and where nothing
            dates it the line is an em dash naming the file it was checked against.
          </p>
        </header>

        <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.5, margin: '16px 0 20px' }} />

        <div style={{ display: 'grid', gap: 26, gridTemplateColumns: 'minmax(0, 1fr)' }} className="st-layout">
          {/* ── Contents ─────────────────────────────────────────────── */}
          {/*
            THE TAB BAR, MADE TO READ CLEAN (fourth pass).

            Pass two's numbered contents column stays — the founder asked to keep
            the side tab bar — but fourteen numbered rows in one flat list is a
            list you scan rather than read, and each row carried a second line
            naming its storage, which doubled its height for a fact that is
            printed again under the open register's own heading.

            So: five groups with a heading and one line of signpost each, one
            line per register, and a seal rule down the active row. That is the
            settings-navigation standard both references converged on — Linear's
            redesigned settings group into Account / Features / Administration /
            Your teams (linear.app/changelog/2024-12-18-personalized-sidebar) and
            Stripe's 2023 Dashboard navigation added grouped sections with
            pinned and recent shortcuts — and the grouping here is by what a
            person came to DO, not by where the value is kept, which is the
            internal fact. Nothing is hidden behind a "More": every register is
            one click from every other, because a settings page whose sections
            are collapsed is a settings page whose sections go unread.
          */}
          <nav aria-label="Settings registers" className="st-nav" style={{ alignSelf: 'start' }}>
            {groups.map((group) => (
              <div key={group.id} style={{ marginBottom: 14 }}>
                <p
                  id={`st-group-${group.id}`}
                  style={{
                    fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em',
                    textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 1px', padding: '0 9px',
                  }}
                >
                  {group.title}
                </p>
                <p
                  style={{
                    fontFamily: SANS, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3)',
                    margin: '0 0 5px', padding: '0 9px', maxWidth: 210,
                  }}
                >
                  {group.hint}
                </p>
                <ul
                  aria-labelledby={`st-group-${group.id}`}
                  style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 2 }}
                >
                  {group.members.map((id) => {
                    const spec = sectionSpec(id);
                    const on = id === shown;
                    return (
                      <li key={id} style={{ flex: '1 1 auto', minWidth: 150 }}>
                        <button
                          type="button"
                          onClick={() => open(id)}
                          aria-current={on ? 'true' : undefined}
                          className="st-tab st-ink st-focus"
                          style={{
                            width: '100%', textAlign: 'left', display: 'flex', gap: 9, alignItems: 'baseline',
                            padding: '5px 9px', borderRadius: 8, border: 0, cursor: 'pointer',
                            borderLeft: `2px solid ${on ? 'var(--seal)' : 'transparent'}`,
                            background: on ? 'var(--seal-tint)' : 'transparent',
                            color: on ? 'var(--ink-1)' : 'var(--ink-2)',
                          }}
                        >
                          <span style={{ fontFamily: MONO, fontSize: 10, color: on ? 'var(--seal-deep)' : 'var(--ink-3)' }}>
                            {String(readingIndexFor(connectionsOn, id)).padStart(2, '0')}
                          </span>
                          <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: on ? 600 : 500, flex: 1, minWidth: 0 }}>
                            {spec.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {/*
              THE COLLAPSE, 2026-09-04 — four tabs become this one line.

              It is deliberately NOT drawn as a fifteenth numbered register. The
              numbers count what this page opens in place; this leaves the page.
              Drawing it as a register would say the till is configured here,
              and it is not — it is configured on `/connections`, which is
              manager-and-owner only, while this page admits staff to nothing at
              all. One line, one arrow out, and the four registers it replaces
              named so a reader looking for "POS" can see where it went.
            */}
            {connectionsOn ? (
              <div style={{ marginBottom: 14 }}>
                <p
                  id="st-group-connections"
                  style={{
                    fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: '0.14em',
                    textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 1px', padding: '0 9px',
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
                  <Plug size={12} strokeWidth={1.8} aria-hidden style={{ color: 'var(--ink-3)' }} />
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                    Connections — what acts for this house
                  </span>
                </Link>
                <p
                  id="st-connections-note"
                  style={{
                    fontFamily: SANS, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3)',
                    margin: '3px 0 0', padding: '0 9px', maxWidth: 210,
                  }}
                >
                  Services, POS, Email and Calendar were four registers here and
                  are one list there, with the payment provider and the servers
                  the house has declared. Managers and owners only.
                </p>
              </div>
            ) : null}
          </nav>

          {/* ── The open register ────────────────────────────────────── */}
          <main ref={panelRef} key={shown} aria-labelledby="st-heading" style={{ minWidth: 0 }}>
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--seal-deep)', margin: 0 }}>
              Register {String(index).padStart(2, '0')} of {live.length}
            </p>
            <h2 id="st-heading" style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', margin: '2px 0 0' }}>
              {spec.title}
            </h2>
            <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', margin: '5px 0 0' }}>
              {spec.description}
            </p>
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '5px 0 16px' }}>
              {KEPT_NOTE[spec.kind]}
            </p>

            {shown === 'team' && <TeamSection data={data} />}
            {shown === 'services' && <ServicesSection data={data} />}
            {shown === 'email' && <EmailSection data={data} />}
            {shown === 'notifications' && <NotifySection data={data} />}
            {shown === 'locations' && <LocationsSection data={data} />}
            {shown === 'measurement' && <MeasurementSection />}
            {shown === 'map' && <MapSection data={data} />}
            {shown === 'features' && <FeaturesSection data={data} />}
            {shown === 'pos' && <PosSection data={data} />}
            {shown === 'calendar' && <CalendarSection data={data} />}
            {shown === 'cellar' && <CellarSection />}
            {shown === 'vendor-terms' && <VendorTermsSection data={data} />}
            {shown === 'thresholds' && <ThresholdsSection data={data} />}
            {shown === 'ledger' && <LedgerSection data={data} />}
            {shown === 'currency' && <CurrencySection data={data} />}
            {shown === 'carrying-cost' && <CarryingCostSection data={data} />}
          </main>
        </div>

        <footer style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          borderTop: '1px solid var(--paper-2)', marginTop: 40, paddingTop: 14 }}>
          <Wordmark size={13} />
          <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)', margin: 0 }}>
            A setting shown without a switch is one the product stores and never reads. It is listed, not hidden.
            A term shown as inferred was worked out from this house&rsquo;s own orders and is never written down as a fact.
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
        .st-layout > .st-nav ul { flex-direction: column }
      }`}</style>
    </div>
  );
}
