import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChooseHouse } from "./ChooseHouse";
import { useAuth } from "../contexts/AuthContext";
import apiClient from "../services/api/client";
import { HOUSE_ENDED_KEY, rememberHouse } from "../lib/houseMemory";

/**
 * Which house today? (ADR 0164, R7): one row per house, this device's last
 * first and marked, one tap opens it; a refusal stays and says so; no houses
 * goes to /no-access when a membership ended and to /get-started when there
 * never was one; an ended house is named in one sentence.
 */

vi.mock("../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api/client", () => ({ default: { get: vi.fn() } }));

const U = "11111111-1111-4111-8111-111111111111";
const MODA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Moda",
  city: "Istanbul",
};
const KADIKOY = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Kadıköy",
  city: "Istanbul",
};
const BESIKTAS = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Beşiktaş",
  city: null,
};

const setActiveRestaurantId = vi.fn();
const logout = vi.fn();

function authAs(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      userId: U,
      email: "p@house.test",
      name: "P",
      restaurantId: "",
      role: null,
      emailVerified: true,
    },
    loading: false,
    logout,
    setActiveRestaurantId,
    ...overrides,
  } as any);
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/choose-house", state }]}>
      <Routes>
        <Route path="/choose-house" element={<ChooseHouse />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const housesAnswer = (houses: unknown[], extra: Record<string, unknown> = {}) =>
  vi.mocked(apiClient.get).mockResolvedValue({
    data: { houses, ...extra },
  } as any);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  logout.mockResolvedValue(undefined);
  authAs();
});

describe("ChooseHouse", () => {
  it("lists the person's houses by name, with this device's last house first and marked", async () => {
    rememberHouse(U, MODA.id);
    housesAnswer([KADIKOY, MODA, BESIKTAS]);

    renderAt();

    const list = await screen.findByRole("list", { name: "Your houses" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "ModaIstanbulLast opened here",
      "Beşiktaş",
      "KadıköyIstanbul",
    ]);
    expect(screen.getByText("Signed in as p@house.test")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/auth/houses");
  });

  it("opens a house in one tap and goes where the person was headed", async () => {
    housesAnswer([MODA, KADIKOY]);
    setActiveRestaurantId.mockResolvedValue(true);

    renderAt({ from: { pathname: "/inventory", search: "?tab=cellar" } });

    fireEvent.click(await screen.findByRole("button", { name: /Kadıköy/ }));

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/inventory"),
    );
    expect(setActiveRestaurantId).toHaveBeenCalledWith(KADIKOY.id);
  });

  it("stays, and says so, when the server refuses the house", async () => {
    housesAnswer([MODA, KADIKOY]);
    setActiveRestaurantId.mockResolvedValue(false);

    renderAt();

    fireEvent.click(await screen.findByRole("button", { name: /Moda/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open Moda. Try again, or choose another house.",
    );
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  // ADR 0164, bracket 2026-09-25 (the founder, round 4, item 16): "Verified
  // account with zero houses and no ended membership -> straight to
  // /get-started; removed-from-house people still see /no-access."
  it("sends a verified account that never had a house straight to /get-started", async () => {
    housesAnswer([], { accessEnded: false });

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/get-started"),
    );
  });

  it("sends a person whose membership ended to /no-access", async () => {
    housesAnswer([], { accessEnded: true });

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/no-access"),
    );
  });

  it("sends a person to /no-access when this tab saw their house end, whatever the server's record says", async () => {
    sessionStorage.setItem(HOUSE_ENDED_KEY, BESIKTAS.id);
    housesAnswer([], { accessEnded: false });

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/no-access"),
    );
  });

  it("reads a missing answer as ended: /no-access, never an invitation to open a restaurant", async () => {
    housesAnswer([]);

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/no-access"),
    );
  });

  it("names the house whose access just ended, in one sentence", async () => {
    sessionStorage.setItem(HOUSE_ENDED_KEY, BESIKTAS.id);
    localStorage.setItem(
      "availableRestaurants",
      JSON.stringify([BESIKTAS, MODA]),
    );
    housesAnswer([MODA, KADIKOY]);

    renderAt();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your access to Beşiktaş has ended.",
    );
  });

  it('says "that house" when the ended house is not in this device\'s list', async () => {
    sessionStorage.setItem(HOUSE_ENDED_KEY, BESIKTAS.id);
    housesAnswer([MODA, KADIKOY]);

    renderAt();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your access to that house has ended.",
    );
  });

  it("offers a search box only above eight houses", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`,
      name: `House ${i}`,
      city: null,
    }));
    housesAnswer(many);
    renderAt();
    const box = await screen.findByPlaceholderText("Find a house");
    fireEvent.change(box, { target: { value: "House 3" } });
    expect(
      within(screen.getByRole("list", { name: "Your houses" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(1);
  });

  it("shows no search box for eight or fewer", async () => {
    housesAnswer([MODA, KADIKOY, BESIKTAS]);
    renderAt();
    await screen.findByRole("list", { name: "Your houses" });
    expect(
      screen.queryByPlaceholderText("Find a house"),
    ).not.toBeInTheDocument();
  });

  it("says so, with a way to try again, when the houses cannot be read", async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("503"));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't read your houses just now.",
    );
    housesAnswer([MODA, KADIKOY]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("list", { name: "Your houses" }),
    ).toBeInTheDocument();
  });

  it("sends an unverified person to verify first, and a signed-out one to sign in", async () => {
    housesAnswer([MODA, KADIKOY]);
    authAs({
      user: {
        userId: U,
        email: "p@house.test",
        restaurantId: "",
        emailVerified: false,
      },
    });
    const { unmount } = renderAt();
    expect(screen.getByTestId("where")).toHaveTextContent("/verify-email");
    unmount();

    authAs({ user: null });
    renderAt();
    expect(screen.getByTestId("where")).toHaveTextContent("/login");
  });

  it('signs the person out from "Not you?"', async () => {
    housesAnswer([MODA, KADIKOY]);
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });
});
