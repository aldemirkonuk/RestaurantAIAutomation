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
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { animate, ink, turn } from '@/lib/mudavym';
import { ensureFraunces } from './fonts';
import {
  KEPT_LABEL, KEPT_NOTE, MONO, SANS, SECTIONS, SERIF,
  isSectionId, keptTally, sectionSpec, type SectionId,
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

export interface SettingsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function SettingsNext({ ground }: SettingsNextProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [active, setActive] = useState<SectionId>(isSectionId(tabParam) ? tabParam : 'team');
  const panelRef = useRef<HTMLElement | null>(null);
  const firstPaint = useRef(true);

  useEffect(() => { ensureFraunces(); }, []);

  // The URL is the source of truth in one direction only: a deep link (or the
  // back button) moves the page. A scrollspy used to overwrite `?tab=` as the
  // reader scrolled, which silently broke the link they had just followed.
  useEffect(() => {
    if (isSectionId(tabParam) && tabParam !== active) setActive(tabParam);
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const data = useSettingsNextData(active);
  const spec = useMemo(() => sectionSpec(active), [active]);
  const index = useMemo(() => SECTIONS.findIndex((s) => s.id === active) + 1, [active]);

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
            {SECTIONS.length === 11 ? 'Eleven' : SECTIONS.length} registers — {keptTally()}.
          </p>
          <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)', margin: '8px 0 0', maxWidth: 640 }}>
            Nothing here records <em>who</em> changed a setting — no table on this page carries an author column. Where
            a change is dated the date is shown, with the word for what it is a date of; where nothing dates it, the
            line is an em dash that names the file it was checked against.
          </p>
        </header>

        <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.5, margin: '16px 0 20px' }} />

        <div style={{ display: 'grid', gap: 26, gridTemplateColumns: 'minmax(0, 1fr)' }} className="st-layout">
          {/* ── Contents ─────────────────────────────────────────────── */}
          <nav aria-label="Settings registers" style={{ alignSelf: 'start' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {SECTIONS.map((s, i) => {
                const on = s.id === active;
                return (
                  <li key={s.id} style={{ flex: '1 1 auto', minWidth: 150 }}>
                    <button
                      type="button"
                      onClick={() => open(s.id)}
                      aria-current={on ? 'true' : undefined}
                      className="st-tab st-ink st-focus"
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', gap: 9, alignItems: 'baseline',
                        padding: '7px 9px', borderRadius: 8, border: 0, cursor: 'pointer',
                        background: on ? 'var(--seal-tint)' : 'transparent',
                        color: on ? 'var(--ink-1)' : 'var(--ink-2)',
                      }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: 10, color: on ? 'var(--seal-deep)' : 'var(--ink-3)' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: on ? 600 : 500, display: 'block' }}>
                          {s.label}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                          {KEPT_LABEL[s.kind]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ── The open register ────────────────────────────────────── */}
          <main ref={panelRef} key={active} aria-labelledby="st-heading" style={{ minWidth: 0 }}>
            <p style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--seal-deep)', margin: 0 }}>
              Register {String(index).padStart(2, '0')} of {SECTIONS.length}
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

            {active === 'team' && <TeamSection data={data} />}
            {active === 'services' && <ServicesSection data={data} />}
            {active === 'email' && <EmailSection data={data} />}
            {active === 'notifications' && <NotifySection data={data} />}
            {active === 'locations' && <LocationsSection data={data} />}
            {active === 'measurement' && <MeasurementSection />}
            {active === 'map' && <MapSection data={data} />}
            {active === 'features' && <FeaturesSection data={data} />}
            {active === 'pos' && <PosSection data={data} />}
            {active === 'calendar' && <CalendarSection data={data} />}
            {active === 'cellar' && <CellarSection />}
          </main>
        </div>

        <footer style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          borderTop: '1px solid var(--paper-2)', marginTop: 40, paddingTop: 14 }}>
          <Wordmark size={13} />
          <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)', margin: 0 }}>
            A setting shown without a switch is one the product stores and never reads. It is listed, not hidden.
          </p>
        </footer>
      </div>
      <style>{`@media (min-width: 900px) { .st-layout { grid-template-columns: 232px minmax(0, 1fr) !important } .st-layout > nav ul { flex-direction: column } }`}</style>
    </div>
  );
}
