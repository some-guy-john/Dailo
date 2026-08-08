import { beforeEach, describe, expect, it } from 'vitest'
import { loadVersusMatch, saveVersusMatch } from './storage'

describe('Versus storage', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      location: { hash: '' },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    } })
  })

  it('stores participant credentials under the public match key', () => {
    saveVersusMatch({
      publicKey: '550e8400-e29b-41d4-a716-446655440000', participantToken: 'private-participant-token', status: 'waiting',
      playerName: 'Alice', opponentName: null, playerStatus: 'waiting', opponentStatus: null, attempts: [], opponentRows: [],
      answer: null, outcome: null, expiresAt: '2026-08-09T00:00:00Z',
    })
    expect(loadVersusMatch('550e8400-e29b-41d4-a716-446655440000')?.participantToken).toBe('private-participant-token')
    expect(window.location.hash).toBe('')
  })
})
