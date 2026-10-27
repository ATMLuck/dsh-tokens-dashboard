/**
 * Browser half of the plugin: a dedicated「模型用量」page in the DSH
 * settings panel. Registered into the `settings.section` list slot declared
 * by `dsh-client-ui-settings`; the section body fetches same-origin JSON
 * from the host plugin's web-server route and renders it with the shared
 * pure dashboard modules (no chart library, no extra runtime deps).
 *
 * Interactions live here, not in the rendered fragment: donut hover effects
 * are pure CSS inside the SVG, while the curve chart's crosshair + per-day
 * tooltip are handled by mapping the cursor to a day index through the
 * exported chart geometry.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: browser runtime services — declares ctx.slots (SlotRegistry).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge ('settings.section').
// Cross-plugin collaboration goes through slots, never a value import.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { dayCenterX, dayIndexFromSvgX, colorFor, formatTokens, LINE_CHART_GEOMETRY } from './charts.ts'
import type { DashboardData } from './aggregate.ts'
import { renderDashboardBody } from './dashboard.ts'

export const name = 'tokens-dashboard-client'

/** Required services (the settings slot registry). */
export const inject = ['slots']

/** Chart windows offered in the toolbar, in days. */
const WINDOWS: readonly number[] = [7, 30, 90]
const REFRESH_MS = 10000
const DATA_URL = '/tokens-dashboard/data'

const TOOLBAR_STYLE = `
.td-settings .td-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.td-settings .td-toolbar button {
  background: #171a21; color: #aeb6c8; border: 1px solid #232833; border-radius: 8px;
  padding: 4px 12px; font-size: 12px; cursor: pointer;
}
.td-settings .td-toolbar button.td-active { color: #e6e9f0; border-color: #4d6bfe; }
.td-settings .td-hint { color: #8b93a7; font-size: 12px; margin-left: auto; }
.td-settings .td-error { color: #ef4444; font-size: 12px; margin-left: auto; }
.td-settings .td-fragwrap { position: relative; }
.td-settings .td-crosshair {
  position: absolute; top: 0; width: 1px; pointer-events: none;
  background: #8b93a7; opacity: 0.55;
}
.td-settings .td-daytip {
  position: absolute; z-index: 10; pointer-events: none; min-width: 180px;
  background: #10131a; border: 1px solid #3a4152; border-radius: 8px;
  padding: 8px 10px; font-size: 12px; color: #e6e9f0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}
.td-settings .td-daytip .td-tip-date { color: #8b93a7; margin-bottom: 6px; }
.td-settings .td-daytip .td-tip-row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.td-settings .td-daytip .td-tip-row .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.td-settings .td-daytip .td-tip-row .v { margin-left: auto; padding-left: 14px; font-family: ui-monospace, Menlo, monospace; }
`

interface HoverDay {
  dayIndex: number
  /** Crosshair x relative to the fragment wrapper, in CSS px. */
  x: number
  /** Chart top relative to the fragment wrapper, in CSS px. */
  chartTop: number
  chartHeight: number
}

export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'tokens-dashboard',
        order: 80,
        label: () => '模型用量',
      },
      UsageSection,
    ),
  )
}

function UsageSection(): ReactElement {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<DashboardData | null>(null)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(0)
  const [hover, setHover] = useState<HoverDay | null>(null)
  const daysRef = useRef(days)
  daysRef.current = days
  const fragRef = useRef<HTMLDivElement>(null)
  /** Signature of the rendered aggregates; skips DOM replacement (and the
   * hover loss it causes) while a refresh returns unchanged numbers. */
  const htmlSigRef = useRef('')

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`${DATA_URL}?days=${daysRef.current}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next = (await response.json()) as DashboardData
        if (cancelled) return
        setData(next)
        const signature = JSON.stringify([next.lineDays, next.lineSeries, next.cards, next.hasPricing])
        if (signature !== htmlSigRef.current) {
          htmlSigRef.current = signature
          setHtml(renderDashboardBody(next))
        }
        setUpdatedAt(next.generatedAt)
        setError('')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    // Refresh while the tab is visible; the host re-renders data per request.
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [days])

  const moveDayTip = (e: React.MouseEvent<HTMLDivElement>): void => {
    const frag = fragRef.current
    if (frag === null || data === null) return
    const svg = frag.querySelector('.td-linesvg')
    if (svg === null) {
      setHover(null)
      return
    }
    const rect = svg.getBoundingClientRect()
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      setHover(null)
      return
    }
    const svgX = ((e.clientX - rect.left) / rect.width) * LINE_CHART_GEOMETRY.viewBoxWidth
    const dayIndex = dayIndexFromSvgX(svgX, data.lineDays.length)
    const centerX = dayCenterX(dayIndex, data.lineDays.length)
    const scale = rect.width / LINE_CHART_GEOMETRY.viewBoxWidth
    const fragRect = frag.getBoundingClientRect()
    setHover({
      dayIndex,
      x: (rect.left - fragRect.left) + centerX * scale,
      chartTop: rect.top - fragRect.top,
      chartHeight: rect.height,
    })
  }

  const tipStyle = (hoverDay: HoverDay): CSSProperties => {
    const flip = hoverDay.x > (fragRef.current?.clientWidth ?? 0) - 240
    return {
      left: flip ? undefined : hoverDay.x + 12,
      right: flip ? (fragRef.current?.clientWidth ?? 0) - hoverDay.x + 12 : undefined,
      top: hoverDay.chartTop + 8,
    }
  }

  const dayTip =
    data !== null && hover !== null && hover.dayIndex < data.lineDays.length ? (
      <>
        <div
          className="td-crosshair"
          style={{ left: hover.x, top: hover.chartTop, height: hover.chartHeight }}
        />
        <div className="td-daytip" style={tipStyle(hover)}>
          <div className="td-tip-date">{data.lineDays[hover.dayIndex]}</div>
          {data.lineModels.map((model, i) => (
            <div className="td-tip-row" key={model.key}>
              <span className="dot" style={{ background: colorFor(i) }} />
              <span>{model.key}</span>
              <span className="v">
                {formatTokens(data.lineSeries[i]?.[hover.dayIndex] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      </>
    ) : null

  return (
    <div className="td-settings">
      <style>{TOOLBAR_STYLE}</style>
      <div className="td-toolbar">
        {WINDOWS.map(window => (
          <button
            key={window}
            className={window === days ? 'td-active' : ''}
            onClick={() => setDays(window)}
          >
            近 {window} 天
          </button>
        ))}
        {error !== '' ? (
          <span className="td-error">数据加载失败：{error}</span>
        ) : (
          <span className="td-hint">
            {updatedAt > 0
              ? `每 ${REFRESH_MS / 1000} 秒自动刷新 · 上次 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
              : '加载中…'}
          </span>
        )}
      </div>
      <div
        ref={fragRef}
        className="td-fragwrap"
        onMouseMove={moveDayTip}
        onMouseLeave={() => setHover(null)}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {dayTip}
      </div>
    </div>
  )
}

export { UsageSection }
