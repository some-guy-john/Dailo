import { supabase } from '../lib/supabase'

export type AdminOverview = {
  environment: string
  wordo: Array<{ london_date: string; status: string }>
  connections: Array<{ london_date: string; status: string }>
  audit: Array<{ action: string; entity_type: string; entity_key: string; created_at: string }>
}

export class AdminError extends Error { constructor(public code: string, message: string) { super(message) } }

async function call(body: Record<string, unknown>) {
  const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
  if (!session) throw new AdminError('admin_auth_required', 'Sign in with an administrator account.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dailo-admin`, {
    method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new AdminError(payload.error?.code ?? 'temporary_server_failure', payload.error?.message ?? 'The admin service is unavailable.')
  return payload
}

export async function loadAdminOverview(): Promise<AdminOverview> { return call({ action: 'overview' }) }
export async function createConnectionsDraft(puzzle: unknown) { return call({ action: 'connections-create-draft', puzzle }) }
export async function publishConnectionsDraft(date: string) { return call({ action: 'connections-publish', date }) }
