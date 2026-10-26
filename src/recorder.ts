import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { normalizeObservation, type UsageStore } from './usage-store.ts'

/**
 * Subscribe to `session/event` and fold every attributed
 * `assistant/message` usage into the store. The listener registration is a
 * cordis effect, so it disappears with the calling plugin; recording itself
 * never throws into the harness event loop (IO failures surface through the
 * store's onError).
 */
export function attachRecorder(ctx: Context, store: UsageStore): void {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'assistant/message') return
    const { message, usage } = event.data
    const record = normalizeObservation({
      ts: event.time,
      provider: message.source.provider,
      model: message.source.model,
      usage,
    })
    if (record === null) return
    store.record(record)
  })
}
