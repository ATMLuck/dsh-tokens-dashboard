/**
 * Zero-dependency SVG chart builders. Everything is a pure string function:
 * no DOM, no files, no external chart library.
 */
import type { HeatmapCell } from './types.ts'

/** Deterministic model color palette, shared by every chart and legend. */
export const PALETTE: readonly string[] = [
  '#4d6bfe',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
]

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? '#4d6bfe'
}

/** 万-based human token counts for the heatmap tooltip: 35228000 → 3522.8万. */
export function formatWan(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const trim1 = (n: number): string => {
    const s = n.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (value >= 1e8) return `${trim1(value / 1e8)}亿`
  if (value >= 1e4) return `${trim1(value / 1e4)}万`
  return String(Math.round(value))
}

/** Human token counts: 1234 → 1.2K, 4_500_000 → 4.50M. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(Math.round(value))
}

/** Human USD amounts that stay readable below one dollar. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0'
  if (value >= 100) return `$${value.toFixed(0)}`
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function niceCeil(value: number): number {
  if (!(value > 0)) return 1
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const fraction = value / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * base
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface LineSeries {
  label: string
  values: readonly number[]
}

/** Geometry of the daily-usage SVG; the browser half maps cursor moves to
 * day indices against these constants. */
export const LINE_CHART_GEOMETRY = {
  viewBoxWidth: 860,
  viewBoxHeight: 320,
  padLeft: 64,
  padRight: 16,
  padTop: 16,
  padBottom: 28,
} as const

/** Day index under an SVG-space x coordinate, clamped into the window. */
export function dayIndexFromSvgX(svgX: number, pointCount: number): number {
  if (pointCount <= 1) return 0
  const plotW =
    LINE_CHART_GEOMETRY.viewBoxWidth - LINE_CHART_GEOMETRY.padLeft - LINE_CHART_GEOMETRY.padRight
  const j = Math.round(((svgX - LINE_CHART_GEOMETRY.padLeft) / plotW) * (pointCount - 1))
  return Math.max(0, Math.min(pointCount - 1, j))
}

/** SVG-space x of a day's center point. */
export function dayCenterX(dayIndex: number, pointCount: number): number {
  if (pointCount <= 1) return LINE_CHART_GEOMETRY.padLeft + (LINE_CHART_GEOMETRY.viewBoxWidth - LINE_CHART_GEOMETRY.padLeft - LINE_CHART_GEOMETRY.padRight) / 2
  const plotW =
    LINE_CHART_GEOMETRY.viewBoxWidth - LINE_CHART_GEOMETRY.padLeft - LINE_CHART_GEOMETRY.padRight
  return LINE_CHART_GEOMETRY.padLeft + (dayIndex / (pointCount - 1)) * plotW
}

/** One plotted point in SVG-space pixel coordinates. */
export interface CurvePoint {
  x: number
  y: number
}

export interface SmoothLineOptions {
  days: readonly string[]
  series: readonly LineSeries[]
  width?: number
  height?: number
}

/**
 * Monotone cubic (Fritsch–Carlson) tangents for the point list. The curve
 * passes through every daily value and never overshoots a local peak, so a
 * sparse usage history reads as smooth waves instead of jagged spikes.
 */
function monotoneTangents(points: readonly { x: number; y: number }[]): number[] {
  const count = points.length
  const slopes: number[] = []
  for (let j = 0; j + 1 < count; j++) {
    const p0 = points[j]
    const p1 = points[j + 1]
    if (p0 === undefined || p1 === undefined) continue
    slopes.push((p1.y - p0.y) / (p1.x - p0.x))
  }
  const m: number[] = new Array<number>(count).fill(0)
  if (count < 2) return m
  m[0] = slopes[0] ?? 0
  m[count - 1] = slopes[count - 2] ?? 0
  for (let j = 1; j + 1 < count; j++) {
    const left = slopes[j - 1] ?? 0
    const right = slopes[j] ?? 0
    m[j] = left * right <= 0 ? 0 : (left + right) / 2
  }
  for (let j = 0; j + 1 < count; j++) {
    const d = slopes[j] ?? 0
    if (d === 0) {
      m[j] = 0
      m[j + 1] = 0
      continue
    }
    const a = (m[j] ?? 0) / d
    const b = (m[j + 1] ?? 0) / d
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[j] = tau * a * d
      m[j + 1] = tau * b * d
    }
  }
  return m
}

