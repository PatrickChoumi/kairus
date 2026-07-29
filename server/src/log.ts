/*
 * Logs and counters.
 *
 * One line of JSON per event, so a log aggregator can read it without regular
 * expressions and a human can still read it with `jq`. `console.error` was the
 * whole of the telemetry before this, which meant the first sign of trouble in
 * production was a user complaining.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info
/** Pretty in a terminal, JSON everywhere a machine reads it. */
const pretty = process.env.LOG_FORMAT === 'pretty'

type Fields = Record<string, unknown>

function emit(level: Level, event: string, fields: Fields = {}): void {
  if (ORDER[level] < threshold) return

  if (pretty) {
    const rest = Object.entries(fields)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ')
    console[level === 'debug' ? 'log' : level](`${level.padEnd(5)} ${event} ${rest}`.trimEnd())
    return
  }

  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (event: string, fields?: Fields) => emit('debug', event, fields),
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
}

/* ---------------------------------------------------------------- counters */

/**
 * Deliberately tiny: counters and gauges, no histograms, no dependency. Enough
 * to answer "is anything being refused, and is anyone connected" without
 * standing up a metrics stack for a single-instance deployment.
 */
const counters = new Map<string, number>()
const gauges = new Map<string, () => number>()

export function count(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function gauge(name: string, read: () => number): void {
  gauges.set(name, read)
}

export function snapshot(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, value] of counters) out[name] = value
  for (const [name, read] of gauges) {
    try {
      out[name] = read()
    } catch {
      // A gauge that cannot be read must not break the whole snapshot.
    }
  }
  return out
}

/** Prometheus text format, for whoever wants to scrape it. */
export function asPrometheus(): string {
  return Object.entries(snapshot())
    .map(([name, value]) => `kairus_${name.replace(/[.-]/g, '_')} ${value}`)
    .join('\n')
}

export function resetCounters(): void {
  counters.clear()
}
