/**
 * `/story`: the platform told as one sample night (founder, 2026-10-28).
 *
 * The landing page (`/`, and `/register` for a stranger) says what Mudavym does
 * part by part. This page follows one delivery and one bottle from the door to
 * close, a chapter at a time, with each chapter's picture pinned and driven by
 * the reader's scroll (story.css says how, and what a reader who asked for less
 * motion, or whose browser has no scroll timelines, gets instead). Its last
 * chapter is further out and says so: what is not built yet, told the way the
 * landing page tells it, with no figure and no date.
 *
 * What it may say is what the landing page already says: every product
 * sentence here is one the landing page carries, or a sample in the landing's
 * own shape, and every name, time and number is invented and labelled so.
 * It loads nothing from anywhere else and links only to its own routes.
 */
import { CSSProperties, Fragment, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChefHat,
  CircleAlert,
  ClipboardList,
  FileText,
  Grape,
  Mail,
  MessageSquare,
  PhoneCall,
  Receipt,
  ShoppingCart,
  Users,
  Wine,
} from 'lucide-react';
import { Seal } from '../../components/mudavym/Seal';
import { Wordmark } from '../../components/mudavym/Wordmark';
import { CTA, START } from '../landing/doors';
import '../landing/landing.css';
import './story.css';

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function hasObserver(): boolean {
  return typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';
}

/** Whether this browser can pin a chapter and let the scroll drive it. */
function canScrub(): boolean {
  try {
    return typeof ResizeObserver === 'function' && CSS.supports('animation-timeline', 'view()');
  } catch {
    return false;
  }
}

/** Where each block of the page stood, from the top of the page, on a screen
 *  of one size (`size`), and where on that page the reader stood (`y`). */
type Laid = { size: string; vh: number; y: number; rows: { top: number; h: number }[] };

function lay(blocks: HTMLElement[], size: string): Laid {
  const y = window.scrollY;
  return {
    size,
    vh: window.innerHeight,
    y,
    rows: blocks.map((b) => {
      const r = b.getBoundingClientRect();
      return { top: r.top + y, h: r.height };
    }),
  };
}

/** The block the reader had at the middle of the screen, and how far into it. */
function place(laid: Laid): { i: number; f: number } | null {
  // a reader at the top stays at the top
  if (laid.y <= 0) return null;
  const at = laid.y + laid.vh / 2;
  const i = laid.rows.findIndex((r) => at < r.top + r.h);
  if (i < 0) return null;
  const r = laid.rows[i];
  return { i, f: r.h ? (at - r.top) / r.h : 0 };
}

/** Puts the reader back at the same share of the same block, at once. */
function keep(was: { i: number; f: number }, now: Laid) {
  const r = now.rows[was.i];
  const top = Math.round(r.top + was.f * r.h - now.vh / 2);
  if (Math.abs(top - window.scrollY) >= 1) window.scrollTo({ top, behavior: 'instant' });
  now.y = window.scrollY;
}

/** Air a pinned picture keeps above and below it, in px, so it never touches the bar. */
export const PIN_AIR = 24;

/** How much of an unpinned picture (or of the screen, when the picture is
 *  taller) is on screen before it plays. */
export const STAGE_SHARE = 0.6;

/** A part that moves: which motion, and when in its chapter's scroll (percent). */
function k(motion: string, a0: number, a1: number, extra?: Record<string, string | number>) {
  return { 'data-k': motion, style: { '--a0': a0, '--a1': a1, ...extra } as CSSProperties };
}

function Go({ className = 'ld-btn' }: { className?: string }) {
  return (
    <Link className={className} to={START}>
      {CTA} <ArrowRight aria-hidden="true" strokeWidth={2} />
    </Link>
  );
}

/** A count that ticks from one number to another as its chapter is scrolled. */
function Reel({ from, to, a0, a1 }: { from: number; to: number; a0: number; a1: number }) {
  const n = Math.abs(to - from);
  const step = to > from ? 1 : -1;
  return (
    <>
      <span className="st-reel" aria-hidden="true">
        <span className="st-reel-strip" {...k('reel', a0, a1, { '--n': n })}>
          {Array.from({ length: n + 1 }, (_, i) => (
            <span key={i}>{from + i * step}</span>
          ))}
        </span>
      </span>
      <span className="st-sr">{to}</span>
    </>
  );
}

