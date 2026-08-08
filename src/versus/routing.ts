export type VersusRoute =
  | { kind: 'create' }
  | { kind: 'invite'; inviteToken: string }
  | { kind: 'match'; publicKey: string }

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseVersusRoute(hash: string): VersusRoute | null {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  if (path === 'wordo/versus') return { kind: 'create' }
  const parts = path.split('/')
  if (parts.length !== 4 || parts[0] !== 'wordo' || parts[1] !== 'versus') return null
  if (parts[2] === 'invite' && TOKEN_PATTERN.test(parts[3])) return { kind: 'invite', inviteToken: parts[3] }
  if (parts[2] === 'match' && UUID_PATTERN.test(parts[3])) return { kind: 'match', publicKey: parts[3] }
  return null
}

export function versusHash(route: VersusRoute): string {
  if (route.kind === 'create') return '#/wordo/versus'
  if (route.kind === 'invite') return `#/wordo/versus/invite/${route.inviteToken}`
  return `#/wordo/versus/match/${route.publicKey}`
}
