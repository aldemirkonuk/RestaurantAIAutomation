/**
 * The landing page at `/` for a stranger (ADR 0320, rebuilt by ADR 0344).
 *
 * The whole platform in one read: a sample house's evening running in the hero,
 * the seven places a back office lives settling into one system, what each part
 * does, one delivery followed from the door to the books, the same evening with
 * and without it, what it notices, the reader's own week in hours (it promises
 * no saving), how it asks before it acts, what happens to the house's data,
 * the goals it is built toward, the vendor calls it will make (not built, no
 * date), what is coming after the back office (predicting the food itself,
 * parked by ADR 0342, so it says it is not built and prints no figure and no
 * date), plain answers, the price line and one button.
 * Every figure and name on the page is a sample and is labelled as one beside
 * it. The page sets no cookie, loads no third-party script and sends
 * nothing anywhere; every link is a route of the app or an anchor on the page.
 *
 * Every motion has a stated job, written beside it. Motion is transform and
 * opacity only, there is no window scroll listener (IntersectionObservers do
 * that work), and `prefers-reduced-motion` shows every finished state at once.
 *
 * Colours come from the `.mudavym` tokens, so the page follows the person's
 * ground choice (ADR 0169). The copy carries no em or en dash, like every other
 * public page (seo.test.ts).
 */
import { CSSProperties, Fragment, MouseEvent, ReactNode, Ref, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  EyeOff,
  FileText,
  Grape,
  KeyRound,
  Lock,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  Receipt,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  WifiOff,
  Wine,
} from 'lucide-react';
import { Seal } from '../../components/mudavym/Seal';
import { Wordmark } from '../../components/mudavym/Wordmark';
import './landing.css';
import { CTA, JOIN, START } from './doors';

// The button's words and the two doors into the form live in ./doors, so /story
// can share them without loading this page.
export { CTA, JOIN, START } from './doors';

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function hasObserver(): boolean {
  return typeof IntersectionObserver === 'function';
}

