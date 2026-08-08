import { isGuessFormatValid, normalizeGuess } from './rules'
import { loadBrowserId, loadConnectionsSession, loadSession } from './storage'
import { supabase } from '../lib/supabase'
import type { ConnectionsAttempt, ConnectionsGroup, ConnectionsSession, GameMode, GameSession, Stats } from './types'

type BackendState = {
  mode: GameMode
  puzzleId: string | null
  date: string | null
  status: GameSession['status'] | 'abandoned' | 'expired'
  attemptCount: number
  attempts: GameSession['attempts']
  answer: string | null
}

type BackendResponse = {
  sessionToken?: string
  state?: BackendState
  result?: {
    status: GameSession['status']
    attemptCount: number
    attempt: { guess: string; result: GameSession['attempts'][number]['result'] }
    answer: string | null
  }
  archives?: ArchivePuzzle[]
  archiveStats?: ArchiveStats
  accountHistory?: AccountHistoryItem[]
  connections?: {
    state?: ConnectionsBackendState
    result?: ConnectionsBackendResult
    stats?: ConnectionsStats
  }
  error?: { code: string; message: string }
}

type ConnectionsBackendState = {
  mode: ConnectionsSession['mode']
  puzzleId: string
  date: string
  words: string[]
  solvedGroups: ConnectionsGroup[]
  attempts: ConnectionsAttempt[]
  mistakeCount: number
  maxMistakes: number
  status: ConnectionsSession['status']
}

type ConnectionsBackendResult = {
  result: ConnectionsAttempt['result']
  group?: ConnectionsGroup
  state: ConnectionsBackendState
}

export type ArchivePuzzle = {
  date: string
  puzzleId: string
  status: 'active' | 'won' | 'lost' | null
}

export type ArchiveStats = {
  played: number
  wins: number
  distribution: number[]
}

export type ConnectionsStats = {
  dailyResults: Record<string, { date: string; won: boolean; mistakes: number }>
}

export type ConnectionsArchivePuzzle = { date: string; puzzleId: string; status: 'active' | 'won' | 'lost' | null }
export type ConnectionsArchiveStats = { played: number; wins: number; mistakeDistribution: number[] }
export type AccountHistoryItem = { mode: 'daily' | 'unlimited'; date: string | null; puzzleId: string; won: boolean; guesses: number; completedAt: string }

export const isProtectedBackendConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export class GameServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export function createEmptySession(mode: GameMode, date: string): GameSession {
  return {
    mode,
    puzzleId: '',
    date: mode === 'unlimited' ? null : date,
    answer: null,
    attempts: [],
    status: 'active',
    startedAt: new Date().toISOString(),
  }
}

function fromConnectionsState(state: ConnectionsBackendState, sessionToken: string, previous?: ConnectionsSession): ConnectionsSession {
  return {
    puzzleId: state.puzzleId,
    mode: state.mode,
    date: state.date,
    sessionToken,
    words: state.words,
    solvedGroups: state.solvedGroups,
    attempts: state.attempts,
    mistakeCount: state.mistakeCount,
    maxMistakes: state.maxMistakes,
    status: state.status,
    startedAt: previous?.startedAt ?? new Date().toISOString(),
  }
}

