import { describe, expect, it } from 'vitest'
import { getDailyAnswer } from './puzzles'
import { getUnlimitedAnswer } from './puzzles'

describe('puzzle selection', () => {
  it('does not select the current daily answer for local unlimited play', () => {
    const dailyAnswer = getDailyAnswer('2026-08-07')
    const selected = getUnlimitedAnswer([], dailyAnswer)
    expect(selected.answer).not.toBe(dailyAnswer)
  })

  it('avoids recent unlimited puzzle identifiers when alternatives exist', () => {
    const selected = getUnlimitedAnswer(['unlimited-ABOUT', 'unlimited-ADORE'])
    expect(['ABOUT', 'ADORE']).not.toContain(selected.answer)
  })
})
