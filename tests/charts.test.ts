import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorFor,
  dayCenterX,
  dayIndexFromSvgX,
  donutSlicePathD,
  formatInt,
  formatTokens,
  formatUsd,
  formatWan,
  parseFormattedTokens,
  parseLinePathPoints,
  renderDonutSVG,
  renderHeatmapSVG,
  renderSmoothLineSVG,
  sampleCurveY,
  smoothPath,
} from '../src/charts.ts'
import { DASHBOARD_STYLE, renderDashboardCharts, renderDashboardHead } from '../src/dashboard.ts'
import { buildDashboardData } from '../src/aggregate.ts'

const NOON = new Date(2026, 9, 27, 12, 0, 0, 0).getTime()

test('number formatters stay human readable', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(1234), '1.2K')
  assert.equal(formatTokens(4_500_000), '4.50M')
  assert.equal(formatTokens(2_300_000_000), '2.30B')
  assert.equal(formatUsd(0), '$0')
  assert.equal(formatUsd(0.5), '$0.5000')
  assert.equal(formatUsd(12.345), '$12.35')
  assert.equal(formatInt(1234567), '1,234,567')
})

test('colorFor cycles the palette deterministically', () => {
  assert.equal(colorFor(0), colorFor(10))
  assert.notEqual(colorFor(0), colorFor(1))
})

