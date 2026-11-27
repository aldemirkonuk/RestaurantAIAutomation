import { useEffect, useId, useState } from 'react'
import { importMenuFromUrl, type MenuImportResult } from '../../services/api/menus'
import { getErrorStatus } from '../../services/api/client'

/**
 * Read the first menu from the house's own website (DD-r108-55). The address
 * comes from the picked place (Places `websiteURI`) or is typed, so it works
 * with Maps off. The gateway does the fetch; this only names the address.
 */

/** The address the gateway is asked to read: https only, scheme added when typed bare. */
export function httpsAddress(raw: string): { url: string; domain: string } | null {
  const typed = raw.trim()
  if (!typed) return null
  // The session's call: a bare domain and Google's http:// site are asked as
  // https://; the gateway reads https only, and most sites redirect anyway.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'https:'
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) return null
  if (parsed.username || parsed.password) return null
  return { url: parsed.toString(), domain: parsed.hostname.replace(/^www\./, '') }
}

const NOT_READ = 'We could not read that page. Send a photo or a PDF instead.'

export function MenuFromWebsite({
  website,
  onSuccess,
}: {
  /** The picked place's own website, or null. */
  website: string | null
  onSuccess: (result: MenuImportResult) => void
}) {
  const id = useId()
  const [value, setValue] = useState(website ?? '')
  const [reading, setReading] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // A place picked again brings its own site; a typed address is kept.
  useEffect(() => {
    if (website) setValue(website)
  }, [website])

  const target = httpsAddress(value)

  const read = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target || reading) return
    setReading(true)
    setRefusal(null)
    try {
      onSuccess(await importMenuFromUrl(target.url))
    } catch (cause) {
      const said = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message
      const status = getErrorStatus(cause) ?? 0
      // A refusal's sentence (4xx: the 422 thin page, a refused address) is
      // said as the gateway wrote it; a fault or a silent refusal gets the
      // plain sentence, never "Internal server error".
      setRefusal(status >= 400 && status < 500 && typeof said === 'string' && said.trim() ? said : NOT_READ)
    } finally {
      setReading(false)
    }
  }

  return (
    <form onSubmit={read} data-testid="menu-website" className="mdv-spread-website">
      <label htmlFor={id} className="mdv-spread-drop-sub">
        Or the menu on your website
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        style={{ minHeight: 44, width: '100%' }}
      />
      {/* The line's room is held whether or not there is an address, so
          typing one never moves the drop zone below. */}
      <div style={{ minHeight: 44 }}>
        {reading ? (
          <p role="status" style={{ minHeight: 44, display: 'flex', alignItems: 'center', margin: 0 }}>
            Reading the menu from {target?.domain}…
          </p>
        ) : target ? (
          <button type="submit" className="mdv-spread-textlink" style={{ minHeight: 44 }}>
            Read the menu from {target.domain}
          </button>
        ) : null}
      </div>
      {refusal && (
        <p role="alert" className="mdv-alert">
          {refusal}
        </p>
      )}
    </form>
  )
}
