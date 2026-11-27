/**
 * "How it tastes": one good's taste profile, mounted in the drawer's TasteCard
 * slot directly after the nutrition card (founder ask 2026-11-19: every good
 * has its details and its taste profile).
 *
 * Simple for people. The rules it keeps:
 * - no number from the 0..10 scale is ever shown: a band word, a bar, a
 *   whisker for the range, and a mark for where it came from;
 * - below confidence 0.4 an axis shows its band word only (no bar, no whisker)
 *   and never leads the summary;
 * - sources that disagree say so and the value is withheld;
 * - nothing known is invented: an empty profile says nobody has described it;
 *   a route that is not switched on says so; a failed read says so and shows
 *   nothing as known (ADR 0020).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UNREACHABLE_WORDS } from '../../../lib/unreachable';
import { getTaste, tasteKeys, type AxisKey, type LineFrom, type TasteBasis, type SubjectKind, type TasteAxis, type TasteData, type TasteEffective, type TasteRead } from '../../../services/api/taste';
import { fmtWhen } from '../../../lib/mudavym/format';
import TasteForm from './TasteForm';
import './taste-card.css';
import {
  AXIS_LABEL,
  axisName,
  bandOf,
  descriptorWord,
  footerFacts,
  knownAxes,
  nextAction,
  PROV_MARK,
  provenanceWords,
  rangeWords,
  sourceWords,
  summaryLine,
  type MarkShape,
} from './taste-words';

export const TASTE_EMPTY = 'Nobody has described how this tastes yet.';
export const TASTE_ABSENT = 'Taste notes are not switched on for this house yet.';
export const TASTE_FAILED = 'Taste could not be read just now.';

/** What the slot hands the card: the item as the drawer knows it (same shape as the nutrition slot). */
export interface TasteCardProps {
  /** The kind (wine, beer, food ...) decides which flavour words the form offers; the house's own kind wins over the library's. */
  row: { id: string; kind?: string | null };
  house?: { kind?: string | null };
  restaurantId: string | null;
  /** Everyone who works here may describe a taste; kept so the slot matches the nutrition card. */
  canManage?: boolean;
  /** Whose taste: a good (default), or a cocktail or dish read on its recipe sheet. */
  subject?: SubjectKind;
  /** False on a recipe sheet: a cocktail's or dish's taste is worked out from its recipe, not described on this form. */
  describe?: boolean;
  /** What an empty profile says (default: nobody has described it). */
  emptyWords?: string;
}

/** One line of "Worked out from": the line's name and whose taste stood in for it. Lines with no known taste are named in the note instead. */
const FROM_WORDS = { good: 'its own taste', class_prior: 'typical of its kind', class_prior_estimate: 'typical of its kind, an estimate' } as const;
export const workedFromWords = (b: TasteBasis): string | null => {
  const named = b.lineSources.filter((l): l is { name: string; from: Exclude<LineFrom, 'unknown'> } => l.from !== 'unknown').map((l) => `${l.name} (${FROM_WORDS[l.from]})`);
  return named.length ? `Worked out from: ${named.join(', ')}.` : null;
};
export const unknownLinesWords = (b: TasteBasis): string | null => {
  const names = [...new Set([...b.unknownNames, ...b.lineSources.filter((l) => l.from === 'unknown').map((l) => l.name)])];
  return names.length ? `Left out because its taste is not known: ${names.join(', ')}.` : null;
};

