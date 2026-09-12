/**
 * The five-stage order spine — pending · approved · ordered · delivered ·
 * recurring — the structure the founder kept ("it shows clearly what's going
 * on"). Each station is a filter: press it and the ledger narrows to that
 * stage; press it again and the whole book returns.
 *
 * Counts arrive on the tally spring (Tally) and only when they *change* —
 * never on first paint. An unknown count is an em dash, never zero.
 */

import { CSSProperties } from 'react';
import { ink } from '@/lib/mudavym/motion';
import { MONO, SANS } from './format';
import { Tally } from './Tally';
import { STAGES, STAGE_LABEL, type Stage } from './useOrdersNextData';

export type SpineStation = Stage | 'recurring';

export interface StageSpineProps {
  counts: Record<Stage, number | null>;
  recurringCount: number | null;
  active: SpineStation | null;
  onSelect: (station: SpineStation | null) => void;
}

const STATIONS: SpineStation[] = [...STAGES, 'recurring'];

export function StageSpine({ counts, recurringCount, active, onSelect }: StageSpineProps) {
  return (
    <div
      role="tablist"
      aria-label="Order stages"
      className="relative flex items-stretch"
      style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)', borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}
    >
      {STATIONS.map((station, i) => {
        const isActive = active === station;
        const value = station === 'recurring' ? recurringCount : counts[station];
        const style: CSSProperties = {
          fontFamily: SANS,
          borderLeft: i === 0 ? 'none' : '1px solid var(--paper-2, #EAE4D8)',
          background: isActive ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
          transition: `background ${ink.ms}ms ${ink.easing}`,
          cursor: 'pointer',
        };
        return (
          <button
            key={station}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(isActive ? null : station)}
            className="group relative flex-1 px-3 py-3 text-left"
            style={style}
          >
            <Tally
              value={value}
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 24,
                fontWeight: 500,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: isActive ? 'var(--seal-deep, #14515C)' : 'var(--ink-1, #211C16)',
                transition: `color ${ink.ms}ms ${ink.easing}`,
              }}
            />
            <span
              style={{
                display: 'block',
                marginTop: 4,
                fontFamily: MONO,
                fontSize: 9.5,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--seal, #1A5E6B)' : 'var(--ink-3, #7C7365)',
                transition: `color ${ink.ms}ms ${ink.easing}`,
              }}
            >
              {STAGE_LABEL[station]}
            </span>
            {/* the station's underline — ink motion, nothing travels more than 2px */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: -1,
                height: 2,
                background: 'var(--seal, #1A5E6B)',
                transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
                transformOrigin: '0 50%',
                transition: `transform ${ink.ms}ms ${ink.easing}`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

export default StageSpine;
