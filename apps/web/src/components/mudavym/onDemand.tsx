/**
 * A component that loads on demand (perf-p9-5).
 *
 * The Ask panel and the command palette are overlays that draw nothing until
 * they are opened, so their code (about 80 KB of source) has no business in the
 * entry chunk every cold route downloads. This wraps one so that it mounts, from
 * its own chunk, the first time `open` is true and stays mounted after, which is
 * what the static import did too (a closed overlay keeps its own close
 * behaviour; nothing here adds an exit animation or a fade, ADR 0112).
 *
 * `preload` starts the download without mounting anything. HouseShell calls it
 * when the pointer or focus reaches a button marked `data-preload`, and once the
 * page has gone idle, so the first open does not wait on the network.
 */
import { Suspense, lazy, useState, type ComponentType } from 'react';

export function onDemand<P extends { open: boolean }>(
  load: () => Promise<{ default: ComponentType<P> }>,
): { Component: ComponentType<P>; preload: () => void } {
  const Lazy = lazy(load) as unknown as ComponentType<P>;
  function Component(props: P) {
    const [mounted, setMounted] = useState(props.open);
    if (props.open && !mounted) setMounted(true);
    if (!mounted) return null;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return {
    Component,
    preload: () => {
      void load().catch(() => {
        /* a failed preload is retried by the open itself, which says so */
      });
    },
  };
}
