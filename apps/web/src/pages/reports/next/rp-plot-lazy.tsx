/**
 * The three recharts drawings, loaded on demand (r104 g4). Recharts is the
 * heaviest thing the page parses; every other part of a cutting (its title,
 * figures, strips, tables, sentences) is chart-free and should not wait for it.
 * Until the drawing module resolves, the cutting shows its outline: a held
 * block in the card's own slot, which the drawing replaces.
 */
import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Cat = lazy(() => import('./rp-plot').then((m) => ({ default: m.CatPlot })));
const Combo = lazy(() => import('./rp-plot').then((m) => ({ default: m.ComboPlot })));
const Point = lazy(() => import('./rp-plot').then((m) => ({ default: m.PointPlot })));

/** The outline: no motion of its own, so reduced motion has nothing to switch off. */
function Outline() {
  return <div className="rp-plot-outline" role="status" aria-label="Drawing the chart" />;
}

export function CatPlot(props: ComponentProps<typeof Cat>) {
  return (
    <Suspense fallback={<Outline />}>
      <Cat {...props} />
    </Suspense>
  );
}
export function ComboPlot(props: ComponentProps<typeof Combo>) {
  return (
    <Suspense fallback={<Outline />}>
      <Combo {...props} />
    </Suspense>
  );
}
export function PointPlot(props: ComponentProps<typeof Point>) {
  return (
    <Suspense fallback={<Outline />}>
      <Point {...props} />
    </Suspense>
  );
}
