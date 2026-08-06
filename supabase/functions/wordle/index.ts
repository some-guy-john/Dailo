import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, errorResponse, json, readBody } from '../_shared/http.ts'
import { createSessionToken, hashToken, isUuid, londonDate } from '../_shared/wordle.ts'

type SessionRow = {
  id: string
  token_hash: string
  browser_id_hash: string | null
  mode: 'daily' | 'unlimited'
  puzzle_word_id: string
  daily_date: string | null
  status: 'active' | 'won' | 'lost' | 'abandoned' | 'expired'
  attempt_count: number
  started_at: string
  completed_at: string | null
  expires_at: string
  wordle_words?: { public_key: string; normalized_word: string } | null
}

type AttemptRow = {
  sequence_number: number
  guess_word: string
  tile_result: string[]
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function requireString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new RequestError(`invalid_${field}`, `The ${field} is invalid.`, 400)
  }
  return value
}

class RequestError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

async function hashOptionalIdentifier(value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null
  const identifier = requireString(value, 'browser_id', 128)
  return hashToken(identifier)
}

async function findSession(token: string): Promise<SessionRow> {
  const tokenHash = await hashToken(token)
  const { data, error } = await admin
    .from('wordle_game_sessions')
    .select('id, token_hash, browser_id_hash, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  if (!data) throw new RequestError('invalid_session', 'This game session is not valid.', 401)
  return data as unknown as SessionRow
}

async function publicState(session: SessionRow) {
  const { data: attempts, error } = await admin
    .from('wordle_attempts')
    .select('sequence_number, guess_word, tile_result')
    .eq('session_id', session.id)
    .order('sequence_number', { ascending: true })

  if (error) throw new RequestError('temporary_server_failure', error.message, 503)

  const state = {
    sessionId: session.id,
    mode: session.mode,
    puzzleId: session.wordle_words?.public_key ?? null,
    date: session.daily_date,
    status: session.status,
    attemptCount: session.attempt_count,
    attempts: (attempts ?? []) as AttemptRow[],
    answer: session.status === 'won' || session.status === 'lost'
      ? session.wordle_words?.normalized_word ?? null
      : null,
  }

  return state
}

async function startSession(body: Record<string, unknown>) {
  const mode = body.mode
  if (mode !== 'daily' && mode !== 'unlimited') {
    throw new RequestError('invalid_mode', 'The game mode is invalid.', 400)
  }

  const providedToken = body.sessionToken
  if (providedToken !== undefined && providedToken !== null && providedToken !== '') {
    const token = requireString(providedToken, 'session_token', 256)
    const session = await findSession(token)
    if (session.mode !== mode) throw new RequestError('invalid_session', 'This session belongs to another mode.', 409)

    if (session.status === 'active' && new Date(session.expires_at) < new Date()) {
      await admin.from('wordle_game_sessions').update({ status: 'expired' }).eq('id', session.id)
      session.status = 'expired'
    }

    return { sessionToken: token, state: await publicState(session) }
  }

  const browserIdHash = await hashOptionalIdentifier(body.browserId)
  let puzzleWordId: string
  let dailyDate: string | null = null

  if (mode === 'daily') {
    dailyDate = londonDate()

    if (browserIdHash) {
      const { data: existingSession, error: existingSessionError } = await admin
        .from('wordle_game_sessions')
        .select('id, token_hash, browser_id_hash, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
        .eq('browser_id_hash', browserIdHash)
        .eq('daily_date', dailyDate)
        .eq('mode', 'daily')
        .maybeSingle()

      if (existingSessionError) throw new RequestError('temporary_server_failure', existingSessionError.message, 503)
      if (existingSession) {
        const existingToken = body.sessionToken
        if (typeof existingToken !== 'string' || existingToken.length === 0) {
          throw new RequestError('daily_already_started', 'This browser already has a daily game. Clear local data only if you intend to lose access to it.', 409)
        }
        const tokenHash = await hashToken(existingToken)
        if (tokenHash !== existingSession.token_hash) {
          throw new RequestError('daily_already_started', 'This browser already has a daily game in progress.', 409)
        }
        return { sessionToken: existingToken, state: await publicState(existingSession as unknown as SessionRow) }
      }
    }

    const { data: assignment, error } = await admin
      .from('wordle_daily_assignments')
      .select('answer_word_id')
      .eq('london_date', dailyDate)
      .eq('status', 'published')
      .maybeSingle()

    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    if (!assignment) throw new RequestError('missing_daily_assignment', 'Today’s puzzle is not available yet.', 503)
    puzzleWordId = assignment.answer_word_id
  } else {
    const recentPuzzleIds = Array.isArray(body.recentPuzzleIds)
      ? body.recentPuzzleIds.filter(isUuid).slice(0, 20)
      : []
    const { data: currentAssignment } = await admin
      .from('wordle_daily_assignments')
      .select('answer_word_id')
      .eq('london_date', londonDate())
      .eq('status', 'published')
      .maybeSingle()
    const excluded = new Set(recentPuzzleIds)
    if (currentAssignment?.answer_word_id) excluded.add(currentAssignment.answer_word_id)

    const { data: candidates, error } = await admin
      .from('wordle_words')
      .select('id, public_key')
      .eq('eligible_answer', true)
      .eq('active', true)
      .limit(1000)

    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    const eligible = (candidates ?? []).filter((candidate) => !excluded.has(candidate.public_key))
    const fallback = (candidates ?? []).filter((candidate) => candidate.id !== currentAssignment?.answer_word_id)
    const pool = eligible.length > 0 ? eligible : fallback
    if (pool.length === 0) throw new RequestError('puzzle_unavailable', 'No practice puzzles are available.', 503)
    puzzleWordId = pool[Math.floor(Math.random() * pool.length)].id
  }

  const token = createSessionToken()
  const tokenHash = await hashToken(token)
  const { data: created, error } = await admin
    .from('wordle_game_sessions')
    .insert({
      token_hash: tokenHash,
      browser_id_hash: browserIdHash,
      mode,
      puzzle_word_id: puzzleWordId,
      daily_date: dailyDate,
      expires_at: new Date(Date.now() + (mode === 'daily' ? 1000 * 60 * 60 * 24 * 8 : 1000 * 60 * 60 * 24)).toISOString(),
    })
    .select('id, token_hash, browser_id_hash, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
    .single()

  if (error || !created) throw new RequestError('temporary_server_failure', error?.message ?? 'Could not create game.', 503)
  return { sessionToken: token, state: await publicState(created as unknown as SessionRow) }
}

async function submitGuess(body: Record<string, unknown>) {
  const token = requireString(body.sessionToken, 'session_token', 256)
  const guess = requireString(body.guess, 'guess', 32)
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency_key', 128)
  const expectedAttempt = body.expectedAttempt
  if (typeof expectedAttempt !== 'number' || !Number.isInteger(expectedAttempt) || expectedAttempt < 1 || expectedAttempt > 6) {
    throw new RequestError('invalid_attempt_sequence', 'The attempt sequence is invalid.', 400)
  }

  const { data, error } = await admin.rpc('wordle_submit_guess', {
    p_token_hash: await hashToken(token),
    p_guess: guess,
    p_expected_attempt: expectedAttempt,
    p_idempotency_key: idempotencyKey,
  })

  if (error) {
    const knownErrors: Record<string, [string, number]> = {
      invalid_session: ['This game session is not valid.', 401],
      expired_session: ['This game session has expired.', 410],
      invalid_guess_format: ['Use five letters.', 422],
      guess_not_in_accepted_list: ['That word is not in the list.', 422],
      attempt_sequence_conflict: ['This game is out of sync. Refresh and try again.', 409],
      game_already_complete: ['This game is already complete.', 409],
      puzzle_unavailable: ['This puzzle is temporarily unavailable.', 503],
    }
    const [message, status] = knownErrors[error.message] ?? ['The guess could not be submitted.', 503]
    throw new RequestError(error.message, message, status)
  }

  return { sessionToken: token, result: data }
}

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST for this endpoint.', 405)

  try {
    const body = await readBody(request)
    const action = body.action
    if (action === 'start') return json(await startSession(body))
    if (action === 'guess') return json(await submitGuess(body))
    throw new RequestError('invalid_action', 'The requested action is invalid.', 400)
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.code, error.message, error.status)
    if (error instanceof Error && error.message === 'invalid_json') return errorResponse('invalid_json', 'The request body is not valid JSON.', 400)
    console.error('wordle_function_error', error)
    return errorResponse('temporary_server_failure', 'The service is temporarily unavailable.', 503)
  }
}

Deno.serve(handle)
