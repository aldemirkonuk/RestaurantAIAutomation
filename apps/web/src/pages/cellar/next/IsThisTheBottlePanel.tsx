/**
 * "Is this the bottle?" — the owed act on `/cellar`.
 *
 * WHAT WAS OWED. The rebuilt register can READ a menu: the scanner's detection
 * half is real (`scanMenuImage` → the orchestrator's four-layer pipeline). Its
 * ADD half never existed anywhere — the legacy scanner tab and the legacy
 * library page both only moved rows around in component state
 * (`MenuScannerTab.tsx:160-172`, `WineLibrary.tsx:1813-1822`), and
 * `WineRegister.tsx` says so in words rather than pretending. The legacy page's
 * question — `WineValidationModal.tsx:162`, and `AddWineModal.tsx:148`'s "Wine
 * detected" — was the only place a person ever confirmed a reading, and it
 * confirmed it into nothing.
 *
 * So this panel is the question AND the write it was always missing:
 *
 *     POST /wines/submissions      wines.controller.ts:91
 *
 * The restaurant and the submitter come from the token
 * (`wine-submissions.service.ts:134-155` stamps `restaurant_id` and
 * `submitted_by`); the panel sends neither.
 *
 * WHAT "YES" ACTUALLY DOES, SAID ON THE PANEL. A confirmed reading enters the
 * master library's STAGING (`master_wine_library_submissions`) where the dedup
 * worker resolves it. It does not put a bottle on a shelf and it does not put
 * one in the book — that is the carry sheet, a different act. Saying "added to
 * your cellar" here would be the exact claim this page has spent two passes
 * refusing to make.
 *
 * THE READING IS GREY UNTIL A PERSON TAKES IT (sketch 103, 2c). Every field is
 * the engine's until it is edited; an edited field goes ink and the panel says
 * which fields the person changed. Nothing is applied by opening the panel.
 *
 * CONFIDENCE IS A NUMBER AND A WORD, NEVER A COLOUR BAND. The legacy modal
 * painted emerald / yellow / rose (`WineValidationModal.tsx:74-85`); ADR 0112
 * rule 8 gives this house one chromatic colour. More importantly the legacy
 * mapped an ABSENT confidence to the same grey chip as a low one, so "the
 * reader did not score this field" and "the reader was unsure" looked alike.
 * Here they are different sentences: an unscored field says it was not scored.
 *
 * THE CONTRACT IS THE NAME (sketch 103, 1e) — the sketch cites this very act.
 */

import { useMemo, useState } from 'react';
import { Panel } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { EM } from './cellar-format';

export type ReadingSource = 'ai_detection' | 'external_api' | 'manual' | 'menu_scan';

export interface BottleReading {
  name: string;
  producer: string;
  vintage: number | null;
  /** The legacy vocabulary, unchanged. */
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert' | '';
  region: string;
  country: string;
  grape?: string;
  /** Per-field score, 0..1. An ABSENT key means the reader did not score it. */
  confidence?: Partial<Record<keyof BottleReading, number>>;
  source: ReadingSource;
}

/** The fields a person may correct, in the order the panel asks them. */
const FIELDS: { key: 'name' | 'producer' | 'vintage' | 'type' | 'region' | 'country' | 'grape'; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'producer', label: 'Producer' },
  { key: 'vintage', label: 'Vintage' },
  { key: 'type', label: 'Type' },
  { key: 'region', label: 'Region' },
  { key: 'country', label: 'Country' },
  { key: 'grape', label: 'Grape' },
];

const TYPES = ['red', 'white', 'sparkling', 'rose', 'dessert'] as const;

const SOURCE_WORDS: Record<ReadingSource, string> = {
  ai_detection: 'read off a label by the engine',
  menu_scan: 'read off a menu by the engine',
  external_api: 'copied from an outside database',
  manual: 'typed by a person',
};

/**
 * How sure the reader was about ONE field, in words.
 *
 * `undefined` is not low confidence — it is no score at all, and the two must
 * never render alike. That conflation is what the legacy chip did.
 */
export function sureness(score: number | undefined): string {
  if (score === undefined) return 'not scored';
  const pct = Math.round(score * 100);
  if (score >= 0.9) return `sure · ${pct}%`;
  if (score >= 0.7) return `fairly sure · ${pct}%`;
  return `unsure · ${pct}%`;
}

/** The legacy validation, restated with its citation (`:104-121`). */
export function readingRefusals(r: BottleReading): Record<string, string> {
  const out: Record<string, string> = {};
  if (!r.name || r.name.trim().length < 3) out.name = 'A name of at least three letters.';
  if (!r.producer || !r.producer.trim()) out.producer = 'Say who made it.';
  if (
    r.vintage !== null &&
    r.vintage !== undefined &&
    (r.vintage < 1900 || r.vintage > new Date().getFullYear())
  ) {
    out.vintage = `A vintage between 1900 and ${new Date().getFullYear()}, or none at all.`;
  }
  if (!r.type) out.type = 'Say what kind of wine it is.';
  return out;
}

export interface IsThisTheBottlePanelProps {
  open: boolean;
  /** The engine's reading. Null closes the question. */
  reading: BottleReading | null;
  onClose: () => void;
  /** "Not this bottle" — the reading is thrown away and nothing is written. */
  onRejected: () => void;
  /** Called after the gateway accepted the submission. */
  onConfirmed?: (submissionId: string | null) => void;
}