function money(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function Go({
  to,
  className = 'ld-btn',
  innerRef,
  tabIndex,
}: {
  to: string;
  className?: string;
  innerRef?: Ref<HTMLAnchorElement>;
  tabIndex?: number;
}) {
  return (
    <Link className={className} to={to} ref={innerRef} tabIndex={tabIndex}>
      {CTA} <ArrowRight aria-hidden="true" strokeWidth={2} />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* The evening feed: what the system does while the house is serving.  */
/* ------------------------------------------------------------------ */

type Agent = 'Receiving' | 'Cellar' | 'Orders' | 'Mail' | 'Sales' | 'Insights' | 'Counts';

const AGENT_ICON: Record<Agent, ReactNode> = {
  Receiving: <Receipt aria-hidden="true" />,
  Cellar: <Wine aria-hidden="true" />,
  Orders: <ShoppingCart aria-hidden="true" />,
  Mail: <Mail aria-hidden="true" />,
  Sales: <TrendingUp aria-hidden="true" />,
  Insights: <Sparkles aria-hidden="true" />,
  Counts: <ClipboardList aria-hidden="true" />,
};

interface FeedEvent {
  agent: Agent;
  text: string;
  /** What waits for a person, and what it reads once they said yes. */
  ask?: [string, string];
}

/** A sample evening. Every vendor, person and number is invented; the card says so. */
export const EVENTS: readonly FeedEvent[] = [
  { agent: 'Receiving', text: 'Invoice from Northfield Wine Co. read. 14 lines, one price above what you agreed.', ask: ['Hold line 3', 'Held'] },
  { agent: 'Cellar', text: 'Albariño 2023 is down to 4 bottles. Your par is 12.', ask: ['Draft order', 'Drafted'] },
  { agent: 'Mail', text: 'Harbor Line Spirits moved Thursday to Friday. Your calendar has it.' },
  { agent: 'Sales', text: 'Lunch sales are in. 86 covers, 41 drinks poured, stock moved to match.' },
  { agent: 'Orders', text: 'Order to Mission Street Produce drafted from last week’s sales.', ask: ['Approve', 'Sent by you'] },
  { agent: 'Insights', text: 'Gin 1 L cost rose 8% over three deliveries. The agreed price did not.', ask: ['Ask for credit', 'Draft ready'] },
  { agent: 'Counts', text: 'Bar count closed by Ana. 212 bottles, 3 short against sales.' },
  { agent: 'Mail', text: 'Reply to Northfield drafted, asking for $32.40 back on line 3.', ask: ['Approve', 'Sent by you'] },
];

interface FeedItem {
  id: number;
  ev: FeedEvent;
  done: boolean;
  time: string;
}

const FEED_ROWS = 5;
/** One new event every so often: slow enough to read each one. */
const FEED_STEP = 2600;
/** How long an ask waits before the sample person says yes. */
const FEED_YES = 1500;

function clock(i: number): string {
  // A sample evening from 5:02 pm, seven minutes a beat, wrapping before 11 pm.
  const m = 17 * 60 + ((2 + i * 7) % (6 * 60));
  const h = Math.floor(m / 60) % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')} pm`;
}

/** The evening so far, newest first. Still, the asks stay open: that is what waits for a person. */
function seed(reduced: boolean): FeedItem[] {
  const n = reduced ? FEED_ROWS : 4;
  return EVENTS.slice(0, n)
    .map((ev, i) => ({ id: i, ev, done: reduced ? !ev.ask : true, time: clock(i) }))
    .reverse();
}

function Feed({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<FeedItem[]>(() => seed(reduced));
  const next = useRef(items.length);
  const [live, setLive] = useState(!hasObserver());

  // The feed runs only while it is on screen: a reader who scrolled past is not
  // paying for an evening they cannot see.
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || !hasObserver()) return;
    const io = new IntersectionObserver((es) => setLive(es.some((e) => e.isIntersecting)), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  // Job: show the system working while the house serves. A new event arrives at
  // the top, the rest step down, and an ask turns to its answer once the sample
  // person says yes, so "waiting for you" counts down in front of the reader.
  useEffect(() => {
    if (reduced || !live) return;
    let yes: number | undefined;
    const tick = window.setInterval(() => {
      const id = next.current++;
      const ev = EVENTS[id % EVENTS.length];
      setItems((prev) => [{ id, ev, done: !ev.ask, time: clock(id) }, ...prev].slice(0, FEED_ROWS + 1));
      if (ev.ask) {
        yes = window.setTimeout(
          () => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, done: true } : it))),
          FEED_YES,
        );
      }
    }, FEED_STEP);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(yes);
    };
  }, [reduced, live]);

  const waiting = items.slice(0, FEED_ROWS).filter((it) => !it.done).length;

  return (
    <div className="ld-feed" ref={ref}>
      <div className="ld-feed-head">
        <div>
          <b>Tonight at a sample house</b>
          <span>Every name and number here is invented.</span>
        </div>
        <span className="ld-live" aria-hidden="true">
          <i /> Running
        </span>
      </div>
      <ol className="ld-feed-list" aria-label="A sample evening, newest first" aria-live="off">
        {items.map((it, i) => (
          <li
            key={it.id}
            className={'ld-ev' + (i >= FEED_ROWS ? ' is-out' : '')}
            style={{ '--row': i } as CSSProperties}
            aria-hidden={i >= FEED_ROWS ? true : undefined}
          >
            <span className="ld-ev-icon">{AGENT_ICON[it.ev.agent]}</span>
            <div className="ld-ev-body">
              <div className="ld-ev-meta">
                <span>{it.ev.agent}</span>
                <span className="ld-mono">{it.time}</span>
              </div>
              <p>{it.ev.text}</p>
            </div>
            {it.ev.ask ? (
              <span className={'ld-ev-ask' + (it.done ? ' is-done' : '')}>
                {it.done ? (
                  <>
                    <Check aria-hidden="true" strokeWidth={2.5} /> {it.ev.ask[1]}
                  </>
                ) : (
                  it.ev.ask[0]
                )}
              </span>
            ) : (
              <span className="ld-ev-ok" aria-label="Done">
                <Check aria-hidden="true" strokeWidth={2.5} />
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="ld-feed-foot">
        <span>Waiting for you</span>
        <b className="ld-mono" key={waiting}>
          {waiting}
        </b>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seven places a back office lives, settling into one.                */
/* ------------------------------------------------------------------ */

/** [what it is today, what it becomes, scatter x, y (px), turn (deg)] */
const SCATTER: readonly [string, string, number, number, number][] = [
  ['Paper invoices', 'Receiving', -46, -34, -9],
  ['The cellar spreadsheet', 'Inventory', 38, -52, 7],
  ['Vendor texts', 'Vendor mail', -60, 26, 6],
  ['A sales export', 'Sales', 52, 18, -8],
  ['The clipboard count', 'Counts', -24, 58, 11],
  ['Four inboxes', 'One inbox', 64, 46, -5],
  ['A calculator', 'Insights', -8, -66, 4],
];

/* ------------------------------------------------------------------ */
/* The platform: what each part does, each with its picture.           */
/* ------------------------------------------------------------------ */

function MiniInvoice() {
  const rows: [string, string, boolean?][] = [
    ['Prosecco NV', '12 × 11.40'],
    ['Albariño 2023', '12 × 14.20'],
    ['Sancerre 2023', '12 × 22.50', true],
    ['Rioja Crianza 2020', '12 × 12.10'],
  ];
  return (
    <div className="ld-mini-doc" aria-hidden="true">
      <span className="ld-mini-scan" />
      {rows.map(([a, b, bad], i) => (
        <div key={a} className={'ld-mini-row' + (bad ? ' is-bad' : '')} style={{ '--i': i } as CSSProperties}>
          <span>{a}</span>
          <span className="ld-mono">{b}</span>
          {bad ? <em>Agreed 19.80</em> : <Check strokeWidth={2.5} />}
        </div>
      ))}
    </div>
  );
}

function MiniShelf() {
  const bars = [0.82, 0.64, 0.22, 0.9, 0.55];
  return (
    <div className="ld-mini-shelf" aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} className={h < 0.3 ? 'is-low' : undefined} style={{ '--h': h, '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

function MiniOrder() {
  return (
    <div className="ld-mini-order" aria-hidden="true">
      <div className="ld-mini-par">
        <span>Par 12</span>
        <i />
      </div>
      <div className="ld-mini-po">
        <ShoppingCart strokeWidth={2} /> Draft order: 8 bottles
      </div>
    </div>
  );
}

function MiniMail() {
  return (
    <div className="ld-mini-mail" aria-hidden="true">
      <p className="ld-bub ld-bub-in">Can we move Thursday&rsquo;s delivery to Friday?</p>
      <p className="ld-bub ld-bub-out">
        <span>Draft</span>Friday works. Please bring the six missing bottles of vodka with it.
      </p>
    </div>
  );
}

function MiniPos() {
  const rows: [string, string][] = [
    ['A sales export', 'Today'],
    ['Toast', 'In progress'],
    ['Square, Clover', 'Next'],
  ];
  return (
    <ul className="ld-mini-pos">
      {rows.map(([a, b], i) => (
        <li key={a} style={{ '--i': i } as CSSProperties}>
          <span>{a}</span>
          <b>{b}</b>
        </li>
      ))}
    </ul>
  );
}

function MiniSpark() {
  return (
    <svg className="ld-mini-spark" viewBox="0 0 240 70" aria-hidden="true" preserveAspectRatio="none">
      <path className="ld-spark-agreed" d="M4 52 H236" />
      <path className="ld-spark-line" pathLength={1} d="M4 52 L60 50 L118 44 L176 30 L236 18" />
      <path className="ld-spark-dot" d="M236 18 h0" />
    </svg>
  );
}

function MiniAsk() {
  return (
    <div className="ld-mini-ask" aria-hidden="true">
      <p className="ld-ask-q">
        <MessageSquare strokeWidth={2} />
        <span>What did we spend on wine in September?</span>
      </p>
      <p className="ld-ask-a">
        <span className="ld-mono">$18,240</span> across 9 deliveries, 6% more than August. Most of the rise is two
        vendors.
      </p>
    </div>
  );
}

interface Part {
  key: string;
  title: string;
  body: string;
  picture: ReactNode;
}

const PARTS: readonly Part[] = [
  {
    key: 'rec',
    title: 'Every invoice, read.',
    body: 'A photo of the paper is enough. Each line is read, matched to what you ordered and checked against the price you agreed.',
    picture: <MiniInvoice />,
  },
  {
    key: 'inv',
    title: 'Stock you can trust.',
    body: 'Deliveries and sales move the count by the bottle, and an open bottle by the glass poured.',
    picture: <MiniShelf />,
  },
  {
    key: 'ord',
    title: 'Orders before you run out.',
    body: 'Pars and what sold last week draft the next order. You change it or send it.',
    picture: <MiniOrder />,
  },
  {
    key: 'mail',
    title: 'One inbox for every vendor.',
    body: 'Vendor email lands in one place, is understood, and gets a reply drafted in your voice.',
    picture: <MiniMail />,
  },
  {
    key: 'pos',
    title: 'Sales from your POS.',
    body: 'What sold moves what is on the shelf.',
    picture: <MiniPos />,
  },
  {
    key: 'ins',
    title: 'It notices before you do.',
    body: 'A price that creeps, a bottle that stopped selling, a count that does not match the sales.',
    picture: <MiniSpark />,
  },
  {
    key: 'ask',
    title: 'Ask it anything.',
    body: 'Questions about the house get answers from your own records, with the numbers behind them.',
    picture: <MiniAsk />,
  },
];

/* ------------------------------------------------------------------ */
/* One delivery, from the door to the books.                           */
/* ------------------------------------------------------------------ */

interface Beat {
  title: string;
  body: string;
}

const BEATS: readonly Beat[] = [
  { title: 'It arrives.', body: 'Someone at the door takes a photo of the paper invoice. That is the whole job at the door.' },
  { title: 'It is read.', body: 'Every line comes off the page: item, size, count and price, matched to the order you placed.' },
  { title: 'It is checked.', body: 'Prices against what you agreed, counts against what came through the door. Anything off is held.' },
  { title: 'It is counted.', body: 'What arrived goes into stock by the bottle, so tonight’s count already knows.' },
  { title: 'It is answered.', body: 'A credit request is drafted to the vendor with the lines and the numbers. You approve it.' },
  { title: 'It is remembered.', body: 'The agreed price, the six still owed, the vendor’s habits. The next order starts from all of it.' },
];

interface StageLine {
  item: string;
  qty: number;
  unit: number;
  flag?: string;
}

/** The sample delivery. Every price is invented; the stage says so. */
const STAGE_LINES: readonly StageLine[] = [
  { item: 'Prosecco NV, 750 ml', qty: 12, unit: 11.4 },
  { item: 'Albariño 2023, 750 ml', qty: 12, unit: 14.2 },
  { item: 'Sancerre 2023, 750 ml', qty: 12, unit: 22.5, flag: 'Agreed $19.80. $32.40 over.' },
  { item: 'Rioja Crianza 2020, 750 ml', qty: 12, unit: 12.1 },
  { item: 'Vodka, 1 L', qty: 12, unit: 19.5, flag: 'Six came, twelve billed. $117.00 over.' },
];
/** $32.40 (Sancerre's price) + $117.00 (vodka's count). */
const OVER = 149.4;

function Stage({ step }: { step: number }) {
  const cls = ['ld-stage'];
  for (let i = 0; i <= step; i++) cls.push('s' + i);
  const result: ReactNode[] = [
    <>Photo taken at the door, 4:10 pm.</>,
    <>5 lines read. Matched to order 1043.</>,
    <>
      2 lines disagree. <b className="ld-mono">{money(OVER)}</b> held.
    </>,
    <>54 bottles into the cellar. Vodka: 6, not 12.</>,
    <>Credit request drafted. Waiting for your yes.</>,
    <>Kept: Sancerre at $19.80. Six vodka still owed.</>,
  ];
  return (
    <div className={cls.join(' ')} aria-hidden="true">
      <div className="ld-stage-doc">
        <span className="ld-stage-flash" />
        <div className="ld-stage-head">
          <div>
            <b>Larkspur Cellars</b>
            <span>Invoice 20931, Tuesday</span>
          </div>
          <span className="ld-stage-sample">Sample</span>
        </div>
        <ul>
          {STAGE_LINES.map((l, i) => (
            <li key={l.item} className={l.flag ? 'is-flag' : undefined} style={{ '--i': i } as CSSProperties}>
              <span className="ld-stage-item">{l.item}</span>
              <span className="ld-mono">
                {l.qty} &times; {l.unit.toFixed(2)}
              </span>
              {l.flag ? <em>{l.flag}</em> : null}
            </li>
          ))}
        </ul>
        <div className="ld-stage-cellar">
          <Wine strokeWidth={2} />
          <span>Cellar</span>
          <b className="ld-mono">+54</b>
        </div>
      </div>
      <div className="ld-stage-draft">
        <div className="ld-stage-draft-head">
          <Mail strokeWidth={2} /> To Larkspur Cellars
        </div>
        <p>
          Line 3 was billed at $22.50; we agreed $19.80. On line 5, six bottles came and twelve were billed. Please
          credit {money(OVER)}.
        </p>
        <span className="ld-stage-yes">
          <Check strokeWidth={2.5} /> Sent by you
        </span>
      </div>
      <div className="ld-stage-result">
        {result.map((r, i) => (
          <p key={i} className={i === step ? 'is-now' : undefined}>
            {r}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What it notices.                                                     */
/* ------------------------------------------------------------------ */

interface Notice {
  kind: string;
  text: string;
  worth?: string;
  /** A tiny picture: a line (points 0..1, higher is more) or bars. */
  line?: number[];
  bars?: number[];
}

const NOTICES: readonly Notice[] = [
  {
    kind: 'Price drift',
    text: 'Gin 1 L went from $24.00 to $25.90 over three deliveries. You agreed $24.00.',
    worth: money(12 * 1.9) + ' on the last delivery',
    line: [0.2, 0.32, 0.5, 0.82],
  },
  {
    kind: 'Billed, not delivered',
    text: 'Mission Street Produce billed 24 cases of limes on an order for 12.',
    worth: money(12 * 15.5) + ' to claim',
    bars: [0.45, 0.9],
  },
  {
    kind: 'Sitting still',
    text: 'Seven bottles of Barolo 2019 have not sold in 63 days. Feature it or stop reordering it.',
    worth: money(7 * 66) + ' on the shelf',
    line: [0.6, 0.58, 0.6, 0.59],
  },
  {
    kind: 'Running short',
    text: 'Your last four Saturdays each beat the one before. Your lime par is two cases short.',
    bars: [0.4, 0.55, 0.7, 0.88],
  },
  {
    kind: 'Cost creep',
    text: 'Wine cost was 31.4% of wine sales last week, up from 28.9%.',
    line: [0.3, 0.34, 0.33, 0.62],
  },
  {
    kind: 'A better source',
    text: 'Two vendors carry your Albariño. Larkspur is $1.10 a bottle less, and delivers Thursdays.',
    worth: money(36 * 1.1) + ' a month at your pace',
    bars: [0.8, 0.68],
  },
];

function NoticePicture({ n }: { n: Notice }) {
  if (n.line) {
    const pts = n.line.map((v, i) => `${8 + (i * 104) / (n.line!.length - 1)},${44 - v * 36}`);
    return (
      <svg viewBox="0 0 120 50" className="ld-np" aria-hidden="true">
        <polyline pathLength={1} points={pts.join(' ')} />
      </svg>
    );
  }
  return (
    <span className="ld-np ld-np-bars" aria-hidden="true">
      {(n.bars ?? []).map((v, i) => (
        <i key={i} style={{ '--h': v, '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Goals.                                                               */
/* ------------------------------------------------------------------ */

const GOALS: readonly [string, string][] = [
  ['Typing invoices by hand', 'Reading them from a photo'],
  ['Counting the cellar all night', 'Counting as you go'],
  ['Finding the overcharge next month', 'Catching it at the door'],
  ['Guessing the order', 'Ordering from what sold'],
  ['Chasing vendors across four inboxes', 'One inbox, replies drafted'],
];

const ROAD: readonly [string, string, string][] = [
  ['Now', 'The whole bar.', 'Wine, beer, spirits and everything behind the bar: invoices, counts, orders and vendor mail.'],
  ['Next', 'Your POS, connected.', 'Toast first, then Square and Clover, so what sells moves your stock without an export.'],
  ['Then', 'The bakery.', 'Flour to finished loaf: ingredients, recipes, batches and waste. The first step into food.'],
  ['After that', 'The whole kitchen.', 'Every station and every ingredient, from the delivery door to the plate.'],
];

/* ------------------------------------------------------------------ */
/* Coming soon: predicting the food itself. Taste prediction is parked  */
/* as research (ADR 0342), so this says what is coming and prints no     */
/* figure and no date. The map is a picture, labelled as a sample.      */
/* ------------------------------------------------------------------ */

const SOON: readonly [ReactNode, string, string][] = [
  [<ChefHat key="t" />, 'How it will taste.', 'A dish read as parts you can measure, so a new plate can be judged before the first one leaves the pass.'],
  [<Grape key="p" />, 'What to pour beside it.', 'Pairings from what the dish and the bottle are made of, and from what your guests already order together.'],
  [<Users key="g" />, 'Who will love it.', 'Learned from your own house’s sales, not from a stranger’s star ratings.'],
];

/** [name, dish or pour, x across lighter to richer, y down brighter to earthier, label on the left]. Invented. */
const TASTE: readonly [string, 'dish' | 'pour', number, number, boolean?][] = [
  ['Oysters', 'dish', 11, 17],
  ['Sancerre', 'pour', 31, 9],
  ['Ceviche', 'dish', 15, 31],
  ['Albariño', 'pour', 39, 23],
  ['Roast chicken', 'dish', 47, 43],
  ['Pinot noir', 'pour', 70, 34],
  ['Short rib', 'dish', 64, 74, true],
  ['Rioja', 'pour', 88, 66, true],
  ['Lamb shoulder', 'dish', 80, 87, true],
  ['Barolo', 'pour', 93, 76, true],
];
/** The dish nobody has cooked yet, and the pour read from where it lands. */
const TASTE_NEW: [number, number] = [26, 66];
const TASTE_MATCH: [number, number] = [52, 54];
const PRINT: readonly [string, number][] = [
  ['Sweet', 0.34],
  ['Sour', 0.22],
  ['Salt', 0.52],
  ['Bitter', 0.3],
  ['Savory', 0.74],
  ['Rich', 0.84],
];

/** A section's number and name. Job of its motion: the rule draws first, so the
 *  eye knows a new part of the page begins before it reads the heading. */
function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="ld-kicker" data-reveal>
      <span className="ld-mono">{n}</span>
      {children}
    </p>
  );
}

function TasteMap() {
  return (
    <figure
      className="ld-taste"
      data-reveal
      role="img"
      aria-label="A sample taste map: dishes and wines placed by how they taste, and a dish nobody has cooked yet placed among them, with the wine to pour beside it."
    >
      <div className="ld-taste-head">
        <span className="ld-taste-key">
          <i className="is-dish" /> Dishes <i className="is-pour" /> Wines
        </span>
        <span className="ld-stage-sample">Sample</span>
      </div>
      <div className="ld-taste-map">
        <span className="ld-taste-x">
          <i>lighter</i>
          <i>richer</i>
        </span>
        <span className="ld-taste-y">
          <i>brighter</i>
          <i>earthier</i>
        </span>
        <svg className="ld-taste-link" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1={TASTE_NEW[0]} y1={TASTE_NEW[1]} x2={TASTE_MATCH[0]} y2={TASTE_MATCH[1]} />
        </svg>
        {TASTE.map(([name, kind, x, y, left], i) => (
          <span
            key={name}
            className={`ld-dot is-${kind}${left ? ' is-left' : ''}`}
            style={
              {
                '--x': `${x}%`,
                '--y': `${y}%`,
                '--fx': `${((i * 37) % 9) * 14 - 56}px`,
                '--fy': `${((i * 53) % 7) * 16 - 48}px`,
                '--i': i,
              } as CSSProperties
            }
          >
            <i />
            {name}
          </span>
        ))}
        <span
          className="ld-dot is-pour is-match"
          style={{ '--x': `${TASTE_MATCH[0]}%`, '--y': `${TASTE_MATCH[1]}%` } as CSSProperties}
        >
          <i />
          Chardonnay
        </span>
        <span
          className="ld-dot is-new"
          style={{ '--x': `${TASTE_NEW[0]}%`, '--y': `${TASTE_NEW[1]}%` } as CSSProperties}
        >
          <i />
          New dish
        </span>
      </div>
      <div className="ld-taste-print">
        <div className="ld-taste-print-head">
          <b>Charred leeks, brown butter</b>
          <span>Not cooked yet</span>
        </div>
        <ul>
          {PRINT.map(([k, v], i) => (
            <li key={k} style={{ '--v': v, '--i': i } as CSSProperties}>
              <span>{k}</span>
              <i />
            </li>
          ))}
        </ul>
        <p>
          Pour beside it: <b>Chardonnay</b>
        </p>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* The same evening, twice: the way it goes now and the way it goes on  */
/* Mudavym, hour against hour.                                          */
/* ------------------------------------------------------------------ */

interface Moment {
  time: string;
  what: string;
  /** [what happens, its tag] the way it goes now. */
  was: [string, string];
  /** [what happens, its tag] on Mudavym. */
  now: [string, string];
}

/** A sample evening. The times and the price are invented; the section says so. */
export const EVENING: readonly Moment[] = [
  {
    time: '4:05 pm',
    what: 'The delivery',
    was: ['The driver waits while someone ticks cases off a paper invoice.', 'On paper'],
    now: ['One photo at the door. Every line is read and matched to the order.', 'Read'],
  },
  {
    time: '4:20 pm',
    what: 'A price',
    was: ['The Sancerre is billed $2.70 a bottle over the price you agreed. Nobody sees it.', 'Missed'],
    now: ['The $2.70 is caught on line 3, and a credit request waits for your yes.', 'Caught'],
  },
  {
    time: '6:15 pm',
    what: 'Vendor mail',
    was: ['A vendor writes about Thursday. The email sits in one of four inboxes.', 'Buried'],
    now: ['It is read, filed under the vendor, and a reply is drafted for you.', 'Drafted'],
  },
  {
    time: '11:40 pm',
    what: 'The close',
    was: ['The night’s invoices get typed into a spreadsheet after service.', 'After close'],
    now: ['The invoices are already in the books. You lock up.', 'Done'],
  },
  {
    time: 'Monday',
    what: 'The order',
    was: ['The order is written from memory and a walk through the cellar.', 'A guess'],
    now: ['The order is drafted from what sold and what is on the shelf, for your yes.', 'From sales'],
  },
];

/** Job of the motion: every hour flips from the old way to the new one, a beat
 *  apart, so the reader compares each hour with itself. It flips once on its own
 *  when first seen, so a reader who never touches the switch still sees both. */
function Evening({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [on, setOn] = useState(() => reduced || !hasObserver());

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || !hasObserver()) return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setOn(true);
        }, 1600);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduced]);

  const pick = (v: boolean) => {
    touched.current = true;
    setOn(v);
  };

  // The switch is an attribute, not a class, for the reason the approval card gives.
  return (
    <div className="ld-eve" ref={ref} data-on={on || undefined} data-reveal>
      <div className="ld-eve-switch" role="group" aria-label="Which evening to show">
        <span className="ld-eve-thumb" aria-hidden="true" />
        <button type="button" aria-pressed={!on} onClick={() => pick(false)}>
          Without Mudavym
        </button>
        <button type="button" aria-pressed={on} onClick={() => pick(true)}>
          With Mudavym
        </button>
      </div>
      <ol className="ld-eve-list">
        {EVENING.map((m, i) => (
          <li key={m.time} style={{ '--i': i } as CSSProperties}>
            <span className="ld-eve-time ld-mono">{m.time}</span>
            <div className="ld-eve-body">
              <b>{m.what}</b>
              <div className="ld-eve-swap">
                <p className="ld-eve-was" aria-hidden={on}>
                  {m.was[0]}
                </p>
                <p className="ld-eve-now" aria-hidden={!on}>
                  {m.now[0]}
                </p>
              </div>
            </div>
            <span className="ld-eve-tag" aria-hidden="true">
              <i className="ld-eve-was">{m.was[1]}</i>
              <i className="ld-eve-now">{m.now[1]}</i>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Your numbers: the reader's own week, added up on this page. It shows */
/* where the hours go now and claims no saving.                         */
/* ------------------------------------------------------------------ */

type DialKey = 'inv' | 'invMin' | 'mail' | 'mailMin' | 'count' | 'rate';

interface Dial {
  key: DialKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** A placeholder to move, not an average; the note under the sum says so. */
  start: number;
  show: (v: number) => string;
}

const DIALS: readonly Dial[] = [
  { key: 'inv', label: 'Invoices a week', min: 0, max: 60, step: 1, start: 14, show: (v) => `${v}` },
  { key: 'invMin', label: 'Minutes to type and check one', min: 1, max: 30, step: 1, start: 9, show: (v) => `${v} min` },
  { key: 'mail', label: 'Vendor emails and calls a week', min: 0, max: 120, step: 1, start: 30, show: (v) => `${v}` },
  { key: 'mailMin', label: 'Minutes on each', min: 1, max: 20, step: 1, start: 4, show: (v) => `${v} min` },
  { key: 'count', label: 'Hours counting stock a week', min: 0, max: 20, step: 0.5, start: 4, show: (v) => `${v} h` },
  { key: 'rate', label: 'What an hour of that time costs', min: 10, max: 80, step: 1, start: 25, show: (v) => `$${v}` },
];

/** A month here is 52 weeks over 12. The note under the sum says so. */
const WEEKS = 52 / 12;

function hours(n: number): string {
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/** The arithmetic, apart from the page so a test can hold it to the note's words. */
export function week(v: Record<DialKey, number>) {
  const parts: [string, number][] = [
    ['Invoices', ((v.inv * v.invMin) / 60) * WEEKS],
    ['Vendor mail', ((v.mail * v.mailMin) / 60) * WEEKS],
    ['Counting', v.count * WEEKS],
  ];
  const total = parts.reduce((s, [, h]) => s + h, 0);
  return { parts, total, cost: total * v.rate };
}

/** Job of the motion: the bars fill by chore when first seen and re-weigh as a
 *  slider moves, so the reader sees which chore the hours sit in. */
function Numbers() {
  const [v, setV] = useState(
    () => Object.fromEntries(DIALS.map((d) => [d.key, d.start])) as Record<DialKey, number>,
  );
  const { parts, total, cost } = week(v);
  const top = Math.max(...parts.map(([, h]) => h), 0.001);
  return (
    <div className="ld-calc" data-reveal>
      <div className="ld-calc-in" role="group" aria-label="Your week">
        {DIALS.map((d) => (
          <label key={d.key} className="ld-dial">
            <span className="ld-dial-top">
              <span>{d.label}</span>
              {/* The slider says its own value; this is the same value, for the eye. */}
              <b className="ld-mono" aria-hidden="true">
                {d.show(v[d.key])}
              </b>
            </span>
            <input
              type="range"
              min={d.min}
              max={d.max}
              step={d.step}
              value={v[d.key]}
              aria-label={d.label}
              aria-valuetext={d.show(v[d.key])}
              style={{ '--p': `${((v[d.key] - d.min) / (d.max - d.min)) * 100}%` } as CSSProperties}
              onChange={(e) => {
                const n = Number(e.target.value);
                setV((p) => ({ ...p, [d.key]: n }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="ld-calc-out">
        <span className="ld-calc-label">Your back office, every month</span>
        <p className="ld-calc-sum" aria-live="polite">
          <b className="ld-mono">{hours(total)}</b> hours
        </p>
        <p className="ld-calc-sub">
          That is <b>{(total / 8).toFixed(1)} working days</b> at eight hours a day, and{' '}
          <b>${Math.round(cost).toLocaleString('en-US')}</b> of paid time.
        </p>
        <ul className="ld-calc-bars">
          {parts.map(([name, h]) => (
            <li key={name}>
              <span>{name}</span>
              <span className="ld-calc-track">
                <i style={{ '--v': h / top } as CSSProperties} />
              </span>
              <b className="ld-mono">{hours(h)} h</b>
            </li>
          ))}
        </ul>
        <p className="ld-calc-why">
          This is the work Mudavym is built to take on. How much of it comes back to your house is something we
          measure with you, not a number we promise here.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Further out: it calls your vendors. Not built (the founder's word,  */
/* 2026-10-28), so like the food band it prints no figure and no date.  */
/* ------------------------------------------------------------------ */

/** A sample call. The bar, the vendor and the words are invented; the note says so. */
const CALL: readonly ['us' | 'them', string][] = [
  ['us', 'Hi, this is the assistant for Juniper, calling about the Sancerre.'],
  ['them', 'Sure. What can I do for you?'],
  ['us', 'We take it every week. Is there a better price if we order it by the case?'],
  ['them', 'I can do a case price. I will send it over today.'],
];

/** Job of the motion: the call is read a line at a time, as it would happen, and
 *  it ends on an offer waiting for a person, not on a deal. The line's wave
 *  moves only while the call is being read, then stops. */
function Call() {
  return (
    <figure className="ld-call-card" data-reveal aria-label="A sample call to a vendor">
      <div className="ld-call-head">
        <span className="ld-call-icon" aria-hidden="true">
          <PhoneCall strokeWidth={2} />
        </span>
        <div>
          <b>Calling Larkspur Cellars</b>
          <span>For a better price on the Sancerre</span>
        </div>
        <span className="ld-call-wave" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </span>
      </div>
      <ol className="ld-call-lines">
        {CALL.map(([who, line], i) => (
          <li key={line} className={`is-${who}`} style={{ '--i': i } as CSSProperties}>
            <span>{who === 'us' ? 'Mudavym' : 'Larkspur'}</span>
            <p>{line}</p>
          </li>
        ))}
      </ol>
      <p className="ld-call-end" style={{ '--i': CALL.length } as CSSProperties}>
        <Check strokeWidth={2.5} aria-hidden="true" /> Offer brought back. <b>Waiting for your yes.</b>
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Your data, and the questions a stranger asks. Every sentence here    */
/* was checked against the code on main; ADR 0344 cites each file and   */
/* line. Where the code only half held a claim, the claim was narrowed. */
/* ------------------------------------------------------------------ */

const KEPT: readonly [ReactNode, string, string][] = [
  [<Lock key="l" />, 'Your house, kept apart.', 'Every request is checked against the restaurant you signed in to.'],
  [<KeyRound key="k" />, 'Sign in your way.', 'Email and password, Google, a passkey, or a code sent to your email.'],
  [<FileText key="f" />, 'The paper stays with it.', 'The photo or PDF of every invoice is kept with its record and shown beside the lines read from it.'],
  [<Coins key="c" />, 'Money in its own currency.', 'Each invoice keeps the currency it was billed in. Nothing is converted at a guessed rate.'],
  [<WifiOff key="w" />, 'A count survives bad signal.', 'Count the shelf on your phone, even offline, and it syncs when the signal returns.'],
  [<EyeOff key="e" />, 'No ads, no trackers.', 'No advertising or tracking scripts, and every font is served from Mudavym itself.'],
];

const FAQ: readonly [string, string][] = [
  ['What does it cost?', 'Nothing, for the first houses. We have not decided what comes after.'],
  [
    'What does it cover today?',
    'The bar: wine, beer, spirits and everything behind it. Invoices, counts, orders and vendor mail. The kitchen comes after, starting with the bakery.',
  ],
  [
    'Does it work with my POS?',
    'A till can send its checks today through a signed feed, which takes some setup on the till’s side. A Toast connection is partly built, and Square and Clover come after it.',
  ],
  [
    'Will it send anything without me?',
    'No. Orders and replies to vendors wait for a person to approve them. Automatic replies stay off until an owner or manager turns them on, and then each one waits two minutes so you can stop it.',
  ],
  [
    'Who can see our numbers?',
    'Your house. Every request is checked against the restaurant on your sign-in, and owners, managers and staff each see only what their role allows.',
  ],
  [
    'Does it work on a phone?',
    'Yes, in the phone’s browser, and it installs to your home screen. The delivery screen opens the rear camera, and a shelf count keeps working offline. There is no app in the app stores.',
  ],
  ['Which languages does it speak?', 'The app is in English. It reads vendor invoices in English and Turkish.'],
  [
    'How do I start?',
    'Make an account and photograph your menu, and Mudavym sets it as your house’s list. Then photograph each delivery invoice at the door.',
  ],
];

/* ------------------------------------------------------------------ */
/* The page.                                                            */
/* ------------------------------------------------------------------ */

export function Landing() {
  const [reduced] = useState(reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const heroCtaRef = useRef<HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(false);
  const [step, setStep] = useState(reduced ? BEATS.length - 1 : 0);
  const [railEnd, setRailEnd] = useState<[boolean, boolean]>([true, false]);
  const [sent, setSent] = useState(false);

  // Job: a block enters once, when it is first seen, so the reader's eye lands on
  // what just arrived. Reduced motion, or no observer, shows everything at once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (reduced || !hasObserver()) {
      targets.forEach((t) => t.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      // A fifth in view is enough: a block on a phone can be taller than the screen.
      { threshold: 0.2 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [reduced]);

  // Job: the delivery on the stage moves on as the reader reaches each beat, so
  // the words and the picture are always about the same moment. The beat that
  // crosses the middle of the screen is the one being read.
  useEffect(() => {
    const story = storyRef.current;
    if (reduced || !story || !hasObserver()) return;
    const beats = Array.from(story.querySelectorAll<HTMLElement>('[data-beat]'));
    // Below 960px the stage is pinned over the top half, so the line the reader
    // is on sits lower, under the stage, not behind it.
    const narrow = (() => {
      try {
        return window.matchMedia('(max-width: 959px)').matches === true;
      } catch {
        return false;
      }
    })();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.beat));
        }
      },
      { rootMargin: narrow ? '-72% 0px -26% 0px' : '-48% 0px -48% 0px', threshold: 0 },
    );
    beats.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, [reduced]);

  // The rail's arrows know when the first or last notice is fully in view.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !hasObserver()) return;
    const cards = rail.querySelectorAll<HTMLElement>('.ld-notice');
    const first = cards[0];
    const last = cards[cards.length - 1];
    if (!first || !last) return;
    const io = new IntersectionObserver(
      (entries) => {
        setRailEnd((prev) => {
          const next: [boolean, boolean] = [prev[0], prev[1]];
          for (const e of entries) {
            if (e.target === first) next[0] = e.intersectionRatio > 0.9;
            if (e.target === last) next[1] = e.intersectionRatio > 0.9;
          }
          return next;
        });
      },
      { root: rail, threshold: [0, 0.9, 1] },
    );
    io.observe(first);
    io.observe(last);
    return () => io.disconnect();
  }, []);

  // On a phone, the one button follows once the hero's is out of view, and
  // steps aside when the closing one is on screen.
  useEffect(() => {
    const hero = heroCtaRef.current;
    const close = closeRef.current;
    if (!hero || !close || !hasObserver()) return;
    let heroOut = false;
    let closeIn = false;
    const update = () => setDock(heroOut && !closeIn);
    const a = new IntersectionObserver(
      (es) => {
        for (const e of es) heroOut = !e.isIntersecting && e.boundingClientRect.top < 0;
        update();
      },
      { threshold: 0 },
    );
    const b = new IntersectionObserver(
      (es) => {
        for (const e of es) closeIn = e.isIntersecting;
        update();
      },
      { threshold: 0.2 },
    );
    a.observe(hero);
    b.observe(close);
    return () => {
      a.disconnect();
      b.disconnect();
    };
  }, []);

  const jump = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  const slide = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.querySelector<HTMLElement>('.ld-notice');
    rail.scrollBy({ left: dir * ((card?.offsetWidth ?? 320) + 16), behavior: reduced ? 'auto' : 'smooth' });
  };

  const headline = ['Your', 'back', 'of', 'house,'];

  return (
    <div className="mudavym mdv-landing" ref={rootRef}>
      <header className="ld-bar">
        <div className="ld-wrap">
          <Link className="ld-lockup" to="/" aria-label="Mudavym">
            <Seal size={22} />
            <Wordmark size={20} />
          </Link>
          <nav aria-label="Page">
            <a className="ld-nav-hide" href="#platform" onClick={(e) => jump(e, 'platform')}>
              Platform
            </a>
            <a className="ld-nav-hide" href="#how" onClick={(e) => jump(e, 'how')}>
              How it works
            </a>
            <a className="ld-nav-hide" href="#goals" onClick={(e) => jump(e, 'goals')}>
              Goals
            </a>
            <a className="ld-nav-hide" href="#next" onClick={(e) => jump(e, 'next')}>
              Coming soon
            </a>
            <Link to="/login">Sign in</Link>
            <Go to={START} className="ld-btn ld-btn-sm" />
          </nav>
        </div>
        {/* Job: fills as the page is read, so the reader knows how much is left.
            It runs on the scroll timeline in CSS; there is no scroll listener. */}
        <span className="ld-progress" aria-hidden="true" />
      </header>

      <main>
        {/* Hero. Job of the motion: the headline arrives a word at a time so it is
            read before anything moves beside it; then the evening starts. */}
        <section className="ld-hero">
          <div className="ld-wrap">
            <div className="ld-hero-copy">
              <p className="ld-eyebrow ld-enter" style={{ '--d': 0 } as CSSProperties}>
                AI-native restaurant operations
              </p>
              <h1>
                {headline.map((w, i) => (
                  <Fragment key={i}>
                    <span className="ld-word ld-enter" style={{ '--d': i + 1 } as CSSProperties}>
                      {w}
                    </span>{' '}
                  </Fragment>
                ))}
                <span className="ld-word ld-seal-word ld-enter" style={{ '--d': 5 } as CSSProperties}>
                  running itself.
                </span>
              </h1>
              <p className="ld-sub ld-enter" style={{ '--d': 7 } as CSSProperties}>
                One system reads every invoice, counts every bottle, drafts the orders and vendor replies, and asks
                before anything leaves.
              </p>
              <div className="ld-cta ld-enter" style={{ '--d': 8 } as CSSProperties}>
                <Go to={START} innerRef={heroCtaRef} />
                <a className="ld-btn-ghost" href="#how" onClick={(e) => jump(e, 'how')}>
                  See it work
                </a>
              </div>
            </div>
            <div className="ld-hero-feed ld-enter" style={{ '--d': 6 } as CSSProperties}>
              <Feed reduced={reduced} />
            </div>
          </div>
        </section>

        {/* Seven places become one. Job: the scattered tools settle into one grid
            and each takes its new name, which is the claim of the section. */}
        <section className="ld-block ld-one">
          <div className="ld-wrap">
            <Kicker n="01">One system</Kicker>
            <h2 data-reveal className="ld-rise">
              Seven places your back office lives today. <span className="ld-seal">One system.</span>
            </h2>
            <ul className="ld-scatter" data-reveal>
              {SCATTER.map(([was, now, x, y, r], i) => (
                <li
                  key={was}
                  style={{ '--x': `${x}px`, '--y': `${y}px`, '--r': `${r}deg`, '--i': i } as CSSProperties}
                >
                  <s>{was}</s>
                  <span>{now}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The platform. Each picture plays its job once, when its cell is seen. */}
        <section className="ld-block" id="platform">
          <div className="ld-wrap">
            <Kicker n="02">The platform</Kicker>
            <h2 data-reveal className="ld-rise">
              Everything behind the pass, <span className="ld-seal">in one place.</span>
            </h2>
            <div className="ld-bento">
              {PARTS.map((p, i) => (
                <article
                  key={p.key}
                  className={`ld-cell ld-cell-${p.key}`}
                  data-reveal
                  style={{ '--i': i % 3 } as CSSProperties}
                >
                  <div className="ld-cell-pic">{p.picture}</div>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              ))}
            </div>
            <p className="ld-note" data-reveal>
              Every name and number in these pictures is a sample.
            </p>
          </div>
        </section>

        {/* One delivery. The stage stays in view while the beats pass beside it. */}
        <section className="ld-block" id="how">
          <div className="ld-wrap">
            <Kicker n="03">How it works</Kicker>
            <h2 data-reveal className="ld-rise">
              One delivery, <span className="ld-seal">from the door to the books.</span>
            </h2>
            <div className="ld-story" ref={storyRef}>
              <div className="ld-story-stage" data-reveal>
                <Stage step={step} />
              </div>
              <ol className="ld-beats">
                {BEATS.map((b, i) => (
                  <li key={b.title} data-beat={i} className={i === step ? 'is-now' : i < step ? 'is-past' : undefined}>
                    <h3>{b.title}</h3>
                    <p>{b.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* What it notices. Job of the motion: each little chart draws itself as
            its card arrives, which is the noticing. */}
        {/* The same evening, twice. Its motion's job is written on Evening. */}
        <section className="ld-block ld-before" id="evening">
          <div className="ld-wrap">
            <Kicker n="04">Before and after</Kicker>
            <h2 data-reveal className="ld-rise">
              The same evening. <span className="ld-seal">Twice.</span>
            </h2>
            <p className="ld-lede" data-reveal>
              Five moments from one night at a sample wine bar: the way they go now, and the way they go on
              Mudavym. Flip it and watch the same hours change.
            </p>
            <Evening reduced={reduced} />
            <p className="ld-note">A sample evening. The bar, the times and the price are invented.</p>
          </div>
        </section>

        <section className="ld-block ld-notices">
          <div className="ld-wrap">
            <Kicker n="05">What it notices</Kicker>
            <div className="ld-rail-head">
              <h2 data-reveal className="ld-rise">
                It notices <span className="ld-seal">before you do.</span>
              </h2>
              <div className="ld-rail-btns">
                <button type="button" onClick={() => slide(-1)} disabled={railEnd[0]} aria-label="Earlier notices">
                  <ChevronLeft strokeWidth={2} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => slide(1)} disabled={railEnd[1]} aria-label="More notices">
                  <ChevronRight strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div className="ld-rail" ref={railRef} data-reveal>
            {NOTICES.map((n, i) => (
              <article key={n.kind} className="ld-notice" style={{ '--i': i } as CSSProperties}>
                <div className="ld-notice-top">
                  <span>{n.kind}</span>
                  <NoticePicture n={n} />
                </div>
                <p>{n.text}</p>
                {n.worth ? <b className="ld-mono">{n.worth}</b> : <b className="ld-notice-quiet">Worth a look</b>}
              </article>
            ))}
          </div>
          <div className="ld-wrap">
            <p className="ld-note">Six sample notices. Every vendor, price and count is invented.</p>
          </div>
        </section>

        {/* Your numbers. Its motion's job is written on Numbers. */}
        <section className="ld-block ld-numbers" id="numbers">
          <div className="ld-wrap">
            <Kicker n="06">Your numbers</Kicker>
            <h2 data-reveal className="ld-rise">
              Your week, <span className="ld-seal">in hours.</span>
            </h2>
            <p className="ld-lede" data-reveal>
              Move each slider to your house and see where the back office takes your time now.
            </p>
            <Numbers />
            <p className="ld-note">
              Your numbers stay on this page. The starting values are placeholders, not averages, and a month here
              is 52 weeks over 12.
            </p>
          </div>
        </section>

        {/* It asks first. Job of the motion: the reader presses yes and sees what
            a yes does, written down. Nothing is sent from this page. */}
        <section className="ld-block ld-trust">
          <div className="ld-wrap">
            <div data-reveal className="ld-rise">
              <Kicker n="07">It asks first</Kicker>
              <h2>
                It runs itself. <span className="ld-seal">Never without you.</span>
              </h2>
              <ul className="ld-rules">
                <li>Orders and replies to vendors wait for your yes.</li>
                <li>Automatic replies stay off until you turn them on. Then each one waits two minutes for you to stop it.</li>
                <li>Order approvals, settings and changes to who has access record who did them and when.</li>
                <li>Owners, managers and staff each see only what their role allows, on screen and in the server.</li>
              </ul>
            </div>
            {/* The sent state is an attribute, not a class: a className change from
                React would drop the is-in the reveal observer added. */}
            <div className="ld-approve" data-sent={sent || undefined} data-reveal>
              <div className="ld-approve-head">
                <Mail strokeWidth={2} aria-hidden="true" />
                <div>
                  <b>Draft reply to Larkspur Cellars</b>
                  <span>Written from invoice 20931, line 3</span>
                </div>
              </div>
              <p>
                Hello Marisol, line 3 of Tuesday&rsquo;s invoice was billed at $22.50 a bottle. We agreed $19.80. Could
                you credit the $32.40 on the next statement? Thank you.
              </p>
              <div className="ld-approve-row">
                {sent ? (
                  <>
                    <span className="ld-approve-done" role="status">
                      <Check strokeWidth={2.5} aria-hidden="true" /> Sent by you, 4:12 pm
                    </span>
                    <button type="button" className="ld-btn-ghost" onClick={() => setSent(false)}>
                      Undo
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ld-btn" onClick={() => setSent(true)}>
                      Approve and send
                    </button>
                    <span className="ld-approve-hint">Try it. Nothing leaves this page.</span>
                  </>
                )}
              </div>
              <p className="ld-approve-log" aria-hidden={!sent}>
                Logged: approved by you. Asked by Receiving, from a price that disagreed with the agreed one.
              </p>
            </div>
          </div>
        </section>

        {/* Your data. No motion of its own beyond the shared rise: these are
            promises, and a promise should sit still to be read. */}
        <section className="ld-block ld-data" id="data">
          <div className="ld-wrap">
            <Kicker n="08">Your data</Kicker>
            <h2 data-reveal className="ld-rise">
              Your records stay <span className="ld-seal">your house&rsquo;s.</span>
            </h2>
            <ul className="ld-data-list">
              {KEPT.map(([icon, title, body], i) => (
                <li key={title} data-reveal style={{ '--i': i } as CSSProperties}>
                  <span className="ld-data-icon" aria-hidden="true">
                    {icon}
                  </span>
                  <b>{title}</b>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Goals. Job of the motion: the old way is struck out and the new way
            takes its place, one goal at a time; then the road draws itself. */}
        <section className="ld-block ld-goals" id="goals">
          <div className="ld-wrap">
            <Kicker n="09">Goals</Kicker>
            <h2 data-reveal className="ld-rise">
              What we are building toward, <span className="ld-seal">for every house.</span>
            </h2>
            <ul className="ld-goal-list">
              {GOALS.map(([was, now]) => (
                <li key={was} data-reveal>
                  <span className="ld-goal-was">{was}</span>
                  <ArrowRight className="ld-goal-arrow" strokeWidth={2} aria-hidden="true" />
                  <span className="ld-goal-now">{now}</span>
                </li>
              ))}
            </ul>

            <div className="ld-road" data-reveal>
              <h3>Where it goes next.</h3>
              <ol>
                {ROAD.map(([when, title, body], i) => (
                  <li key={when} className={i === 0 ? 'is-here' : undefined} style={{ '--i': i } as CSSProperties}>
                    <span className="ld-road-when">{when}</span>
                    <div>
                      <b>{title}</b>
                      <p>{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="ld-north">
                The goal behind all of it: a back of house that runs itself, so the people in it can stay with the
                guests.
              </p>
            </div>

            <div className="ld-call" id="calls">
              <div className="ld-call-copy" data-reveal>
                <p className="ld-pill">
                  <i /> Further out. Not built yet
                </p>
                <h3>It will pick up the phone, too.</h3>
                <p>
                  Mudavym will call your vendors: to ask for a better price, to chase a late delivery, to follow up on
                  a credit. Every offer comes back to you. It agrees to nothing without your yes.
                </p>
                <p className="ld-note">Not built yet, and no date. A sample call: the bar, the vendor and the words are invented.</p>
              </div>
              <Call />
            </div>
          </div>
        </section>

        {/* Coming soon: the food itself. A dark band, so it reads as the next
            chapter, not a part of today's product. Job of the motion: dishes and
            wines settle by how they taste, then a dish nobody has cooked yet lands
            among them and the pour is read from where it landed. */}
        <section className="mudavym ld-block ld-soon" id="next" data-ground="charcoal">
          <div className="ld-wrap">
            <div className="ld-soon-copy" data-reveal>
              <p className="ld-kicker ld-kicker-soon" data-reveal>
                <span className="ld-mono">10</span>
                Coming soon
                <em>
                  <i /> Not built yet
                </em>
              </p>
              <h2>
                Not just running the kitchen. <span className="ld-seal">Predicting the food.</span>
              </h2>
              <p className="ld-soon-lede">
                Everything above keeps the house running. Further out is the food itself: how a dish will taste
                before it is cooked, what to pour beside it, and which of your guests will love it.
              </p>
              <ul className="ld-soon-points">
                {SOON.map(([icon, title, body], i) => (
                  <li key={title} style={{ '--i': i } as CSSProperties}>
                    <span className="ld-soon-icon" aria-hidden="true">
                      {icon}
                    </span>
                    <div>
                      <b>{title}</b>
                      <p>{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <TasteMap />
            <p className="ld-soon-why" data-reveal>
              It learns from what your house sells. That is why the back office comes first: a house that runs on
              Mudavym is what gives it something true to learn from.
            </p>
            <p className="ld-note ld-soon-note" data-reveal>
              Not built yet. No date, and no numbers until they are measured. Every dish and position on this map is
              invented.
            </p>
          </div>
        </section>

        {/* Questions. Job of the motion: the plus turns to a cross and the answer
            drops in under its question, so it reads as opened, not swapped. */}
        <section className="ld-block ld-faq" id="faq">
          <div className="ld-wrap">
            <div className="ld-faq-head" data-reveal>
              <Kicker n="11">Questions</Kicker>
              <h2>
                Straight <span className="ld-seal">answers.</span>
              </h2>
              <p>What it does today, what it does not, and what it will never do without you.</p>
            </div>
            <div className="ld-faq-list" data-reveal>
              {FAQ.map(([q, a]) => (
                <details key={q} className="ld-faq-item">
                  <summary>
                    {q}
                    <Plus strokeWidth={2} aria-hidden="true" />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* The price and who we are: the founder's line, nothing invented. */}
        <section className="ld-block ld-price">
          <div className="ld-wrap" data-reveal>
            <h2>Free for the first houses.</h2>
            <p>
              We are not charging the first houses, and we have not decided what comes after. Built in San Francisco,
              for a small number of restaurants first.
            </p>
          </div>
        </section>

        <section className="ld-block ld-close" ref={closeRef}>
          <div className="ld-wrap" data-reveal>
            <h2>
              Start <span className="ld-seal">tonight.</span>
            </h2>
            <p>Photograph your menu to set up the house, then the next invoice at the door.</p>
            <div className="ld-cta">
              <Go to={START} />
              <Link className="ld-btn-ghost" to="/login">
                Sign in
              </Link>
            </div>
            <p className="ld-close-join">
              Joining a team? <Link to={JOIN}>I have an invite code</Link>
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

      <div className={'ld-dock' + (dock ? ' is-on' : '')} aria-hidden={!dock}>
        <Go to={START} className="ld-btn ld-btn-wide" tabIndex={dock ? undefined : -1} />
      </div>
    </div>
  );
}

export default Landing;
