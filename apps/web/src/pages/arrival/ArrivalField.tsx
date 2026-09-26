import { useEffect, useId, useRef, useState } from 'react'
import { Input, arrivalApi, arrivalError } from './arrival-api'
import {
  localSpeechAvailability,
  LocalRecognizer,
  LocalSpeechConstructor,
  spokenValue,
} from './local-speech'

type FieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'days'
  | 'time'
  | 'currency'
  | 'terms'
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not yet answered'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value))
    return (
      value
        .map(
          (v) =>
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(v)] ??
            String(v),
        )
        .join(' · ') || 'No fixed days'
    )
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => `${key.replace(/_/g, ' ')}: ${v}`)
      .join(' · ')
  return String(value)
}

export function ArrivalField({
  label,
  input,
  kind = 'text',
  source,
  disabled,
  speechDisabled,
  onRecorded,
}: {
  label: string
  input: Input
  kind?: FieldKind
  source: string
  disabled?: boolean
  speechDisabled?: boolean
  onRecorded: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(
    input.value === null || input.value === undefined
      ? ''
      : Array.isArray(input.value)
        ? input.value.join(',')
        : String(input.value),
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [speech, setSpeech] = useState('Checking on-device recognition…')
  const [ready, setReady] = useState(false)
  const [listening, setListening] = useState(false)
  const recognition = useRef<LocalRecognizer | null>(null)
  const language =
    typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'
  useEffect(() => {
    setDraft(
      input.value === null || input.value === undefined
        ? ''
        : Array.isArray(input.value)
          ? input.value.join(',')
          : String(input.value),
    )
  }, [input.value])
  useEffect(() => {
    let active = true
    void localSpeechAvailability(
      window as unknown as {
        SpeechRecognition?: LocalSpeechConstructor
        webkitSpeechRecognition?: LocalSpeechConstructor
      },
      language,
    ).then((result) => {
      if (active) {
        setReady(result.ready)
        setSpeech(
          result.ready
            ? 'Recognition stays on this device. Only the interpreted field is kept, awaiting your seal.'
            : result.reason,
        )
      }
    })
    return () => {
      active = false
      if (recognition.current) {
        recognition.current.onresult = null
        recognition.current.onerror = null
        recognition.current.onend = null
        recognition.current.abort()
      }
    }
  }, [language])
  async function record(value: unknown) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await arrivalApi.typed({ ...input, value })
      setMessage(result.recorded ? 'Posted · typed by you' : result.reason)
      onRecorded()
    } catch (error) {
      setMessage(arrivalError(error))
    } finally {
      setBusy(false)
    }
  }
  async function speak() {
    setMessage(null)
    const availability = await localSpeechAvailability(
      window as unknown as {
        SpeechRecognition?: LocalSpeechConstructor
        webkitSpeechRecognition?: LocalSpeechConstructor
      },
      language,
    )
    if (!availability.ready) {
      setSpeech(availability.reason)
      setReady(false)
      return
    }
    const recognizer = new availability.Constructor()
    recognizer.processLocally = true
    recognizer.lang = language
    recognizer.continuous = false
    recognizer.interimResults = false
    recognizer.maxAlternatives = 1
    recognition.current = recognizer
    recognizer.onresult = (event) => {
      const result = event.results[0]
      if (!result?.isFinal) return
      // Transcript lives only on this stack. Never rendered, logged or sent.
      const value = spokenValue(
        result[0].transcript,
        kind === 'text' ? 'terms' : kind,
      )
      recognizer.onresult = null
      recognizer.abort()
      setListening(false)
      if (value === undefined) {
        setMessage(
          'I could not turn that into this field. Nothing was kept. Type it instead.',
        )
        return
      }
      setBusy(true)
      void arrivalApi
        .propose([{ ...input, value }], 'spoken')
        .then(() => {
          setMessage(
            `In pencil: ${formatValue(value)}. Read it in The assistant before sealing.`,
          )
          onRecorded()
        })
        .catch((error) => setMessage(arrivalError(error)))
        .finally(() => setBusy(false))
    }
    recognizer.onerror = () => {
      setListening(false)
      setMessage(
        'Local recognition stopped. Nothing was recorded. Type it instead.',
      )
    }
    recognizer.onend = () => setListening(false)
    try {
      recognizer.start()
      setListening(true)
    } catch {
      setMessage('Local recognition could not start. Type it instead.')
    }
  }
  const parse = () =>
    kind === 'number'
      ? Number(draft)
      : kind === 'currency'
        ? draft.trim().toUpperCase()
        : kind === 'days'
          ? draft.split(',').map((v) => Number(v.trim()))
          : draft.trim()
  return (
    <div className="ar-field">
      <div>
        <label htmlFor={id}>{label}</label>
        <p className="ar-meta">{source}</p>
        <p className="ar-value">{formatValue(input.value)}</p>
      </div>
      <div className="ar-field-entry">
        {kind === 'boolean' ? (
          <select
            id={id}
            value={
              input.value === null || input.value === undefined
                ? ''
                : String(input.value)
            }
            disabled={disabled || busy}
            onChange={(event) => void record(event.target.value === 'true')}
          >
            <option value="" disabled>
              Not yet answered
            </option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) void record(parse())
            }}
          >
            <input
              id={id}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              type={
                kind === 'number' ? 'number' : kind === 'time' ? 'time' : 'text'
              }
              min={kind === 'number' ? 0 : undefined}
              disabled={disabled || busy}
              placeholder={
                kind === 'days'
                  ? '0=Sun … 6=Sat, separated by commas'
                  : kind === 'currency'
                    ? 'ISO code, e.g. EUR'
                    : 'Your answer'
              }
            />
            <button disabled={disabled || busy || !draft.trim()} type="submit">
              {busy ? 'Recording…' : 'Record'}
            </button>
          </form>
        )}
        {kind === 'days' && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void record([])}
          >
            No fixed delivery days
          </button>
        )}
        <div className="ar-speech">
          <button
            type="button"
            disabled={disabled || speechDisabled || busy || !ready}
            onClick={() =>
              listening
                ? (recognition.current?.abort(), setListening(false))
                : void speak()
            }
          >
            {listening ? 'Stop listening' : 'Speak this field'}
          </button>
          <small>
            {speechDisabled
              ? 'Your typed preferences are available here. A house manager records proposed batches.'
              : speech}
          </small>
        </div>
        {message && (
          <p className="ar-feedback" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
