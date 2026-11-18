import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "../contexts/AuthContext";
import { clearMudavymDesignCache } from "../lib/mudavym/useMudavymDesign";

/**
 * While the session read is still out (a cold reload with a token), the guard
 * shows the shell's frame, never the grey "Loading..." spinner on a light slate
 * (r60 walk: it flashed light on a charcoal house between the boot frame and
 * the page).
 */

vi.mock("../contexts/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../contexts/AuthContext")>()),
  useAuth: vi.fn(),
}));

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
});
afterEach(() => window.localStorage.clear());

function renderLoading() {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: true,
    isAuthenticated: false,
  } as any);
  return render(
    <MemoryRouter initialEntries={["/inventory"]}>
      <ProtectedRoute>
        <div>the page</div>
      </ProtectedRoute>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute while the session read is out", () => {
  it("paints the shell frame and no grey Loading... text", () => {
    renderLoading();
    expect(screen.getByTestId("shell-skeleton")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.queryByText("the page")).toBeNull();
  });
});
