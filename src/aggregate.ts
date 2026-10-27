import { dayKeyOf, lastDayKeys, shiftDayKey, weekdayMon0 } from './days.ts'
import type { HeatmapCell, ModelPricing, PricingMap, UsageRecord } from './types.ts'

/** Reporting windows understood by the tool, the command and the dashboard. */
export type Period = 'today' | '7d' | '30d' | 'all'

export const PERIODS: readonly Period[] = ['today', '7d', '30d', 'all']

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

export function periodLabel(period: Period): string {
  switch (period) {
    case 'today':
      return '今日'
    case '7d':
      return '近7天'
    case '30d':
      return '近30天'
    case 'all':
      return '累计'
  }
}

/** Epoch-ms start (inclusive) of a period, or null for 'all'. */
export function periodStartTs(period: Period, now: number): number | null {
  if (period === 'all') return null
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

export function recordsInPeriod(
  records: readonly UsageRecord[],
  period: Period,
  now: number,
): UsageRecord[] {
  const start = periodStartTs(period, now)
  if (start === null) return [...records]
  return records.filter(record => record.ts >= start)
}

/**
 * Additive totals for a set of records. `billedInputTokens` is the disjoint
 * sum input + cacheRead + cacheWrite; `totalTokens` is billed input plus
 * output. `reasoningTokens` are already inside `outputTokens` and are kept
 * separately for display only.
 */
export interface UsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  billedInputTokens: number
  totalTokens: number
  costUsd: number
}

export interface ModelUsage extends UsageTotals {
  /** Stable identity: `provider/model`. */
  key: string
  provider: string
  model: string
}

export interface DayUsage {
  date: string
  totals: UsageTotals
  models: ModelUsage[]
}

export function emptyTotals(): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    billedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  }
}

function addInto(acc: UsageTotals, record: UsageRecord, costUsd: number): void {
  acc.requests += 1
  acc.inputTokens += record.inputTokens
  acc.outputTokens += record.outputTokens
  acc.cacheReadTokens += record.cacheReadTokens
  acc.cacheWriteTokens += record.cacheWriteTokens
  acc.reasoningTokens += record.reasoningTokens
  const billedInput = record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens
  acc.billedInputTokens += billedInput
  acc.totalTokens += billedInput + record.outputTokens
  acc.costUsd += costUsd
}

/**
 * Resolve pricing for one model: exact key first, then the longest matching
 * prefix (so `deepseek-chat` can cover `deepseek-chat-v3.2`).
 */
export function resolvePricing(pricing: PricingMap, model: string): ModelPricing | undefined {
  const exact = pricing[model]
  if (exact !== undefined) return exact
  let best: { key: string; pricing: ModelPricing } | undefined
  for (const [key, candidate] of Object.entries(pricing)) {
    if (key.length > 0 && model.startsWith(key) && (best === undefined || key.length > best.key.length)) {
      best = { key, pricing: candidate }
    }
  }
  return best?.pricing
}

/** USD cost of one record under the given pricing table (0 when unpriced). */
export function recordCostUsd(record: UsageRecord, pricing: PricingMap): number {
  const price = resolvePricing(pricing, record.model)
  if (price === undefined) return 0
  const cacheRead = price.cacheRead ?? price.input
  const cacheWrite = price.cacheWrite ?? price.input
  const usd =
    (record.inputTokens * price.input +
      record.outputTokens * price.output +
      record.cacheReadTokens * cacheRead +
      record.cacheWriteTokens * cacheWrite) /
    1_000_000
  return Number.isFinite(usd) ? usd : 0
}

function modelUsageOf(record: UsageRecord, costUsd: number): ModelUsage {
  const totals = emptyTotals()
  addInto(totals, record, costUsd)
  return {
    key: `${record.provider}/${record.model}`,
    provider: record.provider,
    model: record.model,
    ...totals,
  }
}

