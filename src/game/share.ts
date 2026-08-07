import type { GameSession, TileState } from './types'

const STANDARD_SQUARES: Record<Exclude<TileState, 'empty'>, string> = {
  correct: '🟩',
  present: '🟨',
  absent: '⬜',
}

const HIGH_CONTRAST_SQUARES: Record<Exclude<TileState, 'empty'>, string> = {
  correct: '🟧',
  present: '🟦',
  absent: '⬜',
}

export function createShareText(session: GameSession, highContrast = false): string {
  const squares = highContrast ? HIGH_CONTRAST_SQUARES : STANDARD_SQUARES
  const grid = session.attempts
    .map(({ result }) => result.map((state) => squares[state as Exclude<TileState, 'empty'>]).join(''))
    .join('\n')
  const label = session.mode === 'daily'
    ? `Dailo Wordo ${session.date ?? ''}`.trim()
    : 'Dailo Wordo Unlimited'
  return `${label} ${session.status === 'won' ? `${session.attempts.length}/6` : 'X/6'}\n\n${grid}`
}
