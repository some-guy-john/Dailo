const supabaseUrl = process.env.VITE_SUPABASE_URL ?? 'https://imndxrsbavywbsnyreyz.supabase.co'
const anonKey = process.env.DAILO_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

if (!anonKey) {
  console.error('Set DAILO_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.')
  process.exit(1)
}

async function check(functionName, body, expectedStatus, expectedCode) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  const code = payload.error?.code
  if (response.status !== expectedStatus || code !== expectedCode) {
    throw new Error(`${functionName}: expected ${expectedStatus} ${expectedCode}, received ${response.status} ${code ?? 'no-error-code'}`)
  }
  console.log(`PASS ${functionName}: ${response.status} ${code}`)
}

await check('wordle', { action: 'health-check-invalid-action' }, 400, 'invalid_action')
await check('wordo-versus', { action: 'health-check-invalid-action' }, 400, 'invalid_action')
await check('dailo-admin', { action: 'overview' }, 401, 'admin_auth_required')
console.log('Production function health checks completed.')
