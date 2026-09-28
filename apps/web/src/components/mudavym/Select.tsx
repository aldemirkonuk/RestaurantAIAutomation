/**
 * A choice by id — the house's own boxed-control language (the same tokens
 * `HoldToApprove`'s track uses: `--paper-1` fill, `--paper-2` border,
 * `--seal`/`--seal-ring` on focus and hover), for the plain, un-sheeted forms
 * a dense card needs rather than an overlay's `.mdv-field`.
 *
 * Built for `DeliveriesToName` (founder, 2026-09-22, round 6z, verbatim
 * pick 8: "Queue it; Mudavym + hold (Recommended)"), which named the gap
 * directly: "components/mudavym has no select or count input". The house
 * rule this exists to keep is ADR 0141/0192's — an item is chosen by its
 * id, never typed as a name — so `value`/`onChange` and every option's
 * `value` are ids; `label` is the only place a name is drawn.
 */
import { ReactNode, useId } from 'react';
import './form-controls.css';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  /** What is being chosen — always rendered for assistive tech; visible unless `hideLabel`. */
  label: string;
  /** Visually hide `label` and use it only as the accessible name (a caller drawing its own visible caption). */
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** The blank leading option's words, e.g. "Choose the item". Omit for no blank option. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Select({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  id,
  className,
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <span className={`mdv-select${className ? ` ${className}` : ''}`}>
      <label htmlFor={selectId} className={hideLabel ? 'sr-only' : 'mdv-select__label'}>
        {label}
      </label>
      <select
        id={selectId}
        className="mdv-select__control"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export default Select;
