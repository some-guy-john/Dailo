import type { GameMode, GameSession, Stats } from './types'
import { EMPTY_STATS } from './stats'

const statsKey = 'dailies:stats:v1'
const themeKey = 'dailies:theme:v1'

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
  return read<Stats>(statsKey) ?? EMPTY_STATS
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

export function loadTheme(): 'system' | 'light' | 'dark' {
  const theme = read<'system' | 'light' | 'dark'>(themeKey)
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}

export function saveTheme(theme: 'system' | 'light' | 'dark'): void {
  write(themeKey, theme)
}
