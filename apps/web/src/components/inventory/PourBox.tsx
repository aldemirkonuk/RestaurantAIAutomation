/**
 * One pour, typed and confirmed in place (r26 menu-pos-mount).
 *
 * The POS panel's glass and shot buttons wait for a confirmed pour
 * (posPortions.ts), and nothing on /inventory let an owner confirm one: the
 * house's pour lived only in TargetMarginSection, which is mounted nowhere,
 * and an item's own pour only in the legacy HousePriceCell. So a glass or a
 * shot could not be picked at all (r24 walk, pos-portions check 2).
 *
 * This box asks for one number in ml and nothing else. It never starts from a
 * number the house did not state (the database's 150 default is not a pour),
 * and it says what Confirm will do before it is pressed. Enter confirms and
 * Escape cancels, as the /menu price boxes do.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";

/** The gateway's bounds (target-margin.service.ts POUR_MIN_ML / POUR_MAX_ML; ConfirmPourSizeDto). */
export const POUR_MIN_ML = 10;
export const POUR_MAX_ML = 500;

/**
 * What the typed pour means. "40", "40 ml", "40,5" and "40.5" are read; a
 * second decimal, a word, or a number outside 10 to 500 is refused with the
 * reason, so Confirm can never send what the gateway would refuse.
 */
export function readPourMl(raw: string): { ml: number | null; problem: string | null } {
  const t = raw.trim().replace(/\s*ml$/i, "").replace(",", ".");
  if (t === "") return { ml: null, problem: null };
  if (!/^\d+(\.\d)?$/.test(t)) {
    return { ml: null, problem: `“${raw.trim()}” is not a number of ml (one decimal at most).` };
  }
  const n = Number(t);
  if (n < POUR_MIN_ML || n > POUR_MAX_ML) {
    return { ml: null, problem: `A pour is between ${POUR_MIN_ML} and ${POUR_MAX_ML} ml.` };
  }
  return { ml: n, problem: null };
}

function reasonOf(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (err?.response?.status === 403) return "only an owner or a manager can confirm a pour";
  const m = err?.response?.data?.message;
  if (typeof m === "string" && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return err?.message || "no reason was given";
}

export function PourBox({
  label,
  startMl,
  sentence,
  onConfirm,
  onCancel,
}: {
  /** The box's accessible name, e.g. "One shot of Gin, in ml". */
  label: string;
  /** A pour already CONFIRMED, to start from; never an unconfirmed default. */
  startMl: number | null;
  /** What Confirm will record, for a readable pour. */
  sentence: (ml: number) => string;
  /** Records the pour. A throw is shown as the refusal; the box stays open. */
  onConfirm: (ml: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(startMl === null ? "" : String(startMl));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  const read = readPourMl(raw);
  const same = read.ml !== null && read.ml === startMl;
  const canConfirm = read.ml !== null && !same && !busy;

  const confirm = async () => {
    if (!canConfirm || read.ml === null) return;
    setBusy(true);
    setFailed(null);
    try {
      await onConfirm(read.ml);
    } catch (e) {
      setFailed(reasonOf(e));
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Escape closes this box only; it is not passed on to what holds it.
      e.stopPropagation();
      if (!busy) onCancel();
    }
  };

  const said = read.problem
    ? read.problem
    : read.ml === null
      ? `Type a pour in ml, between ${POUR_MIN_ML} and ${POUR_MAX_ML}.`
      : same
        ? "That is the pour already confirmed."
        : sentence(read.ml);

  return (
    <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2" data-testid="pour-box">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          ref={box}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          aria-label={label}
          value={raw}
          disabled={busy}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={onKey}
          placeholder="ml"
          className="h-7 w-20 rounded-md border border-gray-300 bg-white px-2 text-right text-xs font-mono"
        />
        <span className="text-[11px] text-gray-500">ml</span>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!canConfirm}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wine-600 text-white text-[11px] font-bold disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {busy ? "Confirming…" : "Confirm pour"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-7 px-2 rounded-md text-[11px] font-semibold text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
      <p className={read.problem ? "mt-1 text-[11px] text-amber-700" : "mt-1 text-[11px] text-gray-500"}>{said}</p>
      {failed && (
        <p role="alert" className="mt-1 text-[11px] font-semibold text-amber-700">
          The pour was not confirmed: {failed}. Nothing was recorded.
        </p>
      )}
    </div>
  );
}

export default PourBox;
