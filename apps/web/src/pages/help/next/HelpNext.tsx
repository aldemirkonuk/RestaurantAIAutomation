/**
 * HelpNext — the Mudavym redesign of `/help`, built to the bar ADR 0160
 * §111 delegates to the builder (the founder picked no base direction for
 * this page — "direction A" in an earlier draft of that record was the
 * sketch README's own recommendation, corrected away in §111 correction 2):
 * "the house's own state above the answers," drawn the way the industry's
 * best do it. Founder, quoted in full in that record: *"just mimic how the
 * big companies are doing. Such as Anthropic, and other fintech startup
 * companies."*
 *
 * THE SHAPE ADR 0144 §2 SETS (locked before this page, and binding on it)
 * -------------------------------------------------------------------
 * "Not a support desk. There is no ticketing backend and no status page ...
 * the answers people actually search for, and above them a readiness line
 * drawn from what the gateway ALREADY knows ... No invented apparatus."
 * So this page has exactly the layers that record allows, in this order:
 *
 *   I    This house, right now   — three groups (`hp-readiness.ts`):
 *        connections, waiting on you, last failed. Each item is one gateway
 *        read, independently loading/ok/error/refused — a failed till read
 *        never takes the mail-reading line down with it.
 *   —    This deployment          — one line, clearly SEPARATE from the house
 *        facts above it (`hp-service.ts`, wave dossier fork F3 option c):
 *        `GET /health/ready` answers for every house at once, so folding it
 *        into "this house" would overstate what it says.
 *   II   Guides                   — the collection the founder asked for by
 *        name (`hp-guide.ts`): using the assistant, moving between tasks,
 *        configuring tasks and goals, a general overview. Written as product
 *        documentation, never marketing.
 *   III  Questions people ask     — the FAQ (`hp-faq.ts`).
 *   IV   Reach a person           — one email, `hp-support.ts`. No Slack
 *        (founder: "Just emails, no Slack or anything for now").
 *   V    Ways back in             — the existing guide, the Sommelier, your
 *        profile.
 *
 * THE STANDING MAIL-GRANT ALERT, AND WHY THERE IS NO SEPARATE BANNER HERE
 * -------------------------------------------------------------------
 * The founder asked for a standing alert when the house's mail grant is
 * absent or revoked, "pop up a notification for mobile. For web ... maybe
 * not" — ADR 0160 §111 lists the web half as OPEN ITEM 5, still undecided
 * ("maybe not" ×3, "I'm not sure"). The mobile half is built:
 * `MailGrantAbsentProducer`
 * (`apps/api-gateway/src/notifications/producers/mail-grant-absent.producer.ts`)
 * writes an ordinary `notifications` row, gated on the same
 * `HouseInboxService.statusFor` this page reads below — see that file's own
 * header for what the row actually does on web today (it reaches the bell
 * unconditionally; that producer's header records this truthfully as open
 * item 5, not as a decision). What THIS page does NOT do is invent a second,
 * page-level web banner for the same fact — that would be deciding open item
 * 5 from a page header, which is not this page's call. Section I's "Mail
 * reading" connection item already states the identical fact in words (tone
 * `attention`, a Reconnect action) because it reads the SAME `statusFor`, so
 * the house's own state is visible on web today without this page adding a
 * second, competing answer to the open question.
 *
 * B'S TWO GRAFTS: WHAT TO DO NEXT, AND THE WRITE-TO-SUPPORT PANEL
 * ------------------------------------------------------------------
 * ADR 0160 §111's Decision, verbatim: *"B's What-to-do-next rail and
 * write-to-support modal are grafted in regardless of which base is
 * picked."* (Direction B is `.planning/sketches/111-help-directions/direction-b.html`;
 * the rail is its `rail()`, :782; the panel is its `panelSupport`, :270,
 * frame 03, :860-862.) Neither is a fourth base direction — both are grafted
 * onto whatever base is built, which here is the ADR 0144 §2 shape above.
 *
 *   - **What to do next** (`hp-nextup.ts`'s `nextUpEntries`, rendered just
 *     below): a separate, always-visible section — never folded into
 *     Section I's "Waiting on you" — listing every reading across the
 *     deployment, connections, last failed and waiting that the page's own
 *     ATTENTION tone already marks as needing a person, in that order. Empty
 *     is drawn as the sentence it is, never a blank section (ADR 0020).
 *   - **The write-to-support panel** (`SupportPanel.tsx`): ADR 0112's
 *     `Panel` shape — centred, the exact message and diagnostics shown
 *     before any mail app opens, closes with the word "Not now", never an X.
 *     Both "Write to support" triggers on this page — the rail's own
 *     shortcut and "Reach a person"'s — open this one panel; there is no
 *     bare `mailto:` link left on the page for either to fall back to.
 *
 * ONE-TAP ACTS, PROMOTED WITHOUT A SECOND EXECUTE PATH
 * ------------------------------------------------------
 * "Promote one-tap acts. That's a big one." `OneTapPanel.tsx`'s own header
 * records the founder's locked decision that one-tap execution has exactly
 * one home, the Dashboard rail — a hold-to-approve seal for the one real
 * workflow, a written-note record for the rest. Building a second execute
 * ceremony here would be the ADR 0083 fault this codebase already fixed
 * once: a control that offers an act its page cannot honestly carry out.
 * So this page promotes them as real, named, counted cards — title, priority,
 * how long each has waited — with one link to where they are acted on. Never
 * a live "done" button.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronDown, Mail } from 'lucide-react';
import { Wordmark } from '../../../components/mudavym';
import { ink, settle, useReducedMotion } from '../../../lib/mudavym/motion';
import { MONO, SANS, SERIF, ensureFraunces, fmtLatency, shortCommit } from './hp-format';
import { databaseWord, serviceNextStep, serviceSentence } from './hp-service';
import { buildSupportMailto, diagnosticsBlock, readSupportChannel } from './hp-support';
import { findFaq, FAQ_ENTRIES } from './hp-faq';
import { GUIDE_ENTRIES } from './hp-guide';
import {
  connectionItems,
  failedItems,
  waitingItems,
  type ReadinessItem,
} from './hp-readiness';
import { nextUpEntries, type NextUpEntry } from './hp-nextup';
import { SupportPanel } from './SupportPanel';
import { useHelpNextData } from './useHelpNextData';

export interface HelpNextProps {
  /** Force a ground regardless of app theme (ADR 0042). Default: charcoal. */
  ground?: 'charcoal';
}

