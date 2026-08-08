import type { ConnectionsSession, GameMode, GameSession, Stats } from './types'
import { EMPTY_STATS } from './stats'

const statsKey = 'dailies:stats:v1'
const themeKey = 'dailies:theme:v1'
const prefsKey = 'dailies:prefs:v1'
const browserIdKey = 'dailies:browser-id:v1'
const connectionsSessionKey = 'dailies:connections-session:v2'
const legacyConnectionsSessionKey = 'dailies:connections-session:v1'

export type Preferences = {
  highContrast: boolean
  reduceMotion: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { highContrast: false, reduceMotion: false }

function read<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : null
  } catch {
    return null
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local persistence is a convenience, not a reason to block play.
  }
}

export function loadStats(): Stats {
  const stored = read<Partial<Stats>>(statsKey)
  return {
    ...EMPTY_STATS,
    ...stored,
    dailyResults: stored?.dailyResults ?? {},
    unlimitedResults: stored?.unlimitedResults ?? [],
    archiveResults: stored?.archiveResults ?? [],
    recentUnlimitedPuzzleIds: stored?.recentUnlimitedPuzzleIds ?? [],
    connectionsDailyResults: stored?.connectionsDailyResults ?? {},
  }
}

export function saveStats(stats: Stats): void {
  write(statsKey, stats)
}

export function getSessionKey(mode: GameMode, date: string | null): string {
  return `dailies:session:${mode}:${date ?? 'unlimited'}`
}

export function loadSession(mode: GameMode, date: string | null): GameSession | null {
  return read<GameSession>(getSessionKey(mode, date))
}

export function saveSession(session: GameSession): void {
  write(getSessionKey(session.mode, session.date), session)
}

export function loadConnectionsSession(date: string, mode: ConnectionsSession['mode'] = 'daily'): ConnectionsSession | null {
  const session = read<ConnectionsSession>(`${connectionsSessionKey}:${mode}:${date}`)
  if (session || mode !== 'daily') return session
  const legacy = read<Omit<ConnectionsSession, 'mode'> & { mode?: ConnectionsSession['mode'] }>(legacyConnectionsSessionKey)
  return legacy?.date === date ? { ...legacy, mode: legacy.mode ?? 'daily' } : null
}

export function saveConnectionsSession(session: ConnectionsSession): void {
  write(`${connectionsSessionKey}:${session.mode}:${session.date}`, session)
}

export function loadTheme(): 'system' | 'light' | 'dark' {
  const theme = read<'system' | 'light' | 'dark'>(themeKey)
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}

export function saveTheme(theme: 'system' | 'light' | 'dark'): void {
  write(themeKey, theme)
}

export function loadPreferences(): Preferences {
  const stored = read<Partial<Preferences>>(prefsKey)
  return {
    highContrast: stored?.highContrast === true,
    reduceMotion: stored?.reduceMotion === true,
  }
}

export function savePreferences(preferences: Preferences): void {
  write(prefsKey, preferences)
}

export function loadBrowserId(): string {
  const existing = read<string>(browserIdKey)
  if (existing) return existing

  const generated = crypto.randomUUID()
  write(browserIdKey, generated)
  return generated
}
