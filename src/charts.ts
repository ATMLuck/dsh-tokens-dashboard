/**
 * Zero-dependency SVG chart builders. Everything is a pure string function:
 * no DOM, no files, no external chart library.
 */

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

function smoothPath(points: readonly { x: number; y: number }[], baseline: number): string {
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
 * Smooth multi-series curve chart of `series[i].values[j]` for `days[j]` —
 * one monotone-smooth curve per model with a faint under-fill and a dot on
 * every day that saw usage (today emphasized).
 */
export function renderSmoothLineSVG(options: SmoothLineOptions): string {
  const width = options.width ?? 860
  const height = options.height ?? 320
  const padLeft = 64
  const padRight = 16
  const padTop = 16
  const padBottom = 28
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `role="img" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">`,
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
      `<text x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" fill="#8b93a7" text-anchor="end">` +
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

  // Per-series: faint under-fill path, stroked curve, usage dots.
  for (let i = 0; i < series.length; i++) {
    const s = series[i]
    if (s === undefined) continue
    const color = colorFor(i)
    const points = s.values.slice(0, pointCount).map((v, j) => ({ x: xAt(j), y: yAt(v) }))
    const d = smoothPath(points, baseline)
    if (d !== '') {
      parts.push(`<path d="${d}" fill="${color}" fill-opacity="0.12" stroke="none"/>`)
      parts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ` +
          `stroke-linecap="round" stroke-linejoin="round"><title>${escapeXml(s.label)}</title></path>`,
      )
    }
    for (let j = 0; j < pointCount; j++) {
      const v = s.values[j] ?? 0
      if (v <= 0) continue
      const isToday = j === pointCount - 1
      parts.push(
        `<circle cx="${xAt(j).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${isToday ? 3 : 2}" ` +
          `fill="${color}" stroke="#0f1115" stroke-width="${isToday ? 1.5 : 0.75}">` +
          `<title>${escapeXml(s.label)} · ${escapeXml(days[j] ?? '')}: ${escapeXml(formatTokens(v))}</title></circle>`,
      )
    }
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
}

/**
 * Donut chart (no legend; the caller renders one with matching colors).
 * Zero or all-zero inputs render a placeholder ring.
 */
export function renderDonutSVG(options: DonutOptions): string {
  const size = options.size ?? 200
  const thickness = options.thickness ?? 26
  const cx = size / 2
  const cy = size / 2
  const radius = (size - thickness * 2) / 2
  const inner = radius - thickness
  const total = options.items.reduce((sum, item) => sum + (item.value > 0 ? item.value : 0), 0)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" ` +
      `font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
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
    const sweep = (value / total) * Math.PI * 2
    const a0 = angle
    const a1 = angle + sweep
    angle = a1
    const largeArc = sweep > Math.PI ? 1 : 0
    const x0 = cx + radius * Math.cos(a0)
    const y0 = cy + radius * Math.sin(a0)
    const x1 = cx + radius * Math.cos(a1)
    const y1 = cy + radius * Math.sin(a1)
    const xi1 = cx + inner * Math.cos(a1)
    const yi1 = cy + inner * Math.sin(a1)
    const xi0 = cx + inner * Math.cos(a0)
    const yi0 = cy + inner * Math.sin(a0)
    const percent = ((value / total) * 100).toFixed(1)
    parts.push(
      `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ` +
        `${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} ` +
        `A ${inner} ${inner} 0 ${largeArc} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" ` +
        `fill="${colorFor(index)}" fill-opacity="0.9">` +
        `<title>${escapeXml(item.label)}: ${escapeXml(formatTokens(value))}（${percent}%）</title></path>`,
    )
  })
  parts.push(
    `<text x="${cx}" y="${cy - 2}" fill="#e6e9f0" text-anchor="middle" font-size="13" ` +
      `font-weight="600">${escapeXml(formatTokens(total))}</text>`,
  )
  parts.push(
    `<text x="${cx}" y="${cy + 14}" fill="#8b93a7" text-anchor="middle" font-size="10">tokens</text>`,
  )
  parts.push('</svg>')
  return parts.join('')
}
