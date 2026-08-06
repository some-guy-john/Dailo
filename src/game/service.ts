import { getDailyAnswer, getDailyPuzzleId, getUnlimitedAnswer } from './puzzles'
import { isGuessFormatValid, isWinningResult, normalizeGuess, scoreGuess } from './rules'
import { loadBrowserId, loadSession } from './storage'
import type { GameMode, GameSession, Stats } from './types'
import { LOCAL_WORDS } from './localWords'

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
  error?: { code: string; message: string }
}

export const isProtectedBackendConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export class GameServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

function createLocalSession(mode: GameMode, stats: Stats, date: string): GameSession {
  if (mode === 'daily') {
    return {
      mode,
      puzzleId: getDailyPuzzleId(date),
      date,
      answer: getDailyAnswer(date),
      attempts: [],
      status: 'active',
      startedAt: new Date().toISOString(),
    }
  }

  const puzzle = getUnlimitedAnswer(stats.recentUnlimitedPuzzleIds, getDailyAnswer(date))
  return {
    mode,
    puzzleId: puzzle.puzzleId,
    date: null,
    answer: puzzle.answer,
    attempts: [],
    status: 'active',
    startedAt: new Date().toISOString(),
  }
}

export function getLocalInitialSession(mode: GameMode, stats: Stats, date: string): GameSession {
  return loadSession(mode, mode === 'daily' ? date : null) ?? createLocalSession(mode, stats, date)
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
  const saved = forceNew ? null : loadSession(mode, mode === 'daily' ? date : null)

  if (!isProtectedBackendConfigured) {
    return saved ?? createLocalSession(mode, stats, date)
  }

  const response = await callBackend({
    action: 'start',
    mode,
    sessionToken: saved?.sessionToken,
    browserId: loadBrowserId(),
    recentPuzzleIds: stats.recentUnlimitedPuzzleIds,
  })
  if (!response.state || !response.sessionToken) {
    throw new GameServiceError('temporary_server_failure', 'The service returned an incomplete game.')
  }
  return fromBackendState(response.state, response.sessionToken, saved ?? undefined)
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

  if (!LOCAL_WORDS.includes(guess)) {
    throw new GameServiceError('guess_not_in_accepted_list', 'That word is not in the list.')
  }
  if (!session.answer) throw new GameServiceError('puzzle_unavailable', 'This puzzle has no answer available.')

  const result = scoreGuess(session.answer, guess)
  const status = isWinningResult(result)
    ? 'won'
    : session.attempts.length + 1 >= 6 ? 'lost' : 'active'
  return {
    ...session,
    attempts: [...session.attempts, { guess, result }],
    status,
    completedAt: status === 'active' ? undefined : new Date().toISOString(),
  }
}
