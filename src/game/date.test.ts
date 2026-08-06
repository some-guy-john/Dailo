import { describe, expect, it } from 'vitest'
import { formatLondonDate, getLondonDate, shiftDate } from './date'

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
})
