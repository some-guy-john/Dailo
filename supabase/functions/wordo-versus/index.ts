import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, errorResponse, json, readBody } from '../_shared/http.ts'
import { consumeRateLimit } from '../_shared/rate-limit.ts'
import { createSessionToken, hashToken } from '../_shared/wordle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { autoRefreshToken: false, persistSession: false },
})

class RequestError extends Error {
  constructor(public code: string, message: string, public status: number) { super(code === 'temporary_server_failure' ? 'The match service is temporarily unavailable.' : message) }
}

function required(value: unknown, field: string, max = 256) {
  if (typeof value !== 'string' || !value || value.length > max) throw new RequestError(`invalid_${field}`, `The ${field} is invalid.`, 400)
  return value
}

const blockedNames = new Set(['admin', 'administrator', 'moderator', 'dailo', 'system'])
function displayName(value: unknown) {
  const name = required(value, 'display_name', 16).trim().replace(/\s+/g, ' ')
  if (name.length < 2 || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,14}[A-Za-z0-9]$/.test(name) || blockedNames.has(name.toLowerCase())) {
    throw new RequestError('invalid_display_name', 'Use 2–16 letters, numbers, spaces, hyphens, or underscores.', 422)
  }
  return name
}

async function participant(token: string) {
  const { data, error } = await admin.from('wordle_versus_players')
    .select('id, match_id, seat, token_hash, display_name, status, attempt_count, joined_at, completed_at')
    .eq('token_hash', await hashToken(token)).maybeSingle()
  if (error) throw new RequestError('temporary_server_failure', 'The match service is temporarily unavailable.', 503)
  if (!data) throw new RequestError('invalid_participant', 'This match session is not valid.', 401)
  return data
}

async function stateFor(token: string) {
  const caller = await participant(token)
  const { data: match, error: matchError } = await admin.from('wordle_versus_matches')
    .select('id, public_key, puzzle_word_id, status, winner_seat, created_at, joined_at, completed_at, expires_at, wordle_words!inner(normalized_word)')
    .eq('id', caller.match_id).single()
  if (matchError || !match) throw new RequestError('temporary_server_failure', 'The match service is temporarily unavailable.', 503)

  if (['waiting', 'active'].includes(match.status) && new Date(match.expires_at) <= new Date()) {
    const { data: expiry, error: expiryError } = await admin.rpc('wordle_versus_expire', { p_match_id: match.id })
    if (expiryError) throw new RequestError('temporary_server_failure', 'The match service is temporarily unavailable.', 503)
    if (expiry && typeof expiry === 'object') {
      match.status = (expiry as { status?: typeof match.status }).status ?? match.status
      match.winner_seat = (expiry as { winner_seat?: 1 | 2 | null }).winner_seat ?? null
    }
  }

  const [{ data: players, error: playerError }, { data: attempts, error: attemptError }] = await Promise.all([
    admin.from('wordle_versus_players').select('id, seat, display_name, status, attempt_count').eq('match_id', match.id).order('seat'),
    admin.from('wordle_versus_attempts').select('player_id, sequence_number, guess_word, tile_result').in('player_id', [caller.id]).order('sequence_number'),
  ])
  if (playerError || attemptError) throw new RequestError('temporary_server_failure', 'The match service is temporarily unavailable.', 503)
  const opponent = (players ?? []).find((player) => player.id !== caller.id) ?? null
  let opponentRows: string[][] = []
  if (opponent) {
    const { data, error } = await admin.from('wordle_versus_attempts').select('tile_result').eq('player_id', opponent.id).order('sequence_number')
    if (error) throw new RequestError('temporary_server_failure', 'The match service is temporarily unavailable.', 503)
    opponentRows = (data ?? []).map((attempt) => attempt.tile_result)
  }
  const terminal = ['completed', 'expired', 'cancelled'].includes(match.status)
  const outcome = !terminal ? null : match.status === 'cancelled' ? 'void' : match.winner_seat === null ? (match.status === 'expired' ? 'void' : 'draw') : match.winner_seat === caller.seat ? 'win' : 'loss'
  const hasConcession = (players ?? []).some((player) => player.status === 'conceded')
  return {
    publicKey: match.public_key, status: match.status, playerName: caller.display_name,
    opponentName: opponent?.display_name ?? null, playerStatus: caller.status, opponentStatus: opponent?.status ?? null,
    attempts: (attempts ?? []).map((attempt) => ({ guess: attempt.guess_word, result: attempt.tile_result })),
    opponentRows,
    answer: (match.status === 'completed' && !hasConcession) || (match.status === 'expired' && match.joined_at !== null)
      ? (match.wordle_words as unknown as { normalized_word: string }).normalized_word
      : null,
    outcome, expiresAt: match.expires_at,
  }
}

