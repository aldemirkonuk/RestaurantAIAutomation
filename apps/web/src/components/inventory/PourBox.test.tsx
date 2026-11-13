import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PourBox, readPourMl } from "./PourBox";

describe("readPourMl (r26)", () => {
  it("reads ml as a house writes it, and refuses what the gateway would refuse", () => {
    expect(readPourMl("40")).toEqual({ ml: 40, problem: null });
    expect(readPourMl(" 40 ml ")).toEqual({ ml: 40, problem: null });
    expect(readPourMl("40,5")).toEqual({ ml: 40.5, problem: null });
    expect(readPourMl("40.5")).toEqual({ ml: 40.5, problem: null });
    expect(readPourMl("")).toEqual({ ml: null, problem: null });
    expect(readPourMl("40.55").problem).toMatch(/one decimal at most/);
    expect(readPourMl("a glass").problem).toMatch(/not a number of ml/);
    expect(readPourMl("-40").problem).toMatch(/not a number of ml/);
    expect(readPourMl("9").problem).toBe("A pour is between 10 and 500 ml.");
    expect(readPourMl("501").problem).toBe("A pour is between 10 and 500 ml.");
    expect(readPourMl("10").ml).toBe(10);
    expect(readPourMl("500").ml).toBe(500);
  });
});

describe("PourBox (r26)", () => {
  const mount = (o: Partial<Parameters<typeof PourBox>[0]> = {}) => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <PourBox
        label="Pour, in ml"
        startMl={null}
        sentence={(ml) => `Records ${ml} ml.`}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...o}
      />,
    );
    return { onConfirm: (o.onConfirm as typeof onConfirm) ?? onConfirm, onCancel: (o.onCancel as typeof onCancel) ?? onCancel };
  };

  it("says what Confirm records before it is pressed, and Confirm waits for a readable pour", async () => {
    const user = userEvent.setup();
    const { onConfirm } = mount();
    const confirm = screen.getByRole("button", { name: "Confirm pour" });
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId("pour-box")).toHaveTextContent("Type a pour in ml, between 10 and 500.");
    await user.type(screen.getByLabelText("Pour, in ml"), "600{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("pour-box")).toHaveTextContent("A pour is between 10 and 500 ml.");
    await user.clear(screen.getByLabelText("Pour, in ml"));
    await user.type(screen.getByLabelText("Pour, in ml"), "125");
    expect(screen.getByTestId("pour-box")).toHaveTextContent("Records 125 ml.");
    expect(confirm).toBeEnabled();
  });

  it("the pour already confirmed is not sent again", async () => {
    const user = userEvent.setup();
    const { onConfirm } = mount({ startMl: 140 });
    expect(screen.getByLabelText("Pour, in ml")).toHaveValue("140");
    await user.type(screen.getByLabelText("Pour, in ml"), "{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("pour-box")).toHaveTextContent("That is the pour already confirmed.");
  });

  it("Enter during input-method composition is not a confirm", async () => {
    const user = userEvent.setup();
    const { onConfirm } = mount({ startMl: null });
    const box = screen.getByLabelText("Pour, in ml");
    await user.type(box, "40");
    // userEvent cannot set the composing flag, so the key is dispatched by hand.
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith(40);
  });

  it("a second Enter while confirming sends once", async () => {
    const user = userEvent.setup();
    let settle: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => { settle = r; }));
    mount({ onConfirm });
    await user.type(screen.getByLabelText("Pour, in ml"), "40{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Confirming…" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    settle();
  });

  it("Escape cancels and confirms nothing", async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = mount();
    await user.type(screen.getByLabelText("Pour, in ml"), "40{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
