/**
 * useUxOverrides — reads the self-learning UX agent's approved, gated overrides
 * for a page and exposes them to components. Also mounts the friction detectors
 * for that page, so this hook is both halves of the client loop.
 *
 * A component asks for its `target_key`; if a human-approved override is live
 * AND this user falls inside its rollout bucket AND the feature is enabled
 * server-side, it receives the patch. Otherwise it renders exactly as today.
 * This is the ONLY channel through which the agent can influence the live UI,
 * and it is entirely opt-in + reversible.
 *
 * Mounted once in DashboardLayout. It previously existed but was imported by no
 * file, which meant the detectors never ran — so the feature was not merely
 * switched off, it was unreachable, and flipping VITE_UX_OPTIMIZER would have
 * collected nothing.
 */

import { useEffect, useState } from "react";
import { attachFrictionDetectors, reportTti } from "../lib/uxSignals";
import { apiClient } from "../services/api/client";

const ENABLED = import.meta.env.VITE_UX_OPTIMIZER === "true";

export interface UxOverride {
  targetKey: string;
  kind: string;
  patch: Record<string, unknown>;
  rolloutPct: number;
}

export function useUxOverrides(page: string) {
  const [overrides, setOverrides] = useState<Record<string, UxOverride>>({});

  useEffect(() => {
    if (!ENABLED) return;
    let cancelled = false;

    // restaurantId is deliberately not sent — the server takes it from the JWT.
    // A client that can name the tenant it is asking about is a client that can
    // name someone else's.
    const token = localStorage.getItem("accessToken");
    if (token) {
      apiClient
        .get<{ enabled?: boolean; overrides?: UxOverride[] }>(
          `/ux/overrides?page=${encodeURIComponent(page)}`,
        )
        .then(({ data: body }) => {
          if (cancelled || !body?.enabled) return;
          const map: Record<string, UxOverride> = {};
          for (const o of body.overrides ?? []) map[o.targetKey] = o;
          setOverrides(map);
        })
        .catch(() => {});
    }

    reportTti(page);
    const detach = attachFrictionDetectors(page);
    return () => {
      cancelled = true;
      detach();
    };
  }, [page]);

  /** Read one override's patch by target key; undefined when none is live. */
  const override = (targetKey: string): Record<string, unknown> | undefined =>
    overrides[targetKey]?.patch;

  return { overrides, override };
}
