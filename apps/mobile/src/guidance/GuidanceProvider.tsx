import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { storage } from "@/lib/mmkv";
import { trackGuidance } from "./analytics";
import { TOUR_REGISTRY } from "./content";
import {
  DEFAULT_GUIDANCE_STATE,
  ROUTE_TO_PAGE_TOUR,
  type GuidanceState,
  type PageGuidanceState,
  type PageTourId,
} from "./types";

const SESSION_KEY = "wineops_guidance_session";

type SessionFatigue = {
  offers: number;
  skips: number;
  offeredPageId?: PageTourId;
};

function readSession(): SessionFatigue {
  try {
    const raw = storage.getString(SESSION_KEY);
    if (!raw) return { offers: 0, skips: 0 };
    return JSON.parse(raw) as SessionFatigue;
  } catch {
    return { offers: 0, skips: 0 };
  }
}

function writeSession(s: SessionFatigue) {
  storage.set(SESSION_KEY, JSON.stringify(s));
}

function mergeGuidance(raw: unknown): GuidanceState {
  const g = (raw && typeof raw === "object" ? raw : {}) as Partial<GuidanceState>;
  return {
    global: { ...DEFAULT_GUIDANCE_STATE.global, ...g.global },
    pages: { ...DEFAULT_GUIDANCE_STATE.pages, ...g.pages },
    guide: { use_cards_seen: g.guide?.use_cards_seen ?? [] },
  };
}

function defaultPage(): PageGuidanceState {
  return { tip: "unseen", tour: "unseen" };
}

interface GuidanceContextValue {
  state: GuidanceState;
  tipVisibleFor: PageTourId | null;
  activeTour: PageTourId | null;
  tourStepIndex: number;
  startTour: (pageId: PageTourId) => void;
  nextTourStep: () => void;
  skipTour: () => void;
  snoozeTip: (pageId: PageTourId) => void;
  dismissTip: (pageId: PageTourId) => void;
  completeTipViaTour: (pageId: PageTourId) => void;
  resetTips: () => void;
  setShowWineAgentFab: (show: boolean) => void;
  unlockWineAgentFab: () => void;
  servicePermissions: Record<string, boolean>;
  setServicePermission: (key: string, value: boolean) => void;
  onboarding: {
    menu_uploaded: boolean;
    vendor_added: boolean;
    team_member_invited: boolean;
    completed_at: string | null;
  } | null;
}

const GuidanceContext = createContext<GuidanceContextValue | null>(null);

