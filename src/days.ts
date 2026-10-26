/** Local-calendar day helpers. Days bucket by the machine's local timezone. */

/** `YYYY-MM-DD` key of the local calendar day containing `ts`. */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const year = String(d.getFullYear())
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Local `YYYY-MM-DD` key of today. */
export function todayKey(now: number = Date.now()): string {
  return dayKeyOf(now)
}

/**
 * Ascending local-day keys for the last `days` days ending at (and
 * including) the day of `endTs`. Always returns at least one key.
 */
export function lastDayKeys(days: number, endTs: number = Date.now()): string[] {
  const count = Math.max(1, Math.floor(days))
  const end = new Date(endTs)
  end.setHours(12, 0, 0, 0)
  const keys: string[] = []
  for (let offset = count - 1; offset >= 0; offset--) {
    const d = new Date(end)
    d.setDate(d.getDate() - offset)
    keys.push(dayKeyOf(d.getTime()))
  }
  return keys
}
