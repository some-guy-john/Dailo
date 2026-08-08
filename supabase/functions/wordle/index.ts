import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, errorResponse, json, readBody } from '../_shared/http.ts'
import { consumeRateLimit } from '../_shared/rate-limit.ts'
import { createSessionToken, hashToken, isCalendarDate, isUuid, londonDate } from '../_shared/wordle.ts'

type SessionRow = {
  id: string
  token_hash: string
  browser_id_hash: string | null
  auth_user_id: string | null
  mode: 'daily' | 'unlimited' | 'archive'
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

type ConnectionsGroup = {
  key: string
  label: string
  difficulty: 1 | 2 | 3 | 4
  words: string[]
}

type ConnectionsSessionRow = {
  id: string
  token_hash: string
  browser_id_hash: string | null
  auth_user_id: string | null
  mode: 'daily' | 'archive'
  puzzle_id: string
  london_date: string
  status: 'active' | 'won' | 'lost' | 'expired'
  mistake_count: number
  solved_groups: string[]
  started_at: string
  completed_at: string | null
  expires_at: string
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
    super(code === 'temporary_server_failure' ? 'The service is temporarily unavailable.' : message)
  }
}

async function hashOptionalIdentifier(value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null
  const identifier = requireString(value, 'browser_id', 128)
  return hashToken(identifier)
}

async function requireConfirmedUser(request: Request): Promise<{ id: string; email: string | undefined }> {
  const authorization = request.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new RequestError('archive_auth_required', 'Sign in with a confirmed email to use Archive.', 401)

  const { data, error } = await admin.auth.getUser(match[1])
  if (error || !data.user) throw new RequestError('archive_auth_required', 'Sign in with a confirmed email to use Archive.', 401)
  if (!data.user.email_confirmed_at) throw new RequestError('archive_email_unconfirmed', 'Confirm your email before using Archive.', 403)
  return { id: data.user.id, email: data.user.email }
}

async function optionalConfirmedUser(request: Request): Promise<{ id: string; email: string | undefined } | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await admin.auth.getUser(match[1])
  if (error || !data.user || !data.user.email_confirmed_at) return null
  return { id: data.user.id, email: data.user.email }
}

async function findSession(token: string): Promise<SessionRow> {
  const tokenHash = await hashToken(token)
  const columns = 'id, token_hash, browser_id_hash, auth_user_id, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)'
  const { data: canonical, error: canonicalError } = await admin
    .from('wordle_game_sessions')
    .select(columns)
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (canonicalError) throw new RequestError('temporary_server_failure', canonicalError.message, 503)
  if (canonical) return canonical as unknown as SessionRow

  const { data: access, error: accessError } = await admin.from('wordle_game_session_tokens')
    .select('session_id').eq('token_hash', tokenHash).maybeSingle()
  if (accessError) throw new RequestError('temporary_server_failure', accessError.message, 503)
  if (!access) throw new RequestError('invalid_session', 'This game session is not valid.', 401)
  await admin.from('wordle_game_session_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  const { data, error } = await admin.from('wordle_game_sessions').select(columns).eq('id', access.session_id).single()
  if (error || !data) throw new RequestError('temporary_server_failure', error?.message ?? 'This game session is not valid.', 503)
  return data as unknown as SessionRow
}

async function issueWordleAccessToken(sessionId: string, browserIdHash: string | null): Promise<string> {
  const token = createSessionToken()
  const { error } = await admin.from('wordle_game_session_tokens').insert({
    session_id: sessionId,
    token_hash: await hashToken(token),
    browser_id_hash: browserIdHash,
  })
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  return token
}

async function issueConnectionsAccessToken(sessionId: string, browserIdHash: string | null): Promise<string> {
  const token = createSessionToken()
  const { error } = await admin.from('connections_game_session_tokens').insert({
    session_id: sessionId,
    token_hash: await hashToken(token),
    browser_id_hash: browserIdHash,
  })
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  return token
}

async function publicState(session: SessionRow) {
  if (session.status === 'active' && new Date(session.expires_at) <= new Date()) {
    const completedAt = new Date().toISOString()
    const { data: expiryRow, error: expiryError } = await admin.from('wordle_game_sessions')
      .update({ status: 'expired', completed_at: completedAt })
      .eq('id', session.id)
      .eq('status', 'active')
      .select('status, completed_at')
      .maybeSingle()
    if (expiryError) throw new RequestError('temporary_server_failure', expiryError.message, 503)
    if (expiryRow) {
      session.status = expiryRow.status as SessionRow['status']
      session.completed_at = expiryRow.completed_at
    } else {
      const { data: current, error: currentError } = await admin.from('wordle_game_sessions')
        .select('status, completed_at').eq('id', session.id).single()
      if (currentError) throw new RequestError('temporary_server_failure', currentError.message, 503)
      session.status = current.status as SessionRow['status']
      session.completed_at = current.completed_at
    }
  }

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
    attempts: (attempts ?? []).map((attempt) => ({
      guess: attempt.guess_word,
      result: attempt.tile_result,
    })),
    answer: session.status === 'won' || session.status === 'lost'
      ? session.wordle_words?.normalized_word ?? null
      : null,
    accountOwned: Boolean(session.auth_user_id),
    accountUserId: session.auth_user_id,
  }

  return state
}