/* ── small kit ─────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: 0 }}>
      {children}
    </p>
  );
}

function Section({ n, id, title, children }: { n: string; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} style={{ marginTop: 40 }}>
      <Eyebrow>{n}</Eyebrow>
      <h2 id={`${id}-h`} style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.15, margin: '4px 0 14px', color: 'var(--ink-1)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Mono({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <span style={{ fontFamily: MONO, fontSize: 12, color: dim ? 'var(--ink-3)' : 'var(--ink-2)' }}>{children}</span>;
}

function Prose({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.6, color: muted ? 'var(--ink-3)' : 'var(--ink-2)', margin: '6px 0 0' }}>
      {children}
    </p>
  );
}

// Chips (and this dot) carry INK, never a one-off semantic colour — same
// convention ConnectionsNext already wrote down for .cx-chip.is-warn
// (connections-next.css:243), measured for contrast on both grounds.
const TONE_COLOR: Record<ReadinessItem['tone'], string> = {
  ok: 'var(--seal-deep)',
  attention: 'var(--ink-1)',
  unknown: 'var(--ink-3)',
  refused: 'var(--ink-3)',
};

function StateRow({ item }: { item: ReadinessItem }) {
  return (
    <div className="hp-row">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span
          aria-hidden
          className="hp-dot"
          style={{
            background: TONE_COLOR[item.tone],
            boxShadow: item.tone === 'attention' ? 'inset 0 0 0 1px var(--ink-4)' : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{item.label}</span>
            {item.actionUrl && (
              <a className="hp-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }} href={item.actionUrl}>
                {item.actionLabel ?? 'Open'}
              </a>
            )}
          </div>
          <Prose muted={item.tone === 'unknown' || item.tone === 'refused'}>{item.detail}</Prose>
        </div>
      </div>
    </div>
  );
}

function StateGroup({ title, items }: { title: string; items: ReadinessItem[] }) {
  return (
    <div className="hp-card" style={{ marginBottom: 12 }}>
      <p style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, letterSpacing: '0.01em', color: 'var(--ink-2)', margin: '0 0 2px' }}>
        {title}
      </p>
      <div>{items.map((it) => <StateRow key={it.id} item={it} />)}</div>
    </div>
  );
}

/**
 * "What to do next" — direction B's rail, grafted in per ADR 0160 §111's
 * Decision (see the header comment above). A SEPARATE section from Section
 * I, on purpose: the round-2 review's own must-fix was that a rail folded
 * inside "Waiting on you" does not meet the Decision. Always rendered, never
 * conditionally hidden — an empty list is drawn as the honest sentence it
 * is, per ADR 0020, not as a section that quietly disappears.
 */
