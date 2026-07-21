/**
 * useUxOverrides — reads the self-learning UX agent's approved, gated overrides
 * for a page and exposes them to components.
 *
 * A component asks for its `target_key`; if a human-approved override is live
 * AND this session falls inside its rollout bucket AND the feature is enabled
 * server-side, it receives the patch. Otherwise it renders exactly as today.
 * This is the ONLY channel through which the agent can influence the live UI,
 * and it is entirely opt-in + reversible.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  uxSessionId,
  attachFrictionDetectors,
  reportTti,
} from "../lib/uxSignals";

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";

export interface UxOverride {
  targetKey: string;
  kind: string;
  patch: Record<string, unknown>;
  rolloutPct: number;
}

export function useUxOverrides(page: string) {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const [overrides, setOverrides] = useState<Record<string, UxOverride>>({});

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page, sessionId: uxSessionId() });
    if (restaurantId) params.set("restaurantId", restaurantId);
    fetch(`${API_URL}/api/v1/ux/overrides?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.enabled) return;
        const map: Record<string, UxOverride> = {};
        for (const o of body.overrides ?? []) map[o.targetKey] = o;
        setOverrides(map);
      })
      .catch(() => {});

    // Wire friction detectors for this page (no-op unless VITE_UX_OPTIMIZER).
    reportTti(page, restaurantId);
    const detach = attachFrictionDetectors(page, restaurantId);
    return () => {
      cancelled = true;
      detach();
    };
  }, [page, restaurantId]);

  /** Read one override's patch by target key; undefined when none is live. */
  const override = (targetKey: string): Record<string, unknown> | undefined =>
    overrides[targetKey]?.patch;

  return { overrides, override };
}
