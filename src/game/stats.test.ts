import { describe, expect, it } from 'vitest'
import { calculateCurrentStreak, calculateMaximumStreak, recordSession } from './stats'
import type { Stats } from './types'

describe('daily streaks', () => {
  it('counts consecutive wins through today', () => {
    const results = {
      '2026-08-05': { date: '2026-08-05', won: true, guesses: 4 },
      '2026-08-06': { date: '2026-08-06', won: true, guesses: 3 },
      '2026-08-07': { date: '2026-08-07', won: true, guesses: 5 },
    }
    expect(calculateCurrentStreak(results, '2026-08-07')).toBe(3)
  })

  it('starts again after a missed date', () => {
    const results = {
      '2026-08-04': { date: '2026-08-04', won: true, guesses: 4 },
      '2026-08-06': { date: '2026-08-06', won: true, guesses: 3 },
    }
    expect(calculateCurrentStreak(results, '2026-08-07')).toBe(1)
  })

  it('resets the current streak after a loss', () => {
    const results = {
      '2026-08-06': { date: '2026-08-06', won: true, guesses: 3 },
      '2026-08-07': { date: '2026-08-07', won: false, guesses: 6 },
    }
    expect(calculateCurrentStreak(results, '2026-08-07')).toBe(0)
  })

  it('finds the maximum consecutive winning streak', () => {
    const results = {
      '2026-08-01': { date: '2026-08-01', won: true, guesses: 4 },
      '2026-08-02': { date: '2026-08-02', won: true, guesses: 3 },
      '2026-08-03': { date: '2026-08-03', won: false, guesses: 6 },
      '2026-08-04': { date: '2026-08-04', won: true, guesses: 5 },
      '2026-08-05': { date: '2026-08-05', won: true, guesses: 4 },
      '2026-08-06': { date: '2026-08-06', won: true, guesses: 4 },
    }
    expect(calculateMaximumStreak(results)).toBe(3)
  })
})

describe('archive results', () => {
  it('records archive results without changing daily statistics', () => {
    const stats: Stats = {
      dailyResults: {},
      unlimitedResults: [],
      archiveResults: [],
      recentUnlimitedPuzzleIds: [],
    }
    const next = recordSession(stats, {
      mode: 'archive',
      puzzleId: 'archive-puzzle',
      date: '2026-08-06',
      answer: 'CRANE',
      attempts: [],
      status: 'won',
      startedAt: '2026-08-07T00:00:00.000Z',
    })

    expect(next.archiveResults).toEqual([{ date: '2026-08-06', puzzleId: 'archive-puzzle', won: true, guesses: 0 }])
    expect(next.dailyResults).toEqual({})
    expect(next.unlimitedResults).toEqual([])
  })
})
