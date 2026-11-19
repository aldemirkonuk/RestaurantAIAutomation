/**
 * The drawing an empty cutting wears: a ledger page ruled off. Drawn on a
 * 96 px grid and shown at 40 px in the strip, so it stays a drawing and does
 * not turn into an icon. A double rule under a figure means the account is
 * ruled off (the house mark's own idea), which is what an empty register is:
 * read, and nothing in it.
 *
 * Decorative: the strip's sentence is what a screen reader gets.
 */
export default function RuledOff() {
  return (
    <svg
      className="rp-ruled"
      viewBox="0 0 96 96"
      width={40}
      height={40}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
    >
      <rect x="18" y="10" width="60" height="76" rx="8" />
      <path d="M30 28h36M30 40h24" opacity="0.5" />
      <path d="M30 60h36M30 67h36" />
      <circle cx="69" cy="48" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
