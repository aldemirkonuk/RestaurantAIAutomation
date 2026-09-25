/**
 * "Photograph the label" — ADR 0160 sec110 item 5.
 *
 * The founder: "the label reader overlay [is] the preferred one ... I can see
 * many more things there at the same time ... not that crowded"; "Photograph
 * the label" itself is approved as drawn (sketch 110, direction A/B §5). The
 * sketch's own build note is blunt about status: **still not started** —
 * nothing in this repository draws it before this file. It is built here over
 * real, wired endpoints, never a mock:
 *
 *   the read   POST /api/v1/scan/wine   (source_type: "label") — orchestrator,
 *              same 3-layer field-parser + matcher pipeline `scanMenuImage`
 *              already uses for a whole menu, called here for one bottle
 *              (`scanWineLabel`, wineDetection.ts). A photo is a reading, not
 *              a record: nothing is written by this step.
 *   the write  POST /wines/submissions  (gateway, `WineSubmissionsService`) —
 *              only on "This is the bottle". Queues into
 *              `master_wine_library_submissions` for the dedup pass; it never
 *              puts stock on a shelf and never writes inventory. "Not now" or
 *              Esc closes with nothing written, same as leaving the camera
 *              step.
 *
 * ONE PANEL, TWO STEPS — not two overlays. ADR 0112 fixed the panel shape for
 * "a centered ask", and the sketch's two panels (Camera, then "Is this the
 * bottle?") are one continuous act, so this is one `Panel` whose body changes
 * with `step`; a person never sees a second overlay open behind the first.
 *
 * THE CAMERA STEP IS NOT `components/scanner/CameraCapture.tsx` (fixed
 * 2026-09-19, cellar confirmer MAJOR). That component is shipped, owned code
 * three other surfaces import (`MenuScannerFlow.tsx`, `MenuScanUpload.tsx`)
 * and this build does not touch — but it draws its OWN chrome ("Scan Wine
 * Menu", an indigo "Open Camera" button, an "AI Detection Pipeline" card
 * naming the models), none of which is a prop this page could override, so
 * mounting it here put a second, contradicting UI directly under this
 * panel's sketch-110A intro sentence. This step is a small, local control
 * instead: two buttons over native file inputs — "Take the photo" opens
 * `capture="environment"` (the device camera where one exists, exactly the
 * bottle-in-frame gesture the copy asks for) and "Choose a photo instead"
 * opens a plain file picker. Both read the file to the same raw-base64
 * string `CameraCapture.tsx` itself produces (`.toDataURL(...).split(',')[1]`
 * / `FileReader` + the same split, `CameraCapture.tsx:375,405`) and hand it
 * to the same `handleCapture` — the read pipeline below this step is
 * unchanged, only the control that reaches it.
 */

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/mudavym';
import { queryKeys } from '../../../lib/query-keys';
import { submitWine } from '../../../services/api/wines';
import { scanWineLabel } from '../../../services/wineDetection';
import type { DetectedWine } from '../../../services/wineDetection';
import { EM, SANS, year } from './cellar-format';

/** The page's one mono stack — not exported from `cellar-format.ts`, which
 * carries only `SANS` (see that file's own header on why the serif/mono
 * stacks live in `cellar-next.css`'s `.cl-serif`/`.cl-num` instead; this is
 * a plain caption, not a number, so it is declared here rather than reusing
 * either class). */
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

type Step = 'camera' | 'reading' | 'confirm' | 'submitting' | 'done' | 'read-error' | 'submit-error';

/**
 * Which fields the confirm step shows, and what the reader's own confidence
 * dict keys them by — `wine_field_parser.py`'s `SCHEMA_FIELDS` /
 * `field_confidences`, snake_case, straight off the backend. The build this
 * fixes read `fieldConfidences.name`/`.grapeVariety`/`.wineType` — none of
 * those keys exist in that dict (it is `wine_name`/`grape_variety`/
 * `wine_type`), so three of six fields always fell through to "not scored"
 * regardless of what the reader actually returned.
 */
type FieldKey = 'wine_name' | 'producer' | 'vintage' | 'country' | 'region' | 'grape_variety' | 'wine_type';

