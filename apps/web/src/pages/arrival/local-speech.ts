/** The Web Speech API's ordinary/default recognition may be remote.
 * https://webaudio.github.io/web-speech-api/#dom-speechrecognition-processlocally
 * We require its explicit local contract AND an installed language pack.
 * No server fallback, audio recorder, transcript store or telemetry hook. */
export interface LocalRecognizer {
  processLocally: boolean
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult:
    | ((event: {
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
      }) => void)
    | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
export interface LocalSpeechConstructor {
  new (): LocalRecognizer
  available?: (options: {
    langs: string[]
    processLocally: true
  }) => Promise<string>
}
export type SpeechAvailability =
  | { ready: true; Constructor: LocalSpeechConstructor }
  | { ready: false; reason: string }
export async function localSpeechAvailability(
  scope: {
    SpeechRecognition?: LocalSpeechConstructor
    webkitSpeechRecognition?: LocalSpeechConstructor
  },
  language: string,
): Promise<SpeechAvailability> {
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  if (!Constructor || typeof Constructor.available !== 'function')
    return {
      ready: false,
      reason:
        'On-device speech is unavailable in this browser. Type your answers here.',
    }
  try {
    const recognizer = new Constructor()
    if (!('processLocally' in recognizer))
      return {
        ready: false,
        reason:
          'This browser cannot guarantee local recognition. Type your answers here.',
      }
    recognizer.processLocally = true
    if (recognizer.processLocally !== true)
      return {
        ready: false,
        reason:
          'This browser cannot keep recognition on this device. Type your answers here.',
      }
    const status = await Constructor.available({
      langs: [language],
      processLocally: true,
    })
    if (status !== 'available')
      return {
        ready: false,
        reason:
          status === 'downloadable' || status === 'downloading'
            ? 'The on-device language pack is not ready. Type your answers here; no speech is sent to a server.'
            : 'On-device speech is unavailable for this language. Type your answers here.',
      }
    return { ready: true, Constructor }
  } catch {
    return {
      ready: false,
      reason:
        'Local recognition could not be verified. Type your answers here.',
    }
  }
}

/** Interpret one selected field locally. Unrecognised sentences are discarded;
 * only the resulting typed value reaches a configuration proposal. */
export function spokenValue(
  text: string,
  kind: 'currency' | 'number' | 'boolean' | 'days' | 'time' | 'terms',
): unknown | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]$/, '')
  if (kind === 'boolean')
    return /^(yes|on|enabled|true|we carry it)$/.test(normalized)
      ? true
      : /^(no|off|disabled|false|we do not carry it)$/.test(normalized)
        ? false
        : undefined
  if (kind === 'currency') {
    const codes: Record<string, string> = {
      'us dollars': 'USD',
      'us dollar': 'USD',
      euros: 'EUR',
      euro: 'EUR',
      'turkish lira': 'TRY',
      'british pounds': 'GBP',
      'pounds sterling': 'GBP',
      'canadian dollars': 'CAD',
    }
    return (
      codes[normalized] ??
      (/^[a-z](?:\s?[a-z]){2}$/.test(normalized)
        ? normalized.replace(/\s/g, '').toUpperCase()
        : undefined)
    )
  }
  if (kind === 'number') {
    const names: Record<string, number> = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      twelve: 12,
      twenty: 20,
      thirty: 30,
    }
    const cleaned = normalized.replace(/ (days|bottles)$/, '')
    return (
      names[cleaned] ??
      (/^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : undefined)
    )
  }
  if (kind === 'time')
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : undefined
  if (kind === 'days') {
    if (
      normalized === 'no fixed days' ||
      normalized === 'no fixed delivery days'
    )
      return []
    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ]
    const parts = normalized.split(/\s*(?:,|and)\s*/)
    return parts.length && parts.every((p) => days.includes(p))
      ? [...new Set(parts.map((p) => days.indexOf(p)))]
      : undefined
  }
  // Payment terms are a structured field; don't persist arbitrary dictation.
  if (kind === 'terms') {
    if (normalized === 'cash on delivery' || normalized === 'cod')
      return 'Cash on delivery'
    const net = normalized.match(/^net (\d{1,3}|thirty|sixty|ninety)$/)
    return net
      ? `Net ${({ thirty: 30, sixty: 60, ninety: 90 } as Record<string, number>)[net[1]] ?? Number(net[1])}`
      : undefined
  }
}