async function connectionsState(session: ConnectionsSessionRow, tokenHash?: string) {
  if (tokenHash && session.status === 'active' && new Date(session.expires_at) <= new Date()) {
    const { data: expiryStatus, error: expiryError } = await admin.rpc('connections_expire_session', { p_token_hash: tokenHash })
    if (expiryError) throw new RequestError('temporary_server_failure', expiryError.message, 503)
    if (typeof expiryStatus === 'string' && expiryStatus !== 'active') {
      session.status = expiryStatus as ConnectionsSessionRow['status']
      session.completed_at = new Date().toISOString()
    }
  }

  const [{ data: puzzle, error: puzzleError }, { data: attempts, error: attemptsError }] = await Promise.all([
    admin.from('connections_daily_puzzles').select('public_key, london_date, words, groups').eq('id', session.puzzle_id).single(),
    admin.from('connections_attempts').select('selected_words, result, group_data').eq('session_id', session.id).order('sequence_number', { ascending: true }),
  ])

  if (puzzleError || attemptsError || !puzzle) {
    throw new RequestError('temporary_server_failure', puzzleError?.message ?? attemptsError?.message ?? 'Connections puzzle unavailable.', 503)
  }

  const groups = puzzle.groups as ConnectionsGroup[]
  const solvedKeys = session.solved_groups ?? []
  const solvedGroups = groups.filter((group) => solvedKeys.includes(group.key))
  const revealAll = session.status === 'won' || session.status === 'lost' || session.status === 'expired'
  return {
    mode: session.mode,
    puzzleId: puzzle.public_key,
    date: puzzle.london_date,
    words: puzzle.words,
    solvedGroups: revealAll ? groups : solvedGroups,
    attempts: (attempts ?? []).map((attempt) => ({
      words: attempt.selected_words,
      result: attempt.result,
      group: attempt.group_data ?? undefined,
    })),
    mistakeCount: session.mistake_count,
    maxMistakes: 4,
    status: session.status,
    accountOwned: Boolean(session.auth_user_id),
    accountUserId: session.auth_user_id,
  }
}

const connectionsSessionColumns = 'id, token_hash, browser_id_hash, auth_user_id, mode, puzzle_id, london_date, status, mistake_count, solved_groups, started_at, completed_at, expires_at'

