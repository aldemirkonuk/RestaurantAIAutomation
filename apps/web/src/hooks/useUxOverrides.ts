/**
 * useUxOverrides — reads the self-learning UX agent's approved, gated overrides
 * for a page and exposes them to components. It would also mount the friction
 * detectors for that page, making it both halves of the client loop.
 *
 * A component asks for its `target_key`; if a human-approved override is live
 * AND this user falls inside its rollout bucket AND the feature is enabled
 * server-side, it receives the patch. Otherwise it renders exactly as today.
 * This is the ONLY channel through which the agent can influence the live UI,
 * and it is entirely opt-in + reversible.
 *
 * NOT MOUNTED ANYWHERE — the whole client half of the loop ships dark.
 * `git grep -n useUxOverrides -- apps/web/src` returns only this file, and
 * `../lib/uxSignals` has no importer but this hook. So no TTI is reported, no
 * friction detector is attached, no override is ever fetched, and the
 * `data-ux-key` markers in the page tree are inert attributes nothing reads.
 * VITE_UX_OPTIMIZER gates code that does not run: flipping it collects nothing.
 *
 * How many markers is a number that moves, so it is written as the command that
 * produces it rather than as a figure that rots:
 *
 *   git grep -c 'data-ux-key=' -- apps/web/src | grep '\.tsx:' | grep -v '\.test\.'
 *
 * (written with `grep '\.tsx:'` rather than a `**` pathspec on purpose — a
 * glob ending `*.tsx` would close this comment block.)
 *
 * Run it — for a total, pipe it through
 * `awk -F: '{s+=$NF; n++} END {print s" lines across "n" files"}'`, and put a
 * ref before `--` to read any other tree (`git grep -c 'data-ux-key=' origin/main
 * -- apps/web/src | …`). No count is written here ON PURPOSE. The version of
 * this comment that shipped hours ago carried one, and it was already wrong by
 * the next commit on the same branch, which added markers to the door screen.
 * That is the whole failure this file is an example of: a figure in prose is
 * checked once, the day it is written; a command is checked every time someone
 * reads it. Quoting today's output here would only start the clock again.
 *
 * How the previous version of this comment came to lie. It said "Mounted once
 * in DashboardLayout", and that was TRUE the day it was written — 7c80b587
 * added both the sentence and the mount. Hours later, on the same day,
 * 1ddf0847 ("feat(receiving): door capture UI…") deleted the import, the
 * `pageKey()` helper and the `useUxOverrides(pageKey(location.pathname))` call
 * from DashboardLayout. Its message does not mention doing so. The sentence
 * outlived the wiring it described and has been false on main ever since, which
 * is why a claim like this one carries the command that re-checks it.
 *
 * To make it live, something must call it: mount `useUxOverrides(<page>)` once
 * per page shell (DashboardLayout being the obvious single site, keyed off the
 * route — see 7c80b587 for the `pageKey()` it used), THEN set
 * VITE_UX_OPTIMIZER=true so the client gate opens, with the server's own gate
 * and a human approval still standing between a signal and a live patch.
 * Mounting it starts collecting behaviour from real users, so it is a decision
 * to take deliberately, not a loose wire to quietly reconnect.
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
