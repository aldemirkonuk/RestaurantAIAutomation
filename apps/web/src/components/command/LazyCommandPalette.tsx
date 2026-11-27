import type { ComponentProps } from 'react';
import { onDemand } from '../mudavym/onDemand';
import type { CommandPalette } from './CommandPalette';

/** The ⌘K palette, from its own chunk. See `mudavym/onDemand.tsx`. */
const palette = onDemand<ComponentProps<typeof CommandPalette>>(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
export const LazyCommandPalette = palette.Component;
export const preloadCommandPalette = palette.preload;