async function startConnections(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'connections-start', 20, 60)) {
    throw new RequestError('rate_limited', 'Too many Connections starts. Try again shortly.', 429)
  }
  const mode = body.mode === 'archive' ? 'archive' : 'daily'
  const currentDate = londonDate()
  const authUser = mode === 'archive' ? await requireConfirmedUser(request) : await optionalConfirmedUser(request)
  const puzzleDate = mode === 'archive' ? requireString(body.archiveDate, 'archive_date', 10) : currentDate
  if (!isCalendarDate(puzzleDate) || (mode === 'archive' && puzzleDate >= currentDate)) {
    throw new RequestError('archive_date_unavailable', 'Only past Connections puzzles are available in the archive.', 422)
  }
  const providedToken = body.sessionToken
  if (typeof providedToken === 'string' && providedToken.length > 0) {
    const tokenHash = await hashToken(providedToken)
    const { data: canonical, error: canonicalError } = await admin.from('connections_game_sessions')
      .select(connectionsSessionColumns).eq('token_hash', tokenHash).maybeSingle()
    if (canonicalError) throw new RequestError('temporary_server_failure', canonicalError.message, 503)
    let session = canonical
    if (!session) {
      const { data: access, error: accessError } = await admin.from('connections_game_session_tokens')
        .select('session_id').eq('token_hash', tokenHash).maybeSingle()
      if (accessError) throw new RequestError('temporary_server_failure', accessError.message, 503)
      if (access) {
        const { data: accessSession, error: accessSessionError } = await admin.from('connections_game_sessions')
          .select(connectionsSessionColumns).eq('id', access.session_id).single()
        if (accessSessionError) throw new RequestError('temporary_server_failure', accessSessionError.message, 503)
        session = accessSession
        await admin.from('connections_game_session_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
      }
    }
    if (session) {
      if (session.mode !== mode) throw new RequestError('invalid_session', 'This Connections session belongs to another mode.', 409)
      if (session.auth_user_id && session.auth_user_id !== authUser?.id) throw new RequestError('invalid_session', 'This Connections session belongs to another account.', 401)
      if (authUser && !session.auth_user_id) {
        const { data: claimedId, error: claimError } = await admin.rpc('connections_claim_or_find_session', { p_session_id: session.id, p_auth_user_id: authUser.id })
        if (claimError) throw new RequestError('temporary_server_failure', claimError.message, 503)
        if (claimedId !== session.id) {
          const accessToken = await issueConnectionsAccessToken(claimedId, await hashOptionalIdentifier(body.browserId))
          const accessSession = await findConnectionsSession(accessToken)
          return { sessionToken: accessToken, connections: { state: await connectionsState(accessSession, await hashToken(accessToken)) } }
        }
        session.auth_user_id = authUser.id
      }
      return { sessionToken: providedToken, connections: { state: await connectionsState(session as ConnectionsSessionRow, await hashToken(providedToken)) } }
    }
  }

  const browserIdHash = await hashOptionalIdentifier(body.browserId)
  if (authUser) {
    const { data: existing, error } = await admin.from('connections_game_sessions').select(connectionsSessionColumns)
      .eq('auth_user_id', authUser.id).eq('london_date', puzzleDate).eq('mode', mode).maybeSingle()
    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    if (existing) {
      const replacementToken = createSessionToken()
      const replacementHash = await hashToken(replacementToken)
      const { error: tokenError } = await admin.from('connections_game_session_tokens')
        .insert({ session_id: existing.id, token_hash: replacementHash, browser_id_hash: browserIdHash })
      if (tokenError) throw new RequestError('temporary_server_failure', tokenError.message, 503)
      return { sessionToken: replacementToken, connections: { state: await connectionsState(existing as ConnectionsSessionRow, replacementHash) } }
    }
  }
  if (browserIdHash) {
    const { data: existing, error } = await admin
      .from('connections_game_sessions')
      .select(connectionsSessionColumns)
      .eq('browser_id_hash', browserIdHash)
      .eq('london_date', puzzleDate)
      .eq('mode', mode)
      .maybeSingle()
    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    if (existing) throw new RequestError('connections_already_started', 'This browser already has today’s Connections puzzle.', 409)
  }

  const { data: puzzle, error: puzzleError } = await admin
    .from('connections_daily_puzzles')
    .select('id')
    .eq('london_date', puzzleDate)
    .eq('status', 'published')
    .maybeSingle()
  if (puzzleError) throw new RequestError('temporary_server_failure', puzzleError.message, 503)
  if (!puzzle) throw new RequestError('missing_connections_assignment', 'Today’s Connections puzzle is not available yet.', 503)

  const token = createSessionToken()
  const tokenHash = await hashToken(token)
  const { data: created, error } = await admin
    .from('connections_game_sessions')
    .insert({
      token_hash: tokenHash,
      browser_id_hash: browserIdHash,
      auth_user_id: authUser?.id ?? null,
      mode,
      puzzle_id: puzzle.id,
      london_date: puzzleDate,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 8).toISOString(),
    })
    .select(connectionsSessionColumns)
    .single()
  if (error || !created) throw new RequestError('temporary_server_failure', error?.message ?? 'Could not create Connections game.', 503)
  return { sessionToken: token, connections: { state: await connectionsState(created as ConnectionsSessionRow, tokenHash) } }
}