export function IsThisTheBottlePanel({
  open,
  reading,
  onClose,
  onRejected,
  onConfirmed,
}: IsThisTheBottlePanelProps) {
  /** The person's corrections, keyed by field. Everything else is the engine's. */
  const [mine, setMine] = useState<Record<string, string>>({});
  const [fixing, setFixing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const answered: BottleReading | null = useMemo(() => {
    if (!reading) return null;
    const v = mine.vintage;
    return {
      ...reading,
      name: mine.name ?? reading.name,
      producer: mine.producer ?? reading.producer,
      vintage:
        v === undefined
          ? reading.vintage
          : v.trim() === ''
            ? null
            : Number.isFinite(Number(v))
              ? Number(v)
              : reading.vintage,
      type: (mine.type as BottleReading['type']) ?? reading.type,
      region: mine.region ?? reading.region,
      country: mine.country ?? reading.country,
      grape: mine.grape ?? reading.grape,
    };
  }, [reading, mine]);

  const refusals = useMemo(
    () => (answered ? readingRefusals(answered) : {}),
    [answered],
  );
  const clean = Object.keys(refusals).length === 0;
  const changed = Object.keys(mine);

  if (!reading || !answered) return null;

  const confirm = async () => {
    if (!clean || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const { data } = await apiClient.post<{ id?: string }>('/wines/submissions', {
        name: answered.name.trim(),
        producer: answered.producer.trim(),
        vintage: answered.vintage,
        primaryType: answered.type || undefined,
        grapeVariety: answered.grape?.trim() || undefined,
        country: answered.country?.trim() || undefined,
        region: answered.region?.trim() || undefined,
      });
      onConfirmed?.(data?.id ?? null);
      setMine({});
      setFixing(false);
      onClose();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFailure(
        status === 403 || status === 401
          ? `This account may not add to the library (${status}). Nothing was written and the reading is still here.`
          : `The bottle was not added to the library (${getErrorMessage(e)}). Nothing was written and the reading is still here.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const cell = (key: (typeof FIELDS)[number]['key']) => {
    const engine =
      key === 'vintage'
        ? reading.vintage === null || reading.vintage === undefined
          ? ''
          : String(reading.vintage)
        : String((reading as unknown as Record<string, unknown>)[key] ?? '');
    const isMine = mine[key] !== undefined;
    const shown = isMine ? mine[key] : engine;
    return { engine, isMine, shown };
  };

  return (
    <Panel
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name — sketch 103 cites this act by name. */
      label="This asks whether the engine read the bottle correctly. Confirming submits the reading to the house library for de-duplication; it puts no stock on a shelf. Leaving writes nothing."
      eyebrow="The label reader"
      title="Is this the bottle?"
      closeLabel="Not now"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            Confirming adds it to the house library. It puts no bottle on a shelf.
          </span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              data-testid="bottle-reject"
              onClick={() => {
                setMine({});
                setFixing(false);
                onRejected();
              }}
            >
              Not this bottle
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              data-testid="bottle-fix"
              data-on={fixing}
              aria-pressed={fixing}
              onClick={() => setFixing((f) => !f)}
            >
              {fixing ? 'Done fixing' : 'Fix a field'}
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              data-testid="bottle-confirm"
              disabled={!clean || saving}
              onClick={() => void confirm()}
              style={{
                borderColor: 'var(--seal)',
                background: clean && !saving ? 'var(--seal)' : undefined,
                color: clean && !saving ? 'var(--paper-0)' : undefined,
              }}
            >
              {saving ? 'Adding it…' : 'Yes, carry it'}
            </button>
          </span>
        </div>
      }
    >
      <p className="cl-said" data-testid="bottle-source">
        {`This reading was ${SOURCE_WORDS[reading.source]}. Nothing about it has been written down;
          the engine's words stay grey until you take them.`}
      </p>

      <dl style={{ margin: '12px 0 0', display: 'grid', gap: 8 }}>
        {FIELDS.map(({ key, label }) => {
          const { isMine, shown } = cell(key);
          const score = reading.confidence?.[key as keyof BottleReading];
          return (
            <div key={key} data-testid={`bottle-field-${key}`}>
              <dt
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.11em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                }}
              >
                {label}
                <span style={{ marginLeft: 6, letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
                  {isMine ? 'yours' : sureness(score)}
                </span>
              </dt>
              <dd style={{ margin: '2px 0 0' }}>
                {fixing ? (
                  key === 'type' ? (
                    <select
                      className="cl-field"
                      aria-label={label}
                      value={shown}
                      data-testid={`bottle-input-${key}`}
                      onChange={(e) => setMine((m) => ({ ...m, [key]: e.target.value }))}
                    >
                      <option value="">Not said</option>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="cl-field"
                      aria-label={label}
                      value={shown}
                      data-testid={`bottle-input-${key}`}
                      onChange={(e) => setMine((m) => ({ ...m, [key]: e.target.value }))}
                    />
                  )
                ) : (
                  <span
                    data-ink={isMine ? 'person' : 'engine'}
                    style={{
                      fontSize: 13,
                      // The engine's hand is grey and stays grey; a value a
                      // person chose is ink. Permanently, not until save.
                      color: isMine ? 'var(--ink-1)' : 'var(--ink-3)',
                    }}
                  >
                    {shown === '' ? EM : shown}
                  </span>
                )}
                {refusals[key] && (
                  <p
                    role="status"
                    data-testid={`bottle-problem-${key}`}
                    style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-2)' }}
                  >
                    {refusals[key]}
                  </p>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {changed.length > 0 && (
        <p className="cl-note" data-testid="bottle-changed">
          You changed {changed.length === 1 ? 'one field' : `${changed.length} fields`} —{' '}
          {changed.join(', ')}. Those go in as yours; the rest go in as the engine read them.
        </p>
      )}

      {failure && (
        <p role="status" className="cl-note" data-testid="bottle-failure">
          {failure}
        </p>
      )}
    </Panel>
  );
}

export default IsThisTheBottlePanel;
