import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { isPeriod, summarizePeriod } from './aggregate.ts'
import type { LiveDashboard } from './live-dashboard.ts'
import { renderPeriodReport } from './report.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

/** Minimal structural view of the harness command registry (`ctx.commands`). */
interface CommandsRuntimeLike {
  register(definition: {
    name: string
    description: string
    handler: (invocation: { rawInput: string }) =>
      | { kind: 'success'; text?: string }
      | { kind: 'error'; text: string }
      | Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }>
  }): () => void
}

function openInBrowser(path: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [path], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // Best effort: the command still reports the dashboard path.
  }
}

const HELP_TEXT = [
  '/usage — 生成模型用量仪表盘（HTML，含卡片、曲线图与饼图，实时自动刷新）',
  '/usage <窗口> — 窗口可选 today / 7d / 30d / all，或天数（如 /usage 14）',
].join('\n')

export interface CommandOptions {
  pricing: PricingMap
  openAfterRender: boolean
  dashboard: LiveDashboard
}

/**
 * Register the `/usage` human command. `commands` is an optional dependency:
 * when the profile provides none, this is a no-op and the tool plus the
 * recorder keep working.
 */
export function registerUsageCommand(
  ctx: Context,
  store: UsageStore,
  options: CommandOptions,
): void {
  const commands = ctx.get('commands') as CommandsRuntimeLike | undefined
  if (commands === undefined) {
    console.log('[tokens-dashboard] no commands runtime in this profile; /usage disabled')
    return
  }
  commands.register({
    name: 'usage',
    description: '模型用量仪表盘：卡片、曲线图与饼图（实时刷新）',
    handler: async ({ rawInput }) => {
      const input = rawInput.trim()
      if (input === 'help' || input === '-h') {
        return { kind: 'success', text: HELP_TEXT }
      }
      let chartDays: number | undefined
      if (input.length > 0 && /^\d+$/.test(input)) {
        chartDays = Math.min(365, Math.max(1, Number.parseInt(input, 10)))
      } else if (input.length > 0 && !isPeriod(input)) {
        return { kind: 'error', text: `未知窗口：${input}（可选 today / 7d / 30d / all 或天数）` }
      }
      const now = Date.now()
      let outPath: string
      try {
        outPath = await options.dashboard.rebuild(now, chartDays)
      } catch (error) {
        return { kind: 'error', text: `仪表盘生成失败：${String(error)}` }
      }
      if (options.openAfterRender) openInBrowser(outPath)
      const period = isPeriod(input) ? input : '30d'
      const summary = summarizePeriod(store.all(), options.pricing, period, now)
      const report = renderPeriodReport(summary, {
        hasPricing: Object.keys(options.pricing).length > 0,
      })
      return { kind: 'success', text: `仪表盘已生成：${outPath}\n\n${report}` }
    },
  })
}
