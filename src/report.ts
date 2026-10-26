import { periodLabel, type PeriodSummary } from './aggregate.ts'
import { formatInt, formatTokens, formatUsd } from './charts.ts'

/** Compact human-readable report shared by the tool and the `/usage` command. */
export function renderPeriodReport(
  summary: PeriodSummary,
  options: { hasPricing: boolean },
): string {
  const totals = summary.totals
  const cost =
    options.hasPricing && totals.costUsd > 0 ? ` · 费用 ${formatUsd(totals.costUsd)}` : ''
  const lines: string[] = [
    `模型用量 · ${periodLabel(summary.period)}：请求 ${formatInt(totals.requests)} · tokens ${formatTokens(totals.totalTokens)}${cost}`,
  ]
  if (summary.models.length === 0) {
    lines.push('（该时段暂无记录）')
    return lines.join('\n')
  }
  lines.push('按模型：')
  for (const model of summary.models) {
    const modelCost =
      options.hasPricing && model.costUsd > 0 ? ` · ${formatUsd(model.costUsd)}` : ''
    lines.push(
      `  ${model.key} — 请求 ${formatInt(model.requests)} · ` +
        `输入 ${formatTokens(model.billedInputTokens)}` +
        `（缓存读 ${formatTokens(model.cacheReadTokens)} / 写 ${formatTokens(model.cacheWriteTokens)}）· ` +
        `输出 ${formatTokens(model.outputTokens)} · 合计 ${formatTokens(model.totalTokens)}${modelCost}`,
    )
  }
  if (summary.days.length > 0) {
    lines.push('按日：')
    for (const day of summary.days.slice(-14)) {
      const dayCost =
        options.hasPricing && day.totals.costUsd > 0 ? ` · ${formatUsd(day.totals.costUsd)}` : ''
      const perModel = day.models.map(m => `${m.model} ${formatTokens(m.totalTokens)}`).join(', ')
      lines.push(
        `  ${day.date} — ${formatTokens(day.totals.totalTokens)}（${perModel}）${dayCost}`,
      )
    }
  }
  return lines.join('\n')
}