async function submitConnections(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'connections-submit', 120, 60)) {
    throw new RequestError('rate_limited', 'Too many Connections submissions. Try again shortly.', 429)
  }
  const token = requireString(body.sessionToken, 'session_token', 256)
  const selectedWords = body.words
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency_key', 128)
  if (!Array.isArray(selectedWords) || selectedWords.length !== 4 || selectedWords.some((word) => typeof word !== 'string')) {
    throw new RequestError('invalid_selection', 'Select four different words.', 422)
  }

  const session = await findConnectionsSession(token)
  if (session.auth_user_id) {
    const authUser = await optionalConfirmedUser(request)
    if (authUser?.id !== session.auth_user_id) throw new RequestError('invalid_session', 'This Connections session belongs to another account.', 401)
  }
  const { data, error } = await admin.rpc('connections_submit_guess', {
    p_token_hash: await hashToken(token),
    p_selected_words: selectedWords,
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    const knownErrors: Record<string, [string, number]> = {
      invalid_session: ['This Connections session is not valid.', 401],
      expired_session: ['This Connections session has expired.', 410],
      invalid_selection: ['Select four different words.', 422],
      group_already_solved: ['That group has already been found.', 422],
      game_already_complete: ['This Connections puzzle is already complete.', 409],
      puzzle_unavailable: ['This puzzle is temporarily unavailable.', 503],
    }
    const [message, status] = knownErrors[error.message] ?? ['The selection could not be checked.', 503]
    throw new RequestError(knownErrors[error.message] ? error.message : 'temporary_server_failure', message, status)
  }
  if (data && typeof data === 'object' && (data as { error?: string }).error) {
    const code = (data as { error: string }).error
    const knownErrors: Record<string, [string, number]> = {
      expired_session: ['This Connections session has expired.', 410],
    }
    const [message, status] = knownErrors[code] ?? ['The selection could not be checked.', 503]
    throw new RequestError(code, message, status)
  }
  const latest = await findConnectionsSession(token)
  return {
    sessionToken: token,
    connections: {
      result: data,
      state: await connectionsState(latest, await hashToken(token)),
    },
  }
}

