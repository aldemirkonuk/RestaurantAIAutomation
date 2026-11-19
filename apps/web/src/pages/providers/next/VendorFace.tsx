/**
 * The vendor's face: a monogram disc, a twelve-week order sparkline and a
 * status dot with its word (critic N-19). Motion is transform, opacity and
 * clip-path only, and `prefers-reduced-motion` turns all of it off.
 */
import { SERIF } from './pv-format';
import { monogramOf, SPARK_WEEKS } from './vendor-face';
import './vendor-face.css';

export function VendorMonogram({ name, size = 40, settle = false }: { name: string; size?: number; settle?: boolean }) {
  const m = monogramOf(name);
  return (
    <span
      className="pv-mono"
      data-testid="vendor-monogram"
      data-settle={settle ? 'true' : undefined}
      aria-hidden
      style={{
        width: size,
        height: size,
        background: m.ground,
        color: m.ink,
        fontFamily: SERIF,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {m.initials}
    </span>
  );
}

/** Twelve bars, oldest first. `null` = the orders book is not read: nothing is drawn. */
export function OrderSpark({ weekly }: { weekly?: number[] | null }) {
  if (weekly == null) return null;
  const total = weekly.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...weekly);
  const label =
    total === 0 ? `No orders in the last ${SPARK_WEEKS} weeks` : `${total} ${total === 1 ? 'order' : 'orders'} in the last ${SPARK_WEEKS} weeks`;
  return (
    <span className="pv-spark" role="img" aria-label={label} data-testid="vendor-spark" data-total={total}>
      <svg width="72" height="20" viewBox="0 0 72 20" aria-hidden focusable="false">
        {weekly.map((n, i) => {
          const h = n === 0 ? 1.5 : Math.max(3, (n / max) * 18);
          return <rect key={i} x={i * 6} y={20 - h} width="4" height={h} rx="1" className={n === 0 ? 'pv-bar0' : 'pv-bar'} />;
        })}
      </svg>
      <span className="pv-spark-cap">{total === 0 ? 'no orders in 12 wk' : `${total} in 12 wk`}</span>
    </span>
  );
}

/** A dot and a word, from what the page already knows: orders open, or none. */
export function VendorStatus({ open }: { open: number | null }) {
  if (open === null) return null;
  const word = open > 0 ? `${open} open` : 'No open orders';
  return (
    <span className="pv-status" data-live={open > 0 ? 'true' : 'false'} data-testid="vendor-status">
      <span className="pv-dot" aria-hidden />
      {word}
    </span>
  );
}

/** A 4 px bar of hits over sample for the three share lines; nothing for any other outcome. */
export function ShareBar({ m }: { m: { key: string; outcome: string; hits: number | null; sample: number } }) {
  if (m.outcome !== 'answered' || m.hits === null || m.sample <= 0) return null;
  if (m.key !== 'onTime' && m.key !== 'linesAsOrdered' && m.key !== 'priceAsAgreed') return null;
  const share = Math.max(0, Math.min(1, m.hits / m.sample));
  return (
    <span className="sc-bar" aria-hidden data-testid="share-bar">
      <i style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}
