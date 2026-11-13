/**
 * The rail's stock panel for a house that holds no goods yet (r28 onboarding,
 * gap 2). The low-stock list is read from the house's goods, so for a house
 * with none an empty list is not health: nothing can run low because nothing
 * is counted. `LowStockPanel` said "Nothing is running low." over that, on the
 * first screen a new owner reaches after /get-started. This panel takes its
 * place, with the same title and the same link out, and says what is true and
 * where the goods come in.
 *
 * Shown only when the totals and the low-stock list both answered and agree:
 * zero goods, and nothing below its minimum (DashboardNext decides).
 */
import { Link } from 'react-router-dom';

const LINK =
  'text-[11px] uppercase tracking-[0.1em] text-inkm-4 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal';

export default function NoGoodsYet() {
  return (
    <section
      className="rounded-lg border border-paper-2 bg-paper-0 p-4"
      aria-label="Running low"
      data-testid="dn-no-goods-yet"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-inkm-1">Running low</h2>
        <Link to="/inventory" className={LINK}>
          Inventory
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        <p className="text-[12px] text-inkm-2">
          The house has no goods on its list yet, so nothing can run low. Low stock is read from the goods the
          house has counted.
        </p>
        <Link
          to="/inventory"
          className="dn-ink inline-block rounded border border-seal-ring bg-seal-tint px-3 py-1.5 text-[11.5px] font-semibold text-seal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        >
          Count the first goods
        </Link>
      </div>
    </section>
  );
}