/**
 * Sketch 110 direction A's own contract (`direction-a.html:337-343`, its
 * `IsThisTheBottlePanel.tsx` citation): a per-field WORD and a percentage, or
 * "not scored" when the reader carries no confidence for that field at all —
 * never a value drawn as if certain just because it happens to have no score
 * ("they say so rather than wearing a low score"). The reading itself
 * (`dd[data-grey]`) is one uniform, unconfirmed tone regardless of the
 * field's confidence; sureness lives in the caption beside the label, never
 * as an italic or a differently-shaded value.
 */
function sureness(confidence?: number): string {
  if (confidence === undefined) return 'not scored';
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.9) return `sure · ${pct}%`;
  if (confidence >= 0.75) return `fairly sure · ${pct}%`;
  return `unsure · ${pct}%`;
}

function FieldRow({
  fieldKey,
  label,
  value,
  confidence,
  taken,
  editing,
  onStartEdit,
  onCommit,
}: {
  fieldKey: FieldKey
  label: string
  /** The reader's own value, or the person's override once taken. */
  value: string | null
  confidence?: number
  /** True once the person has accepted or typed this field themselves. */
  taken: boolean
  editing: boolean
  onStartEdit: (key: FieldKey, current: string) => void
  onCommit: (key: FieldKey, next: string) => void
}) {
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => onCommit(fieldKey, draft.trim());
  // Escape is deliberately NOT handled here to cancel the edit in place: the
  // house rule (Sheet.tsx, "Esc closes, from anywhere") is that Escape always
  // closes the topmost overlay, so a person can never get stuck behind a
  // nested keyboard trap. Swallowing it here to mean "cancel this field"
  // instead would be exactly that trap. Escape while editing therefore
  // closes the whole panel — the same "nothing was written" outcome as
  // "Not this bottle" — rather than a second, competing meaning for one key.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return (
    <div className="f" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--paper-2)' }}>
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}{' '}
        <small style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 0, textTransform: 'none' }}>
          {sureness(confidence)}
        </small>
      </span>
      {editing ? (
        <input
          autoFocus
          className="cl-field cl-focus"
          style={{ fontSize: 13, textAlign: 'right', maxWidth: 200 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label={`Edit ${label}`}
          data-testid={`label-field-edit-${fieldKey}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? '');
            onStartEdit(fieldKey, value ?? '');
          }}
          className="cl-focus"
          style={{
            fontSize: 13,
            fontFamily: SANS,
            // Taken (accepted or typed by the person) reads in full ink; an
            // untouched reading — whatever its confidence — stays the one
            // uniform "read, not yet stated" tone (ADR 0112's own contrast
            // pair, never per-confidence shading).
            color: taken ? 'var(--ink-1)' : 'var(--ink-2)',
            textAlign: 'right',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline dotted',
            textUnderlineOffset: 3,
          }}
          data-testid={`label-field-${fieldKey}`}
        >
          {value ?? EM}
        </button>
      )}
    </div>
  );
}

export default function PhotographLabel({
  open,
  onClose,
  restaurantId,
}: {
  open: boolean
  onClose: () => void
  restaurantId: string | null
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('camera');
  const [wine, setWine] = useState<DetectedWine | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  // Fields the person has accepted or typed themselves — "Fix a field",
  // sketch 110 direction A. Keyed by the reader's own snake_case field
  // names so one map covers both "taken as read" (a value equal to what the
  // reader said, but the person clicked it and it committed) and "corrected"
  // (a different value typed in) — the confirm button's producer check and
  // the final submit both read through this map first.
  const [taken, setTaken] = useState<Partial<Record<FieldKey, string>>>({});
  const [editingField, setEditingField] = useState<FieldKey | null>(null);

  const readValue = (key: FieldKey): string | null => {
    if (!wine) return null;
    switch (key) {
      case 'wine_name':
        return wine.name || null;
      case 'producer':
        return wine.producer ?? null;
      case 'vintage':
        return wine.vintage ? year(wine.vintage) : null;
      case 'country':
        return wine.country ?? null;
      case 'region':
        return wine.region ?? null;
      case 'grape_variety':
        return wine.grapeVariety ?? wine.grape ?? null;
      case 'wine_type':
        return wine.wineType ?? wine.type ?? null;
    }
  };

  const effective = (key: FieldKey): string | null => {
    const t = taken[key];
    return t !== undefined ? (t || null) : readValue(key);
  };

  const effectiveProducer = effective('producer');

  const submit = useMutation({
    mutationFn: async (w: DetectedWine) => {
      // The gateway's DTO requires a producer (`@IsNotEmpty()`,
      // wine-submissions.dto.ts). A label the reader could not attribute is a
      // real, common outcome — never papered over with an invented "Unknown"
      // that would sit in the library looking like a stated fact. The confirm
      // button is disabled below for exactly this case, so reaching here with
      // no producer would be this component's own bug, not the reader's.
      // "Fix a field" lets the person type one in when the reader could not,
      // so this checks the EFFECTIVE (taken-or-read) producer, not the raw
      // reading alone.
      const producer = effective('producer');
      if (!producer) throw new Error('No producer was read off this label');
      return submitWine({
        name: effective('wine_name') ?? w.name,
        producer,
        vintage: taken.vintage !== undefined ? Number(taken.vintage) || null : (w.vintage ?? null),
        primaryType: effective('wine_type') ?? undefined,
        grapeVariety: effective('grape_variety') ?? undefined,
        country: effective('country') ?? undefined,
        region: effective('region') ?? undefined,
        bottleSizeMl: w.bottleSizeMl,
      });
    },
    onSuccess: () => {
      setStep('done');
      void queryClient.invalidateQueries({ queryKey: queryKeys.wines.all });
    },
    onError: () => setStep('submit-error'),
  });

  const reset = () => {
    setStep('camera');
    setWine(null);
    setReadError(null);
    setTaken({});
    setEditingField(null);
    submit.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCapture = async (imageBase64: string) => {
    setStep('reading');
    try {
      const detected = await scanWineLabel(imageBase64, restaurantId ?? undefined);
      setWine(detected);
      setStep('confirm');
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'The label reader could not be reached');
      setStep('read-error');
    }
  };

  // Both inputs feed the same `handleCapture`, in the same raw-base64 shape
  // `CameraCapture.tsx` itself produces — the data-URL prefix is real (every
  // browser's `FileReader.readAsDataURL` writes one), and the OCR pipeline
  // downstream of `handleCapture` was already built to receive base64
  // without it (`CameraCapture.tsx:375,405` strip it the same way).
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file twice must fire onChange again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      void handleCapture(base64);
    };
    reader.onerror = () => {
      setReadError('That photo could not be read off this device.');
      setStep('read-error');
    };
    reader.readAsDataURL(file);
  };

  return (
    <Panel
      open={open}
      onClose={handleClose}
      label="Photograph the label. A photo is not a record; nothing is written until the reading is confirmed."
      eyebrow="Camera"
      title={step === 'confirm' || step === 'submitting' || step === 'done' ? 'Is this the bottle?' : 'Photograph the label'}
      closeLabel={step === 'confirm' ? 'Not now' : 'Close'}
    >
      {/* `.mdv-ovl__body` sets flex/overflow and NO padding by design — every
          consumer pads its own (`orders/next/AgreementSheet.tsx`'s own note
          on the same primitive). This panel had no such wrapper at all, so
          its intro sentence sat flush against the head's bottom border
          (cellar confirmer MAJOR). 16px matches `.mdv-ovl__head`. */}
      <div style={{ padding: '10px 16px 14px' }}>
      {step === 'camera' || step === 'reading' ? (
        <div>
          <p className="cl-note" style={{ marginTop: 0 }}>
            Hold the bottle so the label fills the frame. A photo is not a record — nothing is
            written until you confirm the reading.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              data-seal="true"
              disabled={step === 'reading'}
              onClick={() => cameraInputRef.current?.click()}
              data-testid="label-take-photo"
            >
              Take the photo
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={step === 'reading'}
              onClick={() => fileInputRef.current?.click()}
              data-testid="label-choose-photo"
            >
              Choose a photo instead
            </button>
          </div>
          {/* Two inputs, not one with a toggled `capture` attribute: Chrome and
              Safari both read `capture` once, at mount, and ignore a change to
              it afterwards — so switching one input between "camera" and
              "library" on click is unreliable across engines. Hidden native
              inputs are the same mechanism `CameraCapture.tsx`'s own file-upload
              path uses; only the always-open live camera stream is dropped. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChosen}
            style={{ display: 'none' }}
            data-testid="label-camera-input"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChosen}
            style={{ display: 'none' }}
            data-testid="label-file-input"
          />
          {step === 'reading' ? (
            <p className="cl-said" role="status" style={{ marginTop: 10 }} data-testid="label-reading">
              Reading the label…
            </p>
          ) : null}
        </div>
      ) : step === 'read-error' ? (
        <div>
          <p className="cl-said" role="alert" data-testid="label-read-error">
            {readError ?? 'The label could not be read.'} Nothing was written.
          </p>
          <button type="button" className="cl-btn cl-focus" style={{ marginTop: 10 }} onClick={reset}>
            Try again
          </button>
        </div>
      ) : step === 'confirm' && wine ? (
        <div data-testid="label-confirm">
          <p className="cl-note" style={{ marginTop: 0 }}>
            This reading was read off a label by the engine. Nothing about it has been written
            down; confirming submits it to the house library for de-duplication — it puts no
            bottle on a shelf. Each field says how sure the reader was, or "not scored" when it
            carries no confidence at all — click a field to fix it yourself.
          </p>
          <div style={{ marginTop: 10 }}>
            {(
              [
                ['wine_name', 'Name'],
                ['producer', 'Producer'],
                ['vintage', 'Vintage'],
                ['region', 'Region'],
                ['country', 'Country'],
                ['grape_variety', 'Grape'],
                ['wine_type', 'Style'],
              ] as [FieldKey, string][]
            ).map(([key, label]) => (
              <FieldRow
                key={key}
                fieldKey={key}
                label={label}
                value={effective(key)}
                confidence={wine.fieldConfidences?.[key]}
                taken={key in taken}
                editing={editingField === key}
                onStartEdit={(k) => setEditingField(k)}
                onCommit={(k, next) => {
                  setTaken((cur) => ({ ...cur, [k]: next }));
                  setEditingField(null);
                }}
              />
            ))}
          </div>
          {wine.inMasterLibrary ? (
            <p className="cl-note" style={{ marginTop: 10 }}>
              This bottle already reads as a match in the house library — confirming still submits
              the reading for the dedup pass to weigh, rather than assuming the match is exact.
            </p>
          ) : null}
          {!effectiveProducer ? (
            <p className="cl-said" role="alert" style={{ marginTop: 10 }} data-testid="label-no-producer">
              No producer was read off this label — the house library requires one, so this
              reading cannot be submitted as read. Click Producer above to type one in, or retake
              the photo with the producer's name in frame.
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              data-seal="true"
              disabled={!effectiveProducer}
              onClick={() => {
                setStep('submitting');
                submit.mutate(wine);
              }}
              data-testid="label-confirm-yes"
            >
              This is the bottle
            </button>
            <button type="button" className="cl-btn cl-focus" onClick={reset} data-testid="label-confirm-not-this">
              Not this bottle
            </button>
          </div>
        </div>
      ) : step === 'submitting' ? (
        <p className="cl-said" role="status">
          Submitting the reading…
        </p>
      ) : step === 'submit-error' ? (
        <div>
          <p className="cl-said" role="alert" data-testid="label-submit-error">
            The reading was not submitted (
            {submit.error instanceof Error ? submit.error.message : 'no reason given'}). Nothing
            was written.
          </p>
          <button
            type="button"
            className="cl-btn cl-focus"
            style={{ marginTop: 10 }}
            onClick={() => wine && submit.mutate(wine)}
          >
            Try again
          </button>
        </div>
      ) : step === 'done' ? (
        <div data-testid="label-done">
          <p className="cl-said">
            Submitted. {wine?.name ?? 'The reading'} is queued for the house library's own
            de-duplication pass — no bottle was put on a shelf, and nothing here changed the
            cellar's count.
          </p>
          <button type="button" className="cl-btn cl-focus" style={{ marginTop: 10 }} onClick={handleClose}>
            Done
          </button>
        </div>
      ) : null}
      </div>
    </Panel>
  );
}
