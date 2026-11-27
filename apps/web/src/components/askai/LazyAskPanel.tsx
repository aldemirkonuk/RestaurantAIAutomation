import { onDemand } from '../mudavym/onDemand';

/** The Ask panel, from its own chunk. See `mudavym/onDemand.tsx`. */
const ask = onDemand(() => import('./AskPanel'));
export const LazyAskPanel = ask.Component;
export const preloadAskPanel = ask.preload;
