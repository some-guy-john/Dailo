import { describe, expect, it } from 'vitest'
import { parseVersusRoute, versusHash } from './routing'

describe('Versus hash routing', () => {
  it('parses create, invite, and match routes', () => {
    expect(parseVersusRoute('#/wordo/versus')).toEqual({ kind: 'create' })
    expect(parseVersusRoute('#/wordo/versus/invite/abcdefghijklmnop')).toEqual({ kind: 'invite', inviteToken: 'abcdefghijklmnop' })
    expect(parseVersusRoute('#/wordo/versus/match/550e8400-e29b-41d4-a716-446655440000')).toEqual({ kind: 'match', publicKey: '550e8400-e29b-41d4-a716-446655440000' })
  })

  it('rejects malformed capability routes', () => {
    expect(parseVersusRoute('#/wordo/versus/invite/short')).toBeNull()
    expect(parseVersusRoute('#/wordo/versus/match/not-a-uuid')).toBeNull()
  })

  it('serializes routes without participant credentials', () => {
    expect(versusHash({ kind: 'create' })).toBe('#/wordo/versus')
    expect(versusHash({ kind: 'match', publicKey: '550e8400-e29b-41d4-a716-446655440000' })).toBe('#/wordo/versus/match/550e8400-e29b-41d4-a716-446655440000')
  })
})
