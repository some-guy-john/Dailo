import { describe, expect, it } from 'vitest'
import { isGuessFormatValid, isWinningResult, mergeKeyboardState, normalizeGuess, scoreGuess } from './rules'

describe('Wordle rules', () => {
  it('normalizes guesses and validates the five-letter format', () => {
    expect(normalizeGuess(' crane ')).toBe('CRANE')
    expect(isGuessFormatValid('crane')).toBe(true)
    expect(isGuessFormatValid('cranes')).toBe(false)
    expect(isGuessFormatValid('cr@nE')).toBe(false)
  })

  it('scores exact matches before present letters', () => {
    expect(scoreGuess('CRANE', 'CRATE')).toEqual(['correct', 'correct', 'correct', 'absent', 'correct'])
    expect(isWinningResult(scoreGuess('CRANE', 'CRANE'))).toBe(true)
  })

  it('handles repeated letters without over-counting them', () => {
    expect(scoreGuess('SHEEP', 'EERIE')).toEqual(['present', 'present', 'absent', 'absent', 'absent'])
    expect(scoreGuess('BANAL', 'ABAAA')).toEqual(['present', 'present', 'absent', 'correct', 'absent'])
  })

  it('keeps the strongest keyboard state', () => {
    const first = mergeKeyboardState({}, 'CRATE', scoreGuess('CRANE', 'CRATE'))
    const second = mergeKeyboardState(first, 'CIVIC', scoreGuess('CRANE', 'CIVIC'))
    expect(second.C).toBe('correct')
    expect(second.R).toBe('correct')
    expect(second.A).toBe('correct')
  })
})
