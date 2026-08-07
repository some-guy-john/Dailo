import { isGuessFormatValid, normalizeGuess } from './rules'
import { loadBrowserId, loadSession } from './storage'
import type { GameMode, GameSession, Stats } from './types'

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
  error?: { code: string; message: string }
}

export type ArchivePuzzle = {
  date: string
  puzzleId: string
  status: 'active' | 'won' | 'lost' | null
}

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

function endpoint(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wordle`
}

async function callBackend(body: Record<string, unknown>): Promise<BackendResponse> {
  let response: Response
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new GameServiceError('temporary_server_failure', 'The service could not be reached.')
  }

  const payload = await response.json() as BackendResponse
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

export async function listArchivePuzzles(): Promise<ArchivePuzzle[]> {
  if (!isProtectedBackendConfigured) {
    throw new GameServiceError('configuration_missing', 'Connect Supabase before opening the archive.')
  }

  const response = await callBackend({ action: 'archive-list', browserId: loadBrowserId() })
  return response.archives ?? []
}

export async function submitGuess(session: GameSession, rawGuess: string): Promise<GameSession> {
  const guess = normalizeGuess(rawGuess)
  if (!isGuessFormatValid(guess)) {
    throw new GameServiceError('invalid_guess_format', guess.length < 5 ? 'Not enough letters' : 'Use letters only')
  }

  if (isProtectedBackendConfigured) {
    if (!session.sessionToken) throw new GameServiceError('invalid_session', 'This game session is not valid.')
    const response = await callBackend({
      action: 'guess',
      sessionToken: session.sessionToken,
      guess,
      expectedAttempt: session.attempts.length + 1,
      idempotencyKey: crypto.randomUUID(),
    })
    if (!response.result) throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete guess.')
    const nextAttempts = response.result.attemptCount > session.attempts.length
      ? [...session.attempts, response.result.attempt]
      : session.attempts
    return {
      ...session,
      attempts: nextAttempts,
      status: response.result.status,
      answer: response.result.answer ?? session.answer,
      completedAt: response.result.status === 'active' ? undefined : new Date().toISOString(),
    }
  }

  throw new GameServiceError('configuration_missing', 'Connect Supabase before submitting a protected guess.')
}