export function Glyph({ shape }: { shape: MarkShape }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, focusable: false } as const;
  if (shape === 'solid') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="5.5" fill="currentColor" />
      </svg>
    );
  }
  if (shape === 'tick') {
    return (
      <svg {...common}>
        <path d="M2.5 7.5 5.8 10.8 11.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (shape === 'hatched') {
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3 11 11 3M3 7.5 7.5 3M6.5 11 11 6.5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2 2.5h10v6.5H7.2L4 12V9H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function Marks({ axis, a }: { axis: AxisKey; a: TasteAxis }) {
  const shapes = a.prov.map((p) => PROV_MARK[p.kind].shape);
  return (
    <span className="tc-marks" role="img" aria-label={`Where it came from: ${provenanceWords(a)}`} data-testid={`taste-mark-${axis}`} data-marks={shapes.join(' ')}>
      {[...new Set(shapes)].map((s) => (
        <span key={s} className="tc-mark" data-shape={s}>
          <Glyph shape={s} />
        </span>
      ))}
    </span>
  );
}

function Row({ axis, a, e }: { axis: AxisKey; a: TasteAxis; e: TasteEffective }) {
  const [open, setOpen] = useState(false);
  const band = bandOf(a.v);
  const range = rangeWords(a);
  const next = nextAction(axis, e);
  const whisker = !a.bandOnly && a.lo !== null && a.hi !== null;
  const label = AXIS_LABEL[axis];
  return (
    <li className="tc-row" data-testid={`taste-row-${axis}`} data-band-only={a.bandOnly ? 'true' : undefined}>
      <span className="tc-label">{label}</span>
      {a.bandOnly ? (
        <span className="tc-bar tc-bar-none" aria-hidden="true" />
      ) : (
        <span className="tc-bar" role="img" aria-label={`${label}: ${band}`} data-testid={`taste-bar-${axis}`}>
          <span className="tc-fill" style={{ width: `${a.v * 10}%` }} />
          {whisker ? (
            <span className="tc-whisker" data-testid={`taste-whisker-${axis}`} style={{ left: `${(a.lo as number) * 10}%`, width: `${((a.hi as number) - (a.lo as number)) * 10}%` }} />
          ) : null}
        </span>
      )}
      <span className="tc-band" data-testid={`taste-band-${axis}`}>
        {band}
      </span>
      <Marks axis={axis} a={a} />
      <button
        type="button"
        className="tc-more iv-focus"
        aria-expanded={open}
        aria-label={`Details for ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Less' : 'More'}
      </button>
      {open ? (
        <p className="tc-detail iv-note" data-testid={`taste-detail-${axis}`}>
          {a.bandOnly ? 'Not sure enough to say more than the word. ' : ''}
          Source: {provenanceWords(a)}. {range ?? ''} {next ?? ''}
        </p>
      ) : null}
    </li>
  );
}

function Footer({ d }: { d: TasteData }) {
  if (d.layers.length === 0) return null;
  const f = footerFacts(d);
  const when = f.latest ? `, ${fmtWhen(f.latest)}` : '';
  const count = `${f.sources} ${f.sources === 1 ? 'source' : 'sources'}`;
  const sources = [...new Set(d.layers.map((l) => l.source))];
  const who = f.names.length
    ? `Stated by ${f.names.length > 1 ? `${f.names.slice(0, -1).join(', ')} and ${f.names[f.names.length - 1]}` : f.names[0]}`
    : sources.length === 1 && sources[0] !== 'house' ? sourceWords(sources[0]) : 'Stated';
  // One layer, worked out from the recipe: the list below says where it came
  // from and when, so the footer would say the same thing twice.
  const recipeOnly = d.layers.length === 1 && d.layers[0].source === 'recipe';
  return (
    <>
      {recipeOnly ? null : (
        <p className="iv-note" data-testid="taste-footer">
          {who}
          {when}, {count}.
        </p>
      )}
      <ul className="tc-layers" data-testid="taste-layers">
        {d.layers.map((l, i) => (
          <li key={i}>
            {l.statedByName && l.source === 'house' ? `${l.statedByName}: ` : ''}
            {sourceWords(l.source)}
            {l.statedAt ? `, ${fmtWhen(l.statedAt)}` : ''}
            {l.noteText ? <q className="tc-note">{l.noteText}</q> : l.hasNote ? ' (with a note)' : ''}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TasteCard({ row, house, restaurantId, subject = 'good', describe = true, emptyWords = TASTE_EMPTY }: TasteCardProps) {
  const id = row.id;
  const kind = house?.kind ?? row.kind;
  const qc = useQueryClient();
  const [describing, setDescribing] = useState(false);
  const key = tasteKeys.subject(restaurantId ?? '', subject, id);
  const q = useQuery<TasteRead>({
    queryKey: key,
    queryFn: () => getTaste(subject, id, restaurantId ?? undefined),
    enabled: restaurantId !== null && id !== '',
    staleTime: 30_000,
    retry: false,
  });

  if (q.isError || q.data?.state === 'failed') {
    return (
      <div className="tc" data-testid="taste-card" data-state="failed">
        <p role="alert" className="iv-said iv-said-alarm" data-testid="taste-failed">
          {q.data?.state === 'failed' && q.data.reason === UNREACHABLE_WORDS ? UNREACHABLE_WORDS : TASTE_FAILED}
        </p>
        <button type="button" className="iv-btn iv-focus" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <p className="iv-note" data-testid="taste-card" data-state="loading">
        Reading how this tastes…
      </p>
    );
  }
  if (q.data.state === 'absent') {
    return (
      <div className="tc" data-testid="taste-card" data-state="absent">
        <p className="iv-note" data-testid="taste-absent">
          {TASTE_ABSENT}
        </p>
      </div>
    );
  }
  const d = q.data.data;
  const e = d.effective;
  const rows = e ? knownAxes(e) : [];
  const conflicts = e?.conflicts ?? [];
  const words = e ? [...e.descriptors, ...e.texture].map(descriptorWord).filter((w): w is string => w !== null) : [];
  // A worked-out layer says which axes it could not tell. Those are said as "not known", never as a band.
  const basis = d.layers.find((l) => l.basis)?.basis ?? null;
  const shown = new Set(rows.map(([k]) => k));
  const notKnown = (basis?.notKnown ?? []).filter((k) => !shown.has(k));
  const workedFrom = basis ? workedFromWords(basis) : null;
  const leftOut = basis ? unknownLinesWords(basis) : null;
  const known = rows.length > 0 || conflicts.length > 0 || words.length > 0 || notKnown.length > 0;
  const summary = e ? summaryLine(e) : null;
  const done = (fresh: TasteData) => {
    qc.setQueryData<TasteRead>(key, { state: 'ready', data: fresh });
    void qc.invalidateQueries({ queryKey: key });
    setDescribing(false);
  };
  return (
    <div className="tc" data-testid="taste-card" data-state={known ? 'ready' : 'empty'}>
      {known ? (
        <>
          {summary ? (
            <p className="tc-summary" data-testid="taste-summary">
              {summary}
            </p>
          ) : null}
          {words.length ? (
            <p className="iv-note" data-testid="taste-words">
              Described as {words.join(', ')}.
            </p>
          ) : null}
          <ul className="tc-rows" data-testid="taste-rows">
            {e ? rows.map(([k, a]) => <Row key={k} axis={k} a={a} e={e} />) : null}
            {notKnown.map((k) => (
              <li key={k} className="tc-row tc-notknown" data-testid={`taste-notknown-${k}`}>
                <span className="tc-label">{AXIS_LABEL[k]}</span>
                <span className="tc-bar tc-bar-none" aria-hidden="true" />
                <span className="tc-band">not known</span>
              </li>
            ))}
            {conflicts.map((c) => (
              <li key={c.axis} className="tc-row tc-conflict" data-testid={`taste-conflict-${c.axis}`}>
                Sources disagree on {axisName(c.axis)}.
              </li>
            ))}
          </ul>
          {workedFrom ? (
            <p className="iv-note" data-testid="taste-worked-from">
              {workedFrom}
            </p>
          ) : null}
          {leftOut ? (
            <p className="iv-note" data-testid="taste-left-out">
              {leftOut}
            </p>
          ) : null}
        </>
      ) : (
        <p className="iv-note" data-testid="taste-empty">
          {emptyWords}
        </p>
      )}
      <Footer d={d} />
      {!describe ? null : describing ? (
        <TasteForm
          restaurantId={restaurantId}
          itemId={id}
          kind={kind}
          onSaved={done}
          onCancel={() => setDescribing(false)}
          onUnconfirmed={() => void qc.invalidateQueries({ queryKey: key })}
        />
      ) : (
        <p className="tc-acts">
          <button type="button" className="iv-btn iv-focus" onClick={() => setDescribing(true)}>
            Describe the taste
          </button>
        </p>
      )}
    </div>
  );
}
