import { useId } from 'react'
import { cn } from '../../lib/utils'

/**
 * Single-value range slider.
 *
 * Built on a native <input type="range"> so keyboard support, focus handling and
 * screen-reader semantics come for free rather than being re-implemented. The
 * only custom work is visual: a filled track (a left-to-right gradient computed
 * from the value) and a thumb, both of which need vendor pseudo-elements that
 * Tailwind cannot express — hence the one scoped <style> block.
 */
export interface RangeSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max: number
  step?: number
  label?: string
  /** Renders the current value; return null to hide the readout. */
  format?: (value: number) => string
  /** Shown instead of the formatted value when the slider sits at max. */
  maxLabel?: string
  disabled?: boolean
  className?: string
  id?: string
}

const FILL = '#9E4249' // wine-600
const TRACK = '#EDE7E3' // warm gray-200

export function RangeSlider({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  label,
  format,
  maxLabel,
  disabled,
  className,
  id,
}: RangeSliderProps) {
  const autoId = useId()
  const inputId = id ?? `range-${autoId}`

  const clamped = Math.min(Math.max(value, min), max)
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0
  const atMax = clamped >= max
  const readout = atMax && maxLabel ? maxLabel : format ? format(clamped) : String(clamped)

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {(label || readout) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={inputId} className="text-[11px] font-semibold text-gray-500">
              {label}
            </label>
          )}
          <span className="font-mono text-[11px] font-semibold text-gray-900">{readout}</span>
        </div>
      )}

      <style>{`
        .wo-range { -webkit-appearance: none; appearance: none; background: transparent; }
        .wo-range::-webkit-slider-runnable-track { height: 4px; border-radius: 9999px; }
        .wo-range::-moz-range-track { height: 4px; border-radius: 9999px; }
        .wo-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 16px; height: 16px; margin-top: -6px;
          border-radius: 9999px; background: #fff;
          border: 2px solid ${FILL};
          box-shadow: 0 1px 3px rgba(0,0,0,.18);
          cursor: pointer; transition: transform .12s ease;
        }
        .wo-range::-moz-range-thumb {
          width: 16px; height: 16px; border-radius: 9999px; background: #fff;
          border: 2px solid ${FILL}; box-shadow: 0 1px 3px rgba(0,0,0,.18);
          cursor: pointer; transition: transform .12s ease;
        }
        .wo-range:not(:disabled):hover::-webkit-slider-thumb { transform: scale(1.12); }
        .wo-range:not(:disabled):hover::-moz-range-thumb { transform: scale(1.12); }
        .wo-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(158,66,73,.22); }
        .wo-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px rgba(158,66,73,.22); }
        .wo-range:disabled::-webkit-slider-thumb { border-color: #C9C1BC; cursor: not-allowed; }
        .wo-range:disabled::-moz-range-thumb { border-color: #C9C1BC; cursor: not-allowed; }
      `}</style>

      <input
        id={inputId}
        type="range"
        className="wo-range h-4 w-full cursor-pointer rounded-full outline-none disabled:cursor-not-allowed"
        min={min}
        max={max}
        step={step}
        value={clamped}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={readout}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, ${disabled ? '#C9C1BC' : FILL} 0%, ${
            disabled ? '#C9C1BC' : FILL
          } ${pct}%, ${TRACK} ${pct}%, ${TRACK} 100%)`,
          backgroundSize: '100% 4px',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
    </div>
  )
}

export default RangeSlider
