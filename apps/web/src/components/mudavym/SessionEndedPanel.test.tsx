import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionEndedPanel } from "./SessionEndedPanel";
import { announceSessionEnded, signInAgainPath } from "../../lib/sessionEnded";

/**
 * F-335: a refused sign-in is said over the page, and the page stays. The
 * typed field below must survive the panel opening; "Sign in here" goes to
 * sign-in with a reason and a way back to this page.
 */

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function setup() {
  render(
    <MemoryRouter initialEntries={["/orders?vendor=7"]}>
      <SessionEndedPanel />
      <Where />
      <Routes>
        <Route path="/orders" element={<input aria-label="Quantity" defaultValue="" />} />
        <Route path="/login" element={<p>sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

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
      window.dispatchEvent(new StorageEvent("storage", { key: "refreshToken", newValue: "r2" }));
    });
    expect(screen.queryByTestId("session-ended-here")).toBeNull();
  });
});

describe("signInAgainPath", () => {
  it("carries only this site's path", () => {
    expect(signInAgainPath("/inventory")).toBe("/login?redirect=%2Finventory&ended=1");
  });
});
