import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TokenUsageLike, UsageRecord } from './types.ts'

/** Fields this plugin ingests from one harness `assistant/message` event. */
export interface UsageObservation {
  ts: number
  provider: string
  model: string
  usage: TokenUsageLike | undefined
}

const JSONL_VERSION = 1

function finiteNonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Normalize one raw observation into a storable record, or return null when
 * the observation carries no attribution or no usage — missing counts are
 * never fabricated.
 */
export function normalizeObservation(observation: UsageObservation): UsageRecord | null {
  const { ts, provider, model, usage } = observation
  if (!Number.isFinite(ts) || ts <= 0) return null
  if (typeof provider !== 'string' || provider.length === 0) return null
  if (typeof model !== 'string' || model.length === 0) return null
  if (!usage) return null
  const hasAnyCount =
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.cacheReadTokens !== undefined ||
    usage.cacheWriteTokens !== undefined
  if (!hasAnyCount) return null
  return {
    ts,
    provider,
    model,
    inputTokens: finiteNonNegative(usage.inputTokens),
    outputTokens: finiteNonNegative(usage.outputTokens),
    cacheReadTokens: finiteNonNegative(usage.cacheReadTokens),
    cacheWriteTokens: finiteNonNegative(usage.cacheWriteTokens),
    reasoningTokens: finiteNonNegative(usage.reasoningTokens),
  }
}

/** One JSONL line for the append-only usage log. */
export function serializeRecord(record: UsageRecord): string {
  return JSON.stringify({ v: JSONL_VERSION, ...record })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Parse one JSONL line into a record, or null when malformed. */
function parseLine(line: string): UsageRecord | null {
  if (line.length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  return normalizeObservation({
    ts: value.ts as number,
    provider: value.provider as string,
    model: value.model as string,
    usage: {
      inputTokens: value.inputTokens as number | undefined,
      outputTokens: value.outputTokens as number | undefined,
      cacheReadTokens: value.cacheReadTokens as number | undefined,
      cacheWriteTokens: value.cacheWriteTokens as number | undefined,
      reasoningTokens: value.reasoningTokens as number | undefined,
    },
  })
}

export interface ParsedLog {
  records: UsageRecord[]
  /** Lines that could not be parsed; they are skipped, never rewritten. */
  badLines: number
}

/** Pure JSONL → records fold so tests can run without touching the disk. */
export function parseUsageJsonl(text: string): ParsedLog {
  const records: UsageRecord[] = []
  let badLines = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const record = parseLine(trimmed)
    if (record === null) {
      badLines++
    } else {
      records.push(record)
    }
  }
  return { records, badLines }
}

/**
 * Append-only per-request usage log. Records land in memory immediately and
 * persist through a serialized write queue, so a failing or slow disk never
 * blocks or crashes the harness event loop; IO failures surface through
 * `onError`.
 */
export class UsageStore {
  private readonly records: UsageRecord[] = []
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    readonly filePath: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /** Load existing records; tolerant of a missing or partially corrupt file. */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch {
      return
    }
    const { records, badLines } = parseUsageJsonl(text)
    this.records.push(...records)
    if (badLines > 0) {
      this.onError(new Error(`usage log had ${badLines} unparsable line(s): ${this.filePath}`))
    }
  }

  /** Count of records held in memory (loaded + recorded). */
  get size(): number {
    return this.records.length
  }

  /** Live record list; callers must not mutate. */
  all(): readonly UsageRecord[] {
    return this.records
  }

  /** Store one normalized record in memory and enqueue its JSONL append. */
  record(record: UsageRecord): void {
    if (this.closed) return
    this.records.push(record)
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true })
        await appendFile(this.filePath, `${serializeRecord(record)}\n`, 'utf8')
      })
      .catch((error: unknown) => {
        this.onError(error)
      })
  }

  /** Resolve when every enqueued append has settled. */
  async flush(): Promise<void> {
    await this.queue
  }

  /** Flush and stop accepting records; further record() calls are no-ops. */
  async close(): Promise<void> {
    if (this.closed) return
    await this.flush()
    this.closed = true
  }
}
