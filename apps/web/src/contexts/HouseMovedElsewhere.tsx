/**
 * Another tab moved the session to another house (F-244).
 *
 * Every tab of this browser shares one session, so from the moment another
 * tab switched house, everything THIS tab reads or saves goes to the new
 * house while its screen still shows the last one. The tab stops here, over
 * the whole page so nothing more is done under the wrong name, says where
 * the person went, and opens that house when they say so. It never reloads
 * on its own: whatever they were typing stays on screen until they choose.
 */
import { useEffect, useRef } from "react";

export function HouseMovedElsewhere({
  to,
  from,
  onOpen,
}: {
  /** The house the other tab moved to, when this device knows its name. */
  to: string | null;
  /** The house this tab still shows, when known. */
  from: string | null;
  onOpen: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  const there = to ?? "another house";
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      data-testid="house-moved-elsewhere"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="house-moved-title"
        aria-describedby="house-moved-body"
        className="w-full max-w-sm rounded-lg bg-white p-5 text-gray-900 shadow-xl"
      >
        <h2 id="house-moved-title" className="text-base font-semibold">
          You moved to {there} in another tab.
        </h2>
        <p id="house-moved-body" className="mt-2 text-sm text-gray-700">
          This tab still shows {from ?? "the house you were in"}. It has stopped
          here so nothing you do is saved to the wrong house.
        </p>
        <button
          ref={button}
          type="button"
          onClick={onOpen}
          className="mt-4 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Open {there} here
        </button>
      </div>
    </div>
  );
}
