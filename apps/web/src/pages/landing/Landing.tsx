/**
 * The landing page at `/` for a stranger (ADR 0320).
 *
 * One claim, one sample invoice that reads itself, three ways a delivery costs
 * more than it should, one delivery followed from the door to the cellar, what
 * it costs, who we are, and one button. Every figure on the page is a sample
 * and is labelled as one beside the figure; the one outside figure names its
 * source in the sentence that uses it. Each motion has a stated job: the
 * sheet's cursor shows the reading, the two stamps mark the lines that
 * disagree, the tally adds up what was over, and the door count travels into
 * the claim, the draft and the cellar line. The page sets no cookie, loads no
 * third-party script and sends nothing anywhere; every link is a route of the
 * app itself.
 *
 * Colours come from the `.mudavym` tokens, so the page follows the person's
 * ground choice (ADR 0169). The copy carries no em or en dash, like every other
 * public page (seo.test.ts).
 */
import { Fragment, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Seal } from '../../components/mudavym/Seal';
import { Wordmark } from '../../components/mudavym/Wordmark';
import './landing.css';

type Flag = 'price' | 'count';

interface SheetLine {
  n: number;
  item: string;
  qty: number;
  unit: string;
  line: string;
  bad?: Flag;
}

/** The sample invoice. Every price is invented; the caption under it says so. */
const LINES: readonly SheetLine[] = [
  { n: 1, item: 'Prosecco DOC NV, 750 ml', qty: 12, unit: '11.40', line: '136.80' },
  { n: 2, item: 'Pinot Grigio 2024, 750 ml', qty: 12, unit: '9.75', line: '117.00' },
  { n: 3, item: 'Sancerre 2023, 750 ml', qty: 12, unit: '22.50', line: '270.00', bad: 'price' },
  { n: 4, item: 'Rioja Crianza 2020, 750 ml', qty: 12, unit: '12.10', line: '145.20' },
  { n: 5, item: 'London dry gin, 1 L', qty: 6, unit: '24.00', line: '144.00' },
  { n: 6, item: 'Vodka, 1 L', qty: 12, unit: '19.50', line: '234.00', bad: 'count' },
  { n: 7, item: 'Tonic water, 24 × 200 ml', qty: 4, unit: '21.60', line: '86.40' },
  { n: 8, item: 'Bourbon, 750 ml', qty: 6, unit: '31.00', line: '186.00' },
  { n: 9, item: 'Soda water, 24 × 200 ml', qty: 2, unit: '14.90', line: '29.80' },
  { n: 10, item: 'Lime juice, 1 L', qty: 4, unit: '6.20', line: '24.80' },
  { n: 11, item: 'Delivery', qty: 1, unit: '15.00', line: '15.00' },
];

const STAMP: Record<Flag, string> = { price: 'Price', count: 'Count' };

const WHY: Record<Flag, ReactNode> = {
  price: (
    <>
      Agreed price $19.80. Billed $22.50. Twelve bottles, $2.70 each: <b>$32.40</b> over. Held until a
      manager accepts it with a reason or sends the claim.
    </>
  ),
  count: (
    <>
      Six came through the door. Twelve billed. Six at $19.50: <b>$117.00</b> over. The door count was
      taken while the driver was still there.
    </>
  ),
};

/** $32.40 (price) + $117.00 (count): what the sample sheet carries above what was agreed or delivered. */
const OVER = 149.4;
/** Line 6 of the sample sheet, the one the door count changes. */
const BILLED = 12;
const PRICE = 19.5;

/** The reading, in milliseconds: a lead before the first run, then one line at a time. */
const LEAD_FIRST = 1100;
const READ_START = 160;
const READ_STEP = 150;
const STAMP_PRICE = 120;
const STAMP_COUNT = 520;
const DONE_AFTER = 900;
const TALLY_MS = 700;

