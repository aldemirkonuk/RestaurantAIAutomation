/**
 * The loading screens say why a stored session is still being read (r22,
 * 2026-11-13). Before this, a boot read waiting out a rate limit or a dropped
 * connection showed "Loading..." alone for up to a minute.
 */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useAuth } from "../contexts/AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";
import { RootDoor } from "../pages/landing/RootDoor";

vi.mock("../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("./layout/DashboardLayout", () => ({ DashboardLayout: () => null }));
vi.mock("../lib/mudavym/useMudavymDesign", () => ({ useMudavymDesign: () => true }));

const auth = (v: Record<string, unknown>) => (useAuth as Mock).mockReturnValue(v);
const loadingWith = (sessionWait: unknown) =>
  auth({ user: null, loading: true, isAuthenticated: false, sessionWait });

function protectedPage() {
  return render(
    <MemoryRouter initialEntries={["/reports"]}>
      <Routes>
        <Route path="/reports" element={<ProtectedRoute><div>the page</div></ProtectedRoute>} />
        <Route path="/login" element={<div>the sign-in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function rootPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<RootDoor landing={<div>the landing page</div>} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const note = () => document.querySelector("[data-session-wait-note]")?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem("accessToken", "stored");
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ProtectedRoute's Loading... screen", () => {
  it("an ordinary read says only Loading... for its first five seconds, then that it is slow", () => {
    loadingWith(null);
    protectedPage();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(note()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(note()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(note()).toBe("Still reaching Mudavym. This is taking longer than usual.");
    expect(screen.queryByText("the sign-in page")).toBeNull();
  });

  // A read waiting to ask again has #1092's own screen, which says why and
  // that the person is still signed in; the Loading... line adds nothing.
  it("a rate-limited read shows the wait screen at once: busy, still signed in", () => {
    loadingWith({ reason: "busy", retryAt: Date.now() + 53_250, attempt: 1 });
    protectedPage();
    expect(screen.getByText("Mudavym is busy for a moment.")).toBeInTheDocument();
    expect(screen.getByText(/You are still signed in/)).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(note()).toBeNull();
  });

  it("a dropped connection says check the connection", () => {
    loadingWith({ reason: "offline", retryAt: Date.now() + 4_000, attempt: 3 });
    protectedPage();
    expect(screen.getByText("This device is not reaching Mudavym.")).toBeInTheDocument();
    expect(screen.getByText(/^Check the connection\./)).toBeInTheDocument();
    expect(note()).toBeNull();
  });

  it("says nothing extra once the load is over", () => {
    auth({ user: null, loading: false, isAuthenticated: false, sessionWait: null });
    protectedPage();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(note()).toBeNull();
    expect(screen.getByText("the sign-in page")).toBeInTheDocument();
  });
});

describe("the root's house loader (a stored session at /)", () => {
  it("a read waiting to ask again shows the wait screen, not the landing page", () => {
    loadingWith({ reason: "server", retryAt: Date.now() + 2_000, attempt: 1 });
    rootPage();
    expect(screen.getByText("Mudavym is not answering right now.")).toBeInTheDocument();
    expect(note()).toBeNull();
    expect(screen.queryByText("the landing page")).toBeNull();
  });

  it("an ordinary read keeps the ladder silent at first and adds the slow line at five seconds", () => {
    loadingWith(null);
    const { container } = rootPage();
    expect(container.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(note()).toBe("Still reaching Mudavym. This is taking longer than usual.");
  });
});
