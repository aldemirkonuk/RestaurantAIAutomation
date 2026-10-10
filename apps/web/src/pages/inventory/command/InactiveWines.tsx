/**
 * F-429: "Mark inactive" took a wine off /inventory and out of the stock value
 * here and on /reports, with no question asked and no way back on this page.
 * It now asks first, in plain words, and says how many bottles are still on
 * hand; and "Inactive wines" lists what was marked inactive so one can be made
 * active again (the same PATCH, so its bottles come back untouched).
 * F-442: those bottles are still stock, so /reports keeps valuing them; only
 * this list (and the valuation exported from it) leaves them out.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Power, X } from "lucide-react";
import { toast } from "sonner";
import {
  getInventory,
  updateInventoryItem,
} from "../../../services/api/inventory";
import { getActiveRestaurantId } from "../../../services/api/client";
import { queryKeys } from "../../../lib/query-keys";
import type { InventoryItem } from "../useInventoryPage";

const bottles = (n: number) => `${n} ${n === 1 ? "bottle" : "bottles"}`;

/** What marking this wine inactive does, in the owner's words. */
export function inactiveWarning(item: InventoryItem): string {
  const onHand = (item.liveStock ?? 0) + (item.shadowStock ?? 0);
  const back = "You can make it active again from Inactive wines.";
  if (onHand <= 0) return `It comes off this list. ${back}`;
  return (
    `${bottles(onHand)} still on hand. Marking it inactive takes it off this ` +
    `list and off the valuation you export from here. The bottles stay in ` +
    `the cellar, so Reports still counts them in what your stock is worth. ` +
    back
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 hover:bg-gray-50 rounded-lg"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function MarkInactiveConfirm({
  item,
  onCancel,
  onConfirm,
}: {
  item: InventoryItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title={`Mark ${item.name} inactive?`} onClose={onCancel}>
      <p className="text-sm text-gray-700">{inactiveWarning(item)}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-9 px-4 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Keep active
        </button>
        <button
          onClick={onConfirm}
          className="h-9 px-4 bg-wine-600 hover:bg-wine-700 text-white rounded-lg text-xs font-bold"
        >
          Mark inactive
        </button>
      </div>
    </Dialog>
  );
}

export function InactiveWinesPanel({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** Reads the active list again once a wine is back on it. */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const restaurantId = getActiveRestaurantId() ?? "";
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.inventory.all, "inactive", restaurantId],
    queryFn: () => getInventory(undefined, { inactive: true }),
  });

  const makeActive = async (id: string, name: string) => {
    setBusy(id);
    try {
      await updateInventoryItem(id, { isActive: true } as any);
      toast.success(`${name} is active again`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      onChanged();
    } catch (e: any) {
      toast.error(
        e?.response?.data?.message || `Could not make ${name} active again`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title="Inactive wines" onClose={onClose}>
      {isLoading && (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading
        </p>
      )}
      {isError && (
        <p className="text-sm text-gray-700">
          Inactive wines couldn’t be reached just now.{" "}
          <button
            onClick={() => void refetch()}
            className="underline font-semibold"
          >
            Try again
          </button>
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-gray-500">No wines are marked inactive.</p>
      )}
      {data && data.length > 0 && (
        <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
          {data.map((w) => {
            const name = w.wineName || "Unnamed wine";
            const onHand = (w.stockLive ?? 0) + (w.shadowStock ?? 0);
            return (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 truncate">
                    {name}
                    {w.wineVintage ? (
                      <span className="text-gray-500"> {w.wineVintage}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {onHand > 0 ? `${bottles(onHand)} on hand` : "None on hand"}
                  </p>
                </div>
                <button
                  onClick={() => void makeActive(w.id, name)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 h-8 px-3 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Power className="w-3.5 h-3.5" /> Make active
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