async function create(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'versus-create', 10, 60)) {
    throw new RequestError('rate_limited', 'Too many match creations. Try again shortly.', 429)
  }
  const name = displayName(body.displayName)
  const [{ data: scheduled, error: scheduledError }, { data: candidates, error }] = await Promise.all([
    admin.from('wordle_daily_assignments').select('answer_word_id').in('status', ['draft', 'published']),
    admin.from('wordle_words').select('id').eq('eligible_answer', true).eq('active', true).limit(2000),
  ])
  if (scheduledError || error) throw new RequestError('temporary_server_failure', 'No Versus puzzle is available right now.', 503)
  const excluded = new Set((scheduled ?? []).map((row) => row.answer_word_id))
  const pool = (candidates ?? []).filter((candidate) => !excluded.has(candidate.id))
  if (!pool.length) throw new RequestError('puzzle_unavailable', 'No Versus puzzle is available.', 503)
  const inviteToken = createSessionToken()
  const participantToken = createSessionToken()
  const { data, error: createError } = await admin.rpc('wordle_versus_create', {
    p_invite_token_hash: await hashToken(inviteToken), p_player_token_hash: await hashToken(participantToken),
    p_display_name: name, p_puzzle_word_id: pool[Math.floor(Math.random() * pool.length)].id,
  })
  if (createError) throw new RequestError('temporary_server_failure', 'The match could not be created.', 503)
  return { inviteToken, participantToken, state: await stateFor(participantToken), publicKey: data.public_key }
}

async function join(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'versus-join', 20, 60)) {
    throw new RequestError('rate_limited', 'Too many match joins. Try again shortly.', 429)
  }
  const inviteToken = required(body.inviteToken, 'invite_token')
  const participantToken = createSessionToken()
  const { data, error } = await admin.rpc('wordle_versus_join', {
    p_invite_token_hash: await hashToken(inviteToken), p_player_token_hash: await hashToken(participantToken), p_display_name: displayName(body.displayName),
  })
  if (error) throw mapped(error.message)
  if (data && typeof data === 'object' && (data as { error?: string }).error) throw mapped((data as { error: string }).error)
  return { participantToken, state: await stateFor(participantToken) }
}

function mapped(code: string) {
  const errors: Record<string, [string, number]> = {
    invalid_invite: ['This invitation is not valid.', 404], invite_unavailable: ['This invitation has already been claimed.', 409],
    invite_expired: ['This invitation has expired.', 410], invalid_participant: ['This match session is not valid.', 401],
    match_not_active: ['This match is not active.', 409], match_expired: ['This match has expired.', 410],
    attempt_sequence_conflict: ['This match is out of sync. Refresh and try again.', 409], invalid_guess_format: ['Use five letters.', 422],
    guess_not_in_accepted_list: ['That word is not in the list.', 422],
  }
  const [message, status] = errors[code] ?? ['The match request could not be completed.', 503]
  return new RequestError(errors[code] ? code : 'temporary_server_failure', message, status)
}

async function guess(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'versus-guess', 120, 60)) {
    throw new RequestError('rate_limited', 'Too many guesses. Try again shortly.', 429)
  }
  const token = required(body.participantToken, 'participant_token')
  const expected = body.expectedAttempt
  if (!Number.isInteger(expected) || (expected as number) < 1 || (expected as number) > 6) throw new RequestError('invalid_attempt_sequence', 'The attempt sequence is invalid.', 400)
  const { data, error } = await admin.rpc('wordle_versus_submit_guess', {
    p_player_token_hash: await hashToken(token), p_guess: required(body.guess, 'guess', 32),
    p_expected_attempt: expected, p_idempotency_key: required(body.idempotencyKey, 'idempotency_key', 128),
  })
  if (error) throw mapped(error.message)
  if (data && typeof data === 'object' && (data as { error?: string }).error) throw mapped((data as { error: string }).error)
  return { participantToken: token, state: await stateFor(token) }
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST for this endpoint.', 405)
  try {
    const body = await readBody(request)
    if (body.action === 'state' && !await consumeRateLimit(admin, request, 'versus-state', 40, 60)) {
      throw new RequestError('rate_limited', 'Too many match refreshes. Try again shortly.', 429)
    }
    if (body.action === 'concede' && !await consumeRateLimit(admin, request, 'versus-concede', 20, 60)) {
      throw new RequestError('rate_limited', 'Too many match requests. Try again shortly.', 429)
    }
    if (body.action === 'create') return json(await create(body, request))
    if (body.action === 'join') return json(await join(body, request))
    if (body.action === 'state') return json({ participantToken: required(body.participantToken, 'participant_token'), state: await stateFor(required(body.participantToken, 'participant_token')) })
    if (body.action === 'guess') return json(await guess(body, request))
    if (body.action === 'concede') {
      const token = required(body.participantToken, 'participant_token')
      const { error } = await admin.rpc('wordle_versus_concede', { p_player_token_hash: await hashToken(token) })
      if (error) throw mapped(error.message)
      return json({ participantToken: token, state: await stateFor(token) })
    }
    throw new RequestError('invalid_action', 'The requested action is invalid.', 400)
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.code, error.message, error.status)
    if (error instanceof Error && error.message === 'invalid_json') return errorResponse('invalid_json', 'The request body is not valid JSON.', 400)
    if (error instanceof Error && error.message === 'request_body_too_large') return errorResponse('request_body_too_large', 'The request body is too large.', 413)
    console.error('wordo_versus_error', error)
    return errorResponse('temporary_server_failure', 'The match service is temporarily unavailable.', 503)
  }
}

Deno.serve(handle)
