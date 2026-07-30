const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'

// The axis is read as numbers, in columns: 24-hour, always, whatever the
// browser's locale would rather do.
const hm = new Intl.DateTimeFormat(locale, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const full = new Intl.DateTimeFormat(locale, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DAY = 86_400_000

const startOfDay = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const clock = (ts: number) => hm.format(ts)

export const exact = (ts: number) => full.format(ts)

/** The compact stamp shown beside a conversation in the rail. */
export function stamp(ts: number): string {
  if (!ts) return ''
  const today = startOfDay(Date.now())
  if (ts >= today) return hm.format(ts)
  if (ts >= today - DAY) return 'hier'
  if (ts >= today - 6 * DAY) return weekday.format(ts)
  return dayMonth.format(ts)
}

/** The hairline separator that opens each new day in a thread. */
export function dayLabel(ts: number): string {
  const today = startOfDay(Date.now())
  if (ts >= today) return "aujourd'hui"
  if (ts >= today - DAY) return 'hier'
  const d = new Date(ts)
  return d.getFullYear() === new Date().getFullYear()
    ? dayMonth.format(ts)
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(ts)
}

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b)

/** Messages close in time from the same person read as one utterance. */
export const sameBreath = (a: number, b: number) => Math.abs(a - b) < 4 * 60_000

/** Below this, a pause is just the rhythm of talking and is not worth marking. */
const NOTABLE_SILENCE = 6 * 60_000

/**
 * How long nobody said anything — the label that gives a silence its place on
 * the axis. Returns null when the gap is too short to be worth a word.
 */
export function silence(from: number, to: number): string | null {
  const ms = to - from
  if (ms < NOTABLE_SILENCE) return null

  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} minutes`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'une heure' : `${hours} heures`

  const days = Math.round(hours / 24)
  return days === 1 ? 'un jour' : `${days} jours`
}