/** Per-model totals over the given records, sorted by totalTokens descending. */
export function aggregateModels(
  records: readonly UsageRecord[],
  pricing: PricingMap,
): ModelUsage[] {
  const byKey = new Map<string, ModelUsage>()
  for (const record of records) {
    const key = `${record.provider}/${record.model}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, modelUsageOf(record, recordCostUsd(record, pricing)))
    } else {
      addInto(existing, record, recordCostUsd(record, pricing))
    }
  }
  return [...byKey.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

function totalsOf(records: readonly UsageRecord[], pricing: PricingMap): UsageTotals {
  const acc = emptyTotals()
  for (const record of records) {
    addInto(acc, record, recordCostUsd(record, pricing))
  }
  return acc
}

/**
 * Per-day totals for exactly the given ascending day keys (zero days are
 * preserved), each with its per-model breakdown sorted by totalTokens.
 */
export function aggregateDays(
  records: readonly UsageRecord[],
  pricing: PricingMap,
  dayKeys: readonly string[],
): DayUsage[] {
  const byDay = new Map<string, UsageRecord[]>()
  for (const record of records) {
    const key = dayKeyOf(record.ts)
    const bucket = byDay.get(key)
    if (bucket === undefined) {
      byDay.set(key, [record])
    } else {
      bucket.push(record)
    }
  }
  return dayKeys.map(date => {
    const dayRecords = byDay.get(date) ?? []
    return {
      date,
      totals: totalsOf(dayRecords, pricing),
      models: aggregateModels(dayRecords, pricing),
    }
  })
}

export interface PeriodSummary {
  period: Period
  totals: UsageTotals
  models: ModelUsage[]
  /** Distinct local days with data, ascending. */
  days: DayUsage[]
}

/** Summarize one period over the given records. */
export function summarizePeriod(
  records: readonly UsageRecord[],
  pricing: PricingMap,
  period: Period,
  now: number = Date.now(),
): PeriodSummary {
  const scoped = recordsInPeriod(records, period, now)
  const dayKeys = [...new Set(scoped.map(record => dayKeyOf(record.ts)))].sort()
  return {
    period,
    totals: totalsOf(scoped, pricing),
    models: aggregateModels(scoped, pricing),
    days: aggregateDays(scoped, pricing, dayKeys),
  }
}

export interface CardDatum {
  label: string
  tokens: number
  requests: number
  costUsd: number
}

/** The four dashboard cards: 今日 / 近7天 / 近30天 / 累计. */
export function buildCards(
  records: readonly UsageRecord[],
  pricing: PricingMap,
  now: number = Date.now(),
): CardDatum[] {
  const periods: Period[] = ['today', '7d', '30d', 'all']
  return periods.map(period => {
    const { totals } = summarizePeriod(records, pricing, period, now)
    return {
      label: periodLabel(period),
      tokens: totals.totalTokens,
      requests: totals.requests,
      costUsd: totals.costUsd,
    }
  })
}

export interface DashboardData {
  generatedAt: number
  cards: CardDatum[]
  hasPricing: boolean
  /** Chart window: ascending day keys of the last `chartDays` local days. */
  lineDays: string[]
  /** Window models sorted by totalTokens descending (only non-zero ones). */
  lineModels: ModelUsage[]
  /** `lineSeries[modelIndex][dayIndex]` = tokens of that model on that day. */
  lineSeries: number[][]
  /** Donut input: window models with share of tokens. */
  pie: ModelUsage[]
  /** Detail table rows for the window. */
  table: ModelUsage[]
  /** Records that fell outside the chart window (kept for the 累计 card). */
  windowDaysCount: number
  /** Token-activity heatmap: the trailing year of local days (zero days kept). */
  heatmap: HeatmapCell[]
}

/**
 * Heatmap window: the trailing year (52 full weeks = 364 days) ending today,
 * matching the 7-row calendar grid of the Token 活动 panel.
 */
export const HEATMAP_DAYS = 364

/** Per-day totals for the heatmap window: zero days preserved, ascending. */
export function buildHeatmap(
  records: readonly UsageRecord[],
  now: number = Date.now(),
): HeatmapCell[] {
  const byDay = new Map<string, HeatmapCell>()
  for (const record of records) {
    const key = dayKeyOf(record.ts)
    const entry = byDay.get(key)
    const billed = record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens
    const tokens = billed + record.outputTokens
    if (entry === undefined) {
      byDay.set(key, { date: key, tokens, requests: 1 })
    } else {
      entry.tokens += tokens
      entry.requests += 1
    }
  }
  // lastDayKeys ends at today, so no future cells can appear.
  return lastDayKeys(HEATMAP_DAYS, now).map(date => byDay.get(date) ?? { date, tokens: 0, requests: 0 })
}

/** Aggregate daily cells into Monday-started weeks (last week partial). */
export function aggregateWeeks(days: readonly HeatmapCell[]): HeatmapCell[] {
  const weeks = new Map<string, HeatmapCell>()
  for (const day of days) {
    const monday = shiftDayKey(day.date, -weekdayMon0(day.date))
    const week = weeks.get(monday)
    if (week === undefined) {
      weeks.set(monday, { date: monday, tokens: day.tokens, requests: day.requests })
    } else {
      week.tokens += day.tokens
      week.requests += day.requests
    }
  }
  return [...weeks.values()]
}

/** Running totals: each cell carries the cumulative sums up to that day. */
export function cumulateDays(days: readonly HeatmapCell[]): HeatmapCell[] {
  let tokens = 0
  let requests = 0
  return days.map(day => {
    tokens += day.tokens
    requests += day.requests
    return { date: day.date, tokens, requests }
  })
}

/** Pad the leading edge with nulls so the first cell lands on its weekday row. */
export function weekAlignCells(days: readonly HeatmapCell[]): (HeatmapCell | null)[] {
  const first = days[0]
  if (first === undefined) return []
  const pad = Array.from({ length: weekdayMon0(first.date) }, () => null)
  return [...pad, ...days]
}

/**
 * Assemble everything the HTML dashboard needs from one pass over the
 * records: cards over all four periods plus charts over the trailing
 * `chartDays` window.
 */
export function buildDashboardData(
  records: readonly UsageRecord[],
  pricing: PricingMap,
  options: { chartDays: number; now?: number },
): DashboardData {
  const now = options.now ?? Date.now()
  const chartDays = Math.max(1, Math.floor(options.chartDays))
  const windowKeys = lastDayKeys(chartDays, now)
  const firstKey = windowKeys[0]
  if (firstKey === undefined) {
    throw new Error('chart window must contain at least one day')
  }
  // Local midnight `chartDays - 1` days ago, same arithmetic as periodStartTs.
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (chartDays - 1))
  const windowRecords = records.filter(record => record.ts >= start.getTime())
  const windowModels = aggregateModels(windowRecords, pricing)
  const activeModels = windowModels.filter(model => model.totalTokens > 0)
  const dayTotals = aggregateDays(windowRecords, pricing, windowKeys)
  const lineSeries = activeModels.map(model =>
    dayTotals.map(day => day.models.find(entry => entry.key === model.key)?.totalTokens ?? 0),
  )
  return {
    generatedAt: now,
    cards: buildCards(records, pricing, now),
    hasPricing: Object.keys(pricing).length > 0,
    lineDays: windowKeys,
    lineModels: activeModels,
    lineSeries,
    pie: activeModels,
    table: windowModels,
    windowDaysCount: chartDays,
    heatmap: buildHeatmap(records, now),
  }
}