/** Smooth monotone-cubic path through `points`, closed down to `baseline` —
 * the exact string the line chart renders, exported so the client can rebuild
 * intermediate frames while morphing between two data windows. */
export function smoothPath(points: readonly CurvePoint[], baseline: number): string {
  const count = points.length
  const first = points[0]
  if (count < 2 || first === undefined) return ''
  const m = monotoneTangents(points)
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`
  for (let j = 0; j + 1 < count; j++) {
    const p0 = points[j]
    const p1 = points[j + 1]
    if (p0 === undefined || p1 === undefined) continue
    const h = (p1.x - p0.x) / 3
    d +=
      ` C ${(p0.x + h).toFixed(1)},${(p0.y + (m[j] ?? 0) * h).toFixed(1)}` +
      ` ${(p1.x - h).toFixed(1)},${(p1.y - (m[j + 1] ?? 0) * h).toFixed(1)}` +
      ` ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
  }
  const last = points[count - 1]
  if (last === undefined) return d
  return `${d} L ${last.x.toFixed(1)},${baseline.toFixed(1)} L ${first.x.toFixed(1)},${baseline.toFixed(1)} Z`
}

/**
 * Anchor points of a curve previously emitted by smoothPath: the M point
 * plus the endpoint of every C segment (control points and the baseline
 * corners are not anchors). The client morph reads a chart's on-screen
 * shape by parsing these back out of the live SVG before a re-render.
 */
export function parseLinePathPoints(d: string): CurvePoint[] {
  const pairs = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
  // M + 3 pairs per C segment + 2 baseline corners = 3n pairs for n anchors.
  if (pairs.length === 0 || pairs.length % 3 !== 0) return []
  const points: CurvePoint[] = []
  for (let k = 0; k * 3 < pairs.length; k++) {
    const match = pairs[k * 3]
    if (match === undefined) break
    points.push({ x: Number.parseFloat(match[1] ?? '0'), y: Number.parseFloat(match[2] ?? '0') })
  }
  return points
}

/** Piecewise-linear y of a parsed curve at svg-space x, clamped at the ends. */
export function sampleCurveY(points: readonly CurvePoint[], x: number): number {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return 0
  if (x <= first.x) return first.y
  if (x >= last.x) return last.y
  for (let j = 0; j + 1 < points.length; j++) {
    const a = points[j]
    const b = points[j + 1]
    if (a === undefined || b === undefined) continue
    if (x >= a.x && x <= b.x) {
      const f = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.y + (b.y - a.y) * f
    }
  }
  return last.y
}

/** Inverse of formatTokens for values already written into axis labels:
 * '1.50M' → 1.5e6, '500.0K' → 5e5, '0' → 0. */
export function parseFormattedTokens(text: string): number {
  const match = /^(-?\d+(?:\.\d+)?)\s*([KMB])?$/.exec(text.trim())
  if (match === null) return 0
  const n = Number.parseFloat(match[1] ?? '0')
  const scale = match[2] === 'K' ? 1e3 : match[2] === 'M' ? 1e6 : match[2] === 'B' ? 1e9 : 1
  return n * scale
}

/**
 * Smooth multi-series curve chart of `series[i].values[j]` for `days[j]` —
 * one monotone-smooth curve per model with a faint under-fill and a dot on
 * every day that saw usage (today emphasized).
 */
