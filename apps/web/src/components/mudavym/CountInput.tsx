/**
 * A whole-number count — stepper buttons around a typed field, the house's
 * boxed-control language (same tokens as `Select`/`HoldToApprove`: `--paper-1`
 * fill, `--paper-2` border, `--seal` on focus).
 *
 * Built for `DeliveriesToName` (founder, 2026-09-22, round 6z, verbatim
 * pick 8: "Queue it; Mudavym + hold (Recommended)"), same gap as `Select`:
 * "components/mudavym has no select or count input".
 *
 * WHOLE NUMBERS ONLY, ON PURPOSE
 * -------------------------------
 * A native `<input type="number">` accepts a decimal and a scroll-wheel can
 * change it by accident; a bottle count is neither. This keeps `value` as
 * the RAW STRING the caller already validates as an integer
 * (`nameDeliveredItem`'s "a whole number from 1 to 100000" rule,
 * apps/api-gateway/src/procurement/delivery-item-to-name.ts) — the stepper
 * buttons are the only thing here that does arithmetic, and they always
 * land on an integer. Typing is NOT filtered character-by-character: a
 * stray "2.5" reaches the caller exactly as typed, so the caller's own "not
 * a whole number" refusal is the one true validation rather than a second,
 * silently-different one guessing at what the field would have accepted.
 * `inputMode`/`pattern` below are just the mobile-keyboard hint; nothing
 * here rewrites what was typed.
 */
import { useId } from 'react';
import './form-controls.css';

export interface CountInputProps {
  label: string;
  hideLabel?: boolean;
  /** The raw field value — may be empty, or not yet a valid whole number; the caller validates it. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

function step(value: string, by: number, min: number, max: number): string {
  const n = Number(value);
  const base = Number.isFinite(n) && value.trim() !== '' ? n : by > 0 ? min - 1 : min;
  const next = Math.min(max, Math.max(min, Math.trunc(base) + by));
  return String(next);
}

export function CountInput({
  label,
  hideLabel = false,
  value,
  onChange,
  placeholder,
  min = 0,
  max = 100_000,
  disabled = false,
  id,
  className,
}: CountInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <span className={`mdv-count${className ? ` ${className}` : ''}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'mdv-count__label'}>
        {label}
      </label>
      <span className="mdv-count__control">
        <button
          type="button"
          className="mdv-count__btn"
          aria-label={`Fewer — ${label}`}
          disabled={disabled}
          onClick={() => onChange(step(value, -1, min, max))}
        >
          −
        </button>
        <input
          id={inputId}
          className="mdv-count__input"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="mdv-count__btn"
          aria-label={`More — ${label}`}
          disabled={disabled}
          onClick={() => onChange(step(value, 1, min, max))}
        >
          +
        </button>
      </span>
    </span>
  );
}

export default CountInput;