async function findConnectionsSession(token: string): Promise<ConnectionsSessionRow> {
  const tokenHash = await hashToken(token)
  const { data, error } = await admin
    .from('connections_game_sessions')
    .select(connectionsSessionColumns)
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  if (data) return data as ConnectionsSessionRow
  const { data: access, error: accessError } = await admin.from('connections_game_session_tokens')
    .select('session_id').eq('token_hash', tokenHash).maybeSingle()
  if (accessError) throw new RequestError('temporary_server_failure', accessError.message, 503)
  if (!access) throw new RequestError('invalid_session', 'This Connections session is not valid.', 401)
  await admin.from('connections_game_session_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  const { data: session, error: sessionError } = await admin.from('connections_game_sessions')
    .select(connectionsSessionColumns).eq('id', access.session_id).single()
  if (sessionError || !session) throw new RequestError('temporary_server_failure', sessionError?.message ?? 'This Connections session is not valid.', 503)
  return session as ConnectionsSessionRow
}

async function connectionsStats(request: Request) {
  const authUser = await requireConfirmedUser(request)
  const { data, error } = await admin.from('connections_game_sessions')
    .select('london_date, status, mistake_count').eq('auth_user_id', authUser.id)
    .eq('mode', 'daily')
    .in('status', ['won', 'lost', 'expired']).order('london_date', { ascending: true }).limit(1000)
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  const dailyResults = Object.fromEntries((data ?? []).map((session) => [session.london_date, {
    date: session.london_date,
    won: session.status === 'won',
    mistakes: session.mistake_count,
  }]))
  return { connections: { stats: { dailyResults } } }
}

async function listConnectionsArchive(request: Request) {
  const authUser = await requireConfirmedUser(request)
  const currentDate = londonDate()
  const { data: puzzles, error } = await admin.from('connections_daily_puzzles')
    .select('public_key, london_date').eq('status', 'published').lt('london_date', currentDate)
    .order('london_date', { ascending: false }).limit(365)
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  const dates = (puzzles ?? []).map((puzzle) => puzzle.london_date)
  const { data: sessions, error: sessionsError } = dates.length === 0
    ? { data: [], error: null }
    : await admin.from('connections_game_sessions').select('london_date, status')
      .eq('auth_user_id', authUser.id).eq('mode', 'archive').in('london_date', dates)
  if (sessionsError) throw new RequestError('temporary_server_failure', sessionsError.message, 503)
  const statusByDate = new Map((sessions ?? []).map((session) => [session.london_date, session.status === 'expired' ? 'lost' : session.status]))
  return { connectionsArchives: (puzzles ?? []).map((puzzle) => ({
    date: puzzle.london_date, puzzleId: puzzle.public_key, status: statusByDate.get(puzzle.london_date) ?? null,
  })) }
}

async function connectionsArchiveStats(request: Request) {
  const authUser = await requireConfirmedUser(request)
  const { data, error } = await admin.from('connections_game_sessions').select('status, mistake_count')
     .eq('auth_user_id', authUser.id).eq('mode', 'archive').in('status', ['won', 'lost', 'expired']).limit(1000)
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  const mistakeDistribution = Array.from({ length: 5 }, () => 0)
  for (const session of data ?? []) if (session.status === 'won') mistakeDistribution[session.mistake_count] += 1
  return { connectionsArchiveStats: {
    played: data?.length ?? 0, wins: (data ?? []).filter((session) => session.status === 'won').length, mistakeDistribution,
  } }
}

async function startSession(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'wordle-start', 20, 60)) {
    throw new RequestError('rate_limited', 'Too many game starts. Try again shortly.', 429)
  }
  const mode = body.mode
  if (mode !== 'daily' && mode !== 'unlimited' && mode !== 'archive') {
    throw new RequestError('invalid_mode', 'The game mode is invalid.', 400)
  }

  const authUser = mode === 'archive' ? await requireConfirmedUser(request) : await optionalConfirmedUser(request)

  const providedToken = body.sessionToken
  if (providedToken !== undefined && providedToken !== null && providedToken !== '') {
    const token = requireString(providedToken, 'session_token', 256)
    const session = await findSession(token)
    if (session.mode !== mode) throw new RequestError('invalid_session', 'This session belongs to another mode.', 409)
    if (session.mode === 'archive') {
      if (session.auth_user_id !== authUser?.id) throw new RequestError('invalid_session', 'This archive session belongs to another account.', 401)
    } else if (session.auth_user_id && session.auth_user_id !== authUser?.id) {
      throw new RequestError('invalid_session', 'This game session belongs to another account.', 401)
    } else if (authUser && !session.auth_user_id) {
      const { data: claimedId, error: claimError } = await admin.rpc('wordle_claim_or_find_session', { p_session_id: session.id, p_auth_user_id: authUser.id })
      if (claimError) throw new RequestError('temporary_server_failure', claimError.message, 503)
      if (claimedId !== session.id) {
        const accessToken = await issueWordleAccessToken(claimedId, await hashOptionalIdentifier(body.browserId))
        const accessSession = await findSession(accessToken)
        return { sessionToken: accessToken, state: await publicState(accessSession) }
      }
      session.auth_user_id = authUser.id
    }

    return { sessionToken: token, state: await publicState(session) }
  }

  const browserIdHash = await hashOptionalIdentifier(body.browserId)
  let puzzleWordId: string
  let dailyDate: string | null = null

  if (mode === 'daily') {
    dailyDate = londonDate()

    if (authUser) {
      const { data: owned, error: ownedError } = await admin.from('wordle_game_sessions')
        .select('id, token_hash, browser_id_hash, auth_user_id, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
        .eq('auth_user_id', authUser.id).eq('daily_date', dailyDate).eq('mode', 'daily').maybeSingle()
      if (ownedError) throw new RequestError('temporary_server_failure', ownedError.message, 503)
      if (owned) {
        const replacementToken = createSessionToken()
        const replacementHash = await hashToken(replacementToken)
        const { error: tokenError } = await admin.from('wordle_game_session_tokens').insert({ session_id: owned.id, token_hash: replacementHash, browser_id_hash: browserIdHash })
        if (tokenError) throw new RequestError('temporary_server_failure', tokenError.message, 503)
        return { sessionToken: replacementToken, state: await publicState(owned as unknown as SessionRow) }
      }
    }

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
  } else if (mode === 'archive') {
    const archiveDate = requireString(body.archiveDate, 'archive_date', 10)
    if (!isCalendarDate(archiveDate)) {
      throw new RequestError('invalid_archive_date', 'The archive date is invalid.', 400)
    }
    const currentDate = londonDate()
    if (archiveDate >= currentDate) {
      throw new RequestError('archive_date_unavailable', 'Only past daily puzzles are available in the archive.', 422)
    }
    dailyDate = archiveDate

    if (authUser) {
      const { data: existingSession, error: existingSessionError } = await admin
        .from('wordle_game_sessions')
        .select('id, token_hash, browser_id_hash, auth_user_id, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
        .eq('auth_user_id', authUser.id)
        .eq('daily_date', archiveDate)
        .eq('mode', 'archive')
        .maybeSingle()

      if (existingSessionError) throw new RequestError('temporary_server_failure', existingSessionError.message, 503)
      if (existingSession) {
        const existingToken = body.sessionToken
        if (typeof existingToken === 'string' && existingToken.length > 0) {
          const tokenHash = await hashToken(existingToken)
          if (tokenHash === existingSession.token_hash) {
            return { sessionToken: existingToken, state: await publicState(existingSession as unknown as SessionRow) }
          }
        }
        // Authenticated owners may resume from a different browser. The new
        // token is only returned after the user has been verified above.
        const replacementToken = createSessionToken()
        const replacementHash = await hashToken(replacementToken)
        const { error: tokenError } = await admin.from('wordle_game_session_tokens')
          .insert({ session_id: existingSession.id, token_hash: replacementHash, browser_id_hash: browserIdHash })
        if (tokenError) throw new RequestError('temporary_server_failure', tokenError.message, 503)
        return { sessionToken: replacementToken, state: await publicState(existingSession as unknown as SessionRow) }
      }
    }

    const { data: assignment, error } = await admin
      .from('wordle_daily_assignments')
      .select('answer_word_id')
      .eq('london_date', archiveDate)
      .eq('status', 'published')
      .maybeSingle()

    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    if (!assignment) throw new RequestError('archive_date_unavailable', 'That daily puzzle is not available in the archive.', 404)
    puzzleWordId = assignment.answer_word_id
  } else {
    const recentPuzzleIds = Array.isArray(body.recentPuzzleIds)
      ? body.recentPuzzleIds.filter(isUuid).slice(0, 20)
      : []
    const { data: currentAssignment, error: currentAssignmentError } = await admin
      .from('wordle_daily_assignments')
      .select('answer_word_id')
      .eq('london_date', londonDate())
      .eq('status', 'published')
      .maybeSingle()
    if (currentAssignmentError) throw new RequestError('temporary_server_failure', 'The practice puzzle is temporarily unavailable.', 503)
    const excluded = new Set(recentPuzzleIds)
    const currentAnswerId = currentAssignment?.answer_word_id

    const { data: candidates, error } = await admin
      .from('wordle_words')
      .select('id, public_key')
      .eq('eligible_answer', true)
      .eq('active', true)
      .limit(1000)

    if (error) throw new RequestError('temporary_server_failure', error.message, 503)
    const eligible = (candidates ?? []).filter((candidate) => candidate.id !== currentAnswerId && !excluded.has(candidate.public_key))
    const fallback = (candidates ?? []).filter((candidate) => candidate.id !== currentAnswerId)
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
      auth_user_id: authUser?.id ?? null,
      mode,
      puzzle_word_id: puzzleWordId,
      daily_date: dailyDate,
      expires_at: new Date(Date.now() + (mode === 'daily' ? 1000 * 60 * 60 * 24 * 8 : mode === 'archive' ? 1000 * 60 * 60 * 24 * 365 : 1000 * 60 * 60 * 24)).toISOString(),
    })
    .select('id, token_hash, browser_id_hash, auth_user_id, mode, puzzle_word_id, daily_date, status, attempt_count, started_at, completed_at, expires_at, wordle_words!inner(public_key, normalized_word)')
    .single()

  if (error || !created) throw new RequestError('temporary_server_failure', error?.message ?? 'Could not create game.', 503)
  return { sessionToken: token, state: await publicState(created as unknown as SessionRow) }
}

