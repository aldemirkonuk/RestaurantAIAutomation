/**
 * A till check, read after the fact: what it earned over what it cost, and the
 * lines that could not be costed or priced, in words.
 *
 * The gateway has kept the cost each line had when it sold (`cost_at_sale`) and
 * can say "cost not kept" for a line booked before costs were kept; it also
 * keeps the till's own lines, so a line the till sent with no price is known.
 * None of that reached a screen. A failed read says it failed (ADR 0020): the
 * list, and the check, never turn an unreadable answer into "nothing".
 *
 * Scope, stated on the screen: the margin counts the wine and shelf lines the
 * till sold. A drink-recipe line keeps no sale cost yet, so it is not in it.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getCheckView,
  getRecentChecks,
  type CheckView,
  type RecentCheck,
} from "../../services/api/posHub";

interface Props {
  restaurantId?: string;
}

function errText(e: unknown): string {
  const anyE = e as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return anyE?.response?.data?.message || anyE?.message || "Request failed";
}

const num = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(2);

export function CheckMarginSection({ restaurantId }: Props) {
  const [checks, setChecks] = useState<{
    data: RecentCheck[] | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<{
    data: CheckView | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: false });

  useEffect(() => {
    let live = true;
    setChecks({ data: null, error: null, loading: true });
    getRecentChecks(restaurantId)
      .then((d) => live && setChecks({ data: d, error: null, loading: false }))
      .catch(
        (e) =>
          live && setChecks({ data: null, error: errText(e), loading: false }),
      );
    return () => {
      live = false;
    };
  }, [restaurantId]);

  const open = (id: string) => {
    setPicked(id);
    setView({ data: null, error: null, loading: true });
    getCheckView(id, restaurantId)
      .then((d) => setView({ data: d, error: null, loading: false }))
      .catch((e) =>
        setView({ data: null, error: errText(e), loading: false }),
      );
  };

  const v = view.data;
  return (
    <section aria-label="Check margin">
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        Checks and margin
      </h3>
      <p className="text-[11px] text-gray-500 mb-2">
        Pick a closed check to see what its wine and shelf lines earned over the
        cost kept when they sold. Drink-recipe lines keep no sale cost yet, so
        they are not in the margin.
      </p>
      {checks.loading && (
        <p className="text-[11px] text-gray-400">
          <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
          Reading the checks…
        </p>
      )}
      {checks.error && (
        <p className="text-xs font-semibold text-amber-700">
          The recent checks could not be read ({checks.error}) — not the same as
          having none.
        </p>
      )}
      {checks.data && checks.data.length === 0 && (
        <p className="text-xs text-gray-400">No closed checks have arrived.</p>
      )}
      {checks.data && checks.data.length > 0 && (
        <select
          aria-label="Closed check"
          value={picked ?? ""}
          onChange={(e) => e.target.value && open(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 px-2 text-xs max-w-full"
        >
          <option value="">Choose a check…</option>
          {checks.data.map((c) => (
            <option key={`${c.source}:${c.external_check_id}`} value={c.external_check_id}>
              {c.external_check_id}
              {c.closed_at ? ` — ${c.closed_at.slice(0, 16).replace("T", " ")}` : ""}
              {c.total !== null ? ` — ${num(c.total)}` : ""}
              {c.voided ? " — voided" : ""}
            </option>
          ))}
        </select>
      )}

      {view.loading && (
        <p className="mt-2 text-[11px] text-gray-400">
          <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
          Reading the check…
        </p>
      )}
      {view.error && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          The check could not be read ({view.error}), so no margin is shown.
        </p>
      )}
      {v && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 text-xs">
          <p className="font-semibold text-gray-900">{v.sentence}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-gray-600">
            <span>
              Counted revenue <b className="font-mono">{num(v.revenue)}</b>
            </span>
            <span>
              Cost kept <b className="font-mono">{num(v.cost)}</b>
            </span>
            <span>
              Margin <b className="font-mono">{num(v.margin)}</b>
              {v.marginPct !== null ? ` (${v.marginPct}%)` : ""}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            <span className={v.linesWithoutCost > 0 ? "text-amber-700 font-semibold" : "text-gray-500"}>
              Cost not kept: {v.linesWithoutCost} line(s)
            </span>
            {v.priceNotSentLines === null ? (
              <span className="text-amber-700 font-semibold">
                Price not sent: the till's lines for this check were not found
              </span>
            ) : (
              <span
                className={
                  v.priceNotSentLines > 0 ? "text-amber-700 font-semibold" : "text-gray-500"
                }
              >
                Price not sent: {v.priceNotSentLines} line(s)
              </span>
            )}
            {v.voided && <span className="text-gray-500">This check was voided.</span>}
          </div>
          {v.lines.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-100">
              {v.lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-gray-800">{l.wine ?? "(unnamed line)"}</span>
                  <span className="text-gray-500 font-mono">
                    {num(l.revenue)} / {num(l.cost)}
                    {l.costNote && (
                      <span className="ml-2 font-sans font-semibold text-amber-700">
                        {l.costNote}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default CheckMarginSection;
