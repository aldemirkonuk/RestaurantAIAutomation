import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthShell, AuthCard } from "../components/brand/AuthShell";
import "../components/brand/auth-house.css";
import { useAuth } from "../contexts/AuthContext";
import { usePublicDesign } from "../lib/mudavym/publicDesign";
import { ink } from "../lib/mudavym/motion";
import apiClient from "../services/api/client";
import {
  CHOOSER_SEARCH_ABOVE,
  cachedHouseName,
  orderForChooser,
  readHouseEnded,
  type ChooserHouse,
} from "../lib/houseMemory";

/**
 * Which house today? (ADR 0164, R7; the founder, 2026-09-18: "if they own
 * couple houses ... we let them choose which").
 *
 * The page after sign-in for a person with two or more houses whose device has
 * not used one of them within seven days, and for anyone whose access to the
 * house they were in has just ended. One large row per house, the name and the
 * city and nothing else; this device's last house first, marked; one tap opens
 * it. Kept simple on purpose ("simple for people"): no role, no numbers, no
 * logos. It is the next leaf after sign-in, so it wears the sign-in page's
 * clothes: the same shell, the same public-door switch (`usePublicDesign`), the
 * same paper and seal when that switch is on (sketch 118).
 */

const ROW_TRANSITION = `transform ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing}`;

type Load =
  | { state: "loading" }
  | { state: "ready"; houses: ChooserHouse[] }
  | { state: "failed" };

export function ChooseHouse() {
  const { user, loading, logout, setActiveRestaurantId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const on = usePublicDesign();

  const from = (
    location.state as { from?: { pathname?: string; search?: string } } | null
  )?.from;
  const destination =
    from?.pathname && from.pathname !== "/choose-house"
      ? `${from.pathname}${from.search ?? ""}`
      : "/";

  // Read once: the name comes from the list this device cached before the
  // house ended, because the fresh list no longer has it.
  const [ended] = useState(() => {
    const id = readHouseEnded();
    return id ? (cachedHouseName(id) ?? "that house") : null;
  });

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [opening, setOpening] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchHouses = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const { data } = await apiClient.get("/auth/houses");
      const houses = Array.isArray(data?.houses)
        ? (data.houses as ChooserHouse[])
        : [];
      setLoad({ state: "ready", houses });
    } catch {
      setLoad({ state: "failed" });
    }
  }, []);

  useEffect(() => {
    if (user) void fetchHouses();
  }, [user, fetchHouses]);

  const ordered = useMemo(
    () =>
      load.state === "ready"
        ? orderForChooser(load.houses, user?.userId)
        : null,
    [load, user?.userId],
  );

  const visible = useMemo(() => {
    if (!ordered) return [];
    const q = query.trim().toLocaleLowerCase();
    if (!q) return ordered.houses;
    return ordered.houses.filter(
      (h) =>
        h.name.toLocaleLowerCase().includes(q) ||
        (h.city ?? "").toLocaleLowerCase().includes(q),
    );
  }, [ordered, query]);

  if (!loading && !user) return <Navigate to="/login" replace />;
  if (user?.emailVerified === false)
    return <Navigate to="/verify-email" replace />;
  if (load.state === "ready" && load.houses.length === 0)
    return <Navigate to="/no-access" replace />;

  const open = async (house: ChooserHouse) => {
    setRefused(null);
    setOpening(house.id);
    const ok = await setActiveRestaurantId(house.id);
    setOpening(null);
    if (ok) {
      navigate(destination, { replace: true });
      return;
    }
    setRefused(
      `We couldn't open ${house.name}. Try again, or choose another house.`,
    );
    void fetchHouses();
  };

  const ink1 = on ? "!text-inkm-1" : "text-gray-900";
  const ink3 = on ? "!text-inkm-3" : "text-gray-500";

  return (
    <AuthShell
      title="Which house today?"
      subtitle={user?.email ? `Signed in as ${user.email}` : undefined}
      house={on}
    >
      <AuthCard house={on}>
        {ended && (
          <p
            role="status"
            className={`mb-5 text-sm ${on ? "!text-inkm-2" : "text-gray-700"}`}
          >
            Your access to {ended} has ended.
          </p>
        )}

        {refused && (
          <p role="alert" className="mb-5 text-sm !text-red-700">
            {refused}
          </p>
        )}

        {load.state === "loading" && (
          <p className={`text-sm ${ink3}`} aria-live="polite">
            Opening your houses…
          </p>
        )}

        {load.state === "failed" && (
          <div className="space-y-3">
            <p
              role="alert"
              className={`text-sm ${on ? "!text-inkm-2" : "text-gray-700"}`}
            >
              We couldn't read your houses just now.
            </p>
            <button
              type="button"
              onClick={() => void fetchHouses()}
              className={
                on
                  ? "text-sm font-medium text-seal underline underline-offset-4"
                  : "text-sm font-medium text-wine-600 underline underline-offset-4"
              }
            >
              Try again
            </button>
          </div>
        )}

        {ordered && ordered.houses.length > CHOOSER_SEARCH_ABOVE && (
          <label className="mb-4 block">
            <span className="sr-only">Find a house</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a house"
              className={
                on
                  ? "block w-full rounded-xl border border-paper-2 bg-paper-0 px-4 py-3 text-inkm-1 placeholder:text-inkm-3 focus:outline-none"
                  : "block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-wine-600"
              }
            />
          </label>
        )}

        {ordered && (
          <ul className="space-y-3" aria-label="Your houses">
            {visible.map((house) => {
              const last = house.id === ordered.lastOpenedId;
              return (
                <li key={house.id}>
                  <button
                    type="button"
                    onClick={() => void open(house)}
                    disabled={opening !== null}
                    aria-describedby={last ? `last-${house.id}` : undefined}
                    style={{ transition: ROW_TRANSITION }}
                    className={[
                      "w-full rounded-xl border px-5 py-4 text-left active:scale-[0.99] disabled:opacity-60",
                      on
                        ? last
                          ? "border-seal bg-paper-0 hover:bg-seal-tint"
                          : "border-paper-2 bg-paper-0 hover:border-seal hover:bg-seal-tint"
                        : last
                          ? "border-wine-600 bg-white hover:bg-wine-50"
                          : "border-gray-200 bg-white hover:border-wine-300 hover:bg-wine-50",
                    ].join(" ")}
                  >
                    <span
                      className={`block text-lg font-semibold leading-snug ${ink1}`}
                      style={
                        on
                          ? {
                              fontFamily:
                                "'Fraunces', Georgia, 'Times New Roman', serif",
                            }
                          : undefined
                      }
                    >
                      {opening === house.id
                        ? `Opening ${house.name}…`
                        : house.name}
                    </span>
                    {house.city && (
                      <span className={`mt-0.5 block text-sm ${ink3}`}>
                        {house.city}
                      </span>
                    )}
                    {last && (
                      <span
                        id={`last-${house.id}`}
                        className={`mt-2 block text-xs font-medium uppercase tracking-wide ${on ? "!text-seal" : "text-wine-600"}`}
                      >
                        Last opened here
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className={`text-sm ${ink3}`}>No house matches “{query}”.</li>
            )}
          </ul>
        )}

        <p className={`mt-8 text-center text-sm ${ink3}`}>
          Not you?{" "}
          <button
            type="button"
            onClick={() =>
              void logout().then(() => navigate("/login", { replace: true }))
            }
            className={
              on
                ? "font-medium text-seal underline underline-offset-4 hover:text-seal-deep"
                : "font-medium text-wine-600 underline underline-offset-4 hover:text-wine-700"
            }
          >
            Sign out
          </button>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
