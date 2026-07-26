import { useLocation } from 'react-router-dom'
import { useGuidanceOptional } from './GuidanceProvider'
import { TIP_REGISTRY } from './tours/registry'
import type { PageTourId } from './types'

export function usePageGuidance() {
  const location = useLocation()
  const guidance = useGuidanceOptional()
  const pageId =
    guidance?.resolvePageId(location.pathname) ??
    (null as PageTourId | null)

  const tipDef = pageId ? TIP_REGISTRY[pageId] : null
  const showTip =
    !!guidance &&
    !!pageId &&
    guidance.tipVisibleFor === pageId &&
    !!tipDef

  return {
    pageId,
    tipDef,
    showTip,
    guidance,
  }
}