function NextUpRail({
  entries,
  supportLabel,
  onWriteToSupport,
}: {
  entries: NextUpEntry[];
  supportLabel: string;
  onWriteToSupport: () => void;
}) {
  return (
    <section aria-labelledby="hp-nextup-h" style={{ marginTop: 22 }}>
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--seal-deep)', margin: 0 }}>
        What to do next
      </p>
      <h2 id="hp-nextup-h" style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, margin: '4px 0 10px', color: 'var(--ink-1)' }}>
        {entries.length === 0
          ? 'Everything reads clear right now.'
          : `${entries.length} thing${entries.length === 1 ? '' : 's'} worth a look.`}
      </h2>
      <div className="hp-card">
        {entries.length === 0 ? (
          <Prose muted>
            Every read this page can make came back clear. If a page still misbehaves, the fault is in that page —
            say which one below.
          </Prose>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {entries.map((e) => (
              <li key={e.id} className="hp-row">
                <p style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>{e.title}</p>
                <Prose>{e.body}</Prose>
                {e.actionUrl && (
                  <p style={{ margin: '6px 0 0' }}>
                    <a className="hp-link" href={e.actionUrl}>
                      {e.actionLabel ?? 'Open'} <ArrowUpRight size={11} style={{ display: 'inline', verticalAlign: -1 }} />
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--paper-2)' }}>
          <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 8px' }}>{supportLabel}</p>
          <button type="button" className="hp-btn hp-btn--seal hp-ink hp-focus" onClick={onWriteToSupport}>
            Write to support
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export default function HelpNext({ ground }: HelpNextProps) {
  const data = useHelpNextData();
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  // Deliberately keyed on the four reads a staleness comparison uses, not on
  // anything read inside the callback itself: each one landing recomputes
  // "now" so `mailItem`'s "last read N ago" and similar comparisons in
  // hp-readiness.ts stay current with the data they judge.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [data.mcp, data.oauth, data.pos, data.mail]);

  useEffect(() => {
    ensureFraunces();
  }, []);

  const [openFaq, setOpenFaq] = useState<string | null>(() => findFaq(location.hash)?.slug ?? null);
  useEffect(() => {
    const e = findFaq(location.hash);
    if (!e) return;
    setOpenFaq(e.slug);
    document.getElementById(`hp-faq-${e.slug}`)?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);

  // The write-to-support panel (ADR 0112 Panel shape) — one piece of state,
  // opened from either "Write to support" trigger on the page (the rail's
  // and "Reach a person"'s); see the header comment's "B'S TWO GRAFTS".
  const [supportPanelOpen, setSupportPanelOpen] = useState(false);

  const connections = useMemo(
    () => connectionItems({ mcp: data.mcp, oauth: data.oauth, pos: data.pos, mail: data.mail }, now),
    [data.mcp, data.oauth, data.pos, data.mail, now],
  );
  const waiting = useMemo(
    () => waitingItems({ oneTap: data.oneTap, ordersPending: data.ordersPending, askAi: data.askAi }),
    [data.oneTap, data.ordersPending, data.askAi],
  );
  const { items: failed, allChecked } = useMemo(
    () => failedItems({ producers: data.producers, reminders: data.reminders, mail: data.mail, mcp: data.mcp }, now),
    [data.producers, data.reminders, data.mail, data.mcp, now],
  );

  const pendingActs = data.oneTap.status === 'ok' ? data.oneTap.data : [];

  // "What to do next" (hp-nextup.ts) — composed from the SAME reads Section I
  // already turned into ReadinessItems above; no second network read, no
  // second notion of "not clear".
  const nextUp = useMemo(
    () => nextUpEntries({ service: data.service, connections, failed, waiting }),
    [data.service, connections, failed, waiting],
  );

  const support = readSupportChannel({ VITE_SUPPORT_EMAIL: import.meta.env.VITE_SUPPORT_EMAIL as string | undefined });
  const cameFrom = useMemo(() => {
    try {
      if (!document.referrer) return null;
      const r = new URL(document.referrer);
      return r.origin === window.location.origin ? r.pathname : null;
    } catch {
      return null;
    }
  }, []);

  const gatewayForDiagnostics =
    data.service.kind === 'checking'
      ? { state: 'checking' as const }
      : data.service.kind === 'unreachable'
        ? { state: 'unreachable' as const, detail: data.service.error }
        : {
            state: (data.service.ready ? 'ready' : 'not_ready') as 'ready' | 'not_ready',
            commit: data.service.commit,
            latencyMs: data.service.latencyMs,
          };

  const diagCtx = {
    houseName: data.houseName,
    houseId: data.restaurantId,
    role: data.role,
    cameFrom,
    gateway: gatewayForDiagnostics,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    href: typeof window !== 'undefined' ? window.location.href : null,
  };
  const block = diagnosticsBlock(diagCtx);
  const mailto = support.state === 'configured' ? buildSupportMailto(support.address, diagCtx) : null;
  const nextUpSupportLabel =
    support.state === 'configured' ? `Or write to ${support.address} with these readings.` : 'Or write to support with these readings.';

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const answered = data.service.kind === 'answered';
  const motionMs = reducedMotion ? 0 : settle.ms;

  return (
    <div className="mudavym" data-ground={ground} style={{ minHeight: '100%', background: 'var(--paper-0)', color: 'var(--ink-1)', fontFamily: SANS }}>
      <style>{`
.mudavym .hp-ink { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing} }
.mudavym .hp-focus:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; border-radius: 8px }
.mudavym .hp-link { color: var(--seal-deep); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px }
.mudavym .hp-link:hover { color: var(--seal) }
.mudavym .hp-btn { font: 500 13px/1 ${SANS}; color: var(--ink-1); background: transparent; border: 1px solid var(--ink-3); border-radius: 8px; padding: 9px 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px }
.mudavym .hp-btn:hover { background: var(--paper-1); border-color: var(--ink-2) }
.mudavym .hp-btn:disabled { color: var(--ink-3); cursor: default; background: transparent; border-color: var(--paper-2) }
.mudavym .hp-btn--seal { color: var(--seal-deep); border-color: var(--seal-ring) }
.mudavym .hp-btn--seal:hover { background: var(--seal-tint); border-color: var(--seal) }
.mudavym .hp-card { border: 1px solid var(--paper-2); border-radius: 12px; padding: 15px 17px; background: var(--paper-0) }
.mudavym .hp-row { border-top: 1px solid var(--paper-2); padding: 11px 0 }
.mudavym .hp-row:first-of-type { border-top: none }
.mudavym .hp-dot { width: 7px; height: 7px; border-radius: 999px; margin-top: 5px; flex: none }
.mudavym .hp-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${motionMs}ms ${settle.easing} }
.mudavym .hp-fold[data-open="true"] { grid-template-rows: 1fr }
.mudavym .hp-fold > div { overflow: hidden; min-height: 0 }
.mudavym .hp-chev { transition: transform ${motionMs}ms ${settle.easing}; color: var(--ink-3) }
.mudavym .hp-chev[data-open="true"] { transform: rotate(180deg) }
.mudavym .hp-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; background: none; border: 0; padding: 13px 0; cursor: pointer; color: var(--ink-1); font: 500 14.5px/1.4 ${SANS} }
.mudavym .hp-faq-q:hover { color: var(--seal-deep) }
.mudavym .hp-grid2 { display: grid; gap: 12px; grid-template-columns: 1fr }
@media (min-width: 700px) { .mudavym .hp-grid2 { grid-template-columns: 1fr 1fr } }
.mudavym .hp-act-card { border: 1px dashed var(--ink-3); border-radius: 10px; padding: 12px 14px; background: var(--paper-1) }
@media (prefers-reduced-motion: reduce) {
  .mudavym .hp-ink, .mudavym .hp-fold, .mudavym .hp-chev { transition: none !important }
}
      `}</style>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '26px 18px 72px' }}>
        {/* ── opening ──────────────────────────────────────────────── */}
        <header>
          <Wordmark size={13} />
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '6px 0 0' }}>
            Help &amp; Support · {data.houseName ?? 'this house'}
          </p>
          <h1 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.12, margin: '4px 0 0', color: 'var(--ink-1)' }}>
            The house's own state, first<span style={{ color: 'var(--seal)' }}>.</span>
          </h1>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '8px 0 0', maxWidth: 620 }}>
            What is connected, what is waiting on you, and what last failed — before the questions, and before a
            person.
          </p>
        </header>

        <div aria-hidden style={{ borderTop: '1px solid var(--ink-1)', borderBottom: '1px solid var(--ink-1)', height: 3, opacity: 0.5, margin: '18px 0 4px' }} />

        {/* ── What to do next (direction B's rail, grafted per ADR 0160 §111) ── */}
        <NextUpRail
          entries={nextUp}
          supportLabel={nextUpSupportLabel}
          onWriteToSupport={() => setSupportPanelOpen(true)}
        />

        {/* ── I. This house, right now ───────────────────────────────── */}
        <Section n="I · This house" id="hp-state" title="This house, right now">
          <StateGroup title="Connections" items={connections} />
          <StateGroup title="Waiting on you" items={waiting} />
          {pendingActs.length > 0 && (
            <div className="hp-card" style={{ marginBottom: 12 }}>
              <p style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)', margin: '0 0 10px' }}>
                One-tap actions waiting ({pendingActs.length})
              </p>
              <div className="hp-grid2">
                {pendingActs.slice(0, 6).map((a) => (
                  <div key={a.id} className="hp-act-card">
                    <p style={{ margin: 0, fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{a.title}</p>
                    <p style={{ margin: '4px 0 0', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                      {a.priority}
                    </p>
                  </div>
                ))}
              </div>
              <p style={{ margin: '10px 0 0' }}>
                <a className="hp-link" href="/">Act on these from the Dashboard <ArrowUpRight size={11} style={{ display: 'inline', verticalAlign: -1 }} /></a>
              </p>
            </div>
          )}
          <div className="hp-card">
            <p style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)', margin: '0 0 2px' }}>Last failed</p>
            {failed.length === 0 ? (
              <Prose muted>{allChecked ? 'Nothing recorded as failed right now.' : 'Nothing recorded as failed among the sources that could be read — some could not be checked, above.'}</Prose>
            ) : (
              <div>{failed.map((it) => <StateRow key={it.id} item={it} />)}</div>
            )}
          </div>
        </Section>

        {/* ── This deployment (separate from the house facts above) ──── */}
        <section aria-labelledby="hp-deploy-h" style={{ marginTop: 22 }}>
          <Eyebrow>This deployment, not this house</Eyebrow>
          <div className="hp-card" style={{ marginTop: 6 }}>
            <p id="hp-deploy-h" role="status" aria-live="polite" style={{ fontFamily: SERIF, fontSize: 15.5, lineHeight: 1.4, color: 'var(--ink-1)', margin: 0 }}>
              {serviceSentence(data.service)}
            </p>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {data.service.kind === 'checking' && <Mono dim>one request in flight</Mono>}
              {data.service.kind === 'unreachable' && (
                <>
                  <Mono>client said: {data.service.error}</Mono>
                  <Mono dim>gave up after {fmtLatency(data.service.latencyMs)}</Mono>
                </>
              )}
              {answered && data.service.kind === 'answered' && (
                <>
                  <Mono>answered {data.service.httpStatus} in {fmtLatency(data.service.latencyMs)}</Mono>
                  <Mono>database {databaseWord(data.service)}</Mono>
                  <Mono>build {shortCommit(data.service.commit)}</Mono>
                </>
              )}
            </div>
            <Prose muted>{serviceNextStep(data.service)}</Prose>
            <p style={{ margin: '10px 0 0' }}>
              <Mono dim>GET /api/v1/health/ready · public route · memoised 5s by the gateway</Mono>
            </p>
          </div>
        </section>

        {/* ── II. Guides ───────────────────────────────────────────────── */}
        <Section n="II · Guides" id="hp-guides" title="How this works">
          <div className="hp-grid2">
            {GUIDE_ENTRIES.map((g) => (
              <article key={g.slug} id={g.slug} className="hp-card">
                <h3 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--ink-1)' }}>{g.title}</h3>
                <Prose muted>{g.dek}</Prose>
                <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
                  {g.steps.map((s, i) => <li key={i} style={{ marginTop: i === 0 ? 0 : 6 }}>{s.text}</li>)}
                </ul>
                {g.goes && (
                  <p style={{ margin: '12px 0 0' }}>
                    <a className="hp-link" href={g.goes.to}>{g.goes.label} <ArrowUpRight size={11} style={{ display: 'inline', verticalAlign: -1 }} /></a>
                  </p>
                )}
              </article>
            ))}
          </div>
        </Section>

        {/* ── III. Questions people ask ────────────────────────────────── */}
        <Section n="III · Questions" id="hp-faq" title="Questions people ask">
          <div className="hp-card" style={{ padding: '2px 17px' }}>
            {FAQ_ENTRIES.map((e) => {
              const open = openFaq === e.slug;
              return (
                <div key={e.slug} id={`hp-faq-${e.slug}`} className="hp-row">
                  <button
                    type="button"
                    className="hp-faq-q hp-ink hp-focus"
                    aria-expanded={open}
                    aria-controls={`hp-faq-panel-${e.slug}`}
                    onClick={() => setOpenFaq(open ? null : e.slug)}
                  >
                    <span>{e.question}</span>
                    <ChevronDown size={16} className="hp-chev" data-open={open} aria-hidden />
                  </button>
                  <div className="hp-fold" data-open={open} id={`hp-faq-panel-${e.slug}`}>
                    <div>
                      <Prose>{e.answer}</Prose>
                      {e.goes && (
                        <p style={{ margin: '8px 0 12px' }}>
                          <a className="hp-link" href={e.goes.to}>{e.goes.label} <ArrowUpRight size={11} style={{ display: 'inline', verticalAlign: -1 }} /></a>
                        </p>
                      )}
                      {!e.goes && <div style={{ height: 8 }} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── IV. Reach a person ──────────────────────────────────────── */}
        <Section n="IV · A person" id="hp-contact" title="Reach a person">
          <div className="hp-card">
            <Eyebrow>Email — the only channel</Eyebrow>
            {support.state === 'configured' && (
              <>
                <p style={{ fontFamily: MONO, fontSize: 14, margin: '8px 0 0', wordBreak: 'break-all', color: 'var(--ink-1)' }}>
                  <Mail size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />
                  {support.address}
                </p>
                <Prose>Opens a message with the block below already in it, so the first reply is not a request for it.</Prose>
              </>
            )}
            {support.state === 'unconfigured' && <Prose muted>No support address was configured for this build. There is no default one.</Prose>}
            {support.state === 'unusable' && <Prose muted>The configured address is not usable ({support.why}): {support.raw}</Prose>}

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Opens the centred write-to-support panel (ADR 0112 Panel
                  shape) instead of navigating a bare mailto: link directly —
                  see the header comment's "B'S TWO GRAFTS". The button
                  renders in all three support.state cases: the panel itself
                  is what says which one applies, rather than this trigger
                  quietly disappearing when there is nothing configured. */}
              <button type="button" className="hp-btn hp-btn--seal hp-ink hp-focus" onClick={() => setSupportPanelOpen(true)}>
                Write to support
              </button>
              <button type="button" className="hp-btn hp-ink hp-focus" onClick={copyDiagnostics}>
                {copied ? <>Copied <Check size={13} /></> : 'Copy the diagnostics block'}
              </button>
            </div>

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3)' }}>What "Write to support" sends</summary>
              <pre style={{ marginTop: 8, padding: 12, background: 'var(--paper-1)', border: '1px solid var(--paper-2)', borderRadius: 8, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                {block}
              </pre>
            </details>
          </div>
        </Section>

        {/* ── V. Ways back in ──────────────────────────────────────────── */}
        <Section n="V · Ways back" id="hp-ways-back" title="Ways back in">
          <div className="hp-grid2">
            <a className="hp-card hp-ink hp-focus" style={{ textDecoration: 'none', display: 'block' }} href="/get-started?tab=use">
              <p style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>The app guide</p>
              <Prose muted>The tours and the getting-started walkthrough, from the top.</Prose>
            </a>
            <a className="hp-card hp-ink hp-focus" style={{ textDecoration: 'none', display: 'block' }} href="/sommelier">
              <p style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>The Sommelier</p>
              <Prose muted>Wine, cellar and pairing questions, in a dedicated conversation.</Prose>
            </a>
            <a className="hp-card hp-ink hp-focus" style={{ textDecoration: 'none', display: 'block' }} href="/profile">
              <p style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>Your profile</p>
              <Prose muted>Password, connected accounts, and your own linked services.</Prose>
            </a>
          </div>
        </Section>

        <p style={{ marginTop: 40 }}>
          <Mono dim>Read at {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} by this page</Mono>
        </p>
      </div>

      <SupportPanel
        open={supportPanelOpen}
        onClose={() => setSupportPanelOpen(false)}
        support={support}
        houseName={data.houseName}
        block={block}
        mailto={mailto}
        copied={copied}
        onCopy={copyDiagnostics}
      />
    </div>
  );
}
