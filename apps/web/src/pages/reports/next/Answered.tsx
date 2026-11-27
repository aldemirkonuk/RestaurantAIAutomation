/**
 * The register's view, built once per answer and window rather than on every
 * render of the cutting (perf-p10-4). Its own file so its `useMemo` import does
 * not share a line with `Cutting.tsx`'s react import, which other open work
 * rewrites (perf-p11-s3).
 */

import { useMemo, type ReactNode } from 'react';
import { CATALOGUE, type ViewCtx } from './rp-catalogue';
import type { AnalysisId } from './rp-sheet';
import type { AnalysisView } from './rp-view';

export default function Answered({
  spec,
  data,
  ctx,
  children,
}: {
  spec: (typeof CATALOGUE)[AnalysisId];
  data: unknown;
  ctx: ViewCtx;
  children: (view: AnalysisView) => ReactNode;
}) {
  const view = useMemo(() => spec.view(data, ctx), [spec, data, ctx]);
  return <>{children(view)}</>;
}
