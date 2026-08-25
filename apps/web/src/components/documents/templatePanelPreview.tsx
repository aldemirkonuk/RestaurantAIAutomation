/**
 * Shared template panel renderer.
 *
 * Renders a single `TemplatePanel` (the shape produced by GmailTemplateBuilder /
 * saved via the templates API) exactly the way GmailTemplateBuilder itself does,
 * so any surface that needs to show "what will this template actually look like"
 * (e.g. the provider Send Message slide-over) gets a faithful render instead of
 * a hand-drawn wireframe mockup.
 *
 * Extracted verbatim from GmailTemplateBuilder's `renderPanelPreview` — no
 * behavior change there, just made reusable.
 */
import type { CSSProperties } from 'react'

export type PanelType =
  | 'text' | 'image' | 'chart-bar' | 'chart-pie' | 'chart-line'
  | 'table' | 'financial' | 'metric' | 'header' | 'divider' | 'spacer' | 'button'

export interface TemplatePanel {
  id: string
  type: PanelType
  title: string
  content: any
  config: {
    backgroundColor?: string
    textColor?: string
    fontSize?: 'small' | 'medium' | 'large'
    padding?: 'small' | 'medium' | 'large'
    alignment?: 'left' | 'center' | 'right'
    borderRadius?: 'none' | 'small' | 'medium' | 'large'
  }
}

