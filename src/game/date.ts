export function getLondonDate(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatLondonDate(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function getLondonClockParts(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return { hour: Number(values.hour), minute: Number(values.minute) }
}

export function getLondonMidnightTimestamp(dateString: string): number {
  const utcMidnight = Date.parse(`${dateString}T00:00:00Z`)
  const { hour, minute } = getLondonClockParts(new Date(utcMidnight))
  return utcMidnight - (hour * 60 + minute) * 60_000
}

export function getMillisecondsUntilLondonMidnight(date = new Date()): number {
  const nextDate = shiftDate(getLondonDate(date), 1)
  return Math.max(0, getLondonMidnightTimestamp(nextDate) - date.getTime())
}

export function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
}
