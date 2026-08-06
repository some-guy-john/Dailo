import { describe, expect, it } from 'vitest'
import { createShareText } from './share'
import type { GameSession } from './types'

describe('share text', () => {
  it('includes results without exposing guesses or answers', () => {
    const session: GameSession = {
      mode: 'daily',
      puzzleId: 'daily-2026-08-07',
      date: '2026-08-07',
      answer: 'CRANE',
      attempts: [{
        guess: 'SLATE',
        result: ['absent', 'present', 'absent', 'absent', 'correct'],
      }],
      status: 'won',
      startedAt: '2026-08-07T00:00:00.000Z',
    }

    const text = createShareText(session)
    expect(text).toContain('Dailies 2026-08-07 1/6')
    expect(text).toContain('⬜🟨⬜⬜🟦')
    expect(text).not.toContain('SLATE')
    expect(text).not.toContain('CRANE')
  })
})
