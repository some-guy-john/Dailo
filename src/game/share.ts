import type { GameSession } from './types'

export function createShareText(session: GameSession): string {
  const grid = session.attempts
    .map(({ result }) => result.map((state) => state === 'correct' ? '🟦' : state === 'present' ? '🟨' : '⬜').join(''))
    .join('\n')
  const label = session.mode === 'daily' ? `Dailies ${session.date ?? ''}`.trim() : 'Dailies Unlimited'
  return `${label} ${session.status === 'won' ? `${session.attempts.length}/6` : 'X/6'}\n\n${grid}`
}
