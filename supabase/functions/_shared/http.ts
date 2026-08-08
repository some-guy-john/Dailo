export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const maxBytes = 64 * 1024
  const contentLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('request_body_too_large')
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('request_body_too_large')
    const body = JSON.parse(raw)
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch (error) {
    if (error instanceof Error && error.message === 'request_body_too_large') throw error
    throw new Error('invalid_json')
  }
}
