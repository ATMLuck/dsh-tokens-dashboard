/**
 * Client-side chart morphing. When the dashboard charts fragment is swapped
 * (window switch, or a live refresh that changed the numbers), the new SVGs
 * animate from the previous on-screen shape instead of hard-cutting: curve
 * points tween in y, donut slices tween their sweep, the y-axis scale counts
 * between old and new values, and dots/x-labels fade in at the end.
 *
 * The "from" state is parsed out of the live SVG right before React commits
 * the replacement; the "to" state is the committed markup itself, so this
 * module only relies on the renderer's stable output hooks: `.td-linesvg`
 * with `g.td-line-series[data-series]` per curve and `text[text-anchor="end"]`
 * for y-axis values, plus `svg.td-donut[data-unit]` carrying
 * `g.td-slice[data-label][data-pct]` and `.td-donut-total[data-total]`.
 */
import {
  donutSlicePathD,
  formatTokens,
  formatUsd,
  LINE_CHART_GEOMETRY,
  parseFormattedTokens,
  parseLinePathPoints,
  sampleCurveY,
  smoothPath,
  DONUT_DEFAULT_SIZE,
  DONUT_DEFAULT_THICKNESS,
} from './charts.ts'
import type { CurvePoint } from './charts.ts'

const MORPH_MS = 450
const FADE_MS = 350
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 2 / 2

/** What the charts fragment looked like before the swap (null = first paint). */
export interface ChartsSnapshot {
  /** Series label → parsed curve anchors of the on-screen path. */
  line: Map<string, CurvePoint[]>
  /** Parsed y-axis grid values, top-to-bottom. */
  yLabels: number[]
  /** Per donut (DOM order): label → rendered percentage, and the total. */
  donuts: { pcts: Map<string, number>; total: number }[]
}

/** Parse the fragment's current SVG state; null when there is nothing on screen. */
export function snapshotChartsFragment(frag: Element): ChartsSnapshot | null {
  const lineSvg = frag.querySelector('.td-linesvg')
  const donutSvgs = Array.from(frag.querySelectorAll('svg.td-donut'))
  if (lineSvg === null && donutSvgs.length === 0) return null

  const line = new Map<string, CurvePoint[]>()
  const yLabels: number[] = []
  if (lineSvg !== null) {
    for (const group of Array.from(lineSvg.querySelectorAll('g.td-line-series'))) {
      const label = group.getAttribute('data-series')
      const d = group.querySelector('path')?.getAttribute('d') ?? null
      if (label === null || d === null) continue
      const points = parseLinePathPoints(d)
      if (points.length >= 2) line.set(label, points)
    }
    for (const text of Array.from(lineSvg.querySelectorAll('text[text-anchor="end"]'))) {
      yLabels.push(parseFormattedTokens(text.textContent ?? ''))
    }
  }
  const donuts = donutSvgs.map(svg => {
    const pcts = new Map<string, number>()
    for (const slice of Array.from(svg.querySelectorAll('g.td-slice'))) {
      const label = slice.getAttribute('data-label')
      const pct = Number.parseFloat(slice.getAttribute('data-pct') ?? '')
      if (label !== null && Number.isFinite(pct)) pcts.set(label, pct)
    }
    const total = Number.parseFloat(
      svg.querySelector('.td-donut-total')?.getAttribute('data-total') ?? '',
    )
    return { pcts, total: Number.isFinite(total) ? total : 0 }
  })
  return { line, yLabels, donuts }
}

interface LineMorph {
  paths: SVGPathElement[]
  from: CurvePoint[]
  to: CurvePoint[]
  finalD: string
}
interface TextMorph {
  el: SVGTextElement
  from: number
  to: number
  final: string
  format: (value: number) => string
}
interface SliceMorph {
  path: SVGPathElement
  from: number
  to: number
  finalD: string
}
interface DonutMorph {
  cx: number
  cy: number
  radius: number
  inner: number
  slices: SliceMorph[]
  total: TextMorph | null
}

const changed = (from: number, to: number, eps: number): boolean => Math.abs(to - from) > eps

/**
 * Mutate the freshly-committed fragment so it starts in the snapshot's shape,
 * then tween every piece to its final state. Returns a cancel function; when
 * the tween completes (or is cancelled) the DOM is exactly what the renderer
 * produced, so an interrupted morph can never leave artifacts behind.
 */
