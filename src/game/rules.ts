import type { GuessResult, TileState } from './types'

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6

export function normalizeGuess(value: string): string {
  return value.trim().toUpperCase()
}

export function isGuessFormatValid(value: string): boolean {
  return /^[A-Z]{5}$/.test(normalizeGuess(value))
}

export function scoreGuess(answerValue: string, guessValue: string): GuessResult {
  const answer = normalizeGuess(answerValue)
  const guess = normalizeGuess(guessValue)
  const result: GuessResult = Array.from({ length: WORD_LENGTH }, () => 'absent')
  const remaining = new Map<string, number>()

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (guess[index] === answer[index]) {
      result[index] = 'correct'
    } else {
      const letter = answer[index]
      remaining.set(letter, (remaining.get(letter) ?? 0) + 1)
    }
  }

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (result[index] === 'correct') continue

    const letter = guess[index]
    const available = remaining.get(letter) ?? 0
    if (available > 0) {
      result[index] = 'present'
      remaining.set(letter, available - 1)
    }
  }

  return result
}

const tileStrength: Record<TileState, number> = {
  empty: 0,
  absent: 1,
  present: 2,
  correct: 3,
}

export function mergeKeyboardState(
  current: Record<string, TileState>,
  guess: string,
  result: GuessResult,
): Record<string, TileState> {
  const next = { ...current }
  const normalizedGuess = normalizeGuess(guess)

  normalizedGuess.split('').forEach((letter, index) => {
    const previous = next[letter] ?? 'empty'
    const incoming = result[index]
    if (tileStrength[incoming] > tileStrength[previous]) {
      next[letter] = incoming
    }
  })

  return next
}

export function isWinningResult(result: GuessResult): boolean {
  return result.every((state) => state === 'correct')
}