export function GuidanceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const userId = useSession((s) => s.user?.id);
  const qc = useQueryClient();
  const [sessionTick, setSessionTick] = useState(0);
  const [activeTour, setActiveTour] = useState<PageTourId | null>(null);
  const [tourStepIndex, setTourStepIndex] = useState(0);

  const prefsQuery = useQuery({
    queryKey: ["user-preferences", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<{ preferences: Record<string, unknown> }>(
        `/users/${userId}/preferences`,
      );
      return res.preferences ?? {};
    },
  });

  const onboardingQuery = useQuery({
    queryKey: ["onboarding-progress", userId],
    enabled: !!userId,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      try {
        return await api<{
          menu_uploaded: boolean;
          vendor_added: boolean;
          team_member_invited: boolean;
          completed_at: string | null;
        }>("/onboarding/progress");
      } catch {
        return null;
      }
    },
  });

  const state = useMemo(
    () => mergeGuidance(prefsQuery.data?.guidance),
    [prefsQuery.data?.guidance],
  );

  const servicePermissions = useMemo(() => {
    const raw = (prefsQuery.data?.servicePermissions ?? {}) as Record<string, boolean>;
    return {
      email: raw.email !== false,
      web: raw.web !== false,
      privacy_analytics: raw.privacy_analytics !== false,
      privacy_sharing: !!raw.privacy_sharing,
      ...raw,
    };
  }, [prefsQuery.data?.servicePermissions]);

  const persistMutation = useMutation({
    mutationFn: async (partial: Record<string, unknown>) => {
      if (!userId) return;
      return api(`/users/${userId}/preferences`, {
        method: "PATCH",
        body: { preferences: partial },
      });
    },
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: ["user-preferences", userId] });
    },
  });

  const persistGuidance = useCallback(
    (next: GuidanceState) => {
      persistMutation.mutate({ guidance: next });
    },
    [persistMutation],
  );

  const patchPage = useCallback(
    (pageId: PageTourId, patch: Partial<PageGuidanceState>) => {
      const prev = state.pages[pageId] ?? defaultPage();
      persistGuidance({
        ...state,
        pages: { ...state.pages, [pageId]: { ...prev, ...patch } },
      });
    },
    [persistGuidance, state],
  );

  const tipVisibleFor = useMemo((): PageTourId | null => {
    if (state.global.hide_all_tips) return null;
    if (activeTour) return null;
    if (state.global.tips_snoozed_until) {
      if (new Date(state.global.tips_snoozed_until).getTime() > Date.now()) return null;
    }
    const session = readSession();
    if (session.skips >= 2) return null;

    const pageId = ROUTE_TO_PAGE_TOUR[pathname];
    if (!pageId) return null;
    const page = state.pages[pageId] ?? defaultPage();
    if (page.tip !== "unseen") return null;
    if (page.snooze_until && new Date(page.snooze_until).getTime() > Date.now()) return null;
    if (session.offers >= 1 && session.offeredPageId && session.offeredPageId !== pageId) {
      return null;
    }
    return pageId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, activeTour, pathname, sessionTick]);

  useEffect(() => {
    if (!tipVisibleFor) return;
    const s = readSession();
    if (s.offers < 1 || s.offeredPageId !== tipVisibleFor) {
      s.offers = 1;
      s.offeredPageId = tipVisibleFor;
      writeSession(s);
      trackGuidance("tip_shown", { pageId: tipVisibleFor });
      setSessionTick((n) => n + 1);
    }
  }, [tipVisibleFor]);

  const startTour = useCallback(
    (pageId: PageTourId) => {
      trackGuidance("tour_started", { pageId });
      trackGuidance("tour_step", { pageId, step: 0 });
      setActiveTour(pageId);
      setTourStepIndex(0);
      patchPage(pageId, { tip: "completed", tour: "in_progress" });
    },
    [patchPage],
  );

  const nextTourStep = useCallback(() => {
    if (!activeTour) return;
    const steps = TOUR_REGISTRY[activeTour] ?? [];
    if (tourStepIndex >= steps.length - 1) {
      trackGuidance("tour_completed", { pageId: activeTour });
      patchPage(activeTour, { tour: "completed", tip: "completed" });
      setActiveTour(null);
      setTourStepIndex(0);
      return;
    }
    const next = tourStepIndex + 1;
    trackGuidance("tour_step", { pageId: activeTour, step: next });
    setTourStepIndex(next);
  }, [activeTour, tourStepIndex, patchPage]);

  const skipTour = useCallback(() => {
    if (!activeTour) return;
    const s = readSession();
    s.skips += 1;
    writeSession(s);
    setSessionTick((n) => n + 1);
    trackGuidance("tour_skipped", { pageId: activeTour });
    patchPage(activeTour, { tour: "skipped" });
    setActiveTour(null);
    setTourStepIndex(0);
  }, [activeTour, patchPage]);

  const snoozeTip = useCallback(
    (pageId: PageTourId) => {
      const s = readSession();
      s.skips += 1;
      writeSession(s);
      setSessionTick((n) => n + 1);
      trackGuidance("tip_snoozed", { pageId });
      const until = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      patchPage(pageId, { tip: "snoozed", snooze_until: until });
    },
    [patchPage],
  );

  const dismissTip = useCallback(
    (pageId: PageTourId) => {
      const s = readSession();
      s.skips += 1;
      writeSession(s);
      setSessionTick((n) => n + 1);
      trackGuidance("tip_dismissed", { pageId });
      patchPage(pageId, { tip: "dismissed" });
    },
    [patchPage],
  );

  const completeTipViaTour = useCallback(
    (pageId: PageTourId) => {
      trackGuidance("tip_take_tour", { pageId });
      startTour(pageId);
    },
    [startTour],
  );

  const resetTips = useCallback(() => {
    const pages = { ...state.pages };
    for (const key of Object.keys(pages) as PageTourId[]) {
      pages[key] = { tip: "unseen", tour: pages[key]?.tour ?? "unseen" };
    }
    writeSession({ offers: 0, skips: 0 });
    setSessionTick((n) => n + 1);
    persistGuidance({
      ...state,
      global: { ...state.global, hide_all_tips: false, tips_snoozed_until: undefined },
      pages,
    });
  }, [persistGuidance, state]);

  const setShowWineAgentFab = useCallback(
    (show: boolean) => {
      persistGuidance({
        ...state,
        global: { ...state.global, show_wine_agent_fab: show },
      });
    },
    [persistGuidance, state],
  );

  const unlockWineAgentFab = useCallback(() => {
    persistGuidance({
      ...state,
      global: {
        ...state.global,
        wine_agent_fab_unlocked: true,
        show_wine_agent_fab: true,
      },
    });
  }, [persistGuidance, state]);

  const setServicePermission = useCallback(
    (key: string, value: boolean) => {
      persistMutation.mutate({
        servicePermissions: { ...servicePermissions, [key]: value },
      });
    },
    [persistMutation, servicePermissions],
  );

  const value: GuidanceContextValue = {
    state,
    tipVisibleFor,
    activeTour,
    tourStepIndex,
    startTour,
    nextTourStep,
    skipTour,
    snoozeTip,
    dismissTip,
    completeTipViaTour,
    resetTips,
    setShowWineAgentFab,
    unlockWineAgentFab,
    servicePermissions,
    setServicePermission,
    onboarding: onboardingQuery.data ?? null,
  };

  return (
    <GuidanceContext.Provider value={value}>{children}</GuidanceContext.Provider>
  );
}

export function useGuidance() {
  const ctx = useContext(GuidanceContext);
  if (!ctx) throw new Error("useGuidance must be used within GuidanceProvider");
  return ctx;
}

export function useGuidanceOptional() {
  return useContext(GuidanceContext);
}
