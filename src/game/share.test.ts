import { describe, expect, it } from 'vitest'
import { createConnectionsShareText, createShareText } from './share'
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
    expect(text).toContain('Dailo Wordo 2026-08-07 1/6')
    expect(text).toContain('⬜🟨⬜⬜🟩')
    expect(text).not.toContain('SLATE')
    expect(text).not.toContain('CRANE')
  })

  it('uses the high contrast squares when that preference is on', () => {
    const session: GameSession = {
      mode: 'unlimited',
      puzzleId: 'unlimited-1',
      date: null,
      answer: 'CRANE',
      attempts: [{
        guess: 'SLATE',
        result: ['absent', 'present', 'absent', 'absent', 'correct'],
      }],
      status: 'won',
      startedAt: '2026-08-07T00:00:00.000Z',
    }

    const text = createShareText(session, true)
    expect(text).toContain('Dailo Wordo Unlimited 1/6')
    expect(text).toContain('⬜🟦⬜⬜🟧')
  })
})

describe('Connections share text', () => {
  it('shares colored attempts without words or group labels', () => {
    const text = createConnectionsShareText({
      mode: 'daily', puzzleId: 'connections-1', date: '2026-08-08', words: ['APPLE', 'PEAR', 'HARP', 'LION'],
      solvedGroups: [
        { key: 'fruit', label: 'Fruit', difficulty: 1, words: ['APPLE', 'MANGO', 'PEAR', 'PLUM'] },
        { key: 'music', label: 'Instruments', difficulty: 2, words: ['HARP', 'CELLO', 'VIOLIN', 'GUITAR'] },
        { key: 'shape', label: 'Shapes', difficulty: 3, words: ['OVAL', 'SQUARE', 'CIRCLE', 'TRIANGLE'] },
        { key: 'cats', label: 'Big cats', difficulty: 4, words: ['LION', 'PUMA', 'TIGER', 'LEOPARD'] },
      ],
      attempts: [{ words: ['APPLE', 'HARP', 'OVAL', 'LION'], result: 'incorrect' }],
      mistakeCount: 1, maxMistakes: 4, status: 'lost', startedAt: '2026-08-08T00:00:00Z',
    })
    expect(text).toContain('Dailo Connections 2026-08-08 X/4')
    expect(text).toContain('🟨🟩🟦🟪')
    expect(text).not.toContain('APPLE')
    expect(text).not.toContain('Fruit')
    expect(createConnectionsShareText({
      mode: 'archive', puzzleId: 'archive-1', date: '2026-08-07', words: [], solvedGroups: [], attempts: [],
      mistakeCount: 4, maxMistakes: 4, status: 'lost', startedAt: '2026-08-08T00:00:00Z',
    })).toContain('Dailo Connections Archive 2026-08-07 X/4')
  })
})
