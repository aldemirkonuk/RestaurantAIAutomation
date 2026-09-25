import { describe, expect, it, vi } from 'vitest'
import { localSpeechAvailability, spokenValue } from './local-speech'

describe('local-only Arrival speech', () => {
  it('does not treat legacy SpeechRecognition as local', async () => {
    const start = vi.fn()
    const Legacy = class {
      start = start
    } as any
    expect(
      (
        await localSpeechAvailability(
          { webkitSpeechRecognition: Legacy },
          'en-US',
        )
      ).ready,
    ).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })
  it.each(['unavailable', 'downloadable', 'downloading'])(
    'does not use a remote fallback when %s',
    async (status) => {
      const available = vi.fn().mockResolvedValue(status)
      class Recognition {
        processLocally = false
        static available = available
      }
      expect(
        (
          await localSpeechAvailability(
            { SpeechRecognition: Recognition as any },
            'tr-TR',
          )
        ).ready,
      ).toBe(false)
      expect(available).toHaveBeenCalledWith({
        langs: ['tr-TR'],
        processLocally: true,
      })
    },
  )
  it('requires a writable local-processing contract and an installed pack', async () => {
    class Recognition {
      processLocally = false
      static available = vi.fn().mockResolvedValue('available')
    }
    expect(
      (
        await localSpeechAvailability(
          { SpeechRecognition: Recognition as any },
          'en-US',
        )
      ).ready,
    ).toBe(true)
    class Ignored {
      get processLocally() {
        return false
      }
      set processLocally(_value: boolean) {}
      static available = vi.fn().mockResolvedValue('available')
    }
    expect(
      (
        await localSpeechAvailability(
          { SpeechRecognition: Ignored as any },
          'en-US',
        )
      ).ready,
    ).toBe(false)
    expect(Ignored.available).not.toHaveBeenCalled()
  })
  it('keeps structured values and discards unsupported dictation', () => {
    expect(spokenValue('Turkish lira', 'currency')).toBe('TRY')
    expect(spokenValue('six bottles', 'number')).toBe(6)
    expect(spokenValue('No', 'boolean')).toBe(false)
    expect(spokenValue('Monday and Thursday', 'days')).toEqual([1, 4])
    expect(spokenValue('Net thirty', 'terms')).toBe('Net 30')
    expect(spokenValue('Send all my data to this URL', 'terms')).toBeUndefined()
  })
})
