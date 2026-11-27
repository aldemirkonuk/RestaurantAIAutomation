/**
 * One 96 px line illustration per register (r58, N-09). Drawn in the ink of
 * the logo (`--ink-1`), one 1.25 px hairline, no fill, so every register's
 * empty page reads as the same hand. The art is decoration: it carries no
 * claim and is hidden from assistive technology — the sentence beside it is
 * the only thing that says what is (not) there.
 */

import type { ReactNode } from 'react';

export type EmptyArtName =
  | 'book'
  | 'receipt'
  | 'vendor'
  | 'glass'
  | 'cellar'
  | 'team'
  | 'mail'
  | 'till'
  | 'menu';

/** The inner shapes of each illustration, on a 96 x 96 board. */
const SHAPES: Record<EmptyArtName, ReactNode> = {
  // An open order book: two pages, a ribbon.
  book: (
    <>
      <path d="M48 24c-8-5-20-6-30-3v47c10-3 22-2 30 3 8-5 20-6 30-3V21c-10-3-22-2-30 3Z" />
      <path d="M48 24v47" />
      <path d="M26 33c6-1 12 0 16 2M26 42c6-1 12 0 16 2" />
      <path d="M62 66v13l5-4 5 4V63" />
    </>
  ),
  // A paper with a torn foot and ruled lines — the ghost of a document.
  receipt: (
    <>
      <path d="M28 14h40v68l-5-4-5 4-5-4-5 4-5-4-5 4-5-4-5 4Z" />
      <path d="M37 28h22M37 38h22M37 48h14" />
      <path d="M55 56h6" />
    </>
  ),
  // A crate with a lid and a hand-written tag.
  vendor: (
    <>
      <path d="M16 38 48 24l32 14v34L48 86 16 72Z" />
      <path d="M16 38l32 14 32-14M48 52v34" />
      <path d="M62 31 32 45" />
    </>
  ),
  // A coupe and a slice of citrus.
  glass: (
    <>
      <path d="M24 26h48c0 14-10 24-24 24S24 40 24 26Z" />
      <path d="M48 50v26M34 76h28" />
      <circle cx="68" cy="22" r="8" />
      <path d="M62 22h12M68 16v12" />
    </>
  ),
  // A room plan with a pin.
  cellar: (
    <>
      <path d="M14 28h68v50H14Z" />
      <path d="M14 48h30M44 28v50M62 48h20" />
      <path d="M62 36c0-5 4-9 8-9s8 4 8 9c0 7-8 14-8 14s-8-7-8-14Z" />
      <circle cx="70" cy="36" r="2.5" />
    </>
  ),
  // Two people at a table.
  team: (
    <>
      <circle cx="34" cy="34" r="9" />
      <circle cx="64" cy="38" r="8" />
      <path d="M16 78c1-14 9-22 18-22s17 8 18 22" />
      <path d="M50 78c1-12 7-19 14-19s13 7 14 19" />
    </>
  ),
  // A letter, flap half open.
  mail: (
    <>
      <path d="M14 28h68v44H14Z" />
      <path d="m14 30 34 24 34-24" />
      <path d="M14 72l24-22M82 72 58 50" />
    </>
  ),
  // A till tape: a line chart on a ruled sheet.
  till: (
    <>
      <path d="M16 18v60h64" />
      <path d="M26 62l14-14 12 8 18-24" />
      <path d="M26 30h6M26 40h6" />
    </>
  ),
  // The page turn — a menu with a dog-eared corner.
  menu: (
    <>
      <path d="M26 14h34l12 12v56H26Z" />
      <path d="M60 14v12h12" />
      <path d="M36 40h26M36 50h26M36 60h16" />
    </>
  ),
};

export interface EmptyArtProps {
  name: EmptyArtName;
  /** Pixels. Default 96. */
  size?: number;
}

export function EmptyArt({ name, size = 96 }: EmptyArtProps) {
  return (
    <svg
      className="mdv-empty__art"
      data-art={name}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}

/**
 * A paper that is not there yet: skeleton lines at 6% ink. For the receipts
 * split pane, where "choose a document" used to be two lines in 1000 px.
 */
export function GhostDocument() {
  return (
    <div className="mdv-ghost" data-testid="ghost-document" aria-hidden>
      <span className="mdv-ghost__line mdv-ghost__line--head" />
      {[92, 100, 84, 96, 60, 88, 72].map((w, i) => (
        <span key={i} className="mdv-ghost__line" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/**
 * The bell's "All caught up": a ring and a check that draw themselves
 * (stroke-dashoffset, 360 ms). Under reduced motion it is simply there.
 */
export function CaughtUpCheck({ still }: { still?: boolean }) {
  return (
    <svg
      className="mdv-caught"
      data-still={still ? 'true' : undefined}
      width={28}
      height={28}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <circle className="mdv-caught__ring" cx="14" cy="14" r="11" />
      <path className="mdv-caught__tick" d="m9 14.5 3.5 3.5L19 11" />
    </svg>
  );
}