export function renderSmoothLineSVG(options: SmoothLineOptions): string {
  const width = options.width ?? LINE_CHART_GEOMETRY.viewBoxWidth
  const height = options.height ?? LINE_CHART_GEOMETRY.viewBoxHeight
  const padLeft = LINE_CHART_GEOMETRY.padLeft
  const padRight = LINE_CHART_GEOMETRY.padRight
  const padTop = LINE_CHART_GEOMETRY.padTop
  const padBottom = LINE_CHART_GEOMETRY.padBottom
  const plotW = Math.max(10, width - padLeft - padRight)
  const plotH = Math.max(10, height - padTop - padBottom)
  const days = options.days
  const series = options.series
  const n = days.length

  const pointCount = Math.min(...[days.length, ...series.map(s => s.values.length)])
  const dayTotal: number[] = []
  for (let j = 0; j < pointCount; j++) {
    let sum = 0
    for (const s of series) sum += s.values[j] ?? 0
    dayTotal.push(sum)
  }
  const yMax = niceCeil(Math.max(...dayTotal, 0) * 1.08)

  const xAt = (j: number): number =>
    pointCount <= 1 ? padLeft + plotW / 2 : padLeft + (j / (pointCount - 1)) * plotW
  const yAt = (v: number): number => padTop + plotH * (1 - v / yMax)
  const baseline = yAt(0)

  const parts: string[] = []
  parts.push(
    `<svg class="td-linesvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `role="img" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14">`,
  )

  // Gridlines + y labels.
  const gridLines = 4
  for (let g = 0; g <= gridLines; g++) {
    const value = (yMax / gridLines) * g
    const y = yAt(value)
    parts.push(
      `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" ` +
        `stroke="${g === 0 ? '#3a4152' : '#232833'}" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${padLeft - 8}" y="${(y + 4.5).toFixed(1)}" fill="#8b93a7" text-anchor="end">` +
        `${escapeXml(formatTokens(value))}</text>`,
    )
  }

  // X labels: ~6 ticks plus the last day.
  if (n > 0) {
    const step = Math.max(1, Math.ceil(n / 6))
    const labelled = new Set<number>()
    for (let j = 0; j < n; j += step) labelled.add(j)
    labelled.add(n - 1)
    for (const j of labelled) {
      parts.push(
        `<text x="${xAt(j).toFixed(1)}" y="${height - 8}" fill="#8b93a7" text-anchor="middle">` +
          `${escapeXml(days[j]?.slice(5) ?? '')}</text>`,
      )
    }
  }

  // Per-series: faint under-fill path, stroked curve, usage dots. The group
  // wrapper lets the client morph each curve by label when the window changes.
  for (let i = 0; i < series.length; i++) {
    const s = series[i]
    if (s === undefined) continue
    const color = colorFor(i)
    parts.push(`<g class="td-line-series" data-series="${escapeXml(s.label)}">`)
    const points = s.values.slice(0, pointCount).map((v, j) => ({ x: xAt(j), y: yAt(v) }))
    const d = smoothPath(points, baseline)
    if (d !== '') {
      parts.push(`<path d="${d}" fill="${color}" fill-opacity="0.12" stroke="none"/>`)
      parts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    }
    for (let j = 0; j < pointCount; j++) {
      const v = s.values[j] ?? 0
      if (v <= 0) continue
      const isToday = j === pointCount - 1
      // No <title> here: the client renders its own tooltip, and the native
      // one is a themed box that pops up late and clashes with the page.
      parts.push(
        `<circle cx="${xAt(j).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${isToday ? 3 : 2}" ` +
          `fill="${color}" stroke="#0f1115" stroke-width="${isToday ? 1.5 : 0.75}"/>`,
      )
    }
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('')
}

export interface PieItem {
  label: string
  value: number
}

export interface DonutOptions {
  items: readonly PieItem[]
  size?: number
  thickness?: number
  /** Value formatter for titles, tooltips and the center total (default formatTokens). */
  formatValue?: (value: number) => string
  /** Unit label under the center total (default "tokens"). */
  unit?: string
}

/** Renderer defaults the client morph mirrors when rebuilding slice arcs. */
export const DONUT_DEFAULT_SIZE = 200
export const DONUT_DEFAULT_THICKNESS = 26

/** One donut slice as an SVG annular-sector path; sweep ≤ 0 yields ''. */
export function donutSlicePathD(
  cx: number,
  cy: number,
  radius: number,
  inner: number,
  a0: number,
  a1: number,
): string {
  const sweep = a1 - a0
  if (!(sweep > 0)) return ''
  // A full-circle arc (single-slice donut) degenerates in SVG when both
  // endpoints coincide; leave a hair-thin gap so the ring still renders.
  const clampedSweep = Math.min(sweep, Math.PI * 2 - 1e-4)
  const a1c = a0 + clampedSweep
  const largeArc = clampedSweep > Math.PI ? 1 : 0
  const x0 = cx + radius * Math.cos(a0)
  const y0 = cy + radius * Math.sin(a0)
  const x1 = cx + radius * Math.cos(a1c)
  const y1 = cy + radius * Math.sin(a1c)
  const xi1 = cx + inner * Math.cos(a1c)
  const yi1 = cy + inner * Math.sin(a1c)
  const xi0 = cx + inner * Math.cos(a0)
  const yi0 = cy + inner * Math.sin(a0)
  return (
    `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ` +
    `${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} ` +
    `A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 ${largeArc} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z`
  )
}

/**
 * Donut chart (no legend; the caller renders one with matching colors).
 * Zero or all-zero inputs render a placeholder ring. Each slice carries
 * data-label/data-value/data-pct/data-index so a client-side tooltip can
 * describe it on hover, matching the curve chart's tooltip style.
 */
/** Hover rule carried inside the donut SVG so the effect works anywhere the
 * fragment is mounted: the hovered slice scales out slightly from the center. */
const DONUT_HOVER_STYLE =
  '.td-slice path { transition: transform 0.15s ease; }' +
  '.td-slice:hover path { transform: scale(1.05); }'

export function renderDonutSVG(options: DonutOptions): string {
  const size = options.size ?? DONUT_DEFAULT_SIZE
  const thickness = options.thickness ?? DONUT_DEFAULT_THICKNESS
  const format = options.formatValue ?? formatTokens
  const unit = options.unit ?? 'tokens'
  const cx = size / 2
  const cy = size / 2
  const radius = (size - thickness * 2) / 2
  const inner = radius - thickness
  const total = options.items.reduce((sum, item) => sum + (item.value > 0 ? item.value : 0), 0)

  const parts: string[] = []
  // class/data-unit/data-total: stable hooks for the client-side morph.
  parts.push(
    `<svg class="td-donut" data-unit="${escapeXml(unit)}" xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${size} ${size}" role="img" ` +
      `font-family="ui-monospace, SFMono-Regular, Menlo, monospace">` +
      `<style>${DONUT_HOVER_STYLE}</style>`,
  )
  if (total <= 0) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#232833" stroke-width="${thickness}"/>` +
        `<text x="${cx}" y="${cy + 4}" fill="#8b93a7" text-anchor="middle" font-size="12">暂无数据</text>`,
    )
    parts.push('</svg>')
    return parts.join('')
  }

  let angle = -Math.PI / 2
  options.items.forEach((item, index) => {
    const value = item.value > 0 ? item.value : 0
    if (value === 0) return
    const a0 = angle
    const a1 = angle + (value / total) * Math.PI * 2
    angle = a1
    const percent = ((value / total) * 100).toFixed(1)
    parts.push(
      `<g class="td-slice" data-label="${escapeXml(item.label)}" ` +
        `data-value="${escapeXml(format(value))}" data-pct="${percent}" data-index="${index}">` +
        `<path d="${donutSlicePathD(cx, cy, radius, inner, a0, a1)}" ` +
        `fill="${colorFor(index)}" fill-opacity="0.9" ` +
        `style="transform-origin:${cx}px ${cy}px"/>` +
        `</g>`,
    )
  })
  parts.push(
    `<text class="td-donut-total" data-total="${total}" x="${cx}" y="${cy - 2}" fill="#e6e9f0" ` +
      `text-anchor="middle" font-size="13" font-weight="600">${escapeXml(format(total))}</text>`,
  )
  parts.push(
    `<text x="${cx}" y="${cy + 14}" fill="#8b93a7" text-anchor="middle" font-size="10">${escapeXml(unit)}</text>`,
  )
  parts.push('</svg>')
  return parts.join('')
}

