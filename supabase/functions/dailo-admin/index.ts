import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, errorResponse, json, readBody } from '../_shared/http.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const allowedUsers = new Set((Deno.env.get('DAILO_ADMIN_USER_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean))

class RequestError extends Error { constructor(public code: string, message: string, public status: number) { super(message) } }

async function requireAdmin(request: Request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new RequestError('admin_auth_required', 'Sign in with an administrator account.', 401)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.email_confirmed_at) throw new RequestError('admin_auth_required', 'Sign in with a confirmed administrator account.', 401)
  if (!allowedUsers.has(data.user.id)) throw new RequestError('admin_forbidden', 'This account is not allowed to administer puzzles.', 403)
  return data.user
}

function validatePuzzle(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('invalid_puzzle', 'Puzzle content must be an object.', 422)
  const puzzle = value as Record<string, unknown>
  if (typeof puzzle.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(puzzle.date)) throw new RequestError('invalid_puzzle', 'Use a valid London date.', 422)
  if (!Array.isArray(puzzle.groups) || puzzle.groups.length !== 4) throw new RequestError('invalid_puzzle', 'Provide four groups.', 422)
  const groups = puzzle.groups.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('invalid_puzzle', `Group ${index + 1} is invalid.`, 422)
    const group = value as Record<string, unknown>
    const words = Array.isArray(group.words) ? group.words.map((word) => typeof word === 'string' ? word.trim().toUpperCase() : '') : []
    if (typeof group.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.key) || typeof group.label !== 'string' || !group.label.trim() || group.label.trim().length > 80 || !Number.isInteger(group.difficulty) || Number(group.difficulty) < 1 || Number(group.difficulty) > 4 || words.length !== 4 || words.some((word) => !/^[A-Z][A-Z0-9 '&-]*$/.test(word))) {
      throw new RequestError('invalid_puzzle', `Group ${index + 1} is invalid.`, 422)
    }
    return { key: group.key, label: group.label.trim(), difficulty: group.difficulty, words }
  })
  const words = groups.flatMap((group) => group.words)
  if (new Set(words).size !== 16 || new Set(groups.map((group) => group.key)).size !== 4 || new Set(groups.map((group) => group.difficulty)).size !== 4) throw new RequestError('invalid_puzzle', 'Words, keys, and difficulty levels must be unique.', 422)
  return { date: puzzle.date, words, groups: groups.sort((left, right) => Number(left.difficulty) - Number(right.difficulty)) }
}

async function overview() {
  const [{ data: wordo, error: wordoError }, { data: connections, error: connectionsError }, { data: audit, error: auditError }] = await Promise.all([
    admin.from('wordle_daily_assignments').select('london_date, status').order('london_date', { ascending: false }).limit(60),
    admin.from('connections_daily_puzzles').select('london_date, status').order('london_date', { ascending: false }).limit(60),
    admin.from('dailo_admin_audit').select('action, entity_type, entity_key, created_at').order('created_at', { ascending: false }).limit(20),
  ])
  if (wordoError || connectionsError || auditError) throw new RequestError('temporary_server_failure', wordoError?.message ?? connectionsError?.message ?? auditError?.message ?? 'Admin data unavailable.', 503)
  return { environment: Deno.env.get('DAILO_ENVIRONMENT') ?? 'production', wordo, connections, audit }
}

async function createConnectionsDraft(body: Record<string, unknown>, userId: string) {
  const puzzle = validatePuzzle(body.puzzle)
  const { data, error } = await admin.from('connections_daily_puzzles').insert({ london_date: puzzle.date, words: puzzle.words, groups: puzzle.groups, status: 'draft' }).select('public_key, london_date, status').single()
  if (error) throw new RequestError(error.code === '23505' ? 'date_conflict' : 'temporary_server_failure', error.code === '23505' ? 'That date already has a Connections puzzle.' : error.message, error.code === '23505' ? 409 : 503)
  await admin.from('dailo_admin_audit').insert({ auth_user_id: userId, action: 'create_draft', entity_type: 'connections', entity_key: puzzle.date, details: { publicKey: data.public_key } })
  return data
}

async function publishConnections(body: Record<string, unknown>, userId: string) {
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new RequestError('invalid_date', 'Use a valid date.', 422)
  const { data, error } = await admin.from('connections_daily_puzzles').update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('london_date', body.date).eq('status', 'draft').select('public_key, london_date, status').maybeSingle()
  if (error) throw new RequestError('temporary_server_failure', error.message, 503)
  if (!data) throw new RequestError('draft_not_found', 'No draft exists for that date.', 404)
  await admin.from('dailo_admin_audit').insert({ auth_user_id: userId, action: 'publish', entity_type: 'connections', entity_key: body.date, details: { publicKey: data.public_key } })
  return data
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST.', 405)
  try {
    const user = await requireAdmin(request)
    const body = await readBody(request)
    if (body.action === 'overview') return json(await overview())
    if (body.action === 'connections-create-draft') return json({ puzzle: await createConnectionsDraft(body, user.id) })
    if (body.action === 'connections-publish') return json({ puzzle: await publishConnections(body, user.id) })
    throw new RequestError('invalid_action', 'The requested admin action is invalid.', 400)
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.code, error.message, error.status)
    if (error instanceof Error && error.message === 'invalid_json') return errorResponse('invalid_json', 'The request body is invalid.', 400)
    console.error('dailo_admin_error', error)
    return errorResponse('temporary_server_failure', 'The admin service is unavailable.', 503)
  }
}

Deno.serve(handle)