test('smooth curve chart renders one monotone curve per series', () => {
  const svg = renderSmoothLineSVG({
    days: ['2026-10-25', '2026-10-26', '2026-10-27'],
    series: [
      { label: 'a', values: [1, 2, 3] },
      { label: 'b', values: [0, 1, 0] },
    ],
  })
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.endsWith('</svg>'))
  // Per series: one faint under-fill path + one stroked curve.
  assert.equal((svg.match(/fill-opacity="0.12"/g) ?? []).length, 2)
  assert.equal((svg.match(/fill="none" stroke="/g) ?? []).length, 2)
  // Cubic segments — the curve is actually smooth, not a polyline.
  assert.ok(svg.includes(' C '))
  // Usage dots on non-zero days only: a has 3, b has 1; today emphasized.
  assert.equal((svg.match(/<circle /g) ?? []).length, 4)
  assert.ok(svg.includes('r="3"'))
  assert.ok(svg.includes('10-27'))
  // Larger axis labels; no native <title> tooltips (the client draws its own).
  assert.ok(svg.includes('font-size="14"'))
  assert.ok(!svg.includes('<title'))
})

test('single-point windows render a lone emphasized dot', () => {
  const svg = renderSmoothLineSVG({
    days: ['2026-10-27'],
    series: [{ label: 'a', values: [5] }],
  })
  // A single point has no curve; the dot carries the value.
  assert.ok(!svg.includes('<path d="'))
  assert.equal((svg.match(/<circle /g) ?? []).length, 1)
  assert.ok(svg.includes('r="3"'))
})

test('donut slices carry hover enlarge rules and tooltip data attributes', () => {
  const donut = renderDonutSVG({
    items: [
      { label: 'a', value: 3 },
      { label: 'b', value: 1 },
    ],
  })
  // One hover group per slice, each scaling from the donut center.
  assert.equal((donut.match(/class="td-slice"/g) ?? []).length, 2)
  assert.ok(donut.includes('transform-origin:100px 100px'))
  assert.ok(donut.includes('.td-slice:hover path { transform: scale(1.05); }'))
  // No in-SVG percentage label; the client tooltip reads data-* instead.
  assert.ok(!donut.includes('td-slice-pct'))
  // No native <title> tooltip either — same themed-box problem as the curve.
  assert.ok(!donut.includes('<title'))
  assert.ok(donut.includes('data-label="a"'))
  assert.ok(donut.includes('data-value="3"'))
  assert.ok(donut.includes('data-pct="75.0"'))
  assert.ok(donut.includes('data-pct="25.0"'))
  assert.ok(donut.includes('data-index="0"'))
  assert.ok(donut.includes('data-index="1"'))
})

test('donut supports a custom value format and unit label', () => {
  const donut = renderDonutSVG({
    items: [
      { label: 'a', value: 3 },
      { label: 'b', value: 1 },
    ],
    formatValue: formatUsd,
    unit: '费用',
  })
  assert.ok(donut.includes('>$4.00</text>'))
  assert.ok(donut.includes('data-value="$3.00"'))
  assert.ok(donut.includes('>费用</text>'))
})

test('cursor mapping helpers round-trip day indices', () => {
  // Below/at the left pad clamps to day 0; beyond the right pad to the last.
  assert.equal(dayIndexFromSvgX(-50, 30), 0)
  assert.equal(dayIndexFromSvgX(64, 30), 0)
  assert.equal(dayIndexFromSvgX(844, 30), 29)
  assert.equal(dayIndexFromSvgX(9999, 30), 29)
  // Plot mid maps to the middle day.
  assert.equal(dayIndexFromSvgX(454, 30), 15)
  // Day centers sit on the plot edges at the extremes.
  assert.equal(dayCenterX(0, 30), 64)
  assert.equal(dayCenterX(29, 30), 844)
  // Single-day windows always resolve to day 0.
  assert.equal(dayIndexFromSvgX(400, 1), 0)
  assert.equal(dayCenterX(0, 1), 454)
})

test('formatWan renders Chinese-scaled token counts', () => {
  assert.equal(formatWan(0), '0')
  assert.equal(formatWan(5000), '5000')
  assert.equal(formatWan(690_000), '69万')
  assert.equal(formatWan(35_228_000), '3522.8万')
  assert.equal(formatWan(152_000_000), '1.5亿')
})

test('heatmap grid aligns weeks, labels months and exposes cell data', () => {
  // 2026-10-26 is a Monday; 45 consecutive days span seven week columns.
  const days = []
  for (let i = 0; i < 45; i++) {
    const d = new Date(2026, 9, 26 + i, 12)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const tokens = key === '2026-10-27' ? 100 : key === '2026-11-03' ? 300 : key === '2026-12-08' ? 900 : 0
    days.push({ date: key, tokens, requests: i === 44 ? 3 : 0 })
  }
  const svg = renderHeatmapSVG({ cells: days, rows: 7 })
  // One rect per cell, seven week columns.
  assert.equal((svg.match(/<rect /g) ?? []).length, 45)
  assert.ok(svg.includes('viewBox="0 0 98 '))
  assert.ok(svg.includes('data-date="2026-10-26"'))
  assert.ok(svg.includes('data-tokens="900"'))
  assert.ok(svg.includes('data-requests="3"'))
  // Zero days use the idle gray; the busiest day uses the deepest blue.
  assert.ok(svg.includes('fill="#232833"'))
  assert.ok(svg.includes('fill="#2554b8"'))
  // 10月 labels the first column; 11月 starts one column later and its label
  // would collide, so it is skipped; 12月 sits far enough out to be labeled.
  assert.ok(svg.includes('>10月</text>'))
  assert.ok(!svg.includes('>11月</text>'))
  assert.ok(svg.includes('>12月</text>'))
  assert.ok(svg.includes('.td-hcell:hover { stroke: #e6e9f0; stroke-width: 1; }'))
  // Leading nulls occupy grid slots without rendering rects.
  const padded = renderHeatmapSVG({ cells: [null, ...days], rows: 7 })
  assert.equal((padded.match(/<rect /g) ?? []).length, 45)
  assert.ok(padded.includes('viewBox="0 0 98 '))
})

test('empty donut renders the placeholder ring', () => {
  const empty = renderDonutSVG({ items: [] })
  assert.ok(empty.includes('暂无数据'))
  const allZero = renderDonutSVG({ items: [{ label: 'a', value: 0 }] })
  assert.ok(allZero.includes('暂无数据'))
  assert.ok(!allZero.includes('class="td-slice"'))
})

test('line path parse/sample helpers round-trip the rendered curve', () => {
  const points = [
    { x: 64, y: 292 },
    { x: 454, y: 150 },
    { x: 844, y: 40 },
  ]
  const parsed = parseLinePathPoints(smoothPath(points, 292))
  assert.equal(parsed.length, 3)
  parsed.forEach((p, i) => {
    const source = points[i]
    assert.ok(source !== undefined)
    assert.ok(Math.abs(p.x - source.x) < 0.11)
    assert.ok(Math.abs(p.y - source.y) < 0.11)
  })
  // Sampling inside a segment interpolates; outside clamps to the ends.
  const mid = sampleCurveY(parsed, 454)
  assert.ok(Math.abs(mid - 150) < 0.2)
  assert.equal(sampleCurveY(parsed, 0), 292)
  assert.equal(sampleCurveY(parsed, 9999), 40)
  // Not a renderer-emitted d string → no anchors to morph from.
  assert.deepEqual(parseLinePathPoints('M 1,2 L 3,4'), [])
})

test('parseFormattedTokens inverts the axis label format', () => {
  assert.equal(parseFormattedTokens('0'), 0)
  assert.equal(parseFormattedTokens('1.2K'), 1200)
  assert.equal(parseFormattedTokens('500.0K'), 500_000)
  assert.equal(parseFormattedTokens('4.50M'), 4_500_000)
  assert.equal(parseFormattedTokens('2.30B'), 2_300_000_000)
  assert.equal(parseFormattedTokens(''), 0)
})

test('donut slice path helper matches the rendered slices', () => {
  const donut = renderDonutSVG({ items: [{ label: 'a', value: 3 }] })
  // A 100% slice spans the whole ring from 12 o'clock (full-circle SVG arcs
  // would degenerate, so the helper clamps a hair-thin gap).
  const d = donutSlicePathD(100, 100, 74, 48, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2)
  assert.ok(d.startsWith('M 100.00 26.00'))
  assert.ok(donut.includes(d))
  assert.ok(donut.includes('data-total="3"'))
  assert.equal(donutSlicePathD(100, 100, 74, 48, 0, 0), '')
})

test('charts expose stable hooks for client-side morphing', () => {
  const record = {
    ts: NOON,
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 300,
    reasoningTokens: 0,
  }
  const html = renderDashboardCharts(
    buildDashboardData([record], { 'deepseek-chat': { input: 1, output: 2 } }, {
      chartDays: 3,
      now: NOON,
    }),
  )
  assert.ok(html.includes('class="td-linesvg"'))
  assert.ok(html.includes('<g class="td-line-series" data-series="deepseek/deepseek-chat">'))
  assert.ok(html.includes('<svg class="td-donut" data-unit="tokens"'))
  assert.ok(html.includes('<svg class="td-donut" data-unit="费用"'))
  assert.ok(html.includes('class="td-donut-total" data-total="2000"'))
})

test('dashboard body embeds scoped styles, charts and the model table', () => {
  const record = {
    ts: NOON,
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 300,
    reasoningTokens: 0,
  }
  const data = buildDashboardData([record], { 'deepseek-chat': { input: 1, output: 2 } }, {
    chartDays: 3,
    now: NOON,
  })
  const html = renderDashboardHead(data) + renderDashboardCharts(data)
  assert.ok(DASHBOARD_STYLE.includes('.td-dashboard'))
  assert.ok(html.includes('今日'))
  assert.ok(html.includes('每日 token 用量'))
  assert.ok(html.includes('模型占比 · tokens'))
  assert.ok(html.includes('模型占比 · 费用'))
  assert.ok(html.includes('deepseek/deepseek-chat'))
  assert.ok(html.includes('近 3 天'))
  // Compact table: cache columns are merged and cost only shows with pricing.
  assert.ok(html.includes('>缓存</th>'))
  assert.ok(!html.includes('<th>缓存读</th>'))
  assert.ok(!html.includes('<th>缓存写</th>'))
  assert.ok(html.includes('<td>500</td><td>2.0K</td>'))
  const noPricingHtml = renderDashboardCharts(
    buildDashboardData([record], {}, { chartDays: 3, now: NOON }),
  )
  assert.ok(!noPricingHtml.includes('<th>费用</th>'))
  // The host app owns re-rendering; the fragment must stay script-free.
  assert.ok(!html.includes('<script'))
  // Model ids are HTML-escaped if they ever contain markup.
  const sneaky = buildDashboardData(
    [{ ...record, provider: '<img>', model: 'x"onerror' }],
    {},
    { chartDays: 1, now: NOON },
  )
  const sneakyHtml = renderDashboardHead(sneaky) + renderDashboardCharts(sneaky)
  assert.ok(!sneakyHtml.includes('<img>'))
  assert.ok(sneakyHtml.includes('&lt;img&gt;'))
})
