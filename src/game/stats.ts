import { shiftDate } from './date'
import type { DailyResult, GameSession, Stats, UnlimitedResult } from './types'

export const EMPTY_STATS: Stats = {
  dailyResults: {},
  unlimitedResults: [],
  recentUnlimitedPuzzleIds: [],
}

export function calculateCurrentStreak(results: Record<string, DailyResult>, today: string): number {
  const todayResult = results[today]
  if (todayResult && !todayResult.won) return 0

  let cursor = todayResult?.won ? today : shiftDate(today, -1)
  let streak = 0
  while (results[cursor]?.won) {
    streak += 1
    cursor = shiftDate(cursor, -1)
  }
  return streak
}

export function calculateMaximumStreak(results: Record<string, DailyResult>): number {
  const dates = Object.keys(results).sort()
  let best = 0
  let current = 0
  let previous: string | undefined

  dates.forEach((date) => {
    if (results[date].won && previous && date === shiftDate(previous, 1)) {
      current += 1
    } else {
      current = results[date].won ? 1 : 0
    }
    best = Math.max(best, current)
    previous = date
  })

  return best
}

export function recordSession(stats: Stats, session: GameSession): Stats {
  if (session.status === 'active') return stats
  const won = session.status === 'won'
  const guesses = session.attempts.length

  if (session.mode === 'daily' && session.date) {
    if (stats.dailyResults[session.date]) return stats
    const dailyResults = {
      ...stats.dailyResults,
      [session.date]: { date: session.date, won, guesses },
    }
    return { ...stats, dailyResults }
  }

  const result: UnlimitedResult = { puzzleId: session.puzzleId, won, guesses }
  if (stats.unlimitedResults.some((item) => item.puzzleId === result.puzzleId)) return stats
  return {
    ...stats,
    unlimitedResults: [...stats.unlimitedResults, result],
    recentUnlimitedPuzzleIds: [
      session.puzzleId,
      ...stats.recentUnlimitedPuzzleIds.filter((id) => id !== session.puzzleId),
    ].slice(0, 20),
  }
}