async function submitGuess(body: Record<string, unknown>, request: Request) {
  if (!await consumeRateLimit(admin, request, 'wordle-guess', 120, 60)) {
    throw new RequestError('rate_limited', 'Too many guesses. Try again shortly.', 429)
  }
  const token = requireString(body.sessionToken, 'session_token', 256)
  const guess = requireString(body.guess, 'guess', 32)
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency_key', 128)
  const expectedAttempt = body.expectedAttempt
  if (typeof expectedAttempt !== 'number' || !Number.isInteger(expectedAttempt) || expectedAttempt < 1 || expectedAttempt > 6) {
    throw new RequestError('invalid_attempt_sequence', 'The attempt sequence is invalid.', 400)
  }

  const session = await findSession(token)
  if (session.mode === 'archive') {
    const authUser = await requireConfirmedUser(request)
    if (session.auth_user_id !== authUser.id) throw new RequestError('invalid_session', 'This archive session belongs to another account.', 401)
  }
  if (session.auth_user_id && session.mode !== 'archive') {
    const authUser = await optionalConfirmedUser(request)
    if (authUser?.id !== session.auth_user_id) throw new RequestError('invalid_session', 'This game session belongs to another account.', 401)
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
     throw new RequestError(knownErrors[error.message] ? error.message : 'temporary_server_failure', message, status)
  }

  return { sessionToken: token, result: data }
}

