/**
 * Browser half of the plugin: a dedicated「模型用量」page in the DSH
 * settings panel. Registered into the `settings.section` list slot declared
 * by `dsh-client-ui-settings`; the section body fetches same-origin JSON
 * from the host plugin's web-server route and renders it with the shared
 * pure dashboard modules (no chart library, no extra runtime deps).
 *
 * Interactions live here, not in the rendered fragment: donut hover
 * enlargement is pure CSS inside the SVG while its tooltip and the curve
 * chart's crosshair + per-day tooltip are handled by the client — the curve
 * maps the cursor to a day index through the exported chart geometry, and
 * the donut reads data-label/data-value/data-pct off the hovered slice.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: browser runtime services — declares ctx.slots (SlotRegistry).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge ('settings.section').
// Cross-plugin collaboration goes through slots, never a value import.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  colorFor,
  dayCenterX,
  dayIndexFromSvgX,
  formatTokens,
  formatWan,
  renderHeatmapSVG,
  LINE_CHART_GEOMETRY,
} from './charts.ts'
import { aggregateWeeks, cumulateDays, weekAlignCells } from './aggregate.ts'
import { shiftDayKey } from './days.ts'
import type { DashboardData } from './aggregate.ts'
import type { HeatmapCell } from './types.ts'
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
/* Token 活动 heatmap panel (client-owned: its three modes are pure view state). */
.td-settings .td-hmpanel { background: #171a21; border: 1px solid #232833; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.td-settings .td-hmpanel h2 { font-size: 14px; margin: 0; color: #aeb6c8; font-weight: 600; }
.td-settings .td-hmhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.td-settings .td-seg { display: flex; gap: 2px; background: #10131a; border: 1px solid #232833; border-radius: 999px; padding: 2px; }
.td-settings .td-seg button { background: transparent; border: none; color: #8b93a7; font-size: 12px; padding: 4px 12px; border-radius: 999px; cursor: pointer; }
.td-settings .td-seg button.td-active { background: #232833; color: #e6e9f0; }
.td-settings .td-hmwrap { position: relative; }
.td-settings .td-heatsvg { display: block; width: 100%; height: auto; }
`

interface HoverDay {
  dayIndex: number
  /** Crosshair x relative to the fragment wrapper, in CSS px. */
  x: number
  /** Chart top relative to the fragment wrapper, in CSS px. */
  chartTop: number
  chartHeight: number
}

type HeatmapMode = 'daily' | 'weekly' | 'cumulative'

const HEATMAP_MODES: readonly { key: HeatmapMode; label: string }[] = [
  { key: 'daily', label: '每日' },
  { key: 'weekly', label: '每周' },
  { key: 'cumulative', label: '累计' },
]

/** 2026-10-27 → 2026年10月27日 (the reference tooltip's date style). */
function zhDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  if (year === undefined || month === undefined || day === undefined) return dateKey
  return `${year}年${Number.parseInt(month, 10)}月${Number.parseInt(day, 10)}日`
}

interface HeatTip {
  x: number
  y: number
  line1: string
  line2: string
}

/**
 * Token 活动 panel: a GitHub-style calendar grid of the trailing year, with
 * 每日/每周/累计 view modes (pure view state over the same per-day data) and
 * a per-cell tooltip in the shared .td-daytip style.
 */
function TokenHeatmap({ days }: { days: readonly HeatmapCell[] }): ReactElement {
  const [mode, setMode] = useState<HeatmapMode>('daily')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<HeatTip | null>(null)

  const cells = useMemo(() => {
    if (mode === 'weekly') return aggregateWeeks(days)
    if (mode === 'cumulative') return weekAlignCells(cumulateDays(days))
    return weekAlignCells(days)
  }, [days, mode])

  const svgHtml = useMemo(
    () => renderHeatmapSVG({ cells, rows: mode === 'weekly' ? 1 : 7 }),
    [cells, mode],
  )

  const moveTip = (e: React.MouseEvent<HTMLDivElement>): void => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const target = e.target instanceof Element ? e.target : null
    const cellEl = target?.closest('.td-hcell') ?? null
    if (cellEl === null) {
      setTip(null)
      return
    }
    const date = cellEl.getAttribute('data-date') ?? ''
    const tokens = Number(cellEl.getAttribute('data-tokens') ?? '0')
    const requests = Number(cellEl.getAttribute('data-requests') ?? '0')
    const line1 =
      mode === 'weekly' ? `${date} ~ ${shiftDayKey(date, 6).slice(5)} 当周` : zhDate(date)
    const line2 = `${mode === 'cumulative' ? '累计 ' : ''}${formatWan(tokens)} tokens · ${requests} 轮消息`
    const rect = wrap.getBoundingClientRect()
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, line1, line2 })
  }

  const tipStyle: CSSProperties | undefined =
    tip === null
      ? undefined
      : (() => {
          const width = wrapRef.current?.clientWidth ?? 0
          const flip = tip.x > width - 260
          return {
            left: flip ? undefined : tip.x + 14,
            right: flip ? width - tip.x + 14 : undefined,
            top: tip.y + 14,
          }
        })()

  return (
    <div className="td-hmpanel">
      <div className="td-hmhead">
        <h2>Token 活动</h2>
        <div className="td-seg">
          {HEATMAP_MODES.map(entry => (
            <button
              key={entry.key}
              className={mode === entry.key ? 'td-active' : ''}
              onClick={() => setMode(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} className="td-hmwrap" onMouseMove={moveTip} onMouseLeave={() => setTip(null)}>
        <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
        {tip !== null ? (
          <div className="td-daytip" style={tipStyle}>
            <div className="td-tip-date">{tip.line1}</div>
            <div className="td-tip-row">
              <span>{tip.line2}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Donut tooltip state, read off the hovered slice's data attributes. */
interface SliceTip {
  x: number
  y: number
  label: string
  value: string
  pct: string
  index: number
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
  const [sliceTip, setSliceTip] = useState<SliceTip | null>(null)
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

  const moveSliceTip = (e: React.MouseEvent<HTMLDivElement>): void => {
    const frag = fragRef.current
    if (frag === null) return
    const target = e.target instanceof Element ? e.target : null
    const slice = (target?.closest('.td-slice') ?? null)
    const label = slice?.getAttribute('data-label') ?? null
    if (slice === null || label === null) {
      setSliceTip(null)
      return
    }
    const fragRect = frag.getBoundingClientRect()
    setSliceTip({
      x: e.clientX - fragRect.left,
      y: e.clientY - fragRect.top,
      label,
      value: slice.getAttribute('data-value') ?? '',
      pct: slice.getAttribute('data-pct') ?? '',
      index: Number.parseInt(slice.getAttribute('data-index') ?? '0', 10) || 0,
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

  const sliceTipStyle = (tip: SliceTip): CSSProperties => {
    const flip = tip.x > (fragRef.current?.clientWidth ?? 0) - 240
    return {
      left: flip ? undefined : tip.x + 14,
      right: flip ? (fragRef.current?.clientWidth ?? 0) - tip.x + 14 : undefined,
      top: tip.y + 14,
    }
  }

  const sliceTipEl =
    sliceTip !== null ? (
      <div className="td-daytip" style={sliceTipStyle(sliceTip)}>
        <div className="td-tip-date">{sliceTip.label}</div>
        <div className="td-tip-row">
          <span className="dot" style={{ background: colorFor(sliceTip.index) }} />
          <span>占比 {sliceTip.pct}%</span>
          <span className="v">{sliceTip.value}</span>
        </div>
      </div>
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
      {data !== null ? <TokenHeatmap days={data.heatmap} /> : null}
      <div
        ref={fragRef}
        className="td-fragwrap"
        onMouseMove={e => {
          moveDayTip(e)
          moveSliceTip(e)
        }}
        onMouseLeave={() => {
          setHover(null)
          setSliceTip(null)
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {dayTip}
        {sliceTipEl}
      </div>
    </div>
  )
}

export { UsageSection }
