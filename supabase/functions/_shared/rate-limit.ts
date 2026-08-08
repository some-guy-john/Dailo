import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashToken } from './wordle.ts'

function requestAddress(request: Request): string {
  const direct = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip')
  if (direct?.trim()) return direct.trim()
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

export async function consumeRateLimit(
  client: SupabaseClient,
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const bucketKey = await hashToken(`${scope}:${requestAddress(request)}`)
  const { data, error } = await client.rpc('dailo_consume_rate_limit', {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new Error(`rate_limit_unavailable:${error.message}`)
  return data === true
}