async function listArchive(body: Record<string, unknown>, request: Request) {
  const currentDate = londonDate()
  const authUser = await requireConfirmedUser(request)
  const { data: assignments, error: assignmentError } = await admin
    .from('wordle_daily_assignments')
    .select('london_date, wordle_words!inner(public_key)')
    .eq('status', 'published')
    .lt('london_date', currentDate)
    .order('london_date', { ascending: false })
    .limit(365)

  if (assignmentError) throw new RequestError('temporary_server_failure', assignmentError.message, 503)

  const dates = (assignments ?? []).map((assignment) => assignment.london_date)
  let sessions: Array<{ daily_date: string; status: SessionRow['status'] }> = []
  if (dates.length > 0) {
    const { data, error: sessionError } = await admin
      .from('wordle_game_sessions')
      .select('daily_date, status')
      .eq('auth_user_id', authUser.id)
      .eq('mode', 'archive')
      .in('daily_date', dates)

    if (sessionError) throw new RequestError('temporary_server_failure', sessionError.message, 503)
    sessions = (data ?? []) as Array<{ daily_date: string; status: SessionRow['status'] }>
  }

  const statusByDate = new Map(sessions.map((session) => [session.daily_date, session.status === 'expired' ? 'lost' : session.status]))
  return {
    archives: (assignments ?? []).map((assignment) => ({
      date: assignment.london_date,
      puzzleId: (assignment.wordle_words as { public_key: string }).public_key,
      status: statusByDate.get(assignment.london_date) ?? null,
    })),
  }
}

