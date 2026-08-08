import type { ConnectionsSession, GameSession, TileState } from './types'

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
    : session.mode === 'archive'
      ? `Dailo Wordo Archive ${session.date ?? ''}`.trim()
      : 'Dailo Wordo Unlimited'
  return `${label} ${session.status === 'won' ? `${session.attempts.length}/6` : 'X/6'}\n\n${grid}`
}

const CONNECTIONS_SQUARES = ['🟨', '🟩', '🟦', '🟪']

export function createConnectionsShareText(session: ConnectionsSession): string {
  const difficultyByWord = new Map(session.solvedGroups.flatMap((group) => (
    group.words.map((word) => [word, group.difficulty] as const)
  )))
  const grid = session.attempts.map((attempt) => attempt.words
    .map((word) => CONNECTIONS_SQUARES[(difficultyByWord.get(word) ?? 1) - 1])
    .join('')).join('\n')
  return `Dailo Connections ${session.date} ${session.status === 'won' ? '4/4' : 'X/4'}\nMistakes: ${session.mistakeCount}/${session.maxMistakes}\n\n${grid}`
}