/** Cell colors by activity level: 0 = idle, 4 = busiest (quartile buckets). */
const HEAT_COLORS: readonly string[] = ['#232833', '#7db9f2', '#4f95e8', '#3672d4', '#2554b8']

export interface HeatmapOptions {
  /** Week-aligned cells; null pads the leading edge (and renders nothing). */
  cells: readonly (HeatmapCell | null)[]
  /** Rows per column: 7 for the daily calendar, 1 for the weekly strip. */
  rows?: number
}

/**
 * GitHub-style activity grid: rounded cells colored by quartile of the
 * non-zero values, month labels under the columns where each month starts.
 * Cells carry data-date/data-tokens/data-requests for the client tooltip.
 */
export function renderHeatmapSVG(options: HeatmapOptions): string {
  const rows = options.rows ?? 7
  const cell = 11
  const gap = 3
  const stride = cell + gap
  const cells = options.cells
  const cols = Math.max(1, Math.ceil(cells.length / rows))

  const nonZero = cells
    .filter(entry => entry !== null && entry.tokens > 0)
    .map(entry => (entry as HeatmapCell).tokens)
    .sort((a, b) => a - b)
  const quantile = (p: number): number => {
    if (nonZero.length === 0) return 0
    const index = Math.min(nonZero.length - 1, Math.floor(p * (nonZero.length - 1)))
    return nonZero[index] ?? 0
  }
  const q1 = quantile(0.25)
  const q2 = quantile(0.5)
  const q3 = quantile(0.75)
  const levelOf = (tokens: number): number => {
    if (tokens <= 0) return 0
    if (tokens <= q1) return 1
    if (tokens <= q2) return 2
    if (tokens <= q3) return 3
    return 4
  }

  const parts: string[] = []
  parts.push(
    `<svg class="td-heatsvg" xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${cols * stride} ${rows * stride + 20}" role="img" font-size="11">` +
      `<style>.td-hcell:hover { stroke: #e6e9f0; stroke-width: 1; }</style>`,
  )
  cells.forEach((entry, index) => {
    if (entry === null) return
    const col = Math.floor(index / rows)
    const row = index % rows
    parts.push(
      `<rect class="td-hcell" x="${col * stride}" y="${row * stride}" ` +
        `width="${cell}" height="${cell}" rx="2.5" ` +
        `fill="${HEAT_COLORS[levelOf(entry.tokens)]}" ` +
        `data-date="${escapeXml(entry.date)}" data-tokens="${entry.tokens}" ` +
        `data-requests="${entry.requests}"/>`,
    )
  })
  // Month label under each column where a new month begins; skip labels that
  // would collide with the previous one (months starting mid-gap, GitHub-style).
  let lastMonth = ''
  let lastLabelX = Number.NEGATIVE_INFINITY
  for (let col = 0; col < cols; col++) {
    let month = ''
    for (let row = 0; row < rows; row++) {
      const entry = cells[col * rows + row]
      if (entry !== null && entry !== undefined) {
        month = entry.date.slice(5, 7)
        break
      }
    }
    if (month === '' || month === lastMonth) continue
    lastMonth = month
    const x = col * stride
    if (x - lastLabelX >= 28) {
      lastLabelX = x
      parts.push(
        `<text x="${x}" y="${rows * stride + 16}" fill="#8b93a7" ` +
          `text-anchor="start">${Number.parseInt(month, 10)}月</text>`,
      )
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