/** The chapters, in the order the night runs; the rail and the tests read this. */
export const CHAPTERS = [
  { id: 'st-old', time: '1:12 am', title: 'Most nights' },
  { id: 'st-turn', time: 'Tonight', title: 'One system' },
  { id: 'st-door', time: '4:10 pm', title: 'It arrives' },
  { id: 'st-read', time: '4:11 pm', title: 'It is read' },
  { id: 'st-check', time: '4:12 pm', title: 'It is checked' },
  { id: 'st-shelf', time: '4:15 pm', title: 'It is counted' },
  { id: 'st-dusk', time: '6:00 pm', title: 'Doors open' },
  { id: 'st-pour', time: '9:40 pm', title: 'It is poured' },
  { id: 'st-ask', time: '11:20 pm', title: 'It asks' },
  { id: 'st-close', time: '12:05 am', title: 'It closes' },
  { id: 'st-next', time: 'Tomorrow', title: 'Further out' },
] as const;

type ChapterId = (typeof CHAPTERS)[number]['id'];

function Chapter({
  id,
  kicker,
  title,
  len,
  night,
  stages,
  pic,
  children,
}: {
  id: ChapterId;
  kicker: string;
  title: ReactNode;
  len: number;
  night?: boolean;
  /** The picture marks its own stages, each playing when it is on screen. */
  stages?: boolean;
  pic: ReactNode;
  children: ReactNode;
}) {
  const time = CHAPTERS.find((c) => c.id === id)?.time;
  return (
    <section
      id={id}
      className={'st-ch' + (night ? ' mudavym' : '')}
      data-ground={night ? 'charcoal' : undefined}
      aria-labelledby={id + '-h'}
      style={{ '--st-len': `${len}vh` } as CSSProperties}
    >
      <div className="st-pin">
        <div className="ld-wrap st-grid">
          <div className="st-copy" data-reveal>
            <p className="st-time">
              <span className="ld-mono">{time}</span> {kicker}
            </p>
            <h2 id={id + '-h'}>{title}</h2>
            {children}
          </div>
          <div className="st-pic" data-stage={stages ? undefined : ''}>
            {pic}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The night's paperwork, scattered: the same six scraps in chapters one and two. */
const SCRAPS = [
  { icon: Receipt, b: 'Invoice 20931', s: 'Northfield Wine Co.', dx: '-24cqw', dy: '-30cqh', r: '-6deg', doc: true },
  { icon: ClipboardList, b: 'Bar count', s: 'Half done, row 4', dx: '22cqw', dy: '-28cqh', r: '5deg' },
  { icon: Mail, b: '14 unread', s: 'From vendors', dx: '-26cqw', dy: '2cqh', r: '3deg' },
  { icon: MessageSquare, b: 'Did the Sancerre come?', s: 'A text from the bar', dx: '24cqw', dy: '5cqh', r: '-4deg' },
  { icon: FileText, b: 'Order sheet', s: 'Last week’s, in pencil', dx: '-18cqw', dy: '32cqh', r: '-3deg', doc: true },
  { icon: ShoppingCart, b: 'Reorder Albariño?', s: 'Nobody checked', dx: '20cqw', dy: '31cqh', r: '6deg' },
];

function Scraps({ gather }: { gather?: boolean }) {
  return (
    <>
      {SCRAPS.map(({ icon: Icon, b, s, dx, dy, r, doc }, i) => (
        <div
          key={b}
          className={'st-scrap' + (doc ? ' st-docbg' : '')}
          {...(gather
            ? k('gather', 4 + i * 5, 52 + i * 3, { '--dx': dx, '--dy': dy, '--r': r })
            : k('scrap', 6 + i * 12, 20 + i * 12, { '--dx': dx, '--dy': dy, '--r': r }))}
        >
          <Icon aria-hidden="true" strokeWidth={1.75} />
          <b>{b}</b>
          <small>{s}</small>
        </div>
      ))}
    </>
  );
}

/** The sample invoice: four lines, twelve bottles each, one billed above the agreed price. */
export const LINES = [
  { item: 'Prosecco NV', size: '750 ml', price: 11.4 },
  { item: 'Rioja Crianza 2020', size: '750 ml', price: 12.1 },
  { item: 'Sancerre 2023', size: '750 ml', price: 22.5, agreed: 19.8 },
  { item: 'Gin', size: '1 L', price: 24 },
];
const QTY = 12;

function money(n: number): string {
  return '$' + n.toFixed(2);
}

/** What the extra on line 3 comes to: twelve bottles at the difference. */
export const HELD = QTY * (22.5 - 19.8);

function Lines({ checked }: { checked?: boolean }) {
  return (
    <ol className="st-lines">
      {LINES.map((l, i) => {
        const bad = checked && l.agreed !== undefined;
        return (
          <li
            key={l.item}
            className={'st-line' + (bad ? ' is-bad' : '')}
            {...(checked ? {} : k('raw', 12 + i * 15, 24 + i * 15))}
          >
            <span>{l.item}</span>
            <span>{l.size}</span>
            <em>
              {QTY} × {money(l.price)}
            </em>
            {checked ? (
              <span {...k('pop', 8 + i * 12, 16 + i * 12)}>
                {bad ? (
                  <CircleAlert role="img" aria-label="Held" strokeWidth={2.4} />
                ) : (
                  <Check role="img" aria-label="Checked" strokeWidth={2.4} />
                )}
              </span>
            ) : (
              <span {...k('pop', 20 + i * 15, 27 + i * 15)}>
                <Check role="img" aria-label="Read" strokeWidth={2.4} />
              </span>
            )}
            {/* last, so the grid's first and second children stay the item and its size */}
            {bad && <span className="st-line-bad" {...k('fade', 56, 66)} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Tomorrow's sample call: the same vendor, following up the reply on the line
 *  the night held, which goes only once it has a person's yes (the copy says so,
 *  whatever the reader pressed). Not built yet; it ends on an offer waiting for
 *  a person, as the landing's does. */
const CALL: readonly ['us' | 'them', string][] = [
  ['us', 'Hi, this is the bar’s assistant, following up our email on invoice 20931.'],
  ['them', 'Sure. What can I do for you?'],
  ['us', `Line 3 came in at ${money(22.5)} a bottle, not the agreed ${money(19.8)}.`],
  ['them', `Right. I can credit the ${money(HELD)} on your next invoice.`],
];

/** The voice line's bars, each at its own height, so the wave reads as speech. */
const WAVE = [0.9, 0.55, 1, 0.7, 0.85];

/** Further out still: the landing's three "Coming soon" questions, by name only. */
const SOON = [
  [ChefHat, 'How it will taste'],
  [Grape, 'What to pour beside it'],
  [Users, 'Who will love it'],
] as const;

/** Stars over the house at 6 pm, placed by hand. */
const STARS = [
  ['12%', '14%'],
  ['26%', '8%'],
  ['38%', '22%'],
  ['71%', '10%'],
  ['84%', '24%'],
  ['92%', '8%'],
  ['18%', '34%'],
  ['62%', '30%'],
] as const;

export function Story() {
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ChapterId | null>(null);
  const [order, setOrder] = useState(false);
  const [reply, setReply] = useState(false);
  const [said, setSaid] = useState('');

  // Reveal the words as they come into view, and start each stage of a
  // picture that is not pinned once most of it is on screen (STAGE_SHARE of
  // it, or of the screen when it is taller). Without an observer, or for a
  // reader who asked for less motion, everything is shown at once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const words = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const stages = Array.from(root.querySelectorAll<HTMLElement>('[data-stage]'));
    if (reducedMotion() || !hasObserver()) {
      [...words, ...stages].forEach((el) => el.classList.add('is-in'));
      return;
    }
    // The bar covers the top of the screen (the probe starts under it), so what
    // is behind the bar is not on screen yet, scrolling either way.
    const probe = probeRef.current;
    const bar = probe?.offsetTop ?? 0;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            seen.unobserve(e.target);
          }
        }
      },
      { rootMargin: `${-bar}px 0px -10% 0px` },
    );
    words.forEach((el) => seen.observe(el));
    const onStage = new IntersectionObserver(
      (entries) => {
        const room = probe?.offsetHeight || window.innerHeight;
        for (const e of entries) {
          const need = STAGE_SHARE * Math.min(e.boundingClientRect.height, room);
          if (e.isIntersecting && e.intersectionRect.height >= need) {
            e.target.classList.add('is-in');
            onStage.unobserve(e.target);
          }
        }
      },
      { rootMargin: `${-bar}px 0px 0px 0px`, threshold: Array.from({ length: 41 }, (_, i) => i / 40) },
    );
    stages.forEach((el) => onStage.observe(el));
    return () => {
      seen.disconnect();
      onStage.disconnect();
    };
  }, []);

  // A chapter pins only when its picture fits the shortest screen this browser
  // shows (the probe: 100svh, toolbars out, under the bar; the pin is drawn at
  // the same svh height), so a pinned picture is never clipped and a toolbar
  // sliding away never re-lays the page. One
  // that does not fit keeps its natural height and plays once when it is on
  // screen, like the version for browsers without scroll timelines. Measured on
  // mount and whenever the screen or a picture changes size, never on scroll.
  //
  // A pinned chapter is as long as the screen is tall, so a rotation or a
  // window resize moves every chapter under a reader who has not scrolled.
  // Story keeps the reader's place itself (the browser's own scroll anchoring
  // stands down, is-placed): the same share of the block at the middle of the
  // screen before the change and after it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe || !canScrub()) return;
    const chapters = Array.from(root.querySelectorAll<HTMLElement>('.st-ch'));
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('main > *'));
    // the screen's width, and its height under the bar with the toolbars out,
    // which a toolbar sliding away does not change
    const size = () => `${root.clientWidth}x${probe.offsetHeight}`;
    let laid: Laid | null = null;
    const fit = () => {
      const was = laid && place(laid);
      const room = probe.offsetHeight - PIN_AIR;
      const fits = chapters.map((ch) => {
        const grid = ch.querySelector<HTMLElement>('.st-grid');
        return !!grid && grid.offsetHeight <= room;
      });
      const flips = chapters.filter((ch, i) => ch.classList.contains('is-fit') !== fits[i]);
      if (flips.length) {
        // A part that moves between scroll and time keeps its old clock in
        // Chromium (off a scroll timeline it can sit minutes in the past,
        // unseen), so a chapter that flips starts its parts again: one style
        // pass with no animation (is-flip), then the new one.
        flips.forEach((ch) => ch.classList.add('is-flip'));
        chapters.forEach((ch, i) => ch.classList.toggle('is-fit', fits[i]));
        root.getBoundingClientRect();
        flips.forEach((ch) => ch.classList.remove('is-flip'));
      }
      laid = lay(blocks, size());
      if (was) keep(was, laid);
    };
    // The reader's own scroll moves where they stand on the page as laid. A
    // scroll on a screen of another size is the browser's, made before fit()
    // can run (a phone's rotation anchor, or a page that got shorter pulling
    // the reader up to its end), and says nothing of where they were.
    const read = () => {
      if (laid && size() === laid.size) laid.y = window.scrollY;
    };
    root.classList.add('is-placed');
    fit();
    window.addEventListener('scroll', read, { passive: true });
    // the probe, each chapter's picture, and the blocks between the chapters
    const sized = new ResizeObserver(fit);
    sized.observe(probe);
    blocks.forEach((b) => sized.observe(b.querySelector('.st-grid') ?? b));
    return () => {
      sized.disconnect();
      window.removeEventListener('scroll', read);
      root.classList.remove('is-placed');
    };
  }, []);

  // The rail marks the chapter at the middle of the screen. The dusk band
  // between two chapters counts as the first of them (data-rail); the hero
  // above the first and the end past the last count as none.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !hasObserver()) return;
    const on = new Set<HTMLElement>();
    const where = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) on.add(el);
          else on.delete(el);
        }
        const at: HTMLElement | undefined = on.values().next().value;
        const id = at?.dataset.rail ?? (at?.classList.contains('st-ch') ? at.id : null);
        setActive((id as ChapterId | undefined) ?? null);
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    root.querySelectorAll('main > *').forEach((el) => where.observe(el));
    return () => where.disconnect();
  }, []);

  // Approving swaps the button for Undo, and back; the reader's focus goes to
  // the new one rather than falling to the top of the page.
  const refocus = useRef<'order' | 'reply' | null>(null);
  useEffect(() => {
    const which = refocus.current;
    refocus.current = null;
    if (which) rootRef.current?.querySelector<HTMLElement>(`[data-ask="${which}"] button`)?.focus();
  }, [order, reply]);

  // A keyboard reader who tabs into a picture meets it finished, not wherever
  // the scroll has it: a pinned card can still be on its way in, unseen. The
  // browser scrolled to the button while its card still sat low on its way in
  // (26 px), so once the card stands finished it is brought clear of the bar.
  function shown(el: Element) {
    let keys = true;
    try {
      keys = el.matches(':focus-visible');
    } catch {
      // a browser that cannot tell keys from a pointer shows it finished
    }
    const ch = keys ? el.closest('.st-ch') : null;
    if (!ch) return;
    ch.classList.add('is-done');
    el.scrollIntoView({ block: 'nearest' });
  }

  function answer(which: 'order' | 'reply', yes: boolean) {
    refocus.current = which;
    (which === 'order' ? setOrder : setReply)(yes);
    const what = which === 'order' ? 'The order' : 'The reply';
    setSaid(yes ? `${what}: sent by you. Nothing left this page.` : `${what}: back to waiting for your yes.`);
  }

  const wait = 'Waiting for your yes';

  return (
    <div className="mdv-landing mudavym mdv-story" ref={rootRef} onFocus={(e) => shown(e.target)}>
      <div className="st-probe" ref={probeRef} aria-hidden="true" />
      <header className="ld-bar">
        <div className="ld-wrap">
          <Link className="ld-lockup" to="/" aria-label="Mudavym home">
            <Seal size={22} />
            <Wordmark size={20} />
          </Link>
          <nav aria-label="Page">
            <Link className="ld-nav-hide" to="/">
              The platform
            </Link>
            <Link to="/login">Sign in</Link>
            <Go className="ld-btn ld-btn-sm" />
          </nav>
        </div>
        <span className="ld-progress" aria-hidden="true" />
      </header>

      <nav className="st-rail" aria-label="Chapters">
        <ol>
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <a href={'#' + c.id} aria-current={active === c.id ? 'step' : undefined}>
                {c.time}
                <span className="st-sr">, {c.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main>
        <section className="st-hero">
          <div className="ld-wrap st-hero-in">
            <p className="ld-eyebrow ld-enter" style={{ '--d': 0 } as CSSProperties}>
              A story in one night
            </p>
            <h1>
              {['Every', 'restaurant', 'runs', 'two', 'businesses'].map((w, i) => (
                <Fragment key={i}>
                  <span className="ld-word ld-enter" style={{ '--d': 1 + i * 0.5 } as CSSProperties}>
                    {w}
                  </span>{' '}
                </Fragment>
              ))}
              <span className="ld-word ld-seal-word ld-enter" style={{ '--d': 4 } as CSSProperties}>
                at once.
              </span>
            </h1>
            <p className="st-hero-sub ld-enter" style={{ '--d': 5 } as CSSProperties}>
              One out front, with the guests. One behind it, with the paper: invoices, counts, orders and vendor mail.
              This is one night of the second one.
            </p>
            <p className="st-hero-note ld-enter" style={{ '--d': 6 } as CSSProperties}>
              A sample house on a sample night. Every name, time and number in this story is invented.
            </p>
            <p className="st-cue ld-enter" style={{ '--d': 7 } as CSSProperties}>
              <i aria-hidden="true" /> Scroll to start the night
            </p>
          </div>
        </section>

        <Chapter
          id="st-old"
          night
          len={230}
          kicker="Most nights"
          title="The second business starts after close."
          pic={
            <>
              <div className="st-pile">
                <Scraps />
              </div>
              <p className="st-sample">Sample scraps. The vendor, the wines and the counts are invented.</p>
            </>
          }
        >
          <p>
            Invoices in a drawer. A count half done on a clipboard. Vendor mail nobody answered. Someone stays late to make
            them agree.
          </p>
        </Chapter>

        <Chapter
          id="st-turn"
          len={220}
          kicker="The same house"
          title="Tonight, one system keeps the back."
          pic={
            <div className="st-pile st-gather">
              <Scraps gather />
              <div className="st-unit" {...k('pop', 58, 84)}>
                <span className="st-unit-lock">
                  <Seal size={26} />
                  <Wordmark size={22} />
                </span>
                <ul>
                  <li>Reads</li>
                  <li>Counts</li>
                  <li>Drafts</li>
                  <li>Asks</li>
                </ul>
              </div>
            </div>
          }
        >
          <p>
            The same house, the same night. Mudavym reads, counts, drafts and asks. Follow one delivery and one bottle
            from the door to close.
          </p>
        </Chapter>

        <Chapter
          id="st-door"
          len={230}
          kicker="The delivery"
          title="It arrives."
          pic={
            <>
              <div className="st-door">
                <div className="st-paper st-docbg" {...k('paper', 0, 40)}>
                  <header>
                    <b>Northfield Wine Co.</b>
                    <span>Invoice 20931</span>
                  </header>
                  <div className="st-paper-lines" aria-hidden="true">
                    {['86%', '64%', '78%', '52%', '70%', '40%'].map((w, i) => (
                      <i key={i} style={{ '--w': w } as CSSProperties} />
                    ))}
                  </div>
                  <footer>
                    <span>48 bottles</span>
                    <span>{money(LINES.reduce((t, l) => t + QTY * l.price, 0))}</span>
                  </footer>
                </div>
                {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                  <span key={c} className={'st-corner is-' + c} aria-hidden="true" {...k('frame', 34, 58)} />
                ))}
                <span className="st-flash" aria-hidden="true" {...k('flash', 60, 78)} />
              </div>
              <p className="st-caption" {...k('rise', 74, 92)}>
                Photo taken at the door, 4:10 pm.
              </p>
              <p className="st-sample">A sample invoice. The vendor, the wines and the prices are invented.</p>
            </>
          }
        >
          <p>A case comes in with a paper invoice. Someone at the door takes a photo of it. That is the whole job at the door.</p>
        </Chapter>

        <Chapter
          id="st-read"
          len={240}
          kicker="The invoice"
          title="It is read."
          pic={
            <>
              <div className="st-doc st-docbg">
                <span className="st-scan" aria-hidden="true" {...k('scan', 6, 76)} />
                <header>
                  <b>Northfield Wine Co.</b>
                  <span>Invoice 20931</span>
                </header>
                <Lines />
                <span className="st-chip" {...k('pop', 80, 94)}>
                  <Check aria-hidden="true" strokeWidth={2.4} /> Matched to order 2207
                </span>
              </div>
              <p className="st-sample">The same sample invoice, as lines.</p>
            </>
          }
        >
          <p>Every line comes off the page: item, size, count and price, matched to the order you placed.</p>
        </Chapter>

        <Chapter
          id="st-check"
          len={260}
          kicker="The prices"
          title="It is checked."
          pic={
            <>
              <div className="st-doc st-docbg">
                <header>
                  <b>Against what you agreed</b>
                  <span>Order 2207</span>
                </header>
                <Lines checked />
                <span className="st-stamp" aria-hidden="true" {...k('stamp', 66, 78)}>
                  Held
                </span>
                <div className="st-held" {...k('rise', 70, 86)}>
                  <span>Line 3: agreed {money(19.8)}, billed {money(22.5)}</span>
                  <b>{money(HELD)} held</b>
                </div>
              </div>
              <p className="st-sample">A sample price check. The agreed price is invented.</p>
            </>
          }
        >
          <p>Prices against what you agreed, counts against what came through the door. Anything off is held.</p>
        </Chapter>

        <Chapter
          id="st-shelf"
          len={250}
          kicker="The stock"
          title="It is counted."
          pic={
            <div className="st-shelfpic">
              <p className="st-count">
                <span>Sancerre on the shelf</span>
                <b>
                  <Reel from={6} to={18} a0={10} a1={84} />
                </b>
              </p>
              <div className="st-shelf" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={'old' + i} className="st-bottle is-old" />
                ))}
                {Array.from({ length: QTY }, (_, i) => (
                  <span key={'new' + i} className="st-bottle" {...k('drop', 8 + i * 6, 16 + i * 6)} />
                ))}
                <i className="st-plank" />
              </div>
              <p className="st-caption" {...k('rise', 84, 96)}>
                48 bottles in, across four lines.
              </p>
              <p className="st-sample">Sample counts.</p>
            </div>
          }
        >
          <p>What arrived goes into stock by the bottle, so tonight’s count already knows.</p>
        </Chapter>

        <Chapter
          id="st-dusk"
          len={220}
          kicker="Service"
          title="Doors open."
          pic={
            <div className="st-sky" aria-hidden="true">
              <span className="st-sky-night" {...k('fade', 18, 78)} />
              {STARS.map(([x, y], i) => (
                <i key={i} className="st-star" {...k('fade', 44 + i * 5, 54 + i * 5, { '--x': x, '--y': y })} />
              ))}
              <span className="st-sun" {...k('sink', 0, 72)} />
              <span className="st-house" />
              {['22%', '34%', '46%', '66%', '80%'].map((x, i) => (
                <span key={x} className="st-win" {...k('fade', 62 + i * 5, 72 + i * 5, { '--x': x })} />
              ))}
            </div>
          }
        >
          <p>From here the house is busy out front. The rest of this story happens while they serve.</p>
        </Chapter>

        <div className="st-fall" aria-hidden="true" data-rail="st-dusk" />

        <Chapter
          id="st-pour"
          night
          len={260}
          kicker="By the glass"
          title="It is poured."
          pic={
            <>
              <div className="st-bar">
                <div className="st-big" aria-hidden="true">
                  <span className="st-wine" {...k('drain', 10, 80, { '--n': 5 })} />
                </div>
                <div>
                  <ol className="st-glasses" aria-hidden="true">
                    {Array.from({ length: 5 }, (_, i) => (
                      <li key={i} className="st-glass" {...k('pop', 18 + i * 14, 24 + i * 14)} />
                    ))}
                  </ol>
                  <p className="st-tally">
                    <span>Albariño 2023, glasses poured</span>
                    <b>
                      <Reel from={0} to={5} a0={10} a1={80} />
                    </b>
                    <span>Albariño 2023, bottles left</span>
                    <b>
                      <Reel from={4} to={3} a0={80} a1={90} />
                    </b>
                  </p>
                </div>
              </div>
              <p className="st-sample">A sample bottle, five sample glasses.</p>
            </>
          }
        >
          <p>Deliveries and sales move the count by the bottle, and an open bottle by the glass poured.</p>
        </Chapter>

        <Chapter
          id="st-ask"
          night
          len={200}
          kicker="Before close"
          title="It asks."
          pic={
            <div className="st-asks">
              <p className="st-notice" {...k('rise', 0, 22)}>
                <Wine aria-hidden="true" strokeWidth={1.75} /> Albariño 2023 is down to 3 bottles. Your par is 12.
              </p>
              <article className="st-ask" data-ask="order" data-sent={order || undefined} {...k('rise', 16, 42)}>
                <header>
                  <span>
                    <ShoppingCart aria-hidden="true" strokeWidth={1.75} /> Orders
                  </span>
                  <span className="ld-mono">11:20 pm</span>
                </header>
                <p>Order to Northfield Wine Co. drafted: Albariño 2023, 9 bottles.</p>
                <div className="st-ask-act">
                  {order ? (
                    <>
                      <span className="st-sent">
                        <Check aria-hidden="true" strokeWidth={2.4} /> Sent by you
                      </span>
                      <button type="button" className="st-undo" aria-label="Undo the order" onClick={() => answer('order', false)}>
                        Undo
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ld-btn ld-btn-sm" aria-label="Approve the order" onClick={() => answer('order', true)}>
                      Approve
                    </button>
                  )}
                </div>
              </article>
              <article className="st-ask" data-ask="reply" data-sent={reply || undefined} {...k('rise', 32, 58)}>
                <header>
                  <span>
                    <Mail aria-hidden="true" strokeWidth={1.75} /> Mail
                  </span>
                  <span className="ld-mono">11:21 pm</span>
                </header>
                <p>Reply to Northfield drafted, asking for {money(HELD)} back on line 3.</p>
                <div className="st-ask-act">
                  {reply ? (
                    <>
                      <span className="st-sent">
                        <Check aria-hidden="true" strokeWidth={2.4} /> Sent by you
                      </span>
                      <button type="button" className="st-undo" aria-label="Undo the reply" onClick={() => answer('reply', false)}>
                        Undo
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ld-btn ld-btn-sm" aria-label="Approve the reply" onClick={() => answer('reply', true)}>
                      Approve
                    </button>
                  )}
                </div>
              </article>
              <p className="st-try">Try it. Nothing leaves this page.</p>
              <p className="st-sr" role="status">
                {said}
              </p>
            </div>
          }
        >
          <p>Albariño is under its par. The order is drafted, and so is a reply asking for the {money(HELD)} back.</p>
          <p>
            Orders and replies to vendors wait for a person to approve them. Automatic replies stay off until you
            turn them on.
          </p>
        </Chapter>

        <Chapter
          id="st-close"
          night
          len={220}
          kicker="Close"
          title="It closes."
          pic={
            <>
              <div className="st-receipt st-docbg">
                <span className="st-unroll" aria-hidden="true" {...k('unroll', 6, 86)} />
                <header>
                  <Seal size={18} /> Tuesday, closed 12:05 am
                </header>
                <dl>
                  <dt>Northfield, invoice 20931</dt>
                  <dd>48 bottles in</dd>
                  <dt>Line 3, held</dt>
                  <dd>{money(HELD)}</dd>
                  <dt>Albariño 2023 by the glass</dt>
                  <dd>5 poured</dd>
                  <dt>Order, 9 bottles</dt>
                  <dd className={order ? undefined : 'is-wait'}>{order ? 'Sent by you' : wait}</dd>
                  <dt>Reply on line 3</dt>
                  <dd className={reply ? undefined : 'is-wait'}>{reply ? 'Sent by you' : wait}</dd>
                </dl>
                <footer>A sample night</footer>
              </div>
            </>
          }
        >
          <p>The count already knows what came in tonight and what was poured. Anything that needs your yes is still waiting for it.</p>
        </Chapter>

        {/* Further out, and not built yet: the landing's two future bands told as
            the day after. Job of the motion: the phone rings, the call is read a
            line at a time while the line is live, it ends on an offer waiting for
            a person, and only then does the food come into view, as the next
            thing and not a part of tonight. */}
        <Chapter
          id="st-next"
          night
          len={240}
          kicker="Not built yet"
          title="It will pick up the phone, too."
          stages
          pic={
            <div className="st-next">
              <figure className="st-call" data-stage aria-label="A sample call to a vendor">
                <div className="st-call-head" {...k('rise', 0, 10)}>
                  <span className="st-call-icon" aria-hidden="true" {...k('ring', 2, 12)}>
                    <PhoneCall strokeWidth={2} />
                  </span>
                  <div>
                    <b>Calling Northfield Wine Co.</b>
                    <small>Following up the reply on line 3</small>
                  </div>
                  <span className="st-call-wave" aria-hidden="true">
                    {WAVE.map((h, i) => (
                      <i key={i} {...k('talk', 12 + i, 58, { '--h': h })} />
                    ))}
                  </span>
                </div>
                <ol className="st-call-lines">
                  {CALL.map(([who, line], i) => (
                    <li key={line} className={`is-${who}`} {...k('rise', 12 + i * 12, 22 + i * 12)}>
                      <span>{who === 'us' ? 'Mudavym' : 'Northfield'}</span>
                      <p>{line}</p>
                    </li>
                  ))}
                </ol>
                <p className="st-call-end" {...k('pop', 58, 66)}>
                  <Check aria-hidden="true" strokeWidth={2.5} /> Offer brought back. <b>Waiting for your yes.</b>
                </p>
              </figure>
              <div className="st-soon" data-stage {...k('rise', 68, 80, { '--s0': 68 })}>
                <header>
                  <b>Predicting the food.</b>
                  <em>Coming soon</em>
                </header>
                <ul>
                  {SOON.map(([Icon, name], i) => (
                    <li key={name} {...k('pop', 74 + i * 5, 80 + i * 5)}>
                      <Icon aria-hidden="true" strokeWidth={1.75} /> {name}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="st-sample">Not built yet, and no date. A sample call: the bar, the vendor and the words are invented.</p>
            </div>
          }
        >
          <p>
            Mudavym will call your vendors: to ask for a better price, to chase a late delivery, to follow up on a
            credit. Every offer comes back to you. It agrees to nothing without your yes.
          </p>
          <p>Here it follows up the reply on line 3, once that reply has your yes.</p>
        </Chapter>

        <section className="st-end mudavym" data-ground="charcoal">
          <div className="ld-wrap" data-reveal>
            <h2>
              It runs itself. <span className="ld-seal">Never without you.</span>
            </h2>
            <p>Photograph your menu to set up the house, then the next invoice at the door.</p>
            <div className="ld-cta">
              <Go />
              <Link className="ld-btn-ghost" to="/login">
                Sign in
              </Link>
            </div>
            <p className="st-end-more">
              <Link to="/">See the whole platform</Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="ld-wrap">
          <Link className="ld-lockup" to="/" aria-label="Mudavym home">
            <Seal size={18} />
            <Wordmark size={16} />
          </Link>
          <nav aria-label="Legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default Story;
