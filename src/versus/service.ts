import type { VersusMatch } from './types'

type VersusResponse = {
  inviteToken?: string
  participantToken?: string
  state?: Omit<VersusMatch, 'participantToken'>
  error?: { code: string; message: string }
}

export class VersusServiceError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

function endpoint() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wordo-versus`
}

async function call(body: Record<string, unknown>): Promise<VersusResponse> {
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
    throw new VersusServiceError('temporary_server_failure', 'The match service could not be reached.')
  }
  let payload: VersusResponse
  try {
    payload = await response.json() as VersusResponse
  } catch {
    throw new VersusServiceError('temporary_server_failure', 'The match service returned an invalid response.')
  }
  if (!response.ok || payload.error) throw new VersusServiceError(payload.error?.code ?? 'temporary_server_failure', payload.error?.message ?? 'The match service is unavailable.')
  return payload
}

function match(response: VersusResponse, fallbackToken?: string): VersusMatch {
  const participantToken = response.participantToken ?? fallbackToken
  if (!response.state || !participantToken) throw new VersusServiceError('temporary_server_failure', 'The match service returned incomplete state.')
  return { ...response.state, participantToken }
}

export async function createVersus(displayName: string): Promise<{ match: VersusMatch; inviteToken: string }> {
  const response = await call({ action: 'create', displayName })
  if (!response.inviteToken) throw new VersusServiceError('temporary_server_failure', 'The match invitation was not created.')
  return { match: match(response), inviteToken: response.inviteToken }
}

export async function joinVersus(inviteToken: string, displayName: string): Promise<VersusMatch> {
  return match(await call({ action: 'join', inviteToken, displayName }))
}

export async function getVersusState(participantToken: string): Promise<VersusMatch> {
  return match(await call({ action: 'state', participantToken }), participantToken)
}

export async function submitVersusGuess(matchState: VersusMatch, guess: string, idempotencyKey: string): Promise<VersusMatch> {
  return match(await call({
    action: 'guess', participantToken: matchState.participantToken, guess,
    expectedAttempt: matchState.attempts.length + 1, idempotencyKey,
  }), matchState.participantToken)
}

export async function concedeVersus(matchState: VersusMatch): Promise<VersusMatch> {
  return match(await call({ action: 'concede', participantToken: matchState.participantToken }), matchState.participantToken)
}
