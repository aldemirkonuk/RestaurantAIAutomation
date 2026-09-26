import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "../contexts/AuthContext";

/**
 * ProtectedRoute and the session's house (ADR 0164): a session in no house is
 * sent to the chooser, carrying where it was headed; the role check is exact,
 * on the role in the session's house, like the gateway's RolesGuard.
 */

vi.mock("../contexts/AuthContext", () => ({ useAuth: vi.fn() }));

function Where() {
  const l = useLocation();
  const from = (l.state as { from?: { pathname?: string } } | null)?.from
    ?.pathname;
  return (
    <div data-testid="where">
      {l.pathname}
      {from ? ` from ${from}` : ""}
    </div>
  );
}

function renderWith(user: Record<string, unknown> | null, requiredRole?: any) {
  vi.mocked(useAuth).mockReturnValue({
    user,
    loading: false,
    isAuthenticated: !!user,
  } as any);
  return render(
    <MemoryRouter initialEntries={["/inventory"]}>
      <Routes>
        <Route
          path="/inventory"
          element={
            <ProtectedRoute requiredRole={requiredRole}>
              <div>the page</div>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const inHouse = (role: string | null) => ({
  userId: "u",
  email: "p@house.test",
  emailVerified: true,
  restaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role,
});

describe("ProtectedRoute", () => {
  it("sends a session in no house to the chooser, remembering where it was going", () => {
    renderWith({
      userId: "u",
      email: "p@house.test",
      emailVerified: true,
      restaurantId: "",
      role: null,
    });
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/choose-house from /inventory",
    );
  });

  it("opens the page for a session in a house", () => {
    renderWith(inHouse("staff"));
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("lets owners and managers through a page for ['owner', 'manager'], and not staff", () => {
    const { unmount } = renderWith(inHouse("manager"), ["owner", "manager"]);
    expect(screen.getByText("the page")).toBeInTheDocument();
    unmount();
    renderWith(inHouse("staff"), ["owner", "manager"]);
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("is exact: 'owner' alone refuses a manager", () => {
    renderWith(inHouse("manager"), "owner");
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
  });
});