function money(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/** The sample invoice that reads itself: one cursor, two stamps, one tally. */
function Sheet({ reduced }: { reduced: boolean }) {
  const [run, setRun] = useState(0);
  const [readCount, setReadCount] = useState(0);
  const [flags, setFlags] = useState<Record<Flag, boolean>>({ price: false, count: false });
  const [open, setOpen] = useState<Record<Flag, boolean>>({ price: false, count: false });
  const [done, setDone] = useState(false);
  const [over, setOver] = useState(0);
  const [cursorTop, setCursorTop] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    setReadCount(0);
    setFlags({ price: false, count: false });
    setOpen({ price: false, count: false });
    setDone(false);
    setOver(0);
    setCursorTop(null);
    if (reduced) {
      setReadCount(LINES.length);
      setFlags({ price: true, count: true });
      setDone(true);
      return;
    }
    const lead = run === 0 ? LEAD_FIRST : 0;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, lead + ms));
    };
    LINES.forEach((_, i) =>
      at(READ_START + i * READ_STEP, () => {
        setReadCount(i + 1);
        const row = rowRefs.current[i];
        const table = tableRef.current;
        if (row && table) setCursorTop(table.offsetTop + row.offsetTop + row.offsetHeight);
      }),
    );
    const end = READ_START + LINES.length * READ_STEP;
    at(end + STAMP_PRICE, () => setFlags((f) => ({ ...f, price: true })));
    at(end + STAMP_COUNT, () => setFlags((f) => ({ ...f, count: true })));
    at(end + DONE_AFTER, () => {
      setCursorTop(null);
      setDone(true);
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [run, reduced]);

  useEffect(() => {
    if (!done) return;
    if (reduced || typeof requestAnimationFrame !== 'function') {
      setOver(OVER);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const frame = (t: number) => {
      const p = 1 - Math.pow(1 - Math.min(1, (t - t0) / TALLY_MS), 3);
      setOver(OVER * p);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [done, reduced]);

  const toggle = useCallback((flag: Flag) => {
    setOpen((o) => ({ ...o, [flag]: !o[flag] }));
  }, []);

  return (
    <div className="ld-sheetwrap ld-enter ld-d5">
      <div className="ld-sheet" aria-label="Sample invoice, read line by line">
        <div className="ld-sample" aria-hidden="true">
          SAMPLE
        </div>
        <div className="ld-sheet-head">
          <div>
            <b>Sample Distributing Co.</b>
            <span>Invoice 2231</span>
            <span>Oct 2</span>
          </div>
          <div className="ld-r">
            <b>Sample Restaurant</b>
            <span>PO-0411</span>
            <span>11 lines</span>
          </div>
        </div>
        <div
          className="ld-cursor"
          aria-hidden="true"
          style={{ top: cursorTop ?? 0, opacity: cursorTop === null ? 0 : 1 }}
        />
        <table ref={tableRef}>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="ld-n">Qty</th>
              <th className="ld-n">Unit</th>
              <th className="ld-n">Line</th>
              <th className="ld-st">
                <span className="ld-sr">Check</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((l, i) => {
              const bad = l.bad;
              const flagged = bad ? flags[bad] : false;
              const isOpen = bad ? open[bad] : false;
              const whyId = bad ? `ld-why-${bad}` : undefined;
              return (
                <Fragment key={l.n}>
                  <tr
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    className={`ld-row${i < readCount ? ' is-read' : ''}${flagged ? ' is-flag' : ''}`}
                    onClick={flagged && bad ? () => toggle(bad) : undefined}
                  >
                    <td>{l.n}</td>
                    <td className="ld-item">{l.item}</td>
                    <td className="ld-n">{l.qty}</td>
                    <td className="ld-n">{l.unit}</td>
                    <td className="ld-n">{l.line}</td>
                    <td className="ld-st">
                      <span className="ld-mark ld-ok">agrees</span>
                      {flagged && bad ? (
                        <button
                          type="button"
                          className="ld-stamp"
                          aria-expanded={isOpen}
                          aria-controls={whyId}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(bad);
                          }}
                        >
                          {STAMP[bad]}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {bad ? (
                    <tr id={whyId} className="ld-why" hidden={!isOpen}>
                      <td colSpan={6}>
                        <div>{WHY[bad]}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="ld-sheet-foot">
          <span className="ld-lbl" aria-live="polite">
            {done ? '11 lines read. 2 do not agree.' : 'Reading 11 lines'}
          </span>
          <span className="ld-sum">
            <span>{money(over)}</span>
            <small>billed above what was agreed or delivered</small>
          </span>
        </div>
      </div>
      <div className="ld-caption">
        <span>Sample invoice. Every price on it is invented.</span>
        <button type="button" onClick={() => setRun((r) => r + 1)}>
          Read it again
        </button>
      </div>
      <p className="ld-tapnote">Tap a stamp to see why.</p>
    </div>
  );
}

/** One delivery from the door to the cellar: the door count travels. */
function Day() {
  const [n, setN] = useState(6);
  const [touched, setTouched] = useState(false);
  const short = BILLED - n;
  const credit = short * PRICE;
  const set = (v: number) => {
    setN(Math.max(0, Math.min(BILLED, v)));
    setTouched(true);
  };
  const bump = touched ? ' ld-bump' : '';

  return (
    <section className="ld-block" id="day">
      <div className="ld-wrap">
        <h2>One delivery, from the door to the cellar.</h2>
        <p className="ld-lede">
          Change the count at the door and watch it travel. Every number on this page is a sample.
        </p>
        <div className="ld-beats">
          <div className="ld-beat">
            <div className="ld-beat-text">
              <div className="ld-time">10:40 · THE DOOR</div>
              <h3>Count it while the driver is still there.</h3>
              <p>
                Whoever meets the truck taps the cases in, notes what was refused, takes a photo of the
                paper and initials it. No prices on this screen. It works with no signal and sends itself
                later.
              </p>
              <p className="ld-say">A short delivery is only short if someone wrote it down.</p>
            </div>
            <div className="ld-pane">
              <div className="ld-ph">
                <span>Door · Sample Distributing Co.</span>
                <span>INV 2231</span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Vodka, 1 L · billed</span>
                <span className="ld-v">12</span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Came through the door</span>
                <span className="ld-step">
                  <button type="button" aria-label="One fewer" onClick={() => set(n - 1)}>
                    −
                  </button>
                  <output aria-live="polite">{n}</output>
                  <button type="button" aria-label="One more" onClick={() => set(n + 1)}>
                    +
                  </button>
                </span>
              </div>
              <div className="ld-ticks">
                <div>Photo of the paper</div>
                <div>Initials: S.R.</div>
                <div>Driver: as written on the sheet</div>
              </div>
              <div key={`claim-${n}`} className={`ld-claim${short === 0 ? ' is-none' : ''}${bump}`}>
                {short === 0 ? (
                  <>
                    All <b>12</b> came through the door. Nothing to request.
                  </>
                ) : (
                  <>
                    Short <b>{short}</b> bottle{short === 1 ? '' : 's'}, <b>{money(credit)}</b> to request.
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="ld-beat">
            <div className="ld-beat-text">
              <div className="ld-time">15:10 · THE DESK</div>
              <h3>Three papers, one answer.</h3>
              <p>
                The order, the invoice and the door count are laid side by side. A line that disagrees is
                held: a manager accepts it with a reason, corrects it, or sends the claim. Mudavym reads
                the invoice and drafts the reply. A person sends it.
              </p>
              <p className="ld-say">Nothing leaves the house unless someone in the house sends it.</p>
            </div>
            <div className="ld-pane">
              <div className="ld-ph">
                <span>Desk · line 6, Vodka 1 L</span>
                <span>INV 2231</span>
              </div>
              <div className="ld-match">
                <div className="ld-col">
                  <h4>Order</h4>
                  <div>
                    <span>Qty</span>
                    <span>12</span>
                  </div>
                  <div>
                    <span>Price</span>
                    <span>19.50</span>
                  </div>
                </div>
                <div className="ld-col">
                  <h4>Invoice</h4>
                  <div>
                    <span>Qty</span>
                    <span className="ld-diff">12</span>
                  </div>
                  <div>
                    <span>Price</span>
                    <span>19.50</span>
                  </div>
                </div>
                <div className="ld-col">
                  <h4>Door</h4>
                  <div>
                    <span>Qty</span>
                    <span className={short > 0 ? 'ld-diff' : undefined}>{n}</span>
                  </div>
                  <div>
                    <span>Photo</span>
                    <span>✓</span>
                  </div>
                </div>
              </div>
              <div className="ld-letter">
                <div className="ld-to">To Sample Distributing Co. · Draft</div>
                <div key={`draft-${n}`} className={bump || undefined}>
                  {short === 0
                    ? 'Invoice 2231, line 6, Vodka 1 L: all 12 came through the door on Oct 2. Nothing to request.'
                    : `Invoice 2231, line 6, Vodka 1 L: ${n} of 12 came through the door on Oct 2. Please credit ${money(credit)} against this invoice.`}
                </div>
                <div className="ld-state">{short === 0 ? 'No letter needed' : 'Waiting for a person to send'}</div>
              </div>
            </div>
          </div>
          <div className="ld-beat">
            <div className="ld-beat-text">
              <div className="ld-time">23:30 · THE CELLAR</div>
              <h3>Stock is what arrived, not what was billed.</h3>
              <p>
                The cellar is booked from the door count, so the shelf and the book agree from the first
                night. Wine, beer, spirits, mixers: every drink has a place.
              </p>
              <p className="ld-say">The invoice is a claim. The door is a fact.</p>
            </div>
            <div className="ld-pane ld-ledger">
              <div className="ld-ph">
                <span>Cellar · tonight</span>
                <span>Oct 2</span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Vodka, 1 L</span>
                <span key={`cellar-${n}`} className={`ld-v ld-up${bump}`}>
                  {n === BILLED ? null : <s>+12</s>}+{n}
                </span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Sancerre 2023</span>
                <span className="ld-v ld-up">+12</span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Prosecco DOC NV</span>
                <span className="ld-v ld-up">+12</span>
              </div>
              <div className="ld-line">
                <span className="ld-k">Booked at</span>
                <span className="ld-v">door count</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  const [reduced] = useState(reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const heroCtaRef = useRef<HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLElement>(null);
  const [dock, setDock] = useState(false);

  // A case or a beat plays once, when it comes into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.ld-case, .ld-beat'));
    if (reduced || typeof IntersectionObserver !== 'function') {
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
      // A fifth in view is enough: a beat on a phone is taller than the screen, so a
      // larger share would never be reached and the beat would never enter.
      { threshold: 0.2 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [reduced]);

  // On a phone, the one button follows once the hero's is out of view, and
  // steps aside when the closing one is on screen.
  useEffect(() => {
    const hero = heroCtaRef.current;
    const close = closeRef.current;
    if (!hero || !close || typeof IntersectionObserver !== 'function') return;
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

  return (
    <div className="mudavym mdv-landing" ref={rootRef}>
      <header className="ld-bar">
        <div className="ld-wrap">
          <Link className="ld-lockup" to="/" aria-label="Mudavym">
            <Seal size={22} />
            <Wordmark size={20} />
          </Link>
          <nav>
            <Link to="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="ld-hero">
          <div className="ld-wrap">
            <div>
              <h1>
                <span className="ld-l1 ld-enter ld-d1">
                  Restaurants get overbilled by their distributors and never catch it.
                </span>
                <span className="ld-l2 ld-enter ld-d2">We catch it from a photo of the invoice.</span>
              </h1>
              <p className="ld-sub ld-enter ld-d3">
                Restaurant back-office software for beverage inventory, purchasing, and checking vendor
                invoices against what was delivered.
              </p>
              <div className="ld-cta ld-enter ld-d4">
                <Link className="ld-btn" to="/register" ref={heroCtaRef}>
                  Bring one invoice <Arrow />
                </Link>
                <small>
                  <b>Free for the first houses.</b> Your name, your email, your restaurant. Then the photo.
                </small>
              </div>
            </div>
            <Sheet reduced={reduced} />
          </div>
        </section>

        <section className="ld-block" id="cases">
          <div className="ld-wrap">
            <h2>Three ways a delivery costs more than it should, and one that hides.</h2>
            <p className="ld-lede">
              Every one of them looks like a normal line on a normal invoice. Mudavym checks each line
              against the price you agreed, the order you placed, and what came through the door.
            </p>
            <div className="ld-cases">
              <div className="ld-case">
                <div>
                  <h3>A price above the agreed price.</h3>
                  <p>
                    The sheet says $22.50. Your price for that Sancerre was $19.80. Twelve bottles, and the
                    difference is paid without anyone noticing.
                  </p>
                </div>
                <div className="ld-mini">
                  <span className="ld-t">SAMPLE · INV 2231</span>
                  <div className="ld-ln ld-bad">
                    <span>3</span>
                    <span className="ld-it">Sancerre 2023, 750 ml</span>
                    <span>12 × 22.50</span>
                    <span>270.00</span>
                  </div>
                  <div className="ld-ln">
                    <span>4</span>
                    <span className="ld-it">Rioja Crianza 2020, 750 ml</span>
                    <span>12 × 12.10</span>
                    <span>145.20</span>
                  </div>
                  <div className="ld-tag">
                    <span className="ld-stamp">Price</span>
                  </div>
                </div>
              </div>
              <div className="ld-case">
                <div>
                  <h3>A count above what came through the door.</h3>
                  <p>
                    Twelve billed, six delivered. The only person who can know is the one who met the
                    driver, so that is where the count is taken.
                  </p>
                </div>
                <div className="ld-mini">
                  <span className="ld-t">SAMPLE · INV 2231</span>
                  <div className="ld-ln">
                    <span>5</span>
                    <span className="ld-it">London dry gin, 1 L</span>
                    <span>6 × 24.00</span>
                    <span>144.00</span>
                  </div>
                  <div className="ld-ln ld-bad">
                    <span>6</span>
                    <span className="ld-it">Vodka, 1 L</span>
                    <span>12 × 19.50</span>
                    <span>234.00</span>
                  </div>
                  <div className="ld-tag">
                    <span className="ld-stamp">Count</span>
                  </div>
                </div>
              </div>
              <div className="ld-case">
                <div>
                  <h3>A line you never ordered.</h3>
                  <p>
                    The Prosecco was on the order once, twelve bottles, line one. A week later it is on the
                    invoice twice.
                  </p>
                </div>
                <div className="ld-mini">
                  <span className="ld-t">SAMPLE · INV 2298</span>
                  <div className="ld-ln">
                    <span>7</span>
                    <span className="ld-it">Bourbon, 750 ml</span>
                    <span>6 × 31.00</span>
                    <span>186.00</span>
                  </div>
                  <div className="ld-ln ld-bad">
                    <span>8</span>
                    <span className="ld-it">Prosecco DOC NV, 750 ml</span>
                    <span>6 × 11.40</span>
                    <span>68.40</span>
                  </div>
                  <div className="ld-tag">
                    <span className="ld-stamp">Not ordered</span>
                  </div>
                </div>
              </div>
              <div className="ld-case">
                <div>
                  <h3>The credit that never comes.</h3>
                  <p>
                    A short delivery in September, a credit promised. It is on no invoice in October. Nobody
                    is paid to remember it, so it is kept and asked for.
                  </p>
                </div>
                <div className="ld-mini">
                  <span className="ld-t">SAMPLE · INV 2355</span>
                  <div className="ld-ln">
                    <span>12</span>
                    <span className="ld-it">Delivery</span>
                    <span>1 × 15.00</span>
                    <span>15.00</span>
                  </div>
                  <div className="ld-ln ld-ghost">
                    <span></span>
                    <span className="ld-it">Credit, Sep 25 short delivery, 4 × Rioja</span>
                    <span></span>
                    <span>48.00</span>
                  </div>
                  <div className="ld-tag">
                    <span className="ld-stamp">Credit missing</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="ld-month">
              <span className="ld-sum ld-mono">$265.80</span>
              <span>on the four sample sheets above, in one October. Sample figures, added up on this page.</span>
            </div>
            <div className="ld-fact">
              <b>This is common.</b> In 2015 Consolidated Concepts read 11,000 invoices from 400 restaurants
              and found at least one overcharge on 35 percent of them (FSR Magazine, December 2015). We have
              no figure of our own yet, and we will not print one until we do.
            </div>
          </div>
        </section>

        <Day />

        <section className="ld-block" id="cost">
          <div className="ld-wrap">
            <h2>What it costs.</h2>
            <div className="ld-two">
              <div>
                <p className="ld-big">
                  We are not charging the first houses, and we have not decided what comes after.
                </p>
                <p>
                  When we do decide, the houses already with us hear it first, in writing, before anything
                  changes.
                </p>
              </div>
              <div>
                <h3>For scale</h3>
                <p>
                  Invoice software for restaurants is commonly listed at around $350 per location per
                  month.<sup>1</sup> One caught line often covers that. The sample sheet at the top of this
                  page carried $149.40.
                </p>
                <p className="ld-src">
                  <sup>1</sup> MarginEdge, marginedge.com/pricing, read October 8, 2026.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="ld-block" id="who">
          <div className="ld-wrap">
            <h2>Built in San Francisco, for a small number of houses first.</h2>
            <div className="ld-two">
              <div>
                <p>
                  Mudavym is a small company in San Francisco. The first houses are in the Bay Area and in
                  East Lansing, Michigan, so that we can be at the door when something is wrong. Write to
                  us and a person reads it.
                </p>
                <p className="ld-addr">support@mudavym.com</p>
              </div>
              <div>
                <h3>What we will not do</h3>
                <div className="ld-wont">
                  <div>Mudavym sets no tracking or advertising cookies.</div>
                  <div>We do not sell your data, and we do not share it with advertisers.</div>
                  <div>This page runs no third-party script and no tracker. You can check.</div>
                  <div>Nothing is sent to a distributor unless a person in your house sends it.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="ld-block ld-close" id="close" ref={closeRef}>
          <div className="ld-wrap">
            <h2>
              Restaurants get overbilled and never catch it.{' '}
              <span className="ld-seal ld-ital">Bring one invoice and see.</span>
            </h2>
            <div className="ld-cta">
              <Link className="ld-btn" to="/register">
                Bring one invoice <Arrow />
              </Link>
              <small>
                <b>Free for the first houses.</b> You can be reading your first invoice the same day.
              </small>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="ld-wrap">
          <div>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/login">Sign in</Link>
          </div>
          <div>© 2026 Mudavym</div>
        </div>
      </footer>

      <div className={`ld-dock${dock ? ' is-shown' : ''}`} aria-hidden={!dock}>
        <Link className="ld-btn" to="/register" tabIndex={dock ? 0 : -1}>
          Bring one invoice
        </Link>
      </div>
    </div>
  );
}

export default Landing;
