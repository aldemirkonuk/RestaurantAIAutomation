import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../services/api/client'
import { useAuth } from '../contexts/AuthContext'

/**
 * `/dev/truth` — three throwaway surfaces that make three specific claims
 * checkable by a human who reads no code.
 *
 * They exist because the product's own numbers cannot be verified from the
 * product's own screens. Each tab answers exactly one question and shows the
 * inputs that produced the answer, which is the part every other surface omits.
 *
 *   REACH    Does "386 of 573 reachable" mean what it says?
 *   AS-OF    Would you have said this before you knew?
 *   SWALLOW  Is anything reading as empty because it broke?
 *
 * Deliberately no design system, no charts, no polish — these are instruments,
 * not product. Delete them when the claims stop needing checking.
 *
 * The fourth surface in the design, `/dev/holdout` ("does acting beat not
 * acting?"), is NOT built: `prediction_outcomes` has zero rows and there is no
 * recorded holdout arm, so the screen could only render a comparison that does
 * not exist. Building it would be the fabrication ADR 0020 forbids. It becomes
 * buildable when the ledger has rows.
 */

type Tab = 'reach' | 'asof' | 'swallow'

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
}

function Cell({
  children,
  bad,
  good,
  dim,
}: {
  children: React.ReactNode
  bad?: boolean
  good?: boolean
  dim?: boolean
}) {
  return (
    <td
      style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--line, #e5e5e5)',
        color: bad
          ? 'var(--danger, #b3261e)'
          : good
            ? 'var(--ok, #1b6e4b)'
            : dim
              ? 'var(--ink-3, #736B5D)'
              : 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '6px 12px',
        borderBottom: '2px solid var(--ink-1, #1a1a1a)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

/** Never renders a missing number as 0 — an em dash means "we could not read it". */
function Num({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span title="could not be read">—</span>
  return <>{v.toLocaleString()}</>
}

export default function DevTruth() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'reach'
  const restaurantId = params.get('r') || (user as any)?.restaurantId || ''
  const [cutoff, setCutoff] = useState(params.get('cutoff') || '')

  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    const qs = tab === 'asof' && cutoff ? `?cutoff=${encodeURIComponent(cutoff)}` : ''
    apiClient
      .get(`/analytics/dev/${tab}/${restaurantId}${qs}`)
      .then((r) => !cancelled && setData(r.data))
      // A failed request says so. It does not render as an empty screen — that
      // is the exact confusion these pages exist to expose.
      .catch((e) =>
        !cancelled && setErr(e?.response?.data?.message || e?.message || 'request failed'),
      )
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tab, restaurantId, cutoff])

  const setTab = (t: Tab) => {
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  return (
    <div style={{ padding: 24, ...mono, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>dev / truth</h1>
      <p style={{ margin: '0 0 16px', color: 'var(--ink-3, #736B5D)', maxWidth: 760 }}>
        Instruments, not product. Each tab answers one question and shows the inputs behind
        the answer — which is the part every other surface omits.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['reach', 'asof', 'swallow'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              border: '1px solid var(--line, #ccc)',
              background: t === tab ? 'var(--ink-1, #1a1a1a)' : 'transparent',
              color: t === tab ? 'var(--paper-1, #fff)' : 'inherit',
              ...mono,
            }}
          >
            {t}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-3, #736B5D)' }}>
          r={restaurantId ? `${restaurantId.slice(0, 8)}…` : 'none'}
        </span>
      </div>

      {!restaurantId && (
        <p style={{ color: 'var(--danger, #b3261e)' }}>
          No restaurant. Append <code>?r=&lt;uuid&gt;</code>.
        </p>
      )}
      {loading && <p>loading…</p>}
      {err && (
        <p style={{ color: 'var(--danger, #b3261e)' }}>
          request failed: {err}
          <br />
          <span style={{ color: 'var(--ink-3, #736B5D)' }}>
            This is a failure, not an empty result. The distinction is the point.
          </span>
        </p>
      )}

      {!loading && !err && data && tab === 'reach' && <Reach d={data} />}
      {!loading && !err && data && tab === 'asof' && (
        <AsOf d={data} cutoff={cutoff} setCutoff={setCutoff} />
      )}
      {!loading && !err && data && tab === 'swallow' && <Swallow d={data} />}
    </div>
  )
}

function Reach({ d }: { d: any }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 32, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 28 }}>
            {d.reachedByPresence} <span style={{ fontSize: 16 }}>/ {d.total}</span>
          </div>
          <div style={{ color: 'var(--ink-3, #736B5D)' }}>
            {d.presencePct}% — what the product reports
          </div>
        </div>
        <div>
          <div style={{ fontSize: 28 }}>
            {d.reachedBySufficiency} <span style={{ fontSize: 16 }}>/ {d.total}</span>
          </div>
          <div style={{ color: 'var(--ink-3, #736B5D)' }}>
            {d.sufficiencyPct}% — with a stated row minimum
          </div>
        </div>
        <div>
          <div style={{ fontSize: 28, color: 'var(--danger, #b3261e)' }}>
            −{d.overstatement}
          </div>
          <div style={{ color: 'var(--ink-3, #736B5D)' }}>types the presence test adds</div>
        </div>
      </div>

      <table style={{ borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>
            <Th>requirement</Th>
            <Th>table</Th>
            <Th>rows</Th>
            <Th>present?</Th>
            <Th>≥ min</Th>
            <Th>sufficient?</Th>
          </tr>
        </thead>
        <tbody>
          {d.sources.map((s: any) => (
            <tr key={s.requirement}>
              <Cell>{s.requirement}</Cell>
              <Cell dim>{s.table}</Cell>
              <Cell bad={s.rows === null}>
                <Num v={s.rows} />
                {s.error && <span title={s.error}> (unreadable)</span>}
              </Cell>
              <Cell good={s.presenceFlag} dim={!s.presenceFlag}>
                {s.presenceFlag ? 'YES' : 'no'}
              </Cell>
              <Cell dim>{s.sufficientThreshold}</Cell>
              <Cell good={s.sufficientFlag} bad={s.presenceFlag && !s.sufficientFlag}>
                {s.sufficientFlag ? 'YES' : s.presenceFlag ? 'NO — but counted' : 'no'}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>

      {d.leverage?.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, margin: '20px 0 6px' }}>
            what each source is holding up
          </h2>
          <table style={{ borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr>
                <Th>source</Th>
                <Th>rows</Th>
                <Th>types it alone unlocks</Th>
              </tr>
            </thead>
            <tbody>
              {d.leverage.map((l: any) => (
                <tr key={l.requirement}>
                  <Cell>{l.requirement}</Cell>
                  <Cell bad={l.rows !== null && l.rows < 30}>
                    <Num v={l.rows} />
                  </Cell>
                  <Cell>{l.typesItUnlocks}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Note>{d.note}</Note>
    </>
  )
}

function AsOf({
  d,
  cutoff,
  setCutoff,
}: {
  d: any
  cutoff: string
  setCutoff: (v: string) => void
}) {
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <label>
          cut the world at{' '}
          <input
            type="date"
            value={cutoff ? cutoff.slice(0, 10) : ''}
            onChange={(e) =>
              setCutoff(e.target.value ? `${e.target.value}T23:59:59.999Z` : '')
            }
            style={{ ...mono, padding: 4 }}
          />
        </label>
      </div>

      {d.error ? (
        <p style={{ color: 'var(--danger, #b3261e)' }}>query failed: {d.error}</p>
      ) : (
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>known at the cut</h2>
            <div>checks &nbsp;<Num v={d.known?.checks} /></div>
            <div>revenue <Num v={d.known?.revenue} /></div>
            <div>covers &nbsp;<Num v={d.known?.covers} /></div>
            <div style={{ color: 'var(--ink-3, #736B5D)', marginTop: 6 }}>
              {d.known?.firstAt?.slice(0, 10) ?? '—'} → {d.known?.lastAt?.slice(0, 10) ?? '—'}
            </div>
          </div>
          <div
            style={{
              paddingLeft: 40,
              borderLeft: '2px solid var(--ink-1, #1a1a1a)',
            }}
          >
            <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>what happened after</h2>
            <div>checks &nbsp;<Num v={d.happened?.checks} /></div>
            <div>revenue <Num v={d.happened?.revenue} /></div>
            <div>covers &nbsp;<Num v={d.happened?.covers} /></div>
            <div style={{ color: 'var(--ink-3, #736B5D)', marginTop: 6 }}>
              cover this pane to judge the left one honestly
            </div>
          </div>
        </div>
      )}

      {d.limits && (
        <>
          <h2 style={{ fontSize: 14, margin: '24px 0 6px' }}>what this screen cannot do</h2>
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-3, #736B5D)' }}>
            {d.limits.map((l: string, i: number) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {l}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function Swallow({ d }: { d: any }) {
  return (
    <>
      <table style={{ borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>
            <Th>table</Th>
            <Th>rows</Th>
            <Th>error</Th>
            <Th>state</Th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r: any) => (
            <tr key={r.table}>
              <Cell>{r.table}</Cell>
              <Cell bad={r.rows === null}>
                <Num v={r.rows} />
              </Cell>
              <Cell bad={!!r.errorCode} dim={!r.errorCode}>
                {r.errorCode || '—'}
              </Cell>
              <Cell
                bad={r.state === 'BROKEN'}
                good={r.state === 'HAS ROWS'}
                dim={r.state === 'GENUINELY EMPTY'}
              >
                {r.state}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <Note>{d.note}</Note>
    </>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        color: 'var(--ink-3, #736B5D)',
        maxWidth: 760,
        borderTop: '1px solid var(--line, #e5e5e5)',
        paddingTop: 10,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  )
}
