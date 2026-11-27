/**
 * The three recharts drawings, loaded on demand (r104 g4). Recharts is the
 * heaviest thing the page parses; every other part of a cutting (its title,
 * figures, strips, tables, sentences) is chart-free and should not wait for it.
 * Until the drawing module resolves, the cutting shows its outline: a held
 * block in the card's own slot, which the drawing replaces.
 *
 * A module that does not arrive (a dropped fetch, a deploy between the route
 * chunk and this one) fails ONLY the drawing that asked for it: the card says
 * so and offers a retry, and the other cuttings on the sheet are untouched.
 * It is deliberately not React.lazy under the page boundary, whose reload on a
 * stale chunk would throw away an unsaved Arrange draft.
 */
import { useEffect, useState } from 'react';
import type { ComponentProps, ComponentType } from 'react';
import { Refused } from './rp-plot-chrome';
import type { Failure } from './rp-format';

type Mod = typeof import('./rp-plot');

let loaded: Mod | null = null;
let loading: Promise<Mod> | null = null;
function load(): Promise<Mod> {
  loading ??= import('./rp-plot').then(
    (m) => (loaded = m),
    (e: unknown) => {
      loading = null; // a failed import must be asked for again, not replayed
      throw e;
    },
  );
  return loading;
}

const DID_NOT_ARRIVE: Failure = {
  status: null,
  message: 'the chart code did not arrive',
  forbidden: false,
};

/** The outline: no motion of its own, so reduced motion has nothing to switch off. */
function Outline() {
  return <div className="rp-plot-outline" role="status" aria-label="Drawing the chart" />;
}

function drawing<K extends 'CatPlot' | 'ComboPlot' | 'PointPlot'>(name: K) {
  return function Drawing(props: ComponentProps<Mod[K]>) {
    const [mod, setMod] = useState<Mod | null>(loaded);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (mod) return;
      let live = true;
      setFailed(false);
      load().then(
        (m) => live && setMod(m),
        () => live && setFailed(true),
      );
      return () => {
        live = false;
      };
    }, [mod, attempt]);
    if (mod) {
      // One drawing per name, and `props` is that drawing's own: the union only widens inside this generic.
      const Plot = mod[name] as ComponentType<any>;
      return <Plot {...props} />;
    }
    if (failed)
      return <Refused register="drawing" failure={DID_NOT_ARRIVE} onRetry={() => setAttempt((n) => n + 1)} />;
    return <Outline />;
  };
}

export const CatPlot = drawing('CatPlot');
export const ComboPlot = drawing('ComboPlot');
export const PointPlot = drawing('PointPlot');
