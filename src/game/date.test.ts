import { describe, expect, it } from 'vitest'
import { formatCountdown, formatLondonDate, getLondonDate, getLondonMidnightTimestamp, getMillisecondsUntilLondonMidnight, shiftDate } from './date'

describe('London scheduling', () => {
  it('uses the London calendar date across GMT and BST', () => {
    expect(getLondonDate(new Date('2026-01-15T23:30:00.000Z'))).toBe('2026-01-15')
    expect(getLondonDate(new Date('2026-01-16T00:30:00.000Z'))).toBe('2026-01-16')
    expect(getLondonDate(new Date('2026-07-15T23:30:00.000Z'))).toBe('2026-07-16')
  })

  it('shifts puzzle dates without local timezone surprises', () => {
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('formats the date for the dispatch label', () => {
    expect(formatLondonDate('2026-08-07')).toBe('Fri 7 Aug')
  })

  it('finds the next London midnight across seasonal clock changes', () => {
    const beforeWinterMidnight = new Date('2026-01-15T23:30:00.000Z')
    const beforeSummerMidnight = new Date('2026-07-15T22:30:00.000Z')
    expect(getMillisecondsUntilLondonMidnight(beforeWinterMidnight)).toBe(30 * 60_000)
    expect(getMillisecondsUntilLondonMidnight(beforeSummerMidnight)).toBe(30 * 60_000)
    expect(getLondonMidnightTimestamp('2026-07-16')).toBe(Date.parse('2026-07-15T23:00:00Z'))
  })

  it('formats a countdown without seconds', () => {
    expect(formatCountdown((8 * 60 + 7) * 60_000 + 1)).toBe('08h 08m')
    expect(formatCountdown(0)).toBe('00h 00m')
  })
})
