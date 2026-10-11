import { describe, it, expect, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionEndedPanel } from "./SessionEndedPanel";
import { announceSessionEnded, signInAgainPath } from "../../lib/sessionEnded";
import { AuthContext, type AuthContextType } from "../../contexts/AuthContext";

/**
 * F-335: a refused sign-in is said over the page, and the page stays. The
 * typed field below must survive the panel opening; "Sign in here" goes to
 * sign-in with a reason and a way back to this page.
 */

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

const AYSE = "11111111-1111-4111-8111-111111111111";
const MEHMET = "22222222-2222-4222-8222-222222222222";

function jwt(sub: string): string {
  return `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;
}

function setup() {
  const auth = { user: { userId: AYSE, email: "a@house.test" } } as unknown as AuthContextType;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/orders?vendor=7"]}>
        <SessionEndedPanel />
        <Where />
        <Routes>
          <Route path="/orders" element={<input aria-label="Quantity" defaultValue="" />} />
          <Route path="/login" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => localStorage.clear());

describe("SessionEndedPanel", () => {
  it("stays quiet until a sign-in is refused", () => {
    setup();
    expect(screen.queryByText("Sign in again")).toBeNull();
  });

  it("says why over the page and keeps what was typed", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "12" } });

    act(() => announceSessionEnded("Your password was changed. Sign in again."));

    expect(screen.getByText("Your password was changed. Sign in again.")).toBeTruthy();
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("12");
  });

  it("'Sign in here' goes to sign-in with a reason and the way back", () => {
    setup();
    act(() => announceSessionEnded());
    fireEvent.click(screen.getByTestId("session-ended-here"));
    expect(screen.getByTestId("where").textContent).toBe(
      "/login?redirect=%2Forders%3Fvendor%3D7&ended=1",
    );
  });

  it("closes on its own when this browser signs in again in another tab", () => {
    setup();
    act(() => announceSessionEnded());
    expect(screen.getByTestId("session-ended-here")).toBeTruthy();
    act(() => {
      localStorage.setItem("accessToken", jwt(AYSE));
      window.dispatchEvent(new StorageEvent("storage", { key: "refreshToken", newValue: "r2" }));
    });
    expect(screen.queryByTestId("session-ended-here")).toBeNull();
  });

  it("stays open when someone else signs in in another tab (F-1141)", () => {
    setup();
    act(() => announceSessionEnded());
    act(() => {
      localStorage.setItem("accessToken", jwt(MEHMET));
      window.dispatchEvent(new StorageEvent("storage", { key: "refreshToken", newValue: "r2" }));
    });
    expect(screen.getByTestId("session-ended-here")).toBeTruthy();
  });
});

describe("signInAgainPath", () => {
  it("carries only this site's path", () => {
    expect(signInAgainPath("/inventory")).toBe("/login?redirect=%2Finventory&ended=1");
  });
});