async function archiveStats(request: Request) {
  const authUser = await requireConfirmedUser(request)
  const { data: sessions, error } = await admin
    .from('wordle_game_sessions')
    .select('status, attempt_count')
    .eq('auth_user_id', authUser.id)
    .eq('mode', 'archive')
    .in('status', ['won', 'lost', 'expired'])
    .limit(1000)

  if (error) throw new RequestError('temporary_server_failure', error.message, 503)

  const distribution = Array.from({ length: 6 }, () => 0)
  let wins = 0
  for (const session of sessions ?? []) {
    if (session.status === 'won') {
      wins += 1
      if (session.attempt_count >= 1 && session.attempt_count <= 6) distribution[session.attempt_count - 1] += 1
    }
  }

  return { archiveStats: { played: sessions?.length ?? 0, wins, distribution } }
}

async function accountHistory(request: Request) {
  const authUser = await requireConfirmedUser(request)
  const { data, error } = await admin.from('wordle_game_sessions')
    .select('mode, daily_date, status, attempt_count, completed_at, wordle_words!inner(public_key)')
    .eq('auth_user_id', authUser.id).in('mode', ['daily', 'unlimited']).in('status', ['won', 'lost', 'expired'])
    .order('completed_at', { ascending: false }).limit(500)
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  return { accountHistory: (data ?? []).map((session) => ({
    mode: session.mode, date: session.daily_date, puzzleId: (session.wordle_words as { public_key: string }).public_key,
    won: session.status === 'won', guesses: session.attempt_count, completedAt: session.completed_at,
  })) }
}

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST for this endpoint.', 405)

  try {
    const body = await readBody(request)
    const action = body.action
    if (['connections-stats', 'connections-archive-list', 'connections-archive-stats', 'archive-list', 'archive-stats', 'account-history'].includes(String(action))) {
      if (!await consumeRateLimit(admin, request, `wordle-read-${String(action)}`, 60, 60)) {
        throw new RequestError('rate_limited', 'Too many requests. Try again shortly.', 429)
      }
    }
    if (action === 'start') return json(await startSession(body, request))
    if (action === 'connections-start') return json(await startConnections(body, request))
    if (action === 'connections-submit') return json(await submitConnections(body, request))
    if (action === 'connections-stats') return json(await connectionsStats(request))
    if (action === 'connections-archive-list') return json(await listConnectionsArchive(request))
    if (action === 'connections-archive-stats') return json(await connectionsArchiveStats(request))
    if (action === 'archive-list') return json(await listArchive(body, request))
    if (action === 'archive-stats') return json(await archiveStats(request))
    if (action === 'account-history') return json(await accountHistory(request))
    if (action === 'guess') return json(await submitGuess(body, request))
    throw new RequestError('invalid_action', 'The requested action is invalid.', 400)
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.code, error.message, error.status)
    if (error instanceof Error && error.message === 'invalid_json') return errorResponse('invalid_json', 'The request body is not valid JSON.', 400)
    if (error instanceof Error && error.message === 'request_body_too_large') return errorResponse('request_body_too_large', 'The request body is too large.', 413)
    console.error('wordle_function_error', error)
    return errorResponse('temporary_server_failure', 'The service is temporarily unavailable.', 503)
  }
}

Deno.serve(handle)
