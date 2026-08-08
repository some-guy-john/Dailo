import type { VersusMatch } from './types'

const key = (publicKey: string) => `dailies:wordo-versus:v1:${publicKey}`

export function loadVersusMatch(publicKey: string): VersusMatch | null {
  try {
    const value = window.localStorage.getItem(key(publicKey))
    return value ? JSON.parse(value) as VersusMatch : null
  } catch {
    return null
  }
}

export function saveVersusMatch(match: VersusMatch): void {
  try {
    window.localStorage.setItem(key(match.publicKey), JSON.stringify(match))
  } catch {
    // Match recovery is best-effort; the protected server remains authoritative.
  }
}
