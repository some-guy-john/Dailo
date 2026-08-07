import { describe, expect, it } from 'vitest'
import { getLondonDate } from './date'

describe('daily rollover', () => {
  it('changes the active date at London midnight', () => {
    expect(getLondonDate(new Date('2026-08-06T22:59:59.000Z'))).toBe('2026-08-06')
    expect(getLondonDate(new Date('2026-08-06T23:00:00.000Z'))).toBe('2026-08-07')
  })
})