function endpoint(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wordle`
}

async function callBackend(body: Record<string, unknown>): Promise<BackendResponse> {
  let response: Response
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  const { data: { session: authSession } } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
  const accessToken = authSession?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new GameServiceError('temporary_server_failure', 'The service could not be reached.')
  } finally {
    window.clearTimeout(timeout)
  }

  let payload: BackendResponse
  try {
    payload = await response.json() as BackendResponse
  } catch {
    throw new GameServiceError('temporary_server_failure', 'The service returned an invalid response.')
  }
  if (!response.ok || payload.error) {
    throw new GameServiceError(payload.error?.code ?? 'temporary_server_failure', payload.error?.message ?? 'The service is temporarily unavailable.')
  }
  return payload
}

function fromBackendState(state: BackendState, sessionToken: string, previous?: GameSession): GameSession {
  return {
    mode: state.mode,
    puzzleId: state.puzzleId ?? previous?.puzzleId ?? '',
    date: state.date,
    answer: state.answer,
    sessionToken,
    attempts: state.attempts,
    status: state.status === 'expired' || state.status === 'abandoned' ? 'lost' : state.status,
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    completedAt: state.status === 'active' ? undefined : previous?.completedAt ?? new Date().toISOString(),
  }
}

export async function startGame(mode: GameMode, stats: Stats, date: string, forceNew = false): Promise<GameSession> {
  const saved = forceNew ? null : loadSession(mode, mode === 'unlimited' ? null : date)

  if (!isProtectedBackendConfigured) {
    throw new GameServiceError('configuration_missing', 'Connect Supabase before starting a protected game.')
  }

  const response = await callBackend({
    action: 'start',
    mode,
    archiveDate: mode === 'archive' ? date : undefined,
    sessionToken: saved?.sessionToken,
    browserId: loadBrowserId(),
    recentPuzzleIds: stats.recentUnlimitedPuzzleIds,
  })
  if (!response.state || !response.sessionToken) {
    throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete game.')
  }
  return fromBackendState(response.state, response.sessionToken, saved ?? undefined)
}

export async function startConnections(date: string, forceNew = false, mode: ConnectionsSession['mode'] = 'daily'): Promise<ConnectionsSession> {
  const saved = forceNew ? null : loadConnectionsSession(date, mode)
  if (!isProtectedBackendConfigured) {
    throw new GameServiceError('configuration_missing', 'Connect Supabase before starting Connections.')
  }

  const response = await callBackend({
    action: 'connections-start',
    mode,
    archiveDate: mode === 'archive' ? date : undefined,
    sessionToken: saved?.sessionToken,
    browserId: loadBrowserId(),
  })
  if (!response.connections?.state || !response.sessionToken) {
    throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete Connections puzzle.')
  }
  return fromConnectionsState(response.connections.state, response.sessionToken, saved ?? undefined)
}

export async function listConnectionsArchive(): Promise<ConnectionsArchivePuzzle[]> {
  const response = await callBackend({ action: 'connections-archive-list' })
  return (response as BackendResponse & { connectionsArchives?: ConnectionsArchivePuzzle[] }).connectionsArchives ?? []
}

export async function getConnectionsArchiveStats(): Promise<ConnectionsArchiveStats> {
  const response = await callBackend({ action: 'connections-archive-stats' })
  return (response as BackendResponse & { connectionsArchiveStats?: ConnectionsArchiveStats }).connectionsArchiveStats ?? { played: 0, wins: 0, mistakeDistribution: [] }
}

export async function getConnectionsStats(): Promise<ConnectionsStats> {
  if (!isProtectedBackendConfigured) throw new GameServiceError('configuration_missing', 'Connect Supabase before loading Connections statistics.')
  const response = await callBackend({ action: 'connections-stats' })
  return response.connections?.stats ?? { dailyResults: {} }
}

export async function submitConnections(session: ConnectionsSession, words: string[]): Promise<{ session: ConnectionsSession; result: ConnectionsBackendResult }> {
  if (!session.sessionToken) throw new GameServiceError('invalid_session', 'This Connections session is not valid.')
  const response = await callBackend({
    action: 'connections-submit',
    sessionToken: session.sessionToken,
    words,
    idempotencyKey: crypto.randomUUID(),
  })
  if (!response.connections?.state || !response.connections.result) {
    throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete Connections result.')
  }
  return {
    session: fromConnectionsState(response.connections.state, session.sessionToken, session),
    result: response.connections.result,
  }
}

export async function listArchivePuzzles(): Promise<ArchivePuzzle[]> {
  if (!isProtectedBackendConfigured) {
    throw new GameServiceError('configuration_missing', 'Connect Supabase before opening the archive.')
  }

  const response = await callBackend({ action: 'archive-list', browserId: loadBrowserId() })
  return response.archives ?? []
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  if (!isProtectedBackendConfigured) {
    throw new GameServiceError('configuration_missing', 'Connect Supabase before loading Archive statistics.')
  }

  const response = await callBackend({ action: 'archive-stats' })
  return response.archiveStats ?? { played: 0, wins: 0, distribution: [] }
}

export async function getAccountHistory(): Promise<AccountHistoryItem[]> {
  const response = await callBackend({ action: 'account-history' })
  return response.accountHistory ?? []
}

export async function submitGuess(session: GameSession, rawGuess: string): Promise<GameSession> {
  const guess = normalizeGuess(rawGuess)
  if (!isGuessFormatValid(guess)) {
    throw new GameServiceError('invalid_guess_format', guess.length < 5 ? 'Not enough letters' : 'Use letters only')
  }

  if (isProtectedBackendConfigured) {
    if (!session.sessionToken) throw new GameServiceError('invalid_session', 'This game session is not valid.')
    const pendingKey = `dailies:pending-guess:${session.sessionToken}:${session.attempts.length + 1}:${guess}`
    let idempotencyKey = window.sessionStorage.getItem(pendingKey)
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID()
      window.sessionStorage.setItem(pendingKey, idempotencyKey)
    }
    const response = await callBackend({
      action: 'guess',
      sessionToken: session.sessionToken,
      guess,
      expectedAttempt: session.attempts.length + 1,
      idempotencyKey,
    })
    if (!response.result) throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete guess.')
    const nextAttempts = response.result.attemptCount > session.attempts.length
      ? [...session.attempts, response.result.attempt]
      : session.attempts
    const nextSession = {
      ...session,
      attempts: nextAttempts,
      status: response.result.status,
      answer: response.result.answer ?? session.answer,
      completedAt: response.result.status === 'active' ? undefined : new Date().toISOString(),
    }
    window.sessionStorage.removeItem(pendingKey)
    return nextSession
  }

  throw new GameServiceError('configuration_missing', 'Connect Supabase before submitting a protected guess.')
}
