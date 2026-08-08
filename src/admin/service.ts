import { supabase } from '../lib/supabase'

export type AdminOverview = {
  environment: string
  wordo: Array<{ london_date: string; status: string }>
  connections: Array<{ london_date: string; status: string }>
  audit: Array<{ action: string; entity_type: string; entity_key: string; created_at: string }>
}

export class AdminError extends Error { constructor(public code: string, message: string) { super(message) } }

async function call<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
  if (!session) throw new AdminError('admin_auth_required', 'Sign in with an administrator account.')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dailo-admin`, {
      method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    })
  } catch {
    throw new AdminError('temporary_server_failure', 'The admin service could not be reached.')
  } finally {
    window.clearTimeout(timeout)
  }
  let payload: T & { error?: { code?: string; message?: string } }
  try {
    payload = await response.json() as T & { error?: { code?: string; message?: string } }
  } catch {
    throw new AdminError('temporary_server_failure', 'The admin service returned an invalid response.')
  }
  if (!response.ok || payload.error) throw new AdminError(payload.error?.code ?? 'temporary_server_failure', payload.error?.message ?? 'The admin service is unavailable.')
  return payload
}

export async function loadAdminOverview(): Promise<AdminOverview> { return call({ action: 'overview' }) }
export async function createConnectionsDraft(puzzle: unknown) { return call({ action: 'connections-create-draft', puzzle }) }
export async function publishConnectionsDraft(date: string) { return call({ action: 'connections-publish', date }) }
