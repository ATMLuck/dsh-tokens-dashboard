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

export interface StackedSeries {
  label: string
  values: readonly number[]
}

export interface DailyBarsOptions {
  days: readonly string[]
  series: readonly StackedSeries[]
  width?: number
  height?: number
}

/**
 * Stacked daily bar chart of `series[i].values[j]` for `days[j]`, stacked in
 * the given order (bottom-up). Daily usage is discrete, so each day renders
 * one column — zero days leave a gap instead of the misleading spikes a
 * zero-filled area chart produces on sparse data.
 */
export function renderDailyBarsSVG(options: DailyBarsOptions): string {
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

  const stackCount = Math.min(...[days.length, ...series.map(s => s.values.length)])
  const dayTotal: number[] = []
  for (let j = 0; j < stackCount; j++) {
    let sum = 0
    for (const s of series) sum += s.values[j] ?? 0
    dayTotal.push(sum)
  }
  const yMax = niceCeil(Math.max(...dayTotal, 0) * 1.08)

  const band = plotW / Math.max(1, n)
  const barW = Math.max(2, Math.min(band * 0.62, 48))
  const xAt = (j: number): number => padLeft + band * j + band / 2
  const yAt = (v: number): number => padTop + plotH * (1 - v / yMax)

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

  // One column per day, stacked bottom-up per series. Tiny but non-zero
  // segments clamp to a 1px sliver so they stay hoverable.
  for (let j = 0; j < stackCount; j++) {
    const isToday = j === stackCount - 1
    let cumulative = 0
    for (let i = 0; i < series.length; i++) {
      const s = series[i]
      if (s === undefined) continue
      const v = s.values[j] ?? 0
      if (v <= 0) continue
      const yBottom = yAt(cumulative)
      cumulative += v
      const yTop = yAt(cumulative)
      const color = colorFor(i)
      parts.push(
        `<rect x="${(xAt(j) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" ` +
          `height="${Math.max(1, yBottom - yTop).toFixed(1)}" fill="${color}" fill-opacity="0.9"` +
          `${isToday ? ` stroke="#e6e9f0" stroke-opacity="0.45"` : ''}>` +
          `<title>${escapeXml(s.label)} · ${escapeXml(days[j] ?? '')}: ${escapeXml(formatTokens(v))}</title></rect>`,
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