export function startChartsMorph(frag: HTMLElement, snapshot: ChartsSnapshot | null): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  const baseline =
    LINE_CHART_GEOMETRY.padTop +
    (LINE_CHART_GEOMETRY.viewBoxHeight - LINE_CHART_GEOMETRY.padTop - LINE_CHART_GEOMETRY.padBottom)

  const lines: LineMorph[] = []
  const texts: TextMorph[] = []
  const donuts: DonutMorph[] = []
  const fadeEls: SVGElement[] = []

  const lineSvg = frag.querySelector('.td-linesvg')
  if (lineSvg !== null) {
    for (const group of Array.from(lineSvg.querySelectorAll('g.td-line-series'))) {
      const paths = Array.from(group.querySelectorAll('path')) as SVGPathElement[]
      const finalD = paths[0]?.getAttribute('d') ?? null
      const to = finalD === null ? [] : parseLinePathPoints(finalD)
      if (finalD === null || to.length < 2) continue
      // A series the old window lacked grows out of the baseline; one the old
      // window had resumes from its resampled on-screen shape.
      const oldPoints = snapshot?.line.get(group.getAttribute('data-series') ?? '') ?? null
      const from =
        oldPoints !== null
          ? to.map(p => ({ x: p.x, y: sampleCurveY(oldPoints, p.x) }))
          : to.map(p => ({ x: p.x, y: baseline }))
      lines.push({ paths, from, to, finalD })
    }
    Array.from(lineSvg.querySelectorAll('text[text-anchor="end"]')).forEach((text, index) => {
      const final = text.textContent ?? '0'
      texts.push({
        el: text as SVGTextElement,
        from: snapshot?.yLabels[index] ?? 0,
        to: parseFormattedTokens(final),
        final,
        format: formatTokens,
      })
    })
    for (const el of Array.from(lineSvg.querySelectorAll('circle, text[text-anchor="middle"]'))) {
      fadeEls.push(el as SVGElement)
    }
  }

  Array.from(frag.querySelectorAll('svg.td-donut')).forEach((svg, donutIndex) => {
    const old = snapshot?.donuts[donutIndex] ?? null
    const size = Number.parseFloat((svg.getAttribute('viewBox') ?? '').split(/\s+/)[2] ?? '')
    const donutSize = Number.isFinite(size) && size > 0 ? size : DONUT_DEFAULT_SIZE
    const slices: SliceMorph[] = []
    for (const slice of Array.from(svg.querySelectorAll('g.td-slice'))) {
      const path = slice.querySelector('path')
      const finalD = path?.getAttribute('d') ?? null
      const toPct = Number.parseFloat(slice.getAttribute('data-pct') ?? '')
      if (path === null || finalD === null || !Number.isFinite(toPct)) continue
      slices.push({
        path: path as SVGPathElement,
        from: old?.pcts.get(slice.getAttribute('data-label') ?? '') ?? 0,
        to: toPct,
        finalD,
      })
    }
    if (slices.length === 0) return
    const totalEl = svg.querySelector('.td-donut-total')
    let total: TextMorph | null = null
    if (totalEl !== null) {
      const toTotal = Number.parseFloat(totalEl.getAttribute('data-total') ?? '')
      total = {
        el: totalEl as SVGTextElement,
        from: old?.total ?? 0,
        to: Number.isFinite(toTotal) ? toTotal : 0,
        final: totalEl.textContent ?? '',
        format: svg.getAttribute('data-unit') === '费用' ? formatUsd : formatTokens,
      }
    }
    donuts.push({
      cx: donutSize / 2,
      cy: donutSize / 2,
      radius: (donutSize - DONUT_DEFAULT_THICKNESS * 2) / 2,
      inner: (donutSize - DONUT_DEFAULT_THICKNESS * 2) / 2 - DONUT_DEFAULT_THICKNESS,
      slices,
      total,
    })
  })

  const anyChanged =
    lines.some(item => item.to.some((p, i) => changed(item.from[i]?.y ?? baseline, p.y, 0.5))) ||
    texts.some(item => changed(item.from, item.to, 0.5)) ||
    donuts.some(
      donut =>
        donut.slices.some(slice => changed(slice.from, slice.to, 0.05)) ||
        (donut.total !== null && changed(donut.total.from, donut.total.to, 0.5)),
    )
  if (!anyChanged) return () => {}

  const apply = (e: number): void => {
    for (const item of lines) {
      const points = item.to.map((p, i) => {
        const y0 = item.from[i]?.y ?? baseline
        return { x: p.x, y: y0 + (p.y - y0) * e }
      })
      const d = smoothPath(points, baseline)
      for (const path of item.paths) path.setAttribute('d', d)
    }
    for (const item of texts) {
      item.el.textContent = item.format(item.from + (item.to - item.from) * e)
    }
    for (const donut of donuts) {
      let angle = -Math.PI / 2
      for (const slice of donut.slices) {
        const pct = slice.from + (slice.to - slice.from) * e
        const sweep = (pct / 100) * Math.PI * 2
        slice.path.setAttribute(
          'd',
          donutSlicePathD(donut.cx, donut.cy, donut.radius, donut.inner, angle, angle + sweep),
        )
        angle += sweep
      }
      if (donut.total !== null) {
        donut.total.el.textContent = donut.total.format(
          donut.total.from + (donut.total.to - donut.total.from) * e,
        )
      }
    }
  }

  const finish = (): void => {
    for (const item of lines) for (const path of item.paths) path.setAttribute('d', item.finalD)
    for (const item of texts) item.el.textContent = item.final
    for (const donut of donuts) {
      for (const slice of donut.slices) slice.path.setAttribute('d', slice.finalD)
      if (donut.total !== null) donut.total.el.textContent = donut.total.final
    }
    for (const el of fadeEls) {
      el.style.transition = `opacity ${FADE_MS}ms ease`
      el.style.opacity = '1'
    }
  }

  // Start frame: applied in the same tick as the commit so the browser paints
  // the "from" shape, never the final one; dots and x labels hide meanwhile.
  apply(0)
  for (const el of fadeEls) el.style.opacity = '0'

  let raf = 0
  let cancelled = false
  let done = false
  const start = performance.now()
  const complete = (): void => {
    if (done) return
    done = true
    finish()
  }
  const step = (now: number): void => {
    if (cancelled) return
    const t = Math.min(1, (now - start) / MORPH_MS)
    if (t < 1) {
      apply(easeInOutCubic(t))
      raf = requestAnimationFrame(step)
      return
    }
    complete()
  }
  raf = requestAnimationFrame(step)
  // Occluded windows suspend rAF; the safety timer guarantees the DOM lands
  // on the renderer's exact output instead of idling in a mid-morph state.
  const safety = window.setTimeout(complete, MORPH_MS + 150)
  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
    window.clearTimeout(safety)
    complete()
  }
}