export function renderTemplatePanel(panel: TemplatePanel) {
  const baseStyle: CSSProperties = {
    backgroundColor: panel.config.backgroundColor,
    color: panel.config.textColor,
    padding: panel.config.padding === 'large' ? '2rem' : panel.config.padding === 'small' ? '0.75rem' : '1.25rem',
    textAlign: panel.config.alignment as any,
    borderRadius: panel.config.borderRadius === 'large' ? '1rem' : panel.config.borderRadius === 'medium' ? '0.5rem' : panel.config.borderRadius === 'small' ? '0.25rem' : '0',
  }

  switch (panel.type) {
    case 'header':
      return (
        <div style={baseStyle}>
          <h1 className="text-2xl font-bold mb-2">{panel.content.title}</h1>
          <p className="text-sm opacity-90">{panel.content.subtitle}</p>
        </div>
      )

    case 'text':
      return (
        <div style={baseStyle} className="prose prose-sm max-w-none">
          <p className="whitespace-pre-wrap leading-relaxed">{panel.content.text}</p>
        </div>
      )

    case 'metric':
      return (
        <div style={baseStyle} className="text-center">
          <p className="text-sm font-medium opacity-70 mb-2">{panel.content.label}</p>
          <p className="text-4xl font-bold mb-2">{panel.content.value}</p>
          <p className={`text-sm font-semibold ${panel.content.trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
            {panel.content.trend}
          </p>
        </div>
      )

    case 'financial':
      return (
        <div style={baseStyle}>
          {panel.content.title && <h3 className="text-lg font-bold mb-4">{panel.content.title}</h3>}
          <div className="grid grid-cols-3 gap-4">
            {panel.content.metrics.map((metric: any, idx: number) => (
              <div key={idx} className="text-center p-4 bg-black/5 rounded-lg">
                <p className="text-xs font-semibold opacity-70 mb-1">{metric.label}</p>
                <p className="text-2xl font-bold mb-1">{metric.value}</p>
                <p className={`text-xs font-semibold ${metric.trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {metric.trend}
                </p>
              </div>
            ))}
          </div>
        </div>
      )

    case 'table':
      return (
        <div style={baseStyle}>
          {panel.content.title && <h3 className="text-lg font-bold mb-4">{panel.content.title}</h3>}
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {panel.content.headers.map((header: string, idx: number) => (
                    <th key={idx} className="px-4 py-3 text-left font-semibold text-gray-700">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {panel.content.rows.map((row: string[], idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    {row.map((cell: string, cellIdx: number) => (
                      <td key={cellIdx} className="px-4 py-3">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )

    case 'chart-bar':
    case 'chart-line': {
      const maxValue = Math.max(...panel.content.data)
      return (
        <div style={baseStyle}>
          {panel.content.title && <h3 className="text-lg font-bold mb-4 text-center">{panel.content.title}</h3>}
          <div className="flex items-end justify-center gap-3 h-40">
            {panel.content.data.map((value: number, idx: number) => (
              <div key={idx} className="flex-1 max-w-16 flex flex-col items-center gap-2">
                <span className="text-xs font-bold">{value}</span>
                <div
                  className="w-full rounded-t-lg transition-all"
                  style={{
                    height: `${(value / maxValue) * 100}%`,
                    backgroundColor: panel.content.colors?.[idx] || '#991B1B',
                    minHeight: '8px'
                  }}
                />
                <span className="text-xs text-center">{panel.content.labels[idx]}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    case 'chart-pie': {
      const total = panel.content.data.reduce((a: number, b: number) => a + b, 0)
      return (
        <div style={baseStyle}>
          {panel.content.title && <h3 className="text-lg font-bold mb-4 text-center">{panel.content.title}</h3>}
          <div className="flex items-center justify-center gap-8">
            <div
              className="w-32 h-32 rounded-full"
              style={{
                background: `conic-gradient(${panel.content.data.map((value: number, idx: number) => {
                  const startPercent = panel.content.data.slice(0, idx).reduce((a: number, b: number) => a + b, 0) / total * 100
                  const endPercent = startPercent + (value / total * 100)
                  return `${panel.content.colors?.[idx] || '#991B1B'} ${startPercent}% ${endPercent}%`
                }).join(', ')})`
              }}
            />
            <div className="space-y-2">
              {panel.content.labels.map((label: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: panel.content.colors?.[idx] || '#991B1B' }}
                  />
                  <span className="text-xs">{label}: {Math.round(panel.content.data[idx] / total * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }

    case 'image':
      return (
        <div style={baseStyle}>
          <img
            src={panel.content.url}
            alt={panel.content.alt}
            className="w-full max-h-64 object-cover rounded-lg"
          />
          {panel.content.caption && (
            <p className="text-xs text-center mt-2 opacity-70">{panel.content.caption}</p>
          )}
        </div>
      )

    case 'divider':
      return (
        <div style={{ padding: '1rem 0' }}>
          <hr style={{ borderColor: panel.content.color, borderStyle: panel.content.style }} />
        </div>
      )

    case 'button':
      return (
        <div style={{ ...baseStyle, backgroundColor: 'transparent' }} className="text-center">
          <a
            href={panel.content.url}
            className="inline-block px-8 py-3 font-semibold rounded-lg text-white transition-all hover:opacity-90"
            style={{ backgroundColor: panel.config.backgroundColor === '#FFFFFF' ? '#991B1B' : panel.config.backgroundColor }}
          >
            {panel.content.text}
          </a>
        </div>
      )

    default:
      return <div style={baseStyle}>Panel type: {panel.type}</div>
  }
}

const DEFAULT_PANEL_STYLE = {
  backgroundColor: '#FFFFFF',
  textColor: '#1F2937',
  fontSize: 'medium' as const,
  padding: 'medium' as const,
  alignment: 'left' as const,
  borderRadius: 'medium' as const,
}

/**
 * Convert a "legacy" panel — the position/size/config shape used by the
 * hardcoded examples in `data/emailTemplateCategories.ts` (see
 * `types/emailTemplates.ts`'s `TemplatePanel`) — into the shape this module's
 * `renderTemplatePanel` actually understands.
 *
 * These are two independent panel schemas that happen to share a type name.
 * Naively relabeling every legacy panel as `type: 'text'` and passing its raw
 * `config` through as `content` (the pattern this was copied from in
 * SavedTemplates.tsx) throws away which panel is a table/chart/metric and
 * mismatches the field names `renderTemplatePanel` reads — so nothing but
 * plain text panels ever showed up right, and even those needed `.text`,
 * not `.content`. This does the real per-type field mapping instead.
 *
 * Decorative `shape` panels (background rectangles from the legacy
 * absolute-position canvas) carry no renderable information here, so they're
 * dropped — filter the `null`s out of the result.
 */
export function convertLegacyPanel(panel: any): TemplatePanel | null {
  const cfg = panel?.config ?? {}

  switch (panel?.type) {
    case 'text':
      return {
        id: panel.id,
        type: 'text',
        title: '',
        content: { text: cfg.content ?? '' },
        config: DEFAULT_PANEL_STYLE,
      }

    case 'metric': {
      const change = typeof cfg.change === 'number' ? cfg.change : undefined
      return {
        id: panel.id,
        type: 'metric',
        title: '',
        content: {
          label: cfg.label,
          value: cfg.value,
          trend: change === undefined ? '' : `${change > 0 ? '+' : ''}${change}%`,
          trendUp: cfg.changeType === 'positive',
        },
        config: DEFAULT_PANEL_STYLE,
      }
    }

    case 'table':
      return {
        id: panel.id,
        type: 'table',
        title: '',
        content: {
          title: cfg.title,
          headers: cfg.headers ?? [],
          rows: cfg.rows ?? [],
        },
        config: DEFAULT_PANEL_STYLE,
      }

    case 'chart': {
      const rawData: any[] = Array.isArray(cfg.data) ? cfg.data : []
      const labelKey = cfg.xAxis
      const valueKey = cfg.yAxis ?? 'value'
      const labels = rawData.map(d => d?.[labelKey] ?? d?.name ?? d?.category ?? '')
      const data = rawData.map(d => Number(d?.[valueKey] ?? d?.value ?? 0))
      const chartType = cfg.type === 'pie' ? 'chart-pie' : cfg.type === 'line' ? 'chart-line' : 'chart-bar'
      return {
        id: panel.id,
        type: chartType,
        title: '',
        content: { title: cfg.title, data, labels, colors: cfg.colors },
        config: DEFAULT_PANEL_STYLE,
      }
    }

    // Decorative background shapes from the legacy absolute-position canvas —
    // nothing meaningful to render in a stacked-panel layout.
    case 'shape':
      return null

    default:
      return null
  }
}
